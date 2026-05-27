import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  Image,
  ImageSourcePropType,
  useWindowDimensions,
  Vibration,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useAuth } from "../auth/AuthModalContext";
import { useLanguage } from "../context/LanguageContext";
import { useTeleprompter } from "../context/TeleprompterContext";
import { useVerseSelection } from "../context/VerseSelectionContext";
import { guardProtectedNavigation } from "../utils/routeAccess";
import GitaVerseImageCard from "../components/gitaVerse/GitaVerseImageCard";
import AppIcon from "../components/AppIcon";
import PageBottomMeta from "../components/layout/PageBottomMeta";
import { getExpoSpeechModule, resolveTtsLocale, speakWithResolvedVoice, stopResolvedSpeech } from "../utils/ttsSupport";
import { APP_LOGO_IMAGE } from "../utils/logoAssets";
import {
  mergeWorldEntriesPreserveImages,
  normalizeWorldEntries,
  readCachedWorldViews,
  writeCachedWorldViews,
} from "../utils/worldViewsCache";
import { functionUrl } from "../utils/functionApi";

const HIGHLIGHT_SHLOKA_ENDPOINT = functionUrl("HighlightShloka");
const WORLD_VIEWS_ENDPOINT = functionUrl("GitaWorldViews");

type HighlightPayload = {
  chapter?: number;
  verse?: number;
  sanskrit?: string;
};

type WorldViewEntry = {
  name?: string;
  view?: string;
  image_url?: string;
  domain?: string;
};

type WorldViewPayload = {
  entries?: WorldViewEntry[];
};

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

const parseJsonSafe = (text: string) => {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
};

const normalizeWorldImageUrl = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const decoded = decodeURIComponent(raw);
  try {
    const parsed = new URL(raw);
    if (/commons\.wikimedia\.org$/i.test(parsed.hostname) && /\/w\/thumb\.php$/i.test(parsed.pathname)) {
      const fileParam = String(parsed.searchParams.get("f") || "").trim().replace(/^File:/i, "");
      const widthParam = String(parsed.searchParams.get("w") || "900").trim() || "900";
      if (fileParam) {
        return `https://commons.wikimedia.org/w/thumb.php?f=${encodeURIComponent(fileParam)}&w=${encodeURIComponent(widthParam)}`;
      }
    }
  } catch {
    // ignore parsing issues and continue with other normalizers
  }
  const redirectMatch = decoded.match(
    /https?:\/\/commons\.wikimedia\.org\/wiki\/Special:Redirect\/file\/([^?#]+)/i
  );
  const filePathMatch = decoded.match(
    /https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/([^?#]+)/i
  );
  const matchedTitle = redirectMatch?.[1] || filePathMatch?.[1] || "";
  if (!matchedTitle) return raw;
  const fileTitle = String(matchedTitle || "").trim().replace(/^File:/i, "");
  if (!fileTitle) return raw;
  // Android RN Image is unreliable with Commons redirect endpoints.
  // thumb.php is a direct image endpoint and works consistently.
  return `https://commons.wikimedia.org/w/thumb.php?f=${encodeURIComponent(fileTitle)}&w=900`;
};

const extractCommonsFileTitle = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!/commons\.wikimedia\.org$/i.test(parsed.hostname)) return "";
    const pathname = decodeURIComponent(parsed.pathname || "");
    const directMatch = pathname.match(/\/wiki\/Special:(?:Redirect\/file|FilePath)\/(.+)$/i);
    if (directMatch?.[1]) return String(directMatch[1]).replace(/^File:/i, "").trim();
    if (/\/w\/thumb\.php$/i.test(pathname)) {
      return String(parsed.searchParams.get("f") || "").replace(/^File:/i, "").trim();
    }
    return "";
  } catch {
    return "";
  }
};

