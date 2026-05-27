// app/human-dilemma/[id].tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/auth/AuthModalContext";
import { useTeleprompter } from "@/context/TeleprompterContext";
import { useVerseSelection } from "@/context/VerseSelectionContext";
import { maybeOpenLogin } from "@/utils/routeAccess";
import { upsertAudioTextLookup } from "@/utils/audioTextLookup";
import { useLocalSearchParams, useRouter } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Vibration,
  View,
  useWindowDimensions,
} from "react-native";
import DirectionalText from "@/components/DirectionalText";
import MediaImage from "@/components/MediaImage";
import PageBottomMeta from "@/components/layout/PageBottomMeta";
import { getExpoSpeechModule, resolveTtsLocale, speakWithResolvedVoice, stopResolvedSpeech } from "@/utils/ttsSupport";
import { FUNCTIONS_ORIGIN } from "@/utils/functionApi";

type ExpoSpeechModule = {
  stop: () => void;
  speak: (
    text: string,
    options?: {
      language?: string;
      onDone?: () => void;
      onStopped?: () => void;
      onError?: () => void;
    }
  ) => void;
};

type Raw = Record<string, any>;

type Item = {
  id: string;
  title: string;
  summary?: string;
  image?: string;
  numberOfLines?: number;
};

function pickTitle(raw: Raw): string | undefined {
  const candidates = [
    raw.title,
    raw.name,
    raw.label,
    raw.text,
    raw.topic?.title,
    raw.heading,
  ];
  const found = candidates.find((v) => typeof v === "string" && v.trim().length > 0);
  return found?.trim();
}

function normalize(raw: Raw): Item | null {
  const id = String(
    raw.id ??
      raw._id ??
      raw.key ??
      raw.slug ??
      raw.code ??
      raw.value ??
      ""
  ).trim();

  const title = pickTitle(raw);
  if (!title) return null;

  return {
    id: id || title,
    title,
    summary:
      typeof raw.summary === "string" && raw.summary.trim()
        ? raw.summary.trim()
        : undefined,
    image:
      typeof raw.image === "string" && raw.image.trim()
        ? raw.image.trim()
        : undefined,
  };
}

type SeedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: Item[] }
  | { status: "error"; message: string };

const FETCH_TIMEOUT_MS = 25000;
const FETCH_RETRY_ATTEMPTS = 2;
const FETCH_RETRY_DELAY_MS = 500;
const FUNCTION_HOSTS = [FUNCTIONS_ORIGIN] as const;

