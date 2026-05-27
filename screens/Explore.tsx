import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  Vibration,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "../auth/AuthModalContext";
import { useLanguage } from "../context/LanguageContext";
import { useTeleprompter } from "../context/TeleprompterContext";
import { useVerseSelection } from "../context/VerseSelectionContext";
import { APP_LOGO_GIF, APP_LOGO_PNG } from "../utils/logoAssets";
import {
  mergeWorldEntriesPreserveImages,
  normalizeWorldEntries,
  readCachedWorldViews,
  writeCachedWorldViews,
} from "../utils/worldViewsCache";
import { getExpoSpeechModule, resolveTtsLocale, speakWithResolvedVoice, stopResolvedSpeech } from "../utils/ttsSupport";
import { functionUrl } from "../utils/functionApi";
import PageBottomMeta from "../components/layout/PageBottomMeta";

const GITA_HOME_ENDPOINT = functionUrl("Home");
const GITA_WORLD_VIEWS_ENDPOINT = functionUrl("GitaWorldViews");

type ChapterPayload = {
  chapter: number;
  title: string;
  lang?: string;
  description?: string;
  summary?: string;
  subtitle?: string;
  text?: string;
};

type HomePayload = {
  title?: string;
  description?: string;
  lang?: string;
  langName?: string;
  image?: string;
  chapters?: ChapterPayload[];
};

type WorldViewEntry = {
  name: string;
  domain?: string;
  era?: string;
  category?: string;
  view?: string;
  source_note?: string;
  image_url?: string;
};