const resolveCommonsThumbnailUrl = async (value: string) => {
  const fileTitle = extractCommonsFileTitle(value);
  if (!fileTitle) return "";
  try {
    const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
    endpoint.searchParams.set("action", "query");
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("origin", "*");
    endpoint.searchParams.set("prop", "imageinfo");
    endpoint.searchParams.set("iiprop", "url");
    endpoint.searchParams.set("iiurlwidth", "900");
    endpoint.searchParams.set("titles", `File:${fileTitle}`);

    const response = await fetch(endpoint.toString());
    if (!response.ok) return "";
    const payload = await response.json();
    const pages = payload?.query?.pages || {};
    const firstPage = Object.values(pages || {})?.[0] as any;
    const imageInfo = firstPage?.imageinfo?.[0] || null;
    const direct = String(imageInfo?.thumburl || imageInfo?.url || "").trim();
    return direct;
  } catch {
    return "";
  }
};

const buildImageSource = (uri: string): ImageSourcePropType => {
  const normalized = String(uri || "").trim();
  if (!normalized) return { uri: normalized };
  const isWikimedia = /^https?:\/\/(?:commons|upload)\.wikimedia\.org\//i.test(normalized);
  if (!isWikimedia) return { uri: normalized };
  return {
    uri: normalized,
    headers: {
      "User-Agent": "KalatitManisha/1.0 (Android)",
      Referer: "https://kalatitmanisha.com/",
    },
  } as ImageSourcePropType;
};

const toWorldViewEntry = (raw: any): WorldViewEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw?.name ?? raw?.title ?? raw?.label ?? "").trim();
  const view = String(raw?.view ?? raw?.description ?? raw?.text ?? raw?.summary ?? "").trim();
  const image_url = String(
    raw?.image_url ??
      raw?.imageUrl ??
      raw?.image ??
      raw?.image_uri ??
      raw?.imageUri ??
      raw?.thumbnail ??
      raw?.thumbnailUrl ??
      raw?.mediaUrl ??
      raw?.media?.url ??
      ""
  ).trim();
  const domain = String(raw?.domain ?? raw?.category ?? raw?.topic ?? "").trim();
  if (!name && !view && !image_url) return null;
  return { name, view, image_url, domain };
};

const extractWorldEntriesFromPayload = (payload: any): WorldViewEntry[] => {
  const roots = [
    payload,
    payload?.data,
    payload?.data?.data,
    payload?.result,
    payload?.result?.data,
  ];
  for (const root of roots) {
    const candidates = [
      root,
      root?.entries,
      root?.worldViews,
      root?.items,
      root?.data,
      root?.data?.entries,
      root?.data?.worldViews,
      root?.data?.items,
    ];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate) || !candidate.length) continue;
      const mapped = candidate.map(toWorldViewEntry).filter(Boolean) as WorldViewEntry[];
      if (mapped.length) return mapped;
    }
  }
  return [];
};

const FALLBACK_WORLD_VIEWS: WorldViewEntry[] = [
  {
    name: "Vedanta",
    view: "Witness consciousness endures; act without attachment.",
    image_url:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=60",
    domain: "Philosophy",
  },
];
const FALLBACK_WORLD_IMAGES = [
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=60",
  "https://images.unsplash.com/photo-1528715471579-d1bcf0ba5e83?auto=format&fit=crop&w=900&q=60",
  "https://images.unsplash.com/photo-1470115636492-6d2b56f9146d?auto=format&fit=crop&w=900&q=60",
];
const LOCAL_WORLD_IMAGE_FALLBACK = APP_LOGO_IMAGE;
const HOME_WORLD_VIEW_ICON = require("../assets/gita-icon-scripture-wheel.png");