async function fetchJsonWithTimeout(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...(init || {}), signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFromCandidates(
  urls: string[],
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
  retryAttempts = FETCH_RETRY_ATTEMPTS,
): Promise<Response> {
  let lastError: unknown = new Error("No fetch candidates");
  let lastResponse: Response | null = null;
  for (const url of urls) {
    for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
      try {
        const response = await fetchJsonWithTimeout(url, init, timeoutMs);
        if (response.ok || response.status === 401 || response.status === 403) {
          return response;
        }
        lastResponse = response;
        const retryableStatus =
          response.status === 404 || response.status === 408 || response.status === 429 || response.status >= 500;
        const isLastAttempt = attempt >= retryAttempts;
        if (!retryableStatus || isLastAttempt) break;
        await sleep(FETCH_RETRY_DELAY_MS * (attempt + 1));
      } catch (err) {
        lastError = err;
        const isLastAttempt = attempt >= retryAttempts;
        if (!isLastAttempt) {
          await sleep(FETCH_RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError;
}


type PlaylistTrack = {
  label: string;
  url: string;
  type: "article" | "verse";
  verseKey?: string;
};

type Verse = {
  chapter?: number;
  verse?: number;
  sanskrit?: string;
  recite?: string;
  learn2recite?: string;
  narration?: string;
  hindiNarration?: string;
};

type Detail = {
  id: string;
  title: string;
  summary?: string;
  image?: string;
  body?: string;   // requested-language text
  bodyEN?: string; // English text if provided
  audioUrl?: string;
  videoUrl?: string;
  verses?: Verse[];
};

type SelectedDilemmaMeta = {
  id: string;
  summary?: string;
  image?: string;
};

function pickString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function toPositiveIntOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : undefined;
}

function getShortSnippet(input: string, maxChars = 120): string {
  const normalized = String(input || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const sentence = normalized.split(/[.!?।]/).find((part) => String(part || "").trim().length > 0) || normalized;
  if (sentence.length <= maxChars) return sentence.trim();
  return `${sentence.slice(0, maxChars).trim()}...`;
}

export default function HumanDilemmaDetail(): React.ReactElement {
  const params = useLocalSearchParams() as Record<string, string | undefined>;
  const { lang, t } = useLanguage();
  const auth = useAuth();
  const sessionIdParam = useMemo(() => {
    const candidate = auth.sessionId?.trim();
    return candidate ? candidate : null;
  }, [auth.sessionId]);
  const routeSelection = useMemo<SelectedDilemmaMeta | null>(() => {
    const routeId =
      typeof params?.id === "string" && params.id.trim()
        ? params.id.trim()
        : undefined;
    if (!routeId) return null;
    return {
      id: routeId,
      summary: pickString(params.summary),
      image: pickString(params.image),
    };
  }, [params?.id, params?.summary, params?.image]);
  const [selectedMeta, setSelectedMeta] = useState<SelectedDilemmaMeta | null>(routeSelection);
  const [listState, setListState] = useState<SeedState>({ status: "idle" });
  const [pickerOpen, setPickerOpen] = useState(false);

  // (i18n is now handled by useLanguage context)
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { updateSelection } = useVerseSelection();
  const speechRef = useRef<ExpoSpeechModule | null>(null);
  const controlNodeMapRef = useRef<Record<string, any>>({});
  const ttsRunIdRef = useRef(0);
  const [activeTtsKey, setActiveTtsKey] = useState<string | null>(null);
  const videoLongPressTriggeredRef = useRef(false);
  const tileLongPressTriggeredRef = useRef(false);
  const { registerAnchor, openTeleprompter, closeTeleprompter } = useTeleprompter();

  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; data: Detail }
    | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    if (!routeSelection?.id) return;
    setSelectedMeta((prev) => {
      if (
        prev?.id === routeSelection.id &&
        prev?.summary === routeSelection.summary &&
        prev?.image === routeSelection.image
      ) {
        return prev;
      }
      return routeSelection;
    });
  }, [routeSelection]);

  useEffect(() => {
    if (!selectedMeta?.id) return;
    const currentId =
      typeof params?.id === "string" && params.id.trim() ? params.id.trim() : "";
    const currentSummary = pickString(params?.summary) || "";
    const currentImage = pickString(params?.image) || "";
    const nextSummary = selectedMeta.summary || "";
    const nextImage = selectedMeta.image || "";
    const sameRouteState =
      currentId === selectedMeta.id &&
      currentSummary === nextSummary &&
      currentImage === nextImage;
    if (sameRouteState) return;
    const nextParams: Record<string, string> = {
      id: selectedMeta.id,
    };
    if (nextSummary) nextParams.summary = nextSummary;
    if (nextImage) nextParams.image = nextImage;
    router.replace({
      pathname: "/dilemma",
      params: nextParams,
    });
  }, [params?.id, params?.image, params?.summary, router, selectedMeta]);

  useEffect(() => {
    speechRef.current = getExpoSpeechModule();
  }, []);

  const stopTts = useCallback(() => {
    ttsRunIdRef.current += 1;
    setActiveTtsKey(null);
    void stopResolvedSpeech(speechRef.current);
    if (Platform.OS === "web") {
      try {
        (globalThis as any)?.speechSynthesis?.cancel?.();
      } catch {}
    }
    closeTeleprompter();
  }, [closeTeleprompter]);

  const setControlNodeRef = useCallback(
    (key: string, node: any) => {
      const normalized = String(key || "").trim();
      if (!normalized) return;
      if (node) {
        controlNodeMapRef.current[normalized] = node;
        registerAnchor(normalized, node);
      } else {
        delete controlNodeMapRef.current[normalized];
        registerAnchor(normalized, null);
      }
    },
    [registerAnchor]
  );

  const speakText = useCallback(
    (key: string, text: string, anchorKey = key, header?: string) => {
      const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
      const normalizedHeader = String(header || "").replace(/\s+/g, " ").trim();
      const normalized = normalizedHeader
        ? `${normalizedHeader}. ${normalizedText}`.trim()
        : normalizedText;
      if (!normalized) return;
      if (activeTtsKey === key) {
        stopTts();
        return;
      }
      stopTts();
      const runId = ttsRunIdRef.current + 1;
      ttsRunIdRef.current = runId;
      setActiveTtsKey(key);
      void openTeleprompter({
        anchorKey,
        text: normalized,
        speechRate: 1,
        pageKey: "/dilemma",
        playerKey: key,
        kind: "tts",
      });
      upsertAudioTextLookup({
        pageKey: "/dilemma",
        playerKey: key,
        kind: "tts",
        text: normalized,
        source: "HumanDilemma",
      });
      const done = () => {
        if (ttsRunIdRef.current !== runId) return;
        setActiveTtsKey(null);
      };

      if (Platform.OS !== "web" || speechRef.current) {
        void speakWithResolvedVoice(speechRef.current, lang, normalized, {
          onDone: done,
          onStopped: done,
          onError: done,
        }).catch(done);
        return;
      }

      if (Platform.OS === "web") {
        const webWindow = (globalThis as any)?.window;
        const synth = webWindow?.speechSynthesis ?? (globalThis as any)?.speechSynthesis;
        const Utterance = webWindow?.SpeechSynthesisUtterance;
        if (!synth || !Utterance) {
          done();
          return;
        }
        const utterance = new Utterance(normalized);
        utterance.lang = resolveTtsLocale(lang, normalized);
        utterance.onend = done;
        utterance.onerror = done;
        synth.speak(utterance);
        return;
      }

      done();
    },
    [activeTtsKey, lang, openTeleprompter, stopTts],
  );

  useEffect(() => {
    return () => {
      stopTts();
    };
  }, [stopTts]);

  const listUrls = useMemo(() => {
    return FUNCTION_HOSTS.map((host) => {
      const u = new URL(`${host}/_functions/dilemmaList`);
      if (lang) u.searchParams.set("lang", lang);
      if (sessionIdParam) {
        u.searchParams.set("sessionId", sessionIdParam);
        u.searchParams.set("session", sessionIdParam);
      }
      return u.toString();
    });
  }, [lang, sessionIdParam]);

  const detailId = selectedMeta?.id;
  const detailUrls = useMemo(() => {
    if (!detailId) return [] as string[];
    return FUNCTION_HOSTS.map((host) => {
      const u = new URL(`${host}/_functions/mydil`);
      u.searchParams.set("id", detailId);
      if (lang) u.searchParams.set("lang", lang);
      if (sessionIdParam) {
        u.searchParams.set("sessionId", sessionIdParam);
        u.searchParams.set("session", sessionIdParam);
      }
      return u.toString();
    });
  }, [detailId, lang, sessionIdParam]);

  const detailSummary = selectedMeta?.summary;
  const detailImage = selectedMeta?.image;
  const sessionHeaders = useMemo(() => {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (sessionIdParam) {
      headers["x-session-id"] = sessionIdParam;
      headers["x-session"] = sessionIdParam;
    }
    return headers;
  }, [sessionIdParam]);

  const handleAccessControlError = useCallback(
    (response: Response) => {
      if (response.status === 401 || response.status === 403) {
        maybeOpenLogin(auth.openLogin, "login");
        throw new Error(t("Access denied. Please sign in to continue."));
      }
    },
    [auth, t],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setListState({ status: "loading" });
        const res = await fetchFromCandidates(listUrls, { headers: sessionHeaders });
        handleAccessControlError(res);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Raw[] | Raw;

        const list: Raw[] = Array.isArray(json)
          ? json
          : Array.isArray((json as any)?.data)
          ? (json as any).data
          : [];

        const normalized = list
          .map(normalize)
          .filter((x): x is Item => !!x)
          .reduce<Item[]>((acc, cur) => {
            const key = `${cur.id}|${cur.title}`.toLowerCase();
            if (!acc.some((a) => `${a.id}|${a.title}`.toLowerCase() === key)) acc.push(cur);
            return acc;
          }, [])
          .sort((a, b) => a.title.localeCompare(b.title));

        if (!alive) return;
        setListState({ status: "ready", data: normalized });
      } catch (e: any) {
        if (!alive) return;
        if (e?.name === "AbortError") {
          setListState({ status: "error", message: t("Request timed out while loading dilemmas.") });
          return;
        }
        setListState({ status: "error", message: e?.message ?? t("Fetch failed") });
      }
    })();
    return () => {
      alive = false;
    };
  }, [listUrls, sessionHeaders, handleAccessControlError]);

  useEffect(() => {
    if (listState.status !== "ready") return;
    const list = listState.data;
    if (!list.length) {
      setSelectedMeta(null);
      return;
    }
    const preferredId = selectedMeta?.id;
    const desired = preferredId ? list.find((item) => item.id === preferredId) : undefined;
    if (preferredId && !desired) {
      // Keep route-selected dilemma even if it's not present in the lightweight list payload.
      return;
    }
    const next = desired ?? list[0];
    if (!next) {
      setSelectedMeta(null);
      return;
    }
    const isSame =
      selectedMeta &&
      next.id === selectedMeta.id &&
      next.summary === selectedMeta.summary &&
      next.image === selectedMeta.image;
    if (isSame) return;
    setSelectedMeta({
      id: next.id,
      summary: next.summary,
      image: next.image,
    });
  }, [listState, selectedMeta]);

  useEffect(() => {
    if (!detailId || !detailUrls.length) return;
    let alive = true;
    (async () => {
      try {
        setState({ status: "loading" });
        const res = await fetchFromCandidates(detailUrls, { headers: sessionHeaders });
        handleAccessControlError(res);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        const mapped: Detail = {
          id: String(json.id ?? detailId),
          title: String(json.title ?? t("Untitled")),
          summary: pickString(json.summary, detailSummary),
          image: pickString(json.image, detailImage),
          body: pickString(json.text_local, json.body, json.text),
          bodyEN: pickString(json.textEn, json.text_en),
          audioUrl: pickString(json.audioUrl),
          videoUrl: pickString(json.videoUrl, json.video),
          verses: Array.isArray(json.verses)
            ? json.verses.map((v: any, i: number) => ({
                chapter: toPositiveIntOrUndefined(v.chapter),
                verse: toPositiveIntOrUndefined(v.verse),
                sanskrit: pickString(v.sanskrit),
                recite: pickString(v.recite),
                learn2recite: pickString(v.learn2recite),
                narration: pickString(v.narration),
                hindiNarration: pickString(v.hindiNarration),
              }))
            : [],
        };

        if (!alive) return;
        setState({ status: "ready", data: mapped });
      } catch (e: any) {
        if (!alive) return;
        if (e?.name === "AbortError") {
          setState({ status: "error", message: t("Request timed out while loading dilemma details.") });
          return;
        }
        if (detailSummary || detailImage) {
          setState({
            status: "ready",
            data: {
              id: String(detailId),
              title: t("Untitled"),
              summary: detailSummary,
              image: detailImage,
              body: "",
              bodyEN: undefined,
              verses: [],
            },
          });
        } else {
          setState({ status: "error", message: e?.message ?? t("Fetch failed") });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [detailUrls, detailId, detailSummary, detailImage, sessionHeaders, handleAccessControlError]);

  // ---------- MEDIA ----------
  const detailData = state.status === "ready" ? state.data : null;
  const videoUrl = detailData?.videoUrl;
  const relevantVerses = useMemo(() => detailData?.verses ?? [], [detailData?.verses]);
  const verseTileSize = width < 768 ? 104 : 120;
  const overviewMaxWidth = width < 768 ? 9999 : 840;

  const videoPlayer: any = useVideoPlayer({ uri: "" }, (p) => {
    p.loop = true;
    p.muted = false;
  });

  useEffect(() => {
    if (!videoUrl) return;
    (async () => {
      try {
        await videoPlayer?.replaceAsync?.({ uri: videoUrl });
        await videoPlayer?.play?.();
      } catch {}
    })();
  }, [videoUrl, videoPlayer]);

  const handleVersePillNavigation = useCallback(
    (chapter?: number, verse?: number) => {
      if (!chapter || !verse) return;
      const nextChapter = Math.max(1, Number(chapter));
      const nextVerse = Math.max(1, Number(verse));
      updateSelection({ chapter: nextChapter, verse: nextVerse });
      router.push({
        pathname: "/gitaverse",
        params: {
          chapter: String(nextChapter),
          verse: String(nextVerse),
          lang: (lang || "EN").toString().toUpperCase(),
        },
      });
    },
    [lang, router, updateSelection],
  );

  const triggerTileHaptic = useCallback(() => {
    if (Platform.OS === "web") return;
    try {
      Vibration.vibrate(8);
    } catch {}
  }, []);

  const withTileAssistivePress = useCallback(
    (key: string, shortText: string, onTap: () => void) => ({
      onPressIn: triggerTileHaptic,
      delayLongPress: 320,
      onLongPress: () => {
        const normalized = String(shortText || "").trim();
        if (!normalized) return;
        tileLongPressTriggeredRef.current = true;
        speakText(`tile-${key}`, normalized, `tile-${key}`);
      },
      onPress: () => {
        if (tileLongPressTriggeredRef.current) {
          tileLongPressTriggeredRef.current = false;
          return;
        }
        onTap();
      },
    }),
    [speakText, triggerTileHaptic],
  );

  const activeId = selectedMeta?.id;
  const showEmptyMessage = listState.status === "ready" && listState.data.length === 0;
  const handleSelectDilemma = (item: Item) => {
    setSelectedMeta({
      id: item.id,
      summary: item.summary,
      image: item.image,
    });
    setPickerOpen(false);
  };

  const renderPickerContent = () => {
    if (listState.status === "idle" || listState.status === "loading") {
      return (
        <View style={styles.pickerLoading}>
          <ActivityIndicator />
          <DirectionalText>{t("Loading")}</DirectionalText>
        </View>
      );
    }
    if (listState.status === "error") {
      return (
        <DirectionalText style={styles.error}>
          {t("FailedToLoad")}: {listState.message}
        </DirectionalText>
      );
    }
    if (!listState.data.length) {
      return <DirectionalText>{t("NoDilemmasFound")}</DirectionalText>;
    }
    const selectedItem =
      listState.data.find((item) => item.id === activeId) || listState.data[0] || null;
    return (
      <View style={styles.dropdownRoot}>
        <Pressable
          style={styles.dropdownTrigger}
          onPress={() => setPickerOpen((current) => !current)}
        >
          <View style={styles.dropdownTriggerTextWrap}>
            <DirectionalText style={styles.dropdownTriggerLabel}>
              {selectedItem?.title || t("Select")}
            </DirectionalText>
            {selectedItem?.summary ? (
              <DirectionalText style={styles.dropdownTriggerSummary} numberOfLines={2}>
                {selectedItem.summary}
              </DirectionalText>
            ) : null}
          </View>
          <DirectionalText style={styles.dropdownChevron}>
            {pickerOpen ? "˄" : "˅"}
          </DirectionalText>
        </Pressable>
        {pickerOpen ? (
          <View style={styles.dropdownMenu}>
            <ScrollView nestedScrollEnabled style={styles.dropdownScroll} contentContainerStyle={styles.dropdownList}>
              {listState.data.map((item) => {
                const active = activeId === item.id;
                return (
                  <Pressable
                    key={item.id}
                    style={[
                      styles.pickerItem,
                      styles.dropdownItem,
                      active ? styles.pickerItemActive : null,
                    ]}
                    onPress={() => handleSelectDilemma(item)}
                  >
                    <DirectionalText
                      style={[
                        styles.pickerItemTitle,
                        active ? styles.pickerItemTitleActive : null,
                      ]}
                    >
                      {item.title}
                    </DirectionalText>
                    {item.summary ? (
                      <DirectionalText style={styles.pickerItemSummary} numberOfLines={2}>
                        {item.summary}
                      </DirectionalText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </View>
    );
  };

  let detailContent: React.ReactNode = null;
  if (listState.status === "idle" || listState.status === "loading") {
    detailContent = null;
  } else if (listState.status === "error") {
    detailContent = (
      <View style={styles.center}>
        <DirectionalText style={styles.error}>
          {t("FailedToLoad")}: {listState.message}
        </DirectionalText>
      </View>
    );
  } else if (showEmptyMessage) {
    detailContent = (
      <View style={styles.center}>
        <DirectionalText>{t("NoDilemmasFound")}</DirectionalText>
      </View>
    );
  } else if (!selectedMeta?.id) {
    detailContent = null;
  } else if (state.status === "idle" || state.status === "loading") {
    detailContent = (
      <View style={styles.center}>
        <ActivityIndicator />
        <DirectionalText>{t("Loading")}</DirectionalText>
      </View>
    );
  } else if (state.status === "error") {
    detailContent = (
      <View style={styles.center}>
        <DirectionalText style={styles.error}>{t("FailedToLoad")}: {state.message}</DirectionalText>
      </View>
    );
  } else if (detailData) {
    const data = detailData;
    detailContent = (
      <>
        <View style={[styles.row, { justifyContent: "space-between", alignItems: "center" }]}>
          <DirectionalText style={styles.title}>{data.title}</DirectionalText>
        </View>

        {!!data.image && (
          <MediaImage
            url={data.image}
            style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 12, marginVertical: 12 }}
          />
        )}

        {(data.videoUrl || data.body || data.bodyEN) && (
          <View style={styles.card}>
            <DirectionalText style={styles.sectionTitle}>{t("Overview")}</DirectionalText>
            <Pressable
              ref={(node) => setControlNodeRef("dilemma-overview-full", node)}
              style={[
                styles.overviewInteractiveCard,
                activeTtsKey === "dilemma-overview-full" ? styles.overviewInteractiveCardActive : null,
              ]}
              onPressIn={triggerTileHaptic}
              delayLongPress={320}
              onLongPress={() => {
                videoLongPressTriggeredRef.current = true;
                const shortText = getShortSnippet(
                  pickString(data.summary, data.body, data.bodyEN, data.title) || "",
                );
                speakText("dilemma-overview-short", shortText, "dilemma-overview-full", data.title);
              }}
              onPress={() => {
                if (videoLongPressTriggeredRef.current) {
                  videoLongPressTriggeredRef.current = false;
                  return;
                }
                const fullText =
                  [pickString(data.body), pickString(data.bodyEN)].filter(Boolean).join("\n\n") ||
                  pickString(data.summary, data.title) ||
                  "";
                speakText("dilemma-overview-full", fullText, "dilemma-overview-full", data.title);
              }}
            >
              {data.videoUrl ? (
                <View style={[styles.overviewVideoLarge, { maxWidth: overviewMaxWidth }]}>
                  <VideoView
                    style={styles.overviewVideoInner}
                    player={videoPlayer}
                    nativeControls={false}
                    fullscreenOptions={{ enable: false }}
                    allowsPictureInPicture={false}
                    contentFit="contain"
                  />
                </View>
              ) : null}
              <DirectionalText style={styles.overviewHintText}>
                {activeTtsKey === "dilemma-overview-full"
                  ? t("Tap to stop narration")
                  : t("Tap for full narration • Long press for short summary")}
              </DirectionalText>
            </Pressable>
          </View>
        )}

        {/* Relevant verses */}
        {relevantVerses.length > 0 && (
          <View style={styles.card}>
            <DirectionalText style={styles.sectionTitle}>{t("RelevantVerses")}</DirectionalText>
            <View style={styles.relevantGrid}>
              {relevantVerses.map((v, idx) => {
                const title = v.chapter && v.verse
                  ? `${t("Verse")} ${v.chapter}.${v.verse}`
                  : `${t("Verse")} ${idx + 1}`;
                const sanskrit = String(v.sanskrit ?? "").trim();
                return (
                  <Pressable
                    key={`rv-${idx}`}
                    ref={(node) => setControlNodeRef(`tile-rv-${idx}`, node)}
                    style={[styles.squareTile, { width: verseTileSize, height: verseTileSize }]}
                    {...withTileAssistivePress(`rv-${idx}`, title, () =>
                      handleVersePillNavigation(v.chapter, v.verse),
                    )}
                  >
                    <DirectionalText style={styles.squareTileTitle} numberOfLines={2}>
                      {title}
                    </DirectionalText>
                    {!!sanskrit && (
                      <DirectionalText style={styles.squareTileSubtitle} numberOfLines={2}>
                        {sanskrit}
                      </DirectionalText>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable
        style={[styles.cta, { alignSelf: "flex-start" }]}
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/");
        }}
      >
        <DirectionalText style={styles.ctaText}>{t("Back")}</DirectionalText>
      </Pressable>

      <View style={styles.pickerContainer}>
        <DirectionalText style={styles.pickerHeading}>{t("HumanDilemmas")}</DirectionalText>
        {renderPickerContent()}
      </View>

      {detailContent}
      <View style={{ marginTop: 8 }}>
        <PageBottomMeta />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  error: { color: "#b00020" },

  title: { fontSize: 22, fontWeight: "700" },
  summary: { fontSize: 16, color: "#444" },
  body: { fontSize: 16, lineHeight: 22 },

  card: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    gap: 10,
  },

  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  overviewInteractiveCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.15)",
    backgroundColor: "rgba(15,23,42,0.04)",
    padding: 10,
    gap: 8,
  },
  overviewInteractiveCardActive: {
    borderColor: "rgba(34,197,94,0.65)",
    backgroundColor: "rgba(34,197,94,0.12)",
  },
  overviewVideoLarge: {
    width: "100%",
    alignSelf: "center",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  overviewVideoInner: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  overviewHintText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
  },

  row: { flexDirection: "row", alignItems: "center", gap: 12 },

  cta: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#0a84ff",
    alignSelf: "flex-start",
  },
  ctaText: { color: "#fff", fontWeight: "600" },

  relevantGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  squareTile: {
    borderRadius: 12,
    backgroundColor: "rgba(15,23,42,0.06)",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.22)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    overflow: "hidden",
  },
  squareTileTitle: {
    fontWeight: "600",
    color: "#0f172a",
    fontSize: 12,
    textAlign: "center",
  },
  squareTileSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: "#475569",
    textAlign: "center",
  },
  pickerContainer: { gap: 8 },
  pickerHeading: { fontSize: 18, fontWeight: "700" },
  dropdownRoot: { gap: 8 },
  dropdownTrigger: {
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  dropdownTriggerTextWrap: { flex: 1 },
  dropdownTriggerLabel: { fontWeight: "700", color: "#0f172a", fontSize: 15 },
  dropdownTriggerSummary: { marginTop: 4, color: "#475569", fontSize: 12 },
  dropdownChevron: { color: "#0f172a", fontSize: 18, fontWeight: "700" },
  dropdownMenu: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dbe4ee",
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  dropdownScroll: { maxHeight: 320 },
  dropdownList: { padding: 8, gap: 8 },
  pickerItem: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    minWidth: 160,
  },
  dropdownItem: { minWidth: 0 },
  pickerItemActive: { borderColor: "#0a84ff", backgroundColor: "#e0f2fe" },
  pickerItemTitle: { fontWeight: "600" },
  pickerItemTitleActive: { color: "#1d4ed8" },
  pickerItemSummary: { marginTop: 4, color: "#475569", fontSize: 13 },
  pickerLoading: { flexDirection: "row", alignItems: "center", gap: 8 },
});