type WorldViewPayload = {
  topic?: string;
  purpose?: string;
  categories?: string[];
  entries?: WorldViewEntry[];
  shared_core_message?: string;
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

const buildImageSource = (uri: string) => {
  const normalized = String(uri || "").trim();
  if (!normalized) return { uri: normalized };
  const isWikimedia = /^https?:\/\/(?:commons|upload)\.wikimedia\.org\//i.test(normalized);
  if (!isWikimedia) return { uri: normalized };
  return {
    uri: normalized,
    headers: {
      "User-Agent": `KalatitManisha/1.0 (${Platform.OS})`,
      Referer: "https://kalatitmanisha.com/",
    },
  };
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
  const era = String(raw?.era ?? "").trim() || undefined;
  const category = String(raw?.category ?? "").trim() || undefined;
  const source_note = String(raw?.source_note ?? raw?.sourceNote ?? "").trim() || undefined;
  if (!name && !view && !image_url) return null;
  return { name, view, image_url, domain, era, category, source_note };
};

const extractWorldEntriesFromPayload = (payload: any): WorldViewEntry[] => {
  const roots = [payload, payload?.data, payload?.data?.data, payload?.result, payload?.result?.data];
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

const FALLBACK_HOME: HomePayload = {
  title: "Gita Home",
  description:
    "Sankhya-yoga opens the Bhagavad-gītā with a field of Dharma framed as a sacred invitation. Explore how Krishna reorients every battlefield worry into a timeless teaching on courage, service, and clarity.",
  lang: "EN",
  langName: "English",
  image: "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?auto=format&fit=crop&w=900&q=60",
  chapters: [
    { chapter: 1, title: "Arjuna’s Despair" },
    { chapter: 2, title: "Sankhya-yoga Begins" },
    { chapter: 3, title: "Karma-yoga" },
    { chapter: 4, title: "Jnana-yoga" },
    { chapter: 9, title: "The Yoga of Royal Knowledge" },
  ],
};

const FALLBACK_WORLD_VIEWS: WorldViewPayload = {
  topic: "Shared views",
  purpose: "Bridge this verse with world traditions.",
  categories: ["ALL", "Vedanta", "Bhakti"],
  entries: [
    {
      name: "Vedanta",
      view:
        "The witness consciousness always exists. Action without attachment is ordered along sattva, rajas, and tamas.",
      domain: "Philosophy",
    },
    {
      name: "Bhakti",
      view:
        "Offering the battle to Krishna means surrendering the fruits of action while remaining devoted and attentive.",
      domain: "Devotion",
    },
    {
      name: "Stoic",
      view:
        "Focus on what is within your control—engage dutifully and let outcomes be indifferent.",
      domain: "Modern life",
    },
  ],
};
const FALLBACK_WORLD_IMAGES = [
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=60",
  "https://images.unsplash.com/photo-1528715471579-d1bcf0ba5e83?auto=format&fit=crop&w=900&q=60",
  "https://images.unsplash.com/photo-1470115636492-6d2b56f9146d?auto=format&fit=crop&w=900&q=60",
];
const LOCAL_WORLD_IMAGE_FALLBACK = APP_LOGO_GIF;
const EXPLORE_HERO_GIF = APP_LOGO_GIF;
const EXPLORE_HERO_PNG = APP_LOGO_PNG;
const EXPLORE_WORLD_VIEW_ICON = require("../assets/gita-icon-scripture-wheel.png");
const emptyHomeForLang = (langCode: string): HomePayload => ({
  title: "",
  description: "",
  lang: String(langCode || "EN").toUpperCase(),
  chapters: [],
});
const EMPTY_WORLD_VIEWS: WorldViewPayload = {
  topic: "",
  purpose: "",
  categories: [],
  entries: [],
};

export default function Explore() {
  const router = useRouter();
  const { lang, t } = useLanguage();
  const auth = useAuth();
  const { updateSelection } = useVerseSelection();
  const { registerAnchor, openTeleprompter, closeTeleprompter } = useTeleprompter();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const scholarsLabel = useMemo(() => {
    const resolved = t("common.as_understood_by_scholars");
    return resolved === "common.as_understood_by_scholars" ? "As Understood By Scholars" : resolved;
  }, [t]);
  const heroImageWidth = isWeb ? Math.min(760, Math.max(480, width - 96)) : undefined;
  const heroImageStyle = heroImageWidth
    ? {
        width: heroImageWidth,
        height: heroImageWidth * 0.6,
        alignSelf: "center" as const,
      }
    : undefined;
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const [heroSource, setHeroSource] = useState<any>(EXPLORE_HERO_GIF);

  const safeLang = useMemo(() => {
    if (typeof lang === "string") return lang.toUpperCase();
    return "EN";
  }, [lang]);

  const sessionIdParam = useMemo(
    () => (auth.sessionId ?? "").trim(),
    [auth.sessionId]
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

  const homeUrl = useMemo(() => buildUrl(GITA_HOME_ENDPOINT), [buildUrl]);
  const worldViewsUrl = useMemo(() => buildUrl(GITA_WORLD_VIEWS_ENDPOINT), [buildUrl]);

  const headers = useMemo(
    () => ({
      Accept: "application/json",
    }),
    []
  );

  const [homeData, setHomeData] = useState<HomePayload>(() =>
    safeLang === "EN" ? FALLBACK_HOME : emptyHomeForLang(safeLang)
  );
  const [worldData, setWorldData] = useState<WorldViewPayload>(() =>
    safeLang === "EN" ? FALLBACK_WORLD_VIEWS : EMPTY_WORLD_VIEWS
  );
  const [loadingHome, setLoadingHome] = useState(false);
  const [loadingWorld, setLoadingWorld] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [worldError, setWorldError] = useState<string | null>(null);
  const [worldImageOverrides, setWorldImageOverrides] = useState<Record<string, string>>({});
  const [activeWorldTtsKey, setActiveWorldTtsKey] = useState<string | null>(null);
  const worldTtsRunIdRef = React.useRef(0);
  const speechRef = React.useRef<ExpoSpeechModule | null>(null);
  const longPressTriggeredRef = React.useRef(false);

  useEffect(() => {
    speechRef.current = getExpoSpeechModule();
  }, []);

  const fetchHome = useCallback(async () => {
    setLoadingHome(true);
    setHomeError(null);
    try {
      const response = await fetch(homeUrl, { headers });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload: HomePayload = await response.json();
      setHomeData((prev) => ({
        ...prev,
        ...payload,
        chapters: payload.chapters ?? prev.chapters,
      }));
    } catch (err: any) {
      setHomeError(err?.message || "Unable to load the Explore card.");
    } finally {
      setLoadingHome(false);
    }
  }, [headers, homeUrl]);

  const fetchWorldViews = useCallback(async () => {
    const cached = await readCachedWorldViews(safeLang);
    const cachedEntries = normalizeWorldEntries((cached.entries || []) as WorldViewEntry[]);
    const hasFreshCache = cached.fresh && cachedEntries.length > 0;
    if (cachedEntries.length > 0) {
      setWorldData((prev) => ({
        ...prev,
        entries: mergeWorldEntriesPreserveImages((prev.entries || []) as WorldViewEntry[], cachedEntries),
      }));
    }

    setLoadingWorld(!hasFreshCache);
    setWorldError(null);
    try {
      const res = await fetch(worldViewsUrl, { headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      const json = parseJsonSafe(text);
      const extractedEntries = extractWorldEntriesFromPayload(json);
      if (extractedEntries.length > 0) {
        let normalizedEntries = normalizeWorldEntries(extractedEntries as WorldViewEntry[]);
        const missingAnyImage = normalizedEntries.some((entry) => !entry?.image_url);
        if (missingAnyImage && safeLang !== "EN") {
          try {
            const fallbackRes = await fetch(buildUrlForLang(GITA_WORLD_VIEWS_ENDPOINT, "EN"), { headers });
            if (fallbackRes.ok) {
              const fallbackText = await fallbackRes.text();
              const fallbackJson = parseJsonSafe(fallbackText);
              const fallbackEntries = normalizeWorldEntries(
                extractWorldEntriesFromPayload(fallbackJson) as WorldViewEntry[]
              );
              if (fallbackEntries.length) {
                normalizedEntries = mergeWorldEntriesPreserveImages(fallbackEntries, normalizedEntries);
              }
            }
          } catch {
            // ignore EN fallback errors
          }
        }
        setWorldData((prev) => ({
          ...prev,
          ...(typeof json === "object" && json?.data ? json.data : json),
          entries: mergeWorldEntriesPreserveImages(
            (prev.entries || []) as WorldViewEntry[],
            normalizedEntries
          ),
        }));
        void writeCachedWorldViews(safeLang, normalizedEntries);
      } else {
        throw new Error("World views payload has no entries");
      }
    } catch (err: any) {
      setWorldError(err?.message || "Unable to load world views.");
    } finally {
      setLoadingWorld(false);
    }
  }, [buildUrlForLang, headers, safeLang, worldViewsUrl]);

  useEffect(() => {
    fetchHome();
  }, [fetchHome]);

  useEffect(() => {
    fetchWorldViews();
  }, [fetchWorldViews]);

  useEffect(() => {
    setHomeData(safeLang === "EN" ? FALLBACK_HOME : emptyHomeForLang(safeLang));
    setWorldData(safeLang === "EN" ? FALLBACK_WORLD_VIEWS : EMPTY_WORLD_VIEWS);
    setWorldImageOverrides({});
  }, [safeLang]);

  const chapters = homeData.chapters ?? [];
  const worldEntries = worldData.entries ?? [];
  const makeWorldEntryKey = useCallback((entry: WorldViewEntry, index: number) => {
    return `${String(entry?.name || "").trim()}|${String(entry?.domain || "").trim()}|${String(entry?.view || "").trim().slice(0, 80)}|${index}`;
  }, []);
  const shuffledWorldEntries = useMemo(() => {
    const items = worldEntries.map((entry, index) => ({
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

  const worldImageForEntry = useCallback((entry: WorldViewEntry, index: number) => {
    const cardKey = makeWorldEntryKey(entry, index);
    const override = String(worldImageOverrides[cardKey] || "").trim();
    if (override) return override;
    const direct = normalizeWorldImageUrl(String(entry?.image_url || "").trim());
    if (direct) return direct;
    return FALLBACK_WORLD_IMAGES[index % FALLBACK_WORLD_IMAGES.length];
  }, [makeWorldEntryKey, worldImageOverrides]);
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
        pageKey: "/explore",
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
  const chapterNarration = useCallback(
    (chapter: ChapterPayload) => {
      const chapterNumber = Number(chapter?.chapter || 0);
      const title = String(chapter?.title || "").trim();
      const detail = String(
        chapter?.description ?? chapter?.summary ?? chapter?.subtitle ?? chapter?.text ?? ""
      ).trim();
      const header = `${t("Chapter")} ${chapterNumber}${title ? `. ${title}` : ""}`;
      if (!detail) return header;
      const normalizedHeader = header.replace(/\s+/g, " ").trim().toLowerCase();
      const normalizedDetail = detail.replace(/\s+/g, " ").trim().toLowerCase();
      if (normalizedDetail.startsWith(normalizedHeader)) return detail;
      return `${header}. ${detail}`;
    },
    [t]
  );
  const worldNarrationForEntry = useCallback((entry: WorldViewEntry) => {
    const name = String(entry?.name || "").trim();
    const title = String(entry?.domain || "").trim();
    const statement = String(entry?.view || "").trim();
    return [name, title, statement].filter(Boolean).join(". ");
  }, []);
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
  const worldTileSize = width < 768 ? 104 : 120;
  const openChapterScreen = useCallback(
    (chapter: ChapterPayload) => {
      const chapterNumber = Math.max(1, Number(chapter?.chapter || 1));
      const title = String(chapter?.title || "").trim();
      updateSelection({ chapter: chapterNumber, verse: 1 });
      router.push({
        pathname: "/chapter",
        params: {
          chapter: String(chapterNumber),
          title,
          lang: safeLang,
        },
      });
    },
    [router, safeLang, updateSelection]
  );

  return (
    <ScrollView
      className="flex-1 bg-slate-50 px-4 py-5"
      contentContainerStyle={{ paddingBottom: 48, alignItems: "center" }}
    >
      <View className="space-y-6" style={{ width: "100%", alignItems: "center" }}>
        <TouchableOpacity
          ref={(node) => registerAnchor("explore-hero-image", node)}
          {...withTileAssistivePress(
            "explore-hero-image",
            homeData.title || t("Gita Home"),
            () =>
              speakWorldView(
                "explore-hero-image",
                `${homeData.title || t("Gita Home")}. ${String(homeData.description || "").trim()}`
              )
          )}
          style={{ width: "100%", alignItems: "center" }}
        >
          <View
            style={[
              {
                marginBottom: 8,
                width: "100%",
                height: 192,
                overflow: "hidden",
                borderRadius: 16,
                backgroundColor: "rgba(148,163,184,0.08)",
              },
              heroImageStyle,
            ]}
          >
            <Image
              source={heroSource}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
              onLoad={() => setHeroImageFailed(false)}
              onError={() => {
                if (heroSource !== EXPLORE_HERO_PNG) {
                  setHeroSource(EXPLORE_HERO_PNG);
                  return;
                }
                setHeroImageFailed(true);
              }}
            />
          </View>
          {__DEV__ && heroImageFailed ? (
            <Text className="mt-1 text-[10px] text-red-600 text-center">
              Explore hero image failed to load.
            </Text>
          ) : null}
        </TouchableOpacity>
        {loadingHome && (
          <View className="flex-row items-center mt-1 justify-center">
            <ActivityIndicator size="small" color="#475569" />
            <Text className="ml-2 text-xs text-slate-500">Loading…</Text>
          </View>
        )}
        {homeError && (
          <Text className="mt-2 text-xs font-medium text-red-600 text-center">
            {homeError}
          </Text>
        )}

        <View style={{ width: "100%", alignItems: "center" }}>
          <View className="flex-row items-center justify-center mb-3">
            <Text className="text-lg font-semibold text-slate-900 text-center">
              {t("Chapters")}
            </Text>
          </View>
          <View className="flex-row flex-wrap" style={{ gap: 12, justifyContent: "center" }}>
            {chapters.map((chapter) => (
              <TouchableOpacity
                key={chapter.chapter}
                ref={(node) => registerAnchor(`chapter-${chapter.chapter}`, node)}
                {...withTileAssistivePress(
                  `chapter-${chapter.chapter}`,
                  chapterNarration(chapter),
                  () => openChapterScreen(chapter)
                )}
                className="rounded-xl border items-center justify-center bg-white"
                style={{
                  width: worldTileSize,
                  height: worldTileSize,
                  borderColor:
                    activeWorldTtsKey === `chapter-${chapter.chapter}`
                      ? "rgba(34,197,94,0.75)"
                      : "rgba(15,23,42,0.22)",
                  backgroundColor:
                    activeWorldTtsKey === `chapter-${chapter.chapter}`
                      ? "rgba(34,197,94,0.2)"
                      : "rgba(15,23,42,0.06)",
                  padding: 6,
                }}
              >
                <Text className="text-[11px] font-semibold text-slate-500">{t("Chapter")}</Text>
                <Text className="text-lg font-extrabold text-slate-900">{chapter.chapter}</Text>
                <Text className="mt-1 text-[10px] font-semibold text-slate-700 text-center" numberOfLines={2}>
                  {chapter.title}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ width: "100%", alignItems: "center" }}>
          <View
            className="flex-row items-center justify-center mb-3"
            style={{ width: "100%", columnGap: 10, rowGap: 10, flexWrap: "wrap" }}
          >
            <Image
              source={EXPLORE_WORLD_VIEW_ICON}
              accessibilityRole="image"
              accessibilityLabel={t("Bhagavad Gita")}
              style={{ width: 42, height: 42 }}
              resizeMode="contain"
            />
            <Text className="text-lg font-semibold text-slate-900 text-center">
              {scholarsLabel}
            </Text>
            {loadingWorld ? <ActivityIndicator size="small" color="#475569" /> : null}
          </View>
            <View className="flex-row flex-wrap" style={{ gap: 12, justifyContent: "center" }}>
              {shuffledWorldEntries.map(({ entry, stableKey }, index) => (
                <TouchableOpacity
                  key={stableKey}
                  ref={(node) => registerAnchor(`world-${stableKey}`, node)}
                  {...withTileAssistivePress(
                    `world-${stableKey}`,
                    worldNarrationForEntry(entry),
                    () => speakWorldView(`world-${stableKey}`, worldNarrationForEntry(entry))
                  )}
                  className="shrink-0 rounded-xl border bg-white"
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
                    const source = imageUri === "local" ? LOCAL_WORLD_IMAGE_FALLBACK : buildImageSource(imageUri);
                    return (
                  <Image
                    source={source}
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
                          "[explore] world image failed",
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
            <Text className="mt-2 text-xs font-medium text-red-600 text-center">
              {worldError}
            </Text>
          )}
        </View>
        <View style={{ marginTop: 8, width: "100%" }}>
          <PageBottomMeta />
        </View>
      </View>
    </ScrollView>
  );
}