export default function Home() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ reset?: string; email?: string }>();
  const { lang, t } = useLanguage();
  const { selection } = useVerseSelection();
  const auth = useAuth();
  const { registerAnchor, openTeleprompter, closeTeleprompter } = useTeleprompter();
  const resetPromptHandledRef = React.useRef(false);

  const safeLang = useMemo(() => (typeof lang === "string" ? lang.toUpperCase() : "EN"), [lang]);
  const safeChapter = useMemo(() => Math.max(1, Number(selection?.chapter || 1)), [selection?.chapter]);
  const safeVerse = useMemo(() => Math.max(1, Number(selection?.verse || 1)), [selection?.verse]);

  const sessionIdParam = useMemo(
    () => (auth.sessionId ?? "").trim(),
    [auth.sessionId]
  );
  const [highlightHintVisible, setHighlightHintVisible] = useState(false);
  const scholarsLabel = useMemo(() => {
    const resolved = t("common.as_understood_by_scholars");
    return resolved === "common.as_understood_by_scholars" ? "As Understood By Scholars" : resolved;
  }, [t]);

  const headers = useMemo(
    () => ({
      Accept: "application/json",
    }),
    []
  );

  const buildUrl = useCallback(
    (base: string) => {
      const url = new URL(base);
      url.searchParams.set("lang", safeLang);
      if (sessionIdParam) {
        url.searchParams.set("sessionId", sessionIdParam);
        url.searchParams.set("session", sessionIdParam);
      }
      return url.toString();
    },
    [safeLang, sessionIdParam]
  );
  const buildUrlForLang = useCallback(
    (base: string, langCode: string) => {
      const url = new URL(base);
      url.searchParams.set("lang", String(langCode || "EN").toUpperCase());
      if (sessionIdParam) {
        url.searchParams.set("sessionId", sessionIdParam);
        url.searchParams.set("session", sessionIdParam);
      }
      return url.toString();
    },
    [sessionIdParam]
  );

  const [highlight, setHighlight] = useState<HighlightPayload | null>(null);
  const [highlightLoading, setHighlightLoading] = useState(false);
  const [highlightError, setHighlightError] = useState<string | null>(null);
  const [worldEntries, setWorldEntries] = useState<WorldViewEntry[]>(FALLBACK_WORLD_VIEWS);
  const [worldLoading, setWorldLoading] = useState(false);
  const [worldError, setWorldError] = useState<string | null>(null);
  const [worldImageOverrides, setWorldImageOverrides] = useState<Record<string, string>>({});
  const [activeWorldTtsKey, setActiveWorldTtsKey] = useState<string | null>(null);
  const worldTtsRunIdRef = React.useRef(0);
  const speechRef = React.useRef<ExpoSpeechModule | null>(null);
  const longPressTriggeredRef = React.useRef(false);

  useEffect(() => {
    speechRef.current = getExpoSpeechModule();
  }, []);

  const fetchHighlight = useCallback(async () => {
    setHighlightLoading(true);
    setHighlightError(null);
    try {
      const url = buildUrl(HIGHLIGHT_SHLOKA_ENDPOINT);
      const response = await fetch(url, { headers });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      const payload = text ? JSON.parse(text) : {};
      const entry = payload?.data ?? payload ?? {};
      const chapter = Number(entry?.chapter ?? entry?.ch ?? 0);
      const verse = Number(entry?.verse ?? entry?.v ?? 0);
      const sanskrit =
        typeof entry?.sanskrit === "string"
          ? entry.sanskrit.trim()
          : typeof entry?.text === "string"
          ? entry.text.trim()
          : "";

      if (!chapter || !verse || !sanskrit) {
        throw new Error("Highlight data incomplete");
      }
      setHighlight({ chapter, verse, sanskrit });
    } catch (err: any) {
      setHighlightError(err?.message || "Unable to load highlight.");
      setHighlight(null);
    } finally {
      setHighlightLoading(false);
    }
  }, [headers, buildUrl]);

  const fetchWorldViews = useCallback(async () => {
    const cached = await readCachedWorldViews(safeLang);
    const cachedEntries = normalizeWorldEntries(cached.entries || []);
    const hasFreshCache = cached.fresh && cachedEntries.length > 0;
    if (cachedEntries.length > 0) {
      setWorldEntries((prev) => mergeWorldEntriesPreserveImages(prev, cachedEntries));
    }

    setWorldLoading(!hasFreshCache);
    setWorldError(null);
    try {
      const url = buildUrl(WORLD_VIEWS_ENDPOINT);
      const response = await fetch(url, { headers });
      const text = await response.text();
      const json = parseJsonSafe(text);
      const extracted = extractWorldEntriesFromPayload(json);
      if (extracted.length > 0) {
        let normalized = normalizeWorldEntries(extracted);

        const missingAnyImage = normalized.some((entry) => !entry?.image_url);
        if (missingAnyImage && safeLang !== "EN") {
          try {
            const fallbackRes = await fetch(buildUrlForLang(WORLD_VIEWS_ENDPOINT, "EN"), { headers });
            if (fallbackRes.ok) {
              const fallbackJsonText = await fallbackRes.text();
              const fallbackJson = parseJsonSafe(fallbackJsonText);
              const fallbackEntries = normalizeWorldEntries(extractWorldEntriesFromPayload(fallbackJson));
              if (fallbackEntries.length) {
                normalized = mergeWorldEntriesPreserveImages(fallbackEntries, normalized);
              }
            }
          } catch {
            // ignore EN fallback failures
          }
        }

        setWorldEntries((prev) => mergeWorldEntriesPreserveImages(prev, normalized));
        void writeCachedWorldViews(safeLang, normalized);
      } else {
        throw new Error("World views payload has no entries");
      }
    } catch (err: any) {
      setWorldError(err?.message || "Unable to load world views.");
    } finally {
      setWorldLoading(false);
    }
  }, [buildUrl, buildUrlForLang, headers, safeLang]);

  useEffect(() => {
    setWorldImageOverrides({});
  }, [safeLang]);

  useEffect(() => {
    fetchHighlight();
  }, [fetchHighlight]);

  useEffect(() => {
    fetchWorldViews();
  }, [fetchWorldViews]);

  const stopWorldTts = useCallback(() => {
    worldTtsRunIdRef.current += 1;
    setActiveWorldTtsKey(null);
    void stopResolvedSpeech(speechRef.current);
    if (Platform.OS === "web") {
      try {
        (globalThis as any)?.speechSynthesis?.cancel?.();
      } catch {}
    }
    closeTeleprompter();
  }, [closeTeleprompter]);

  const speakWorldView = useCallback(
    (key: string, text: string) => {
      const normalized = String(text || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
      if (!normalized) return;
      if (activeWorldTtsKey === key) {
        stopWorldTts();
        return;
      }
      stopWorldTts();
      const runId = worldTtsRunIdRef.current + 1;
      worldTtsRunIdRef.current = runId;
      setActiveWorldTtsKey(key);
      void openTeleprompter({
        anchorKey: key,
        text: normalized,
        speechRate: 1,
        pageKey: "/home",
        playerKey: key,
        kind: "tts",
      });
      const done = () => {
        if (worldTtsRunIdRef.current !== runId) return;
        setActiveWorldTtsKey(null);
      };

      if (Platform.OS !== "web" || speechRef.current) {
        void speakWithResolvedVoice(speechRef.current, safeLang, normalized, {
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
        if (!synth || !Utterance) return;
        const utterance = new Utterance(normalized);
        utterance.lang = resolveTtsLocale(safeLang, normalized);
        utterance.onend = done;
        utterance.onerror = done;
        synth.speak(utterance);
      }
    },
    [activeWorldTtsKey, openTeleprompter, safeLang, stopWorldTts]
  );

  useEffect(() => {
    return () => {
      stopWorldTts();
    };
  }, [stopWorldTts]);

  useEffect(() => {
    const resetStatus = String(params?.reset || "").trim().toLowerCase();
    const resetSucceeded = resetStatus === "success" || resetStatus === "1" || resetStatus === "true";
    if (!resetSucceeded) return;
    if (resetPromptHandledRef.current) return;
    resetPromptHandledRef.current = true;
    const email = typeof params?.email === "string" ? params.email.trim() : "";
    auth.promptLogin(email || undefined);
  }, [auth, params?.email, params?.reset]);

  const navigateToHighlight = useCallback(() => {
    if (!highlight) return;
    guardProtectedNavigation({
      targetPath: "/gitaverse",
      sessionId: auth.sessionId,
      openLogin: auth.openLogin,
      onAllowed: () => {
        router.push({
          pathname: "/gitaverse",
          params: {
            chapter: String(highlight.chapter ?? 1),
            verse: String(highlight.verse ?? 1),
            lang: safeLang,
          },
        });
      },
    });
  }, [auth.openLogin, auth.sessionId, highlight, router, safeLang]);

  const makeWorldEntryKey = useCallback((entry: WorldViewEntry, index: number) => {
    return `${String(entry?.name || "").trim()}|${String(entry?.domain || "").trim()}|${String(entry?.view || "").trim().slice(0, 80)}|${index}`;
  }, []);
  const worldImageForEntry = useCallback((entry: WorldViewEntry, index: number) => {
    const cardKey = makeWorldEntryKey(entry, index);
    const override = String(worldImageOverrides[cardKey] || "").trim();
    if (override) return override;
    const direct = normalizeWorldImageUrl(String(entry?.image_url || "").trim());
    if (direct) return direct;
    return FALLBACK_WORLD_IMAGES[index % FALLBACK_WORLD_IMAGES.length];
  }, [makeWorldEntryKey, worldImageOverrides]);
  const worldTileSize = width < 768 ? 104 : 120;
  const menuTileSize = worldTileSize;
  const mainMenuLinks = useMemo(
    () => [
      { label: t("Explore"), path: "/explore", icon: { family: "feather" as const, name: "compass" } },
      { label: t("Gita Verse"), path: "/gitaverse", icon: { family: "feather" as const, name: "book-open" } },
      { label: t("Favourites"), path: "/myfavourates", icon: { family: "feather" as const, name: "heart" } },
      { label: t("Dilemma"), path: "/dilemma", icon: { family: "feather" as const, name: "help-circle" } },
      { label: t("About"), path: "/about", icon: { family: "feather" as const, name: "info" } },
      { label: t("Privacy"), path: "/privacy-policy", icon: { family: "feather" as const, name: "shield" } },
      { label: t("Data Deletion"), path: "/data-deletion", icon: { family: "feather" as const, name: "trash-2" } },
    ],
    [t]
  );
  const triggerTileHaptic = useCallback(() => {
    if (Platform.OS === "web") return;
    try {
      Vibration.vibrate(8);
    } catch {}
  }, []);
  const withTileAssistivePress = useCallback(
    (key: string, label: string, onTap: () => void) => ({
      onPressIn: triggerTileHaptic,
      delayLongPress: 320,
      onLongPress: () => {
        const normalizedLabel = String(label || "").trim();
        if (!normalizedLabel) return;
        longPressTriggeredRef.current = true;
        speakWorldView(key, normalizedLabel);
      },
      onPress: () => {
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          return;
        }
        onTap();
      },
    }),
    [speakWorldView, triggerTileHaptic]
  );
  const handleMainMenuPress = useCallback(
    (path: string) => {
      guardProtectedNavigation({
        targetPath: path,
        sessionId: auth.sessionId,
        openLogin: auth.openLogin,
        onAllowed: () => {
          if (path === "/gitaverse") {
            router.push({
              pathname: "/gitaverse",
              params: { chapter: String(safeChapter), verse: String(safeVerse), lang: safeLang },
            });
            return;
          }
          router.push(path as any);
        },
      });
    },
    [auth.openLogin, auth.sessionId, router, safeChapter, safeLang, safeVerse]
  );
  const worldNarrationForEntry = useCallback((entry: WorldViewEntry) => {
    const name = String(entry?.name || "").trim();
    const title = String(entry?.domain || "").trim();
    const statement = String(entry?.view || "").trim();
    return [name, title, statement].filter(Boolean).join(". ");
  }, []);
  const shuffledWorldEntries = useMemo(() => {
    const items = (worldEntries || []).map((entry, index) => ({
      entry,
      stableKey: makeWorldEntryKey(entry, index),
    }));
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }, [makeWorldEntryKey, safeLang, worldEntries]);

  return (
    <>
      <ScrollView
        className="flex-1 bg-slate-50 px-4 py-5"
        contentContainerStyle={{ paddingBottom: 48, alignItems: "center" }}
      >
        <View className="space-y-6" style={{ width: "100%", alignItems: "center" }}>
          <View className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm space-y-4" style={{ width: "100%", alignItems: "center" }}>
            <View className="flex-row items-center justify-center">
              <Text className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400 text-center">
                Highlight Shloka
              </Text>
              {highlightLoading && <ActivityIndicator size="small" color="#475569" style={{ marginLeft: 8 }} />}
            </View>
            {highlight ? (
              <Pressable
                onPress={navigateToHighlight}
                onHoverIn={Platform.OS === "web" ? () => setHighlightHintVisible(true) : undefined}
                onHoverOut={Platform.OS === "web" ? () => setHighlightHintVisible(false) : undefined}
                accessibilityRole="button"
                accessibilityHint="Opens this verse in the Gita Verse page"
                style={{ alignItems: "center" as const, cursor: Platform.OS === "web" ? ("pointer" as any) : undefined }}
              >
                <Text className="text-sm text-slate-500 mb-2 text-center">
                  Chapter {highlight.chapter}, Verse {highlight.verse}
                </Text>
                <View style={{ alignItems: "center" }}>
                  <GitaVerseImageCard
                    sanskritText={String(highlight.sanskrit || "")}
                    chapter={Number(highlight.chapter || 0)}
                    verse={Number(highlight.verse || 0)}
                    width={width < 768 ? 320 : 420}
                    showVerseLabel={false}
                    minimalChrome
                  />
                  {Platform.OS === "web" && highlightHintVisible ? (
                    <View
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        borderRadius: 999,
                        backgroundColor: "rgba(15,23,42,0.88)",
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                      }}
                    >
                      <Text className="text-[11px] font-semibold text-white">{t("Open in Gita Verse")}</Text>
                    </View>
                  ) : null}
                </View>
                {Platform.OS !== "web" ? (
                  <Text className="mt-3 text-xs font-semibold text-sky-700 text-center">
                    {t("Tap to Open")}
                  </Text>
                ) : (
                  <Text className="mt-3 text-xs font-semibold text-slate-500 text-center">
                    {t("Hover or tap to open this verse")}
                  </Text>
                )}
              </Pressable>
            ) : (
              <Text className="text-base text-slate-600 text-center">{highlightError ?? "Highlight is unavailable right now."}</Text>
            )}
          </View>

          <View className="space-y-3" style={{ width: "100%", alignItems: "center" }}>
            <View
              className="flex-row items-center justify-center"
              style={{ width: "100%", columnGap: 10, rowGap: 10, flexWrap: "wrap" }}
            >
              <Image
                source={HOME_WORLD_VIEW_ICON}
                accessibilityRole="image"
                accessibilityLabel={t("Bhagavad Gita")}
                style={{ width: 42, height: 42 }}
                resizeMode="contain"
              />
              <Text className="text-lg font-semibold text-slate-900 text-center">
                {scholarsLabel}
              </Text>
              {worldLoading ? <ActivityIndicator size="small" color="#475569" /> : null}
            </View>
            <View className="flex-row flex-wrap" style={{ gap: 12, justifyContent: "center" }}>
              {shuffledWorldEntries.map(({ entry, stableKey }, index) => (
                <TouchableOpacity
                  key={stableKey}
                  ref={(node) => registerAnchor(`world-${stableKey}`, node)}
                  {...withTileAssistivePress(
                    `world-${stableKey}`,
                    String(entry?.name || "Scholar"),
                    () => speakWorldView(`world-${stableKey}`, worldNarrationForEntry(entry))
                  )}
                  className="rounded-xl border bg-white"
                  style={{
                    width: worldTileSize,
                    height: worldTileSize,
                    borderColor:
                      activeWorldTtsKey === `world-${stableKey}`
                        ? "rgba(34,197,94,0.75)"
                        : "rgba(15,23,42,0.22)",
                    backgroundColor:
                      activeWorldTtsKey === `world-${stableKey}`
                        ? "rgba(34,197,94,0.2)"
                        : "rgba(15,23,42,0.06)",
                    overflow: "hidden",
                  }}
                >
                  {(() => {
                    const cardKey = makeWorldEntryKey(entry, index);
                    const fallbackImage = FALLBACK_WORLD_IMAGES[index % FALLBACK_WORLD_IMAGES.length];
                    const imageUri = worldImageForEntry(entry, index);
                    const imageSource: ImageSourcePropType =
                      imageUri === "local" ? LOCAL_WORLD_IMAGE_FALLBACK : buildImageSource(imageUri);
                    return (
                  <Image
                    source={imageSource}
                    className="w-full h-full bg-slate-200"
                    resizeMode="cover"
                    onError={(event) => {
                      void (async () => {
                        const resolvedWikimedia = await resolveCommonsThumbnailUrl(imageUri);
                        if (resolvedWikimedia) {
                          setWorldImageOverrides((prev) => ({ ...prev, [cardKey]: resolvedWikimedia }));
                          return;
                        }
                        setWorldImageOverrides((prev) => {
                          if (!prev[cardKey]) return { ...prev, [cardKey]: fallbackImage };
                          if (prev[cardKey] === fallbackImage) return { ...prev, [cardKey]: "local" };
                          return prev;
                        });
                      })();
                      if (__DEV__) {
                        console.debug(
                          "[home] world image failed",
                          imageUri,
                          "nativeError",
                          event?.nativeEvent?.error || "",
                          "fallback",
                          fallbackImage
                        );
                      }
                    }}
                  />
                    );
                  })()}
                  <View
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      paddingHorizontal: 6,
                      paddingVertical: 6,
                      backgroundColor: "rgba(15,23,42,0.45)",
                    }}
                  >
                    <Text numberOfLines={2} className="text-xs font-semibold text-white text-center">
                      {String(entry.name || "Scholar")}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
            {worldError && (
              <Text className="text-xs font-medium text-red-600 text-center">{worldError}</Text>
            )}
          </View>

          <View className="space-y-3" style={{ width: "100%", alignItems: "center" }}>
            <Text className="text-lg font-semibold text-slate-900 text-center">{t("Main Menu")}</Text>
            <View className="flex-row flex-wrap" style={{ gap: 12, justifyContent: "center" }}>
              {mainMenuLinks.map((link) => (
                <TouchableOpacity
                  key={link.path}
                  {...withTileAssistivePress(`menu-${link.path}`, link.label, () => handleMainMenuPress(link.path))}
                  className="rounded-xl border items-center justify-center"
                  style={{
                    width: menuTileSize,
                    height: menuTileSize,
                    borderColor: "rgba(15,23,42,0.22)",
                    backgroundColor: "rgba(15,23,42,0.06)",
                  }}
                >
                  <AppIcon family={link.icon.family} name={link.icon.name} size={22} color="#0f172a" />
                  <Text
                    className="text-xs font-semibold text-slate-800 text-center"
                    style={{ marginTop: 8, paddingHorizontal: 6 }}
                    numberOfLines={2}
                  >
                    {link.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={{ marginTop: 8, width: "100%" }}>
            <PageBottomMeta />
          </View>
        </View>
      </ScrollView>

    </>
  );
}
