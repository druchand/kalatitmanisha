import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  Vibration,
  View,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus, type AudioSource } from "expo-audio";
import YouTube from "react-native-youtube-iframe";
import { VideoView, useVideoPlayer } from "expo-video";
import { useAuth } from "../auth/AuthModalContext";
import { useLanguage } from "../context/LanguageContext";
import { useTeleprompter } from "../context/TeleprompterContext";
import { useVerseSelection } from "../context/VerseSelectionContext";
import GitaVerseImageCard from "../components/gitaVerse/GitaVerseImageCard";
import PageBottomMeta from "../components/layout/PageBottomMeta";
import {
  extractNarrationFromRaw,
  extractTextForSection,
  normalizeGitaAIRoot,
  wrapRootForSection,
} from "../utils/gitaAISectionHelpers";
import { upsertAudioTextLookup } from "../utils/audioTextLookup";
import { getExpoSpeechModule, resolveTtsLocale, speakWithResolvedVoice, stopResolvedSpeech } from "../utils/ttsSupport";
import { functionUrl } from "../utils/functionApi";

const GITA_VERSE_ENDPOINT = functionUrl("gitaVerse");
const GITA_PARAYAN_CHAPTER_FEED_ENDPOINT = functionUrl("GitaParayanChapterFeed");
const MIN_VERSE_NUMBER = 1;
const MIN_CHAPTER_NUMBER = 1;
const MAX_CHAPTER_NUMBER = 18;
const DEFAULT_MAX_VERSE_FALLBACK = 72;
const KNOWN_VERSE_COUNT_BY_CHAPTER: Record<number, number> = {
  1: 47,
  2: 72,
  3: 43,
  4: 42,
  5: 29,
  6: 47,
  7: 30,
  8: 28,
  9: 34,
  10: 42,
  11: 55,
  12: 20,
  13: 35,
  14: 27,
  15: 20,
  16: 24,
  17: 28,
  18: 78,
};

type VerseSnapshot = {
  sanskrit: string;
  transliteration: string;
  verseText: string;
  chapterText: string;
  chapterTitle: string;
  learn2reciteUrl: string;
  audioByType: {
    recite: string;
    hindiNarration: string;
    languageNarration: string;
    learn2recite: string;
  };
  audioTextByType: {
    recite: string;
    hindiNarration: string;
    languageNarration: string;
  };
  audioPlaylist: Array<{ label: string; url: string }>;
  verseTtsSource: string;
  modernContextText: string;
  relatedVerses: Array<{ chapter: number; verse: number; shlok: string; sanskrit?: string | null; raw?: any }>;
  humanDilemmas: Array<{ id: string; name: string; text: string; mediaUrl: string; raw?: any }>;
};

type ParayanChapterFeed = {
  chapter: number;
  audio: {
    chapter: number;
    fileName: string;
    audioUrl: string;
  } | null;
  verseCount: number;
  chapterPayload: any;
  previewText: string;
  sloks: Array<{
    verse: number;
    sanskrit: string;
    text: string;
    raw?: any;
  }>;
  teleprompterText: string;
};

type ExpoSpeechModule = {
  stop: () => void;
  speak: (
    text: string,
    options?: {
      language?: string;
      pitch?: number;
      rate?: number;
      onDone?: () => void;
      onStopped?: () => void;
      onError?: () => void;
    }
  ) => void;
};

const Speech: ExpoSpeechModule | null = getExpoSpeechModule();

const getWebSpeechSynthesis = () => {
  if (Platform.OS !== "web") return null;
  const webWindow = (globalThis as any)?.window;
  const synth = webWindow?.speechSynthesis ?? (globalThis as any)?.speechSynthesis;
  if (!synth || typeof synth.speak !== "function" || typeof synth.cancel !== "function") {
    return null;
  }
  return synth;
};

const toPlayableAudioUrl = (value: any): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const wixAudio = raw.match(/^wix:audio:\/\/v1\/([^/#?]+)$/i);
  if (wixAudio?.[1]) {
    return `https://static.wixstatic.com/mp3/${wixAudio[1]}`;
  }
  return "";
};

const isModernContextPlaceholder = (value: string) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "from ai fetch" ||
    normalized === "from ai fetch or cache" ||
    normalized === "from ai cache" ||
    normalized.includes("from ai fetch")
  );
};

const pickModernContextText = (verseData: any): string => {
  const candidate = [
    verseData?.modernLifeContext,
    verseData?.modernContext,
    verseData?.modern_context,
    verseData?.context,
    verseData?.contextText,
    verseData?.simple_meaning,
    verseData?.simpleMeaning,
    verseData?.meaning,
    verseData?.translationText,
    verseData?.translation,
  ]
    .map((entry) => String(entry || "").trim())
    .find((entry) => entry && !isModernContextPlaceholder(entry));

  return normalizeMarqueeText(candidate || "");
};

const normalizeVerseTextValue = (value: any): string => {
  if (Array.isArray(value)) {
    return normalizeMarqueeText(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join(" ")
    );
  }
  return normalizeMarqueeText(String(value || "").trim());
};

const combineAudioTeleprompterText = (...parts: any[]) =>
  normalizeMarqueeText(
    parts
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ")
  );

const sanitizeTileLabelText = (value: any): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw
    .replace(/\bTTS\b[:\-\s]*/gi, "")
    .replace(/\bAudio\b[:\-\s]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

const ensureVersePrefix = (value: any): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^verse\b/i.test(raw)) return raw;
  const chapterMatch = raw.match(/^chapter\s+(\d+\.\d+)$/i);
  if (chapterMatch?.[1]) return `Verse ${chapterMatch[1]}`;
  if (/^\d+\.\d+$/.test(raw)) return `Verse ${raw}`;
  return raw;
};

const extractLearn2ReciteUrl = (verseData: any): string => {
  const direct = [
    verseData?.learn2recite,
    verseData?.learnToRecite,
    verseData?.learn_to_recite,
    verseData?.learn,
  ];
  for (const candidate of direct) {
    const url = toPlayableAudioUrl(candidate);
    if (url) return url;
  }

  const playlist = Array.isArray(verseData?.audioPlaylist) ? verseData.audioPlaylist : [];
  const preferred = playlist.find((item: any) => {
    const label = String(item?.label || item?.name || "").toLowerCase();
    const key = String(item?.key || item?.type || "").toLowerCase();
    return label.includes("learn") || key.includes("learn");
  });
  const fallback = playlist.find((item: any) => {
    const label = String(item?.label || item?.name || "").toLowerCase();
    return label.includes("recite");
  });
  const anyPlayable = playlist.find((item: any) => toPlayableAudioUrl(item?.url));

  return toPlayableAudioUrl(preferred?.url || fallback?.url || anyPlayable?.url || "");
};

const normalizeAudioPlaylist = (verseData: any): Array<{ label: string; url: string }> => {
  const list = Array.isArray(verseData?.audioPlaylist) ? verseData.audioPlaylist : [];
  return list
    .map((item: any, idx: number) => {
      const url = toPlayableAudioUrl(item?.url);
      if (!url) return null;
      const fallback = `Track ${idx + 1}`;
      const rawLabel = String(item?.label || item?.name || fallback).trim() || fallback;
      return {
        label: sanitizeTileLabelText(rawLabel) || fallback,
        url,
      };
    })
    .filter((item: any): item is { label: string; url: string } => Boolean(item));
};

const toPositiveInt = (value: any): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const parseChapterVerseFromShlok = (value: any): { chapter: number; verse: number } | null => {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)\s*[\.:]\s*(\d+)$/);
  if (!match) return null;
  const chapter = Number(match[1]);
  const verse = Number(match[2]);
  if (!Number.isFinite(chapter) || chapter < 1) return null;
  if (!Number.isFinite(verse) || verse < 1) return null;
  return { chapter: Math.floor(chapter), verse: Math.floor(verse) };
};

const normalizeRelatedVerseItems = (
  entries: any,
  fallbackChapter: number,
  fallbackVerse: number
): Array<{ chapter: number; verse: number; shlok: string; sanskrit?: string | null; raw?: any }> => {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((item: any) => {
      const chapterFromFields = toPositiveInt(item?.chapter ?? item?.ch ?? item?.chapterNo);
      const verseFromFields = toPositiveInt(item?.verse ?? item?.v ?? item?.verseNo);
      const fromShlok = parseChapterVerseFromShlok(item?.shlok ?? item?.slok ?? item?.reference);
      const chapter = chapterFromFields ?? fromShlok?.chapter ?? fallbackChapter;
      const verse = verseFromFields ?? fromShlok?.verse ?? fallbackVerse;
      const shlok = String(item?.shlok ?? item?.slok ?? `${chapter}.${verse}`).trim();
      const sanskritValue = item?.sanskrit ?? item?.text ?? item?.verseText ?? null;
      return {
        chapter,
        verse,
        shlok,
        sanskrit: typeof sanskritValue === "string" ? sanskritValue : null,
        raw: item,
      };
    })
    .filter((item) => item.chapter >= 1 && item.verse >= 1);
};

const normalizeHumanDilemmaItems = (
  entries: any
): Array<{ id: string; name: string; text: string; mediaUrl: string; raw?: any }> => {
  if (!Array.isArray(entries)) return [];
  return entries.reduce<Array<{ id: string; name: string; text: string; mediaUrl: string; raw?: any }>>((acc, item: any, idx: number) => {
    const id = String(item?.id ?? item?._id ?? item?.dilemmaId ?? "").trim();
    const name = String(item?.name ?? item?.title ?? "").trim();
    const text = String(item?.text ?? item?.description ?? item?.summary ?? "").trim();
    if (!id || (!name && !text)) return acc;
    acc.push({
      id,
      name: name || `Dilemma ${idx + 1}`,
      text,
      mediaUrl: extractDilemmaMediaUrl(item),
      raw: item,
    });
    return acc;
  }, []);
};

const extractDilemmaMediaUrl = (item: any): string => {
  const candidates = [
    item?.image,
    item?.imageUrl,
    item?.gif,
    item?.gifUrl,
    item?.video,
    item?.videoUrl,
    item?.thumbnail,
    item?.thumbnailUrl,
  ];
  for (const candidate of candidates) {
    const url = String(candidate || "").trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return "";
};

const extractDilemmaNarrationText = (item: any): string => {
  const candidates = [
    item?.text,
    item?.description,
    item?.summary,
    item?.narration,
    item?.story,
    item?.content,
    item?.problem,
    item?.dilemma,
    item?.details,
    item?.detail,
    item?.data?.text,
    item?.data?.description,
    item?.data?.summary,
    item?.data?.narration,
    item?.data?.content,
    item?.payload?.text,
    item?.payload?.description,
    item?.payload?.summary,
    item?.payload?.narration,
    item?.payload?.content,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = normalizeMarqueeText(candidate);
    if (normalized) return normalized;
  }
  return "";
};

function DilemmaTileVideo({ url }: { url: string }) {
  const player: any = useVideoPlayer({ uri: url }, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <VideoView
      player={player}
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

function DilemmaTileMedia({ url }: { url?: string }) {
  const normalized = String(url || "").trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  const isVideo = /\.(mp4|mov|m4v|webm|m3u8)(\?|$)/i.test(lower);
  if (isVideo) return <DilemmaTileVideo url={normalized} />;

  return (
    <Image
      source={{ uri: normalized }}
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" }}
      resizeMode="cover"
    />
  );
}

const firstParam = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const parseEndpointPayload = (rawText: string) => {
  let parsed: any = {};
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = {};
    }
  }

  let body = parsed?.body ?? parsed ?? {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  return body?.payLoad ?? body?.payload ?? body ?? {};
};

const normalizeMarqueeText = (value: string) =>
  String(value || "")
    // Remove all common + unicode line separators that can truncate single-line rendering.
    .replace(/[\r\n\t\f\v\u2028\u2029]+/g, " ")
    // Remove control characters that may prematurely terminate layout/rendering.
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const normalizeTeleprompterText = (value: string) =>
  String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u2028\u2029]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ ]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const toPreviewWords = (value: string, count = 15) => {
  const words = normalizeMarqueeText(value).split(" ").filter(Boolean);
  if (!words.length) return "";
  const picked = words.slice(0, count).join(" ");
  return words.length > count ? `${picked}…` : picked;
};

const buildParayanPreviewText = (sloks: Array<{ text?: string; sanskrit?: string }>, fallback = "") =>
  toPreviewWords(
    String(
      sloks?.find((item) => String(item?.text || item?.sanskrit || "").trim())?.text ||
        sloks?.find((item) => String(item?.sanskrit || "").trim())?.sanskrit ||
        fallback ||
        ""
    ).trim(),
    14
  );

const parseAiPayloadRoot = (rawText: string) => {
  let parsed: any = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }
  if (!parsed) return null;
  let root = parsed?.data ?? parsed?.body ?? parsed;
  if (typeof root === "string") {
    try {
      root = JSON.parse(root);
    } catch {}
  }
  return root?.payload ?? root?.payLoad ?? root;
};

const extractYouTubeVideoIdFromUrl = (rawUrl: string): string => {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const pathParts = String(parsed.pathname || "")
      .split("/")
      .filter(Boolean);
    if (host.includes("youtu.be")) {
      const id = pathParts[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    }
    const fromQuery = parsed.searchParams.get("v") || "";
    if (/^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery;
    const embedIdx = pathParts.findIndex((part) => part === "embed" || part === "shorts" || part === "live");
    if (embedIdx >= 0 && pathParts[embedIdx + 1]) {
      const fromPath = pathParts[embedIdx + 1];
      return /^[A-Za-z0-9_-]{11}$/.test(fromPath) ? fromPath : "";
    }
  } catch {}
  const fallback = value.match(/(?:v=|\/)([A-Za-z0-9_-]{11})(?:[?&/#]|$)/);
  return fallback?.[1] || "";
};

const pickText = (...values: any[]) => {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
};

const extractAiPillItems = (value: any): Array<{ title: string; text: string }> => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item: any, idx: number) => {
        if (typeof item === "string") {
          const text = String(item).trim();
          if (!text) return null;
          return { title: `Item ${idx + 1}`, text };
        }
        const title = pickText(
          item?.name,
          item?.Name,
          item?.title,
          item?.Title,
          item?.label,
          item?.faith,
          item?.Source,
          item?.source,
          item?.Quote,
          item?.quote,
          `Item ${idx + 1}`
        );
        const text = pickText(
          item?.narrative,
          item?.Narration,
          item?.comment,
          item?.text,
          item?.description,
          item?.explanation,
          item?.Explanation,
          item?.quote,
          item?.Quote
        );
        if (!text) return null;
        return { title, text };
      })
      .filter((item): item is { title: string; text: string } => Boolean(item));
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]: [string, any]) => {
        const text = pickText(
          item?.narrative,
          item?.Narration,
          item?.comment,
          item?.text,
          item?.description,
          item?.explanation,
          item?.Explanation,
          item?.quote,
          item?.Quote,
          typeof item === "string" ? item : ""
        );
        if (!text) return null;
        return {
          title: pickText(item?.name, item?.Name, item?.title, item?.Title, item?.Source, item?.source, key),
          text,
        };
      })
      .filter((item): item is { title: string; text: string } => Boolean(item));
  }
  const text = String(value || "").trim();
  return text ? [{ title: "Item 1", text }] : [];
};

const extractYouTubeVideoItems = (value: any): Array<{ tileId: string; id: string; title: string; thumbnail?: string; url: string; videoId?: string }> => {
  const list = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
  return list
    .map((item: any, idx: number) => {
      const rawId = String(
        item?.videoId ||
          item?.id?.videoId ||
          item?.snippet?.resourceId?.videoId ||
          item?.youtubeId ||
          ""
      ).trim();
      const urlFromPayload = String(item?.url || "").trim();
      const normalizedRawId = /^[A-Za-z0-9_-]{11}$/.test(rawId) ? rawId : "";
      const videoId = normalizedRawId || extractYouTubeVideoIdFromUrl(urlFromPayload);
      const url = urlFromPayload || (videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : "");
      if (!url) return null;
      const title = pickText(item?.title, item?.snippet?.title, "YouTube");
      const thumbnail =
        item?.thumbnail?.high?.url ||
        item?.thumbnail?.medium?.url ||
        item?.thumbnails?.high?.url ||
        item?.thumbnails?.medium?.url ||
        (videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : undefined);
      const id = String(item?.id || videoId || url).trim();
      const tileId = `${id || "yt"}-${idx}`;
      return { tileId, id, title, thumbnail, url, videoId: videoId || undefined };
    })
    .filter((item: any): item is { tileId: string; id: string; title: string; thumbnail?: string; url: string; videoId?: string } => Boolean(item));
};

export default function GitaVerseNew() {
  const auth = useAuth();
  const { lang, selectLanguage, t } = useLanguage();
  const { selection, updateSelection } = useVerseSelection();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isCompact = width < 768;
  const routeParams = useLocalSearchParams<{
    chapter?: string | string[];
    verse?: string | string[];
    lang?: string | string[];
  }>();

  const safeLang = useMemo(
    () => (typeof lang === "string" ? lang.toUpperCase() : "EN"),
    [lang]
  );
  const routeChapter = useMemo(
    () => toPositiveInt(firstParam(routeParams.chapter)),
    [routeParams.chapter]
  );
  const routeVerse = useMemo(
    () => toPositiveInt(firstParam(routeParams.verse)),
    [routeParams.verse]
  );
  const routeLang = useMemo(
    () => String(firstParam(routeParams.lang) || "").trim().toUpperCase(),
    [routeParams.lang]
  );

  const appliedRouteSelectionRef = useRef("");
  useEffect(() => {
    if (!routeChapter || !routeVerse) return;
    const routeKey = `${routeLang || safeLang}:${routeChapter}:${routeVerse}`;
    if (appliedRouteSelectionRef.current === routeKey) return;
    appliedRouteSelectionRef.current = routeKey;

    if (routeLang && routeLang !== safeLang) {
      void selectLanguage(routeLang);
    }
    updateSelection({ chapter: routeChapter, verse: routeVerse });
  }, [routeChapter, routeVerse, routeLang, safeLang, selectLanguage, updateSelection]);

  const selectionChapter = Math.max(
    MIN_CHAPTER_NUMBER,
    Number(selection?.chapter || MIN_CHAPTER_NUMBER)
  );
  const selectionVerse = Math.max(
    MIN_VERSE_NUMBER,
    Number(selection?.verse || MIN_VERSE_NUMBER)
  );

  const getMaxVerseForChapter = useCallback((chapter: number) => {
    const normalizedChapter = Math.max(
      MIN_CHAPTER_NUMBER,
      Math.min(MAX_CHAPTER_NUMBER, Math.floor(chapter || MIN_CHAPTER_NUMBER))
    );
    return (
      KNOWN_VERSE_COUNT_BY_CHAPTER[normalizedChapter] ?? DEFAULT_MAX_VERSE_FALLBACK
    );
  }, []);
  const getPrevChapter = useCallback(
    (chapter: number) => (chapter <= MIN_CHAPTER_NUMBER ? MAX_CHAPTER_NUMBER : chapter - 1),
    []
  );
  const getNextChapter = useCallback(
    (chapter: number) => (chapter >= MAX_CHAPTER_NUMBER ? MIN_CHAPTER_NUMBER : chapter + 1),
    []
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sanskrit, setSanskrit] = useState("");
  const [chapterTextByRow, setChapterTextByRow] = useState<{ prev: string; current: string; next: string }>({
    prev: "",
    current: "",
    next: "",
  });
  const [chapterTitleByRow, setChapterTitleByRow] = useState<{ prev: string; current: string; next: string }>({
    prev: "",
    current: "",
    next: "",
  });
  const [verseSanskritByRow, setVerseSanskritByRow] = useState<{ prev: string; current: string; next: string }>({
    prev: "",
    current: "",
    next: "",
  });
  const [currentLearn2ReciteUrl, setCurrentLearn2ReciteUrl] = useState("");
  const [currentVerseTtsSource, setCurrentVerseTtsSource] = useState("");
  const [currentModernContextText, setCurrentModernContextText] = useState("");
  const [currentAudioByType, setCurrentAudioByType] = useState<VerseSnapshot["audioByType"]>({
    recite: "",
    hindiNarration: "",
    languageNarration: "",
    learn2recite: "",
  });
  const [currentAudioTextByType, setCurrentAudioTextByType] = useState<VerseSnapshot["audioTextByType"]>({
    recite: "",
    hindiNarration: "",
    languageNarration: "",
  });
  const [aiExplanationText, setAiExplanationText] = useState("");
  const [aiModernContextText, setAiModernContextText] = useState("");
  const [aiScholarItems, setAiScholarItems] = useState<Array<{ title: string; text: string }>>([]);
  const [aiMultiFaithItems, setAiMultiFaithItems] = useState<Array<{ title: string; text: string }>>([]);
  const [aiActionsLoading, setAiActionsLoading] = useState(false);
  const [legendaryStories, setLegendaryStories] = useState<Array<{ id: string; title: string; text: string }>>([]);
  const [legendaryLoadingActions, setLegendaryLoadingActions] = useState(false);
  const [youtubeItems, setYoutubeItems] = useState<
    Array<{ tileId: string; id: string; title: string; thumbnail?: string; url: string; videoId?: string }>
  >([]);
  const [relatedVerses, setRelatedVerses] = useState<
    Array<{ chapter: number; verse: number; shlok: string; sanskrit?: string | null; raw?: any }>
  >([]);
  const [humanDilemmas, setHumanDilemmas] = useState<
    Array<{ id: string; name: string; text: string; mediaUrl: string; raw?: any }>
  >(
    []
  );
  const [dilemmaMediaById, setDilemmaMediaById] = useState<Record<string, string>>({});
  const [dilemmaTextById, setDilemmaTextById] = useState<Record<string, string>>({});
  const [activeYouTubeTileId, setActiveYouTubeTileId] = useState<string | null>(null);
  const [youtubePlayerSeed, setYouTubePlayerSeed] = useState(0);
  const requestKeyRef = useRef("");
  const verseSnapshotCacheRef = useRef<Map<string, VerseSnapshot>>(new Map());
  const verseSnapshotInFlightRef = useRef<Map<string, Promise<VerseSnapshot>>>(new Map());
  const parayanFeedCacheRef = useRef<Map<number, ParayanChapterFeed>>(new Map());
  const parayanFeedInFlightRef = useRef<Map<number, Promise<ParayanChapterFeed | null>>>(new Map());
  const ttsRunIdRef = useRef(0);
  const [activeChapterTtsKey, setActiveChapterTtsKey] = useState<"prev" | "current" | "next" | null>(null);
  const [activeGenericTtsKey, setActiveGenericTtsKey] = useState<string | null>(null);
  const { registerAnchor, openTeleprompter, closeTeleprompter } = useTeleprompter();
  const audioPlayer = useAudioPlayer(null);
  const audioStatus = useAudioPlayerStatus(audioPlayer);
  const isVerseAudioPlaying = useMemo(() => Boolean(audioStatus?.playing), [audioStatus]);
  const [activeVerseAudioKey, setActiveVerseAudioKey] = useState<string | null>(null);
  const [pendingStreamTeleprompter, setPendingStreamTeleprompter] = useState<{
    key: string;
    text: string;
  } | null>(null);
  const [audioPlaylistTracks, setAudioPlaylistTracks] = useState<Array<{ label: string; url: string }>>([]);
  const [currentParayanFeed, setCurrentParayanFeed] = useState<ParayanChapterFeed | null>(null);
  const webStreamAudioRef = useRef<any>(null);
  const dilemmaMediaCacheRef = useRef<Map<string, string>>(new Map());
  const dilemmaTextCacheRef = useRef<Map<string, string>>(new Map());
  const resolvedModernContextTtsSource = useMemo(
    () => normalizeMarqueeText(aiModernContextText || ""),
    [aiModernContextText]
  );
  const promotedRecitePlaylistTrack = useMemo(
    () =>
      audioPlaylistTracks.find((track) => {
        const label = String(track?.label || "").trim().toLowerCase();
        return label === "recite";
      }) || null,
    [audioPlaylistTracks]
  );
  const remainingAudioPlaylistTracks = useMemo(
    () =>
      audioPlaylistTracks.filter((track) => {
        const label = String(track?.label || "").trim().toLowerCase();
        return label !== "recite" && label !== "hindi" && label !== "learn2recite" && label !== "female";
      }),
    [audioPlaylistTracks]
  );
  const modernContextTileLabel = useMemo(() => {
    const preferred = String(t("Modern Context") || "").trim();
    if (preferred && preferred !== "Modern Context" && preferred !== "Modern Contex") return preferred;
    const fallback = String(t("Additional context") || "").trim();
    if (fallback && fallback !== "Additional context") return fallback;
    return preferred || "Modern Context";
  }, [t]);
  const sattvicLogicTileLabel = useMemo(() => {
    const preferred = String(t("Logic Lens") || "").trim();
    if (preferred && preferred !== "Logic Lens") return preferred;
    return "Logic Lens";
  }, [t]);
  const activeYouTubeItem = useMemo(
    () => youtubeItems.find((item) => item.tileId === activeYouTubeTileId) || null,
    [activeYouTubeTileId, youtubeItems]
  );
  const formatChapterLabel = useCallback(
    (value: number | string) => t("Chapter {value}", { value }),
    [t]
  );
  const formatVerseLabel = useCallback(
    (ref: string) => t("Verse {ref}", { ref }),
    [t]
  );
  const localizeVerseLabel = useCallback(
    (value: string) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const verseMatch = raw.match(/^verse\s+(.+)$/i);
      if (verseMatch?.[1]) return formatVerseLabel(verseMatch[1]);
      const chapterMatch = raw.match(/^chapter\s+(\d+\.\d+)$/i);
      if (chapterMatch?.[1]) return formatVerseLabel(chapterMatch[1]);
      if (/^\d+\.\d+$/.test(raw)) return formatVerseLabel(raw);
      return raw;
    },
    [formatVerseLabel]
  );
  const withTtsHeader = useCallback((header: string, body: string, subtitle?: string) => {
    const headerText = String(header || "").trim();
    const subtitleText = String(subtitle || "").trim();
    const bodyText = normalizeMarqueeText(body);
    if (!bodyText) return "";
    const combinedHeader = [headerText, subtitleText].filter(Boolean).join(". ");
    if (!combinedHeader) return bodyText;
    const loweredBody = bodyText.toLowerCase();
    if (loweredBody.startsWith(combinedHeader.toLowerCase())) return bodyText;
    return `${combinedHeader}. ${bodyText}`;
  }, []);

  const buildUrl = useCallback(
    (chapter: number, verse: number, langCode = safeLang) => {
      const sessionId = String(auth.sessionId || "").trim();
      const url = new URL(GITA_VERSE_ENDPOINT);
      url.searchParams.set("lang", String(langCode || safeLang).trim().toUpperCase());
      url.searchParams.set("chapter", String(chapter));
      url.searchParams.set("verse", String(verse));
      if (sessionId) {
        url.searchParams.set("sessionId", sessionId);
        url.searchParams.set("session", sessionId);
      }
      return url.toString();
    },
    [auth.sessionId, safeLang]
  );

  const fetchParayanChapterFeed = useCallback(async (chapter: number): Promise<ParayanChapterFeed | null> => {
    const normalizedChapter = Math.max(
      MIN_CHAPTER_NUMBER,
      Math.min(MAX_CHAPTER_NUMBER, Math.floor(Number(chapter) || MIN_CHAPTER_NUMBER))
    );
    const cached = parayanFeedCacheRef.current.get(normalizedChapter);
    if (cached) return cached;
    const inFlight = parayanFeedInFlightRef.current.get(normalizedChapter);
    if (inFlight) return inFlight;

    const requestPromise = (async () => {
      const normalizeFeed = (payload: any): ParayanChapterFeed | null => {
        const feed: ParayanChapterFeed = {
          chapter: Number(payload?.chapter || normalizedChapter),
          audio: payload?.audio
            ? {
                chapter: Number(payload.audio.chapter || normalizedChapter),
                fileName: String(payload.audio.fileName || "").trim(),
                audioUrl: toPlayableAudioUrl(payload.audio.audioUrl),
              }
            : null,
          verseCount: Number(payload?.verseCount || 0),
          chapterPayload: payload?.chapterPayload || null,
          sloks: Array.isArray(payload?.sloks)
            ? payload.sloks.map((item: any, index: number) => ({
                verse: Number(item?.verse || index + 1),
                sanskrit: String(item?.sanskrit || "").trim(),
                text: normalizeMarqueeText(String(item?.text || "").trim()),
                raw: item?.raw ?? item,
              }))
            : [],
          previewText: "",
          teleprompterText: normalizeMarqueeText(String(payload?.teleprompterText || "").trim()),
        };
        feed.previewText = buildParayanPreviewText(feed.sloks, feed.teleprompterText);
        return feed.audio?.audioUrl ? feed : null;
      };

      try {
        const url = new URL(GITA_PARAYAN_CHAPTER_FEED_ENDPOINT);
        url.searchParams.set("chapter", String(normalizedChapter));
        const response = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const rawText = await response.text();
        const payload = parseEndpointPayload(rawText);
        const feed = normalizeFeed(payload);
        if (feed) {
          parayanFeedCacheRef.current.set(normalizedChapter, feed);
          return feed;
        }
      } catch {}

      return null;
    })();

    parayanFeedInFlightRef.current.set(normalizedChapter, requestPromise);
    try {
      return await requestPromise;
    } finally {
      parayanFeedInFlightRef.current.delete(normalizedChapter);
    }
  }, []);

  const fetchVerseSnapshot = useCallback(
    async (chapter: number, verse: number, langCode = safeLang): Promise<VerseSnapshot> => {
      const normalizedLang = String(langCode || safeLang).trim().toUpperCase();
      const key = `${normalizedLang}:${chapter}:${verse}:${String(auth.sessionId || "").trim()}`;
      const cached = verseSnapshotCacheRef.current.get(key);
      if (cached) return cached;
      const inFlight = verseSnapshotInFlightRef.current.get(key);
      if (inFlight) return inFlight;

      const requestPromise = (async () => {
        const response = await fetch(buildUrl(chapter, verse, normalizedLang), {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const rawText = await response.text();
        const payload = parseEndpointPayload(rawText);
        const verseData = payload?.verseData ?? null;
        const chapterData = payload?.chapterData ?? null;
        const playlist = normalizeAudioPlaylist(verseData);
        const findByLabel = (pattern: RegExp) =>
          playlist.find((item) => pattern.test(item.label.toLowerCase()))?.url || "";
        const languageNarrationFallback =
          playlist.find((item) => {
            const label = item.label.toLowerCase();
            return !label.includes("learn") && !label.includes("recite") && !label.includes("hindi");
          })?.url || playlist[0]?.url || "";
        const snapshotSanskrit = String(
          verseData?.sanskritText ||
            verseData?.sanskrit ||
            verseData?.GitaVerses_verseTranslations?.[0]?.sanskrit ||
            ""
        ).trim();
        const snapshotTransliteration = normalizeMarqueeText(
          String(verseData?.transliteration || verseData?.transliteraton || "").trim()
        );
        const snapshotVerseText = normalizeVerseTextValue(
          verseData?.verseText ??
            verseData?.translationText ??
            verseData?.translation ??
            verseData?.meaning
        );
        const snapshot: VerseSnapshot = {
          sanskrit: snapshotSanskrit,
          transliteration: snapshotTransliteration,
          verseText: snapshotVerseText,
          chapterText: String(chapterData?.text || chapterData?.description || "").trim(),
          chapterTitle: String(chapterData?.title || "").trim(),
          learn2reciteUrl: extractLearn2ReciteUrl(verseData),
          audioByType: {
            recite: toPlayableAudioUrl(
              verseData?.recite ||
                findByLabel(/recite/)
            ),
            hindiNarration: toPlayableAudioUrl(
              verseData?.hindiNarration ||
                findByLabel(/hindi/)
            ),
            languageNarration: toPlayableAudioUrl(
              verseData?.narration ||
                findByLabel(/narration|language/) ||
                languageNarrationFallback
            ),
            learn2recite: extractLearn2ReciteUrl(verseData),
          },
          audioTextByType: {
            recite: combineAudioTeleprompterText(snapshotSanskrit, snapshotTransliteration),
            hindiNarration: combineAudioTeleprompterText(snapshotSanskrit, snapshotVerseText),
            languageNarration: combineAudioTeleprompterText(snapshotTransliteration, snapshotVerseText),
          },
          audioPlaylist: playlist,
          verseTtsSource: normalizeMarqueeText(
            [
              snapshotTransliteration,
              snapshotVerseText,
            ]
              .map((entry) => String(entry || "").trim())
              .filter(Boolean)
              .join(" ")
          ),
          modernContextText: pickModernContextText(verseData),
          relatedVerses: normalizeRelatedVerseItems(
            verseData?.relatedVerses ??
              verseData?.relatedVerse ??
              verseData?.related_shlokas ??
              verseData?.relatedShlokas,
            chapter,
            verse
          ),
          humanDilemmas: normalizeHumanDilemmaItems(verseData?.humanDilemma ?? verseData?.humanDilemmas),
        };
        verseSnapshotCacheRef.current.set(key, snapshot);
        return snapshot;
      })();

      verseSnapshotInFlightRef.current.set(key, requestPromise);
      try {
        return await requestPromise;
      } finally {
        verseSnapshotInFlightRef.current.delete(key);
      }
    },
    [auth.sessionId, buildUrl, safeLang]
  );

  useEffect(() => {
    let cancelled = false;
    void fetchParayanChapterFeed(selectionChapter)
      .then((feed) => {
        if (cancelled) return;
        setCurrentParayanFeed(feed);
      })
      .catch((error) => {
        if (cancelled) return;
        setCurrentParayanFeed(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchParayanChapterFeed, selectionChapter]);

  const stopTtsPlayback = useCallback(() => {
    ttsRunIdRef.current += 1;
    setActiveChapterTtsKey(null);
    setActiveGenericTtsKey(null);
    closeTeleprompter();
    void stopResolvedSpeech(Speech);
    const webSynth = getWebSpeechSynthesis();
    try {
      webSynth?.cancel();
    } catch {}
  }, [closeTeleprompter]);
  const stopStreamAudioPlayback = useCallback(() => {
    try {
      webStreamAudioRef.current?.pause();
      webStreamAudioRef.current = null;
    } catch {}
    try {
      audioPlayer.pause();
    } catch {}
    try {
      audioPlayer.remove();
    } catch {}
    setActiveVerseAudioKey(null);
    closeTeleprompter();
  }, [audioPlayer, closeTeleprompter]);
  const stopYouTubePlayback = useCallback(() => {
    setActiveYouTubeTileId(null);
  }, []);
  const stopOtherMedia = useCallback(
    (target: "tts" | "audio" | "youtube") => {
      if (target !== "tts") stopTtsPlayback();
      if (target !== "audio") stopStreamAudioPlayback();
      if (target !== "youtube") stopYouTubePlayback();
    },
    [stopStreamAudioPlayback, stopTtsPlayback, stopYouTubePlayback]
  );

  const speakChapterText = useCallback(
    (key: "prev" | "current" | "next", text: string, anchorKey: string) => {
      const normalized = String(text || "").trim();
      if (!normalized) return;
      const displayText = normalizeMarqueeText(normalized);
      if (activeChapterTtsKey === key) {
        stopTtsPlayback();
        return;
      }
      stopOtherMedia("tts");
      const runId = ttsRunIdRef.current + 1;
      ttsRunIdRef.current = runId;
      setActiveChapterTtsKey(key);
      upsertAudioTextLookup({
        pageKey: "/gitaverse",
        playerKey: `chapter-${key}`,
        kind: "tts",
        text: displayText,
        source: "GitaVerseNew.chapter",
      });
      void openTeleprompter({
        anchorKey,
        text: displayText,
        speechRate: 1,
        pageKey: "/gitaverse",
        playerKey: `chapter-${key}`,
        kind: "tts",
      });
      if (Platform.OS !== "web" || Speech) {
        void speakWithResolvedVoice(Speech, safeLang, displayText, {
          onDone: () => {
            if (ttsRunIdRef.current !== runId) return;
            setActiveChapterTtsKey(null);
          },
          onStopped: () => {
            if (ttsRunIdRef.current !== runId) return;
            setActiveChapterTtsKey(null);
          },
          onError: () => {
            if (ttsRunIdRef.current !== runId) return;
            setActiveChapterTtsKey(null);
          },
        }).catch(() => {
          if (ttsRunIdRef.current !== runId) return;
          setActiveChapterTtsKey(null);
        });
        return;
      }

      const webSynth = getWebSpeechSynthesis();
      const webWindow = (globalThis as any)?.window;
      const Utterance = webWindow?.SpeechSynthesisUtterance;
      if (!webSynth || !Utterance) return;
      const utterance = new Utterance(displayText);
      utterance.lang = resolveTtsLocale(safeLang, displayText);
      utterance.onend = () => {
        if (ttsRunIdRef.current !== runId) return;
        setActiveChapterTtsKey(null);
      };
      utterance.onerror = () => {
        if (ttsRunIdRef.current !== runId) return;
        setActiveChapterTtsKey(null);
      };
      webSynth.speak(utterance);
    },
    [activeChapterTtsKey, openTeleprompter, safeLang, stopOtherMedia, stopTtsPlayback]
  );

  useEffect(() => {
    const chapter = Math.min(MAX_CHAPTER_NUMBER, Math.max(MIN_CHAPTER_NUMBER, selectionChapter));
    const verse = Math.min(getMaxVerseForChapter(chapter), Math.max(MIN_VERSE_NUMBER, selectionVerse));
    const reqKey = `${safeLang}:${chapter}:${verse}:${String(auth.sessionId || "").trim()}`;
    requestKeyRef.current = reqKey;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const snapshot = await fetchVerseSnapshot(chapter, verse);
        const nextSanskrit = snapshot.sanskrit;
        if (requestKeyRef.current !== reqKey) return;
        setSanskrit(nextSanskrit);
        setCurrentLearn2ReciteUrl(snapshot.learn2reciteUrl || "");
        setCurrentAudioByType(snapshot.audioByType);
        setCurrentAudioTextByType(snapshot.audioTextByType);
        setAudioPlaylistTracks(snapshot.audioPlaylist || []);
        setCurrentVerseTtsSource(snapshot.verseTtsSource || "");
        setCurrentModernContextText(snapshot.modernContextText || "");
        setRelatedVerses(snapshot.relatedVerses || []);
        setHumanDilemmas(snapshot.humanDilemmas || []);
        if (!nextSanskrit) {
          setError(t("Verse text unavailable for this selection."));
        }
      } catch (err: any) {
        if (requestKeyRef.current !== reqKey) return;
        setSanskrit("");
        setCurrentLearn2ReciteUrl("");
        setCurrentAudioByType({
          recite: "",
          hindiNarration: "",
          languageNarration: "",
          learn2recite: "",
        });
        setCurrentAudioTextByType({
          recite: "",
          hindiNarration: "",
          languageNarration: "",
        });
        setAudioPlaylistTracks([]);
        setCurrentVerseTtsSource("");
        setCurrentModernContextText("");
        setRelatedVerses([]);
        setHumanDilemmas([]);
        setError(err?.message || t("Unable to load verse"));
      } finally {
        if (requestKeyRef.current === reqKey) {
          setLoading(false);
        }
      }
    })();
  }, [auth.sessionId, fetchVerseSnapshot, getMaxVerseForChapter, safeLang, selectionChapter, selectionVerse, t]);

  const goToVerse = useCallback(
    (delta: number) => {
      const steps = Math.max(0, Math.floor(Math.abs(delta)));
      if (!steps) return;

      const direction = delta > 0 ? 1 : -1;
      let nextChapter = Math.min(
        MAX_CHAPTER_NUMBER,
        Math.max(MIN_CHAPTER_NUMBER, Number(selection?.chapter ?? MIN_CHAPTER_NUMBER))
      );
      let nextVerse = Math.max(MIN_VERSE_NUMBER, Number(selection?.verse ?? MIN_VERSE_NUMBER));
      nextVerse = Math.min(getMaxVerseForChapter(nextChapter), nextVerse);

      for (let i = 0; i < steps; i += 1) {
        if (direction > 0) {
          const chapterMax = getMaxVerseForChapter(nextChapter);
          if (nextVerse < chapterMax) {
            nextVerse += 1;
          } else if (nextChapter < MAX_CHAPTER_NUMBER) {
            nextChapter += 1;
            nextVerse = MIN_VERSE_NUMBER;
          } else {
            nextChapter = MIN_CHAPTER_NUMBER;
            nextVerse = MIN_VERSE_NUMBER;
          }
        } else if (nextVerse > MIN_VERSE_NUMBER) {
          nextVerse -= 1;
        } else if (nextChapter > MIN_CHAPTER_NUMBER) {
          nextChapter -= 1;
          nextVerse = getMaxVerseForChapter(nextChapter);
        } else {
          nextChapter = MAX_CHAPTER_NUMBER;
          nextVerse = getMaxVerseForChapter(nextChapter);
        }
      }

      updateSelection({ chapter: nextChapter, verse: nextVerse });
    },
    [getMaxVerseForChapter, selection?.chapter, selection?.verse, updateSelection]
  );
  const chapterPrev = getPrevChapter(selectionChapter);
  const chapterNext = getNextChapter(selectionChapter);
  const selectionMaxVerse = getMaxVerseForChapter(selectionChapter);
  const versePrev = useMemo(() => {
    if (selectionVerse > MIN_VERSE_NUMBER) return selectionVerse - 1;
    const prevChapter = getPrevChapter(selectionChapter);
    return getMaxVerseForChapter(prevChapter);
  }, [getMaxVerseForChapter, getPrevChapter, selectionChapter, selectionVerse]);
  const verseNext = useMemo(() => {
    if (selectionVerse < selectionMaxVerse) return selectionVerse + 1;
    return MIN_VERSE_NUMBER;
  }, [selectionMaxVerse, selectionVerse]);
  const versePrevChapter = useMemo(() => {
    if (selectionVerse > MIN_VERSE_NUMBER) return selectionChapter;
    return getPrevChapter(selectionChapter);
  }, [getPrevChapter, selectionChapter, selectionVerse]);
  const verseNextChapter = useMemo(() => {
    if (selectionVerse < selectionMaxVerse) return selectionChapter;
    return getNextChapter(selectionChapter);
  }, [getNextChapter, selectionChapter, selectionMaxVerse, selectionVerse]);
  const squareSize = isCompact ? 104 : 120;

  useEffect(() => {
    const reqKey = `${safeLang}:${selectionChapter}:${selectionVerse}:${String(auth.sessionId || "").trim()}`;
    let active = true;

    (async () => {
      try {
        const [chapterPrevSnapshot, chapterCurrentSnapshot, chapterNextSnapshot, versePrevSnapshot, verseCurrentSnapshot, verseNextSnapshot] =
          await Promise.all([
            fetchVerseSnapshot(chapterPrev, MIN_VERSE_NUMBER),
            fetchVerseSnapshot(selectionChapter, MIN_VERSE_NUMBER),
            fetchVerseSnapshot(chapterNext, MIN_VERSE_NUMBER),
            fetchVerseSnapshot(versePrevChapter, versePrev),
            fetchVerseSnapshot(selectionChapter, selectionVerse),
            fetchVerseSnapshot(verseNextChapter, verseNext),
          ]);

        if (!active) return;
        if (requestKeyRef.current !== reqKey) return;

        setChapterTextByRow({
          prev: chapterPrevSnapshot.chapterText,
          current: chapterCurrentSnapshot.chapterText,
          next: chapterNextSnapshot.chapterText,
        });
        setChapterTitleByRow({
          prev: chapterPrevSnapshot.chapterTitle,
          current: chapterCurrentSnapshot.chapterTitle,
          next: chapterNextSnapshot.chapterTitle,
        });
        setVerseSanskritByRow({
          prev: versePrevSnapshot.sanskrit,
          current: verseCurrentSnapshot.sanskrit,
          next: verseNextSnapshot.sanskrit,
        });
      } catch {
        if (!active) return;
      }
    })();

    return () => {
      active = false;
    };
  }, [
    auth.sessionId,
    chapterNext,
    chapterPrev,
    fetchVerseSnapshot,
    safeLang,
    selectionChapter,
    selectionVerse,
    verseNext,
    verseNextChapter,
    versePrev,
    versePrevChapter,
  ]);

  useEffect(() => {
    return () => {
      stopTtsPlayback();
    };
  }, [stopTtsPlayback]);

  const toggleGenericTtsForText = useCallback(
    (
      key: string,
      rawText: string,
      variant: "default" | "female" | "male" = "default",
      anchorKey = key,
      showTeleprompter = true
    ) => {
      const text = normalizeMarqueeText(rawText);
      if (!text) return;
      if (activeGenericTtsKey === key) {
        stopTtsPlayback();
        return;
      }
      stopOtherMedia("tts");
      setActiveGenericTtsKey(key);
      upsertAudioTextLookup({
        pageKey: "/gitaverse",
        playerKey: key,
        kind: "tts",
        text,
        source: "GitaVerseNew.generic",
      });
      const pitch = variant === "female" ? 1.22 : variant === "male" ? 0.86 : 1;
      const rate = variant === "female" ? 0.95 : variant === "male" ? 0.9 : 1;
      if (showTeleprompter) {
        void openTeleprompter({
          anchorKey,
          text,
          speechRate: rate,
          pageKey: "/gitaverse",
          playerKey: key,
          kind: "tts",
        });
      }
      const runId = ttsRunIdRef.current + 1;
      ttsRunIdRef.current = runId;

      const done = () => {
        if (ttsRunIdRef.current !== runId) return;
        setActiveGenericTtsKey(null);
      };

      if (Platform.OS !== "web" || Speech) {
        void speakWithResolvedVoice(Speech, safeLang, text, {
          pitch,
          rate,
          onDone: done,
          onStopped: done,
          onError: done,
        }).catch(done);
        return;
      }

      const webSynth = getWebSpeechSynthesis();
      const webWindow = (globalThis as any)?.window;
      const Utterance = webWindow?.SpeechSynthesisUtterance;
      if (!webSynth || !Utterance) return;
      const utterance = new Utterance(text);
      utterance.lang = resolveTtsLocale(safeLang, text);
      utterance.pitch = pitch;
      utterance.rate = rate;
      utterance.onend = done;
      utterance.onerror = done;
      webSynth.speak(utterance);
    },
    [activeGenericTtsKey, openTeleprompter, safeLang, stopOtherMedia, stopTtsPlayback]
  );

  const toggleStreamAudio = useCallback(
    (key: string, url: string, teleprompterText?: string) => {
      const normalized = String(url || "").trim();
      if (!normalized) return;
      const streamText = String(teleprompterText || "").trim()
        ? normalizeTeleprompterText(String(teleprompterText || ""))
        : normalizeMarqueeText(
            currentVerseTtsSource ||
              currentModernContextText ||
              aiExplanationText ||
              chapterTextByRow.current ||
              sanskrit
          );
      upsertAudioTextLookup({
        pageKey: "/gitaverse",
        playerKey: key,
        kind: "stream",
        text: streamText,
        source: normalized,
      });
      try {
        if (activeVerseAudioKey !== key) {
          stopOtherMedia("audio");
          setPendingStreamTeleprompter(streamText ? { key, text: streamText } : null);
          audioPlayer.replace({ uri: normalized } as AudioSource);
          audioPlayer.play();
          setActiveVerseAudioKey(key);
          return;
        }
        if (isVerseAudioPlaying) {
          audioPlayer.pause();
          setPendingStreamTeleprompter(null);
          closeTeleprompter();
        } else {
          stopOtherMedia("audio");
          setPendingStreamTeleprompter(streamText ? { key, text: streamText } : null);
          audioPlayer.play();
        }
      } catch {
        setActiveVerseAudioKey(null);
        setPendingStreamTeleprompter(null);
        closeTeleprompter();
      }
    },
    [
      activeVerseAudioKey,
      aiExplanationText,
      audioPlayer,
      chapterTextByRow.current,
      closeTeleprompter,
      currentModernContextText,
      currentVerseTtsSource,
      isVerseAudioPlaying,
      sanskrit,
      stopOtherMedia,
    ]
  );
  useEffect(() => {
    if (!isVerseAudioPlaying || !pendingStreamTeleprompter?.key || !pendingStreamTeleprompter?.text) return;
    void openTeleprompter({
      anchorKey: pendingStreamTeleprompter.key,
      text: pendingStreamTeleprompter.text,
      speechRate: 1,
      pageKey: "/gitaverse",
      playerKey: pendingStreamTeleprompter.key,
      kind: "stream",
    });
    setPendingStreamTeleprompter(null);
  }, [isVerseAudioPlaying, openTeleprompter, pendingStreamTeleprompter]);
  const longPressTriggeredRef = useRef(false);
  const triggerTouchFeedback = useCallback(() => {
    if (Platform.OS === "web") return;
    try {
      Vibration.vibrate(8);
    } catch {}
  }, []);
  const handleLongPressLabelSpeak = useCallback(
    (key: string, label: string) => {
      const text = normalizeMarqueeText(label);
      if (!text) return;
      longPressTriggeredRef.current = true;
      toggleGenericTtsForText(`hint-${key}`, text, "default", key, false);
    },
    [toggleGenericTtsForText]
  );
  const withAssistivePress = useCallback(
    (key: string, label: string, onTap: () => void, disabled = false) => {
      if (disabled) {
        return {
          onPress: onTap,
        };
      }
      return {
        onPressIn: triggerTouchFeedback,
        delayLongPress: 320,
        onLongPress: () => handleLongPressLabelSpeak(key, label),
        onPress: () => {
          if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false;
            return;
          }
          onTap();
        },
      };
    },
    [handleLongPressLabelSpeak, triggerTouchFeedback]
  );
  const toggleCurrentVerseLearn2ReciteAudio = useCallback(() => {
    const url = String(currentLearn2ReciteUrl || "").trim();
    if (!url) return;
    const currentKey = `${selectionChapter}:${selectionVerse}`;
    toggleStreamAudio(currentKey, url);
  }, [currentLearn2ReciteUrl, selectionChapter, selectionVerse, toggleStreamAudio]);

  const handleHindiNarrationAudio = useCallback(async () => {
    const fallbackUrl = String(currentAudioByType.hindiNarration || "").trim();
    if (!fallbackUrl) return;
    try {
      const hindiSnapshot =
        safeLang === "HI"
          ? await fetchVerseSnapshot(selectionChapter, selectionVerse)
          : await fetchVerseSnapshot(selectionChapter, selectionVerse, "HI");
      toggleStreamAudio(
        "audio-hindi",
        String(hindiSnapshot.audioByType.hindiNarration || fallbackUrl).trim() || fallbackUrl,
        hindiSnapshot.audioTextByType.hindiNarration || currentAudioTextByType.hindiNarration
      );
    } catch {
      toggleStreamAudio("audio-hindi", fallbackUrl, currentAudioTextByType.hindiNarration);
    }
  }, [
    currentAudioByType.hindiNarration,
    currentAudioTextByType.hindiNarration,
    fetchVerseSnapshot,
    safeLang,
    selectionChapter,
    selectionVerse,
    toggleStreamAudio,
  ]);

  const handleParayanAudio = useCallback(async () => {
    const feed = currentParayanFeed || (await fetchParayanChapterFeed(selectionChapter));
    if (feed && feed !== currentParayanFeed) {
      setCurrentParayanFeed(feed);
    }
    const url = String(feed?.audio?.audioUrl || "").trim();
    if (!url) return;
    toggleStreamAudio(
      `audio-parayan-${selectionChapter}`,
      url,
      feed?.teleprompterText || ""
    );
  }, [currentParayanFeed, fetchParayanChapterFeed, selectionChapter, toggleStreamAudio]);

  const handleNarrationAudioWithFallback = useCallback(
    (
      key: string,
      url: string,
      text: string,
      variant: "female" | "male"
    ) => {
      const normalizedUrl = String(url || "").trim();
      const normalizedText = String(text || "").trim();
      if (normalizedUrl) {
        toggleStreamAudio(key, normalizedUrl, normalizedText);
        return;
      }
      if (!normalizedText) return;
      toggleGenericTtsForText(key, normalizedText, variant);
    },
    [toggleGenericTtsForText, toggleStreamAudio]
  );

  const lastVerseAudioSelectionKeyRef = useRef<string>(`${selectionChapter}:${selectionVerse}`);
  useEffect(() => {
    const currentSelectionKey = `${selectionChapter}:${selectionVerse}`;
    if (lastVerseAudioSelectionKeyRef.current === currentSelectionKey) return;
    lastVerseAudioSelectionKeyRef.current = currentSelectionKey;

    if (!activeVerseAudioKey) return;
    try {
      audioPlayer.pause();
    } catch {}
    try {
      audioPlayer.remove();
    } catch {}
    setActiveVerseAudioKey(null);
  }, [activeVerseAudioKey, audioPlayer, selectionChapter, selectionVerse]);

  useEffect(() => {
    return () => {
      try {
        audioPlayer.pause();
      } catch {}
      try {
        audioPlayer.remove();
      } catch {}
    };
  }, [audioPlayer]);

  const aiFetchKeyRef = useRef<string>("");
  const legendaryFetchKeyRef = useRef<string>("");
  const dilemmaTapRef = useRef<{ key: string; at: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);

  useEffect(() => {
    const sessionId = String(auth.sessionId || "").trim();
    const fetchKey = `${safeLang}:${selectionChapter}:${selectionVerse}:${sessionId}`;
    if (aiFetchKeyRef.current === fetchKey) return;
    aiFetchKeyRef.current = fetchKey;

    setAiExplanationText("");
    setAiModernContextText("");
    setAiScholarItems([]);
    setAiMultiFaithItems([]);
    setAiActionsLoading(true);
    let active = true;

    (async () => {
      try {
        const aiUrl = new URL(functionUrl("aiGitaSnippet"));
        if (sessionId) {
          aiUrl.searchParams.set("sessionId", sessionId);
          aiUrl.searchParams.set("session", sessionId);
        }
        const fetchAi = async (
          attempt = 0
        ): Promise<{
          section1Text: string;
          section4Text: string;
          section3Items: Array<{ title: string; text: string }>;
          section5Items: Array<{ title: string; text: string }>;
        }> => {
          const aiRes = await fetch(aiUrl.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chapter: selectionChapter,
              verse: selectionVerse,
              language: safeLang,
              sections: "1-5",
              format: "json",
            }),
          });
          const aiText = await aiRes.text();
          let parsed: any = null;
          if (aiText) {
            try {
              parsed = JSON.parse(aiText);
            } catch {
              parsed = null;
            }
          }
          const root = parsed?.data ?? parsed?.body ?? parsed ?? {};
          const normalized = normalizeGitaAIRoot(root ?? parsed);
          const section1Root = wrapRootForSection(normalized.root, "1");
          const section3Root =
            normalized.root?.sections?.["3"] ??
            normalized.root?.section3 ??
            normalized.root?.["3"] ??
            normalized.root;
          const section5Root =
            normalized.root?.sections?.["5"] ??
            normalized.root?.section5 ??
            normalized.root?.["5"] ??
            normalized.root;
          const section1Text =
            extractTextForSection(section1Root, "1", safeLang.toLowerCase()) || "";
          const section4Root = wrapRootForSection(normalized.root, "4");
          const section4Text =
            extractTextForSection(section4Root, "4", safeLang.toLowerCase()) ||
            (normalized.cleanedRaw ? extractNarrationFromRaw(normalized.cleanedRaw, "4") : "") ||
            "";
          const section3Items = extractAiPillItems(section3Root);
          const section5Items = extractAiPillItems(section5Root);

          const responseStateHeader = String(aiRes.headers.get("X-AI-Response-State") || "")
            .trim()
            .toLowerCase();
          const responseStateBody = String((parsed?.responseState || root?.responseState || "")).trim().toLowerCase();
          const responseState = responseStateHeader || responseStateBody;
          const shouldRetry =
            attempt < 3 &&
            (responseState === "pending" ||
              responseState === "fallback-en" ||
              responseState === "fallback-hi" ||
              (!section1Text && !section4Text && !section3Items.length && !section5Items.length));
          if (shouldRetry) {
            await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
            return fetchAi(attempt + 1);
          }

          return { section1Text, section4Text, section3Items, section5Items };
        };

        const aiData = await fetchAi(0);
        if (!active) return;
        setAiExplanationText(aiData.section1Text);
        setAiModernContextText(aiData.section4Text);
        setAiScholarItems(aiData.section3Items);
        setAiMultiFaithItems(aiData.section5Items);
      } catch {
        if (!active) return;
        setAiExplanationText("");
        setAiModernContextText("");
        setAiScholarItems([]);
        setAiMultiFaithItems([]);
      } finally {
        if (active) setAiActionsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [auth.sessionId, safeLang, selectionChapter, selectionVerse]);

  useEffect(() => {
    if (!humanDilemmas.length) return;
    const sessionId = String(auth.sessionId || "").trim();
    let active = true;

    (async () => {
      const entries = await Promise.all(
        humanDilemmas.map(async (item) => {
          const id = String(item.id || "").trim();
          if (!id) return null;
          const payloadMedia = String(item.mediaUrl || "").trim();
          const payloadText = normalizeMarqueeText(String(item.text || "").trim());
          if (dilemmaMediaCacheRef.current.has(id) || dilemmaTextCacheRef.current.has(id)) {
            return [
              id,
              String(dilemmaMediaCacheRef.current.get(id) || payloadMedia),
              String(dilemmaTextCacheRef.current.get(id) || payloadText),
            ] as const;
          }

          try {
            const detailUrl = new URL(functionUrl("mydil"));
            detailUrl.searchParams.set("id", id);
            detailUrl.searchParams.set("lang", safeLang);
            if (sessionId) {
              detailUrl.searchParams.set("sessionId", sessionId);
            }
            const response = await fetch(detailUrl.toString(), { headers: { Accept: "application/json" } });
            if (!response.ok) return [id, payloadMedia, payloadText] as const;
            const rawText = await response.text();
            const detail = parseEndpointPayload(rawText);
            const resolvedMedia =
              extractDilemmaMediaUrl(detail) ||
              extractDilemmaMediaUrl((detail as any)?.data) ||
              payloadMedia;
            const resolvedText =
              extractDilemmaNarrationText(detail) ||
              extractDilemmaNarrationText((detail as any)?.data) ||
              payloadText;
            dilemmaMediaCacheRef.current.set(id, resolvedMedia);
            dilemmaTextCacheRef.current.set(id, resolvedText);
            return [id, resolvedMedia, resolvedText] as const;
          } catch {
            return [id, payloadMedia, payloadText] as const;
          }
        })
      );

      if (!active) return;
      const mediaPatch: Record<string, string> = {};
      const textPatch: Record<string, string> = {};
      entries.forEach((entry) => {
        if (!entry) return;
        const [id, mediaUrl, detailText] = entry;
        if (!id) return;
        mediaPatch[id] = String(mediaUrl || "");
        textPatch[id] = String(detailText || "");
      });
      setDilemmaMediaById((prev) => ({ ...prev, ...mediaPatch }));
      setDilemmaTextById((prev) => ({ ...prev, ...textPatch }));
    })();

    return () => {
      active = false;
    };
  }, [auth.sessionId, humanDilemmas, safeLang]);

  useEffect(() => {
    const sessionId = String(auth.sessionId || "").trim();
    const fetchKey = `${safeLang}:${selectionChapter}:${selectionVerse}:${sessionId}`;
    if (legendaryFetchKeyRef.current === fetchKey) return;
    legendaryFetchKeyRef.current = fetchKey;

    setLegendaryStories([]);
    setLegendaryLoadingActions(true);
    setActiveYouTubeTileId(null);
    let active = true;

    (async () => {
      try {
        const storiesUrl = new URL(functionUrl("GitaLegendaryStories"));
        storiesUrl.searchParams.set("chapter", String(selectionChapter));
        storiesUrl.searchParams.set("verse", String(selectionVerse));
        storiesUrl.searchParams.set("lang", safeLang);
        if (sessionId) {
          storiesUrl.searchParams.set("sessionId", sessionId);
          storiesUrl.searchParams.set("session", sessionId);
        }
        const response = await fetch(storiesUrl.toString(), { headers: { Accept: "application/json" } });
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : {};
        const root = parsed?.data ?? parsed?.body ?? parsed ?? {};
        const payload = root?.data ?? root;
        const stories = Array.isArray(payload?.stories) ? payload.stories : [];
        if (!active) return;
        setLegendaryStories(
          stories
            .map((item: any, idx: number) => ({
              id: String(item?.id || `story-${idx + 1}`),
              title: pickText(item?.title, t("Story {index}", { index: idx + 1 })),
              text: pickText(item?.story_text, item?.text, item?.description),
            }))
            .filter((item: any) => item.text)
        );
      } catch {
        if (!active) return;
        setLegendaryStories([]);
      } finally {
        if (active) setLegendaryLoadingActions(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [auth.sessionId, safeLang, selectionChapter, selectionVerse, t]);

  useEffect(() => {
    const sessionId = String(auth.sessionId || "").trim();
    let active = true;
    (async () => {
      try {
        const url = new URL(functionUrl("gitaYouTubeVivechan"));
        url.searchParams.set("chapter", String(selectionChapter));
        url.searchParams.set("verse", String(selectionVerse));
        url.searchParams.set("lang", safeLang);
        if (sessionId) {
          url.searchParams.set("sessionId", sessionId);
          url.searchParams.set("session", sessionId);
        }
        const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : {};
        const root = parsed?.data ?? parsed?.body ?? parsed ?? {};
        const payload = root?.payload ?? root?.payLoad ?? root;
        if (!active) return;
        const nextItems = extractYouTubeVideoItems(payload?.videoLinks);
        setYoutubeItems(nextItems);
        setActiveYouTubeTileId(null);
      } catch {
        if (!active) return;
        setYoutubeItems([]);
        setActiveYouTubeTileId(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [auth.sessionId, safeLang, selectionChapter, selectionVerse]);

  useEffect(() => {
    // Reset per-verse mapping view; cache still serves already fetched ids.
    setDilemmaMediaById({});
    setDilemmaTextById({});
  }, [safeLang, selectionChapter, selectionVerse]);

  useEffect(() => {
    return () => {
      if (dilemmaTapRef.current?.timer) {
        clearTimeout(dilemmaTapRef.current.timer);
      }
      dilemmaTapRef.current = null;
    };
  }, []);

  const showAuthPrompt = Boolean(
    !loading &&
      !auth.sessionId &&
      error &&
      /signin|sign in|session|unauthorized|access denied/i.test(String(error))
  );
  const actionTileSize = squareSize;

  const renderActionTile = (
    id: string,
    title: string,
    onPress: () => void,
    options?: {
      subtitle?: string;
      active?: boolean;
      disabled?: boolean;
      thumbnail?: string;
      meta?: string;
    }
  ) => {
    const disabled = Boolean(options?.disabled);
    const active = Boolean(options?.active);
    const labelText = normalizeMarqueeText(
      `${title}${options?.subtitle ? `. ${options.subtitle}` : ""}${options?.meta ? `. ${options.meta}` : ""}`
    );
    return (
      <TouchableOpacity
        key={id}
        ref={(node) => registerAnchor(id, node)}
        {...withAssistivePress(id, labelText || title, onPress, disabled)}
        disabled={disabled}
        style={{
          width: actionTileSize,
          height: actionTileSize,
          minWidth: 48,
          minHeight: 48,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: active ? "rgba(34,197,94,0.75)" : "rgba(15,23,42,0.22)",
          backgroundColor: disabled
            ? "rgba(148,163,184,0.16)"
            : active
            ? "rgba(34,197,94,0.2)"
            : "rgba(15,23,42,0.06)",
          alignItems: "center",
          justifyContent: "center",
          padding: 6,
          opacity: disabled ? 0.6 : 1,
          overflow: "hidden",
        }}
      >
        {options?.thumbnail ? (
          <Image
            source={{ uri: options.thumbnail }}
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%", opacity: 0.22 }}
            resizeMode="cover"
          />
        ) : null}
        <Text numberOfLines={2} style={{ textAlign: "center", color: "#0f172a", fontSize: 12, fontWeight: "700" }}>
          {title}
        </Text>
        {options?.subtitle ? (
          <Text numberOfLines={1} style={{ marginTop: 4, textAlign: "center", color: "#0f172a", opacity: 0.75, fontSize: 10 }}>
            {options.subtitle}
          </Text>
        ) : null}
        {options?.meta ? (
          <Text numberOfLines={3} style={{ marginTop: 3, textAlign: "center", color: "#0f172a", opacity: 0.62, fontSize: 9 }}>
            {options.meta}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  };
  const centeredTileRowStyle = {
    flexGrow: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 4,
    gap: 10,
  };
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: 14,
          paddingTop: 4,
          paddingBottom: 24,
          width: "100%",
        }}
      >
        <View style={{ alignItems: "center" }}>
          {loading ? (
            <View style={{ marginTop: 4, flexDirection: "row", alignItems: "center" }}>
              <ActivityIndicator />
              <Text style={{ color: "#0f172a", marginLeft: 8, opacity: 0.8 }}>{t("Loading…")}</Text>
            </View>
          ) : null}

          {error ? (
            <Text style={{ color: "#b91c1c", marginTop: 10 }}>{error}</Text>
          ) : null}

          {showAuthPrompt ? (
            <TouchableOpacity
              {...withAssistivePress("auth-sign-in", t("Sign in to load this verse"), () => auth.openLogin("login"))}
              style={{
                marginTop: 12,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 12,
                backgroundColor: "rgba(34,197,94,0.18)",
                borderWidth: 1,
                borderColor: "rgba(34,197,94,0.55)",
              }}
            >
              <Text style={{ color: "#0f172a", fontWeight: "700" }}>
                {t("Sign in to load this verse")}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {sanskrit ? (
          <View style={{ marginTop: 2, alignItems: "center" }}>
            <GitaVerseImageCard
              sanskritText={sanskrit}
              chapter={selectionChapter}
              verse={selectionVerse}
              width={isCompact ? 320 : 420}
              showVerseLabel={false}
              minimalChrome
            />
          </View>
        ) : null}
        <View style={{ marginTop: 8, alignItems: "center", gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              ref={(node) => registerAnchor("chapter-prev", node)}
              {...withAssistivePress(
                "chapter-prev",
                `${formatChapterLabel(chapterPrev)}. ${chapterTitleByRow.prev || ""}`,
                () => speakChapterText("prev", chapterTextByRow.prev, "chapter-prev")
              )}
              style={{
                width: squareSize,
                height: squareSize,
                minWidth: 48,
                minHeight: 48,
                borderRadius: 8,
                borderWidth: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: 4,
                borderColor:
                  activeChapterTtsKey === "prev"
                    ? "rgba(34,197,94,0.7)"
                    : "rgba(15,23,42,0.24)",
                backgroundColor:
                  activeChapterTtsKey === "prev"
                    ? "rgba(34,197,94,0.2)"
                    : "rgba(15,23,42,0.06)",
              }}
            >
              <Text style={{ fontSize: 11, color: "#0f172a", opacity: 0.72 }}>{t("Chapter")}</Text>
              <Text style={{ fontSize: 18, fontWeight: "800", color: "#0f172a" }}>{chapterPrev}</Text>
              <Text numberOfLines={2} style={{ marginTop: 3, fontSize: 10, color: "#0f172a", textAlign: "center" }}>
                {chapterTitleByRow.prev || "—"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              ref={(node) => registerAnchor("chapter-current", node)}
              {...withAssistivePress(
                "chapter-current",
                `${formatChapterLabel(selectionChapter)}. ${chapterTitleByRow.current || ""}`,
                () => speakChapterText("current", chapterTextByRow.current, "chapter-current")
              )}
              style={{
                width: squareSize,
                height: squareSize,
                minWidth: 48,
                minHeight: 48,
                borderRadius: 8,
                borderWidth: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: 4,
                borderColor:
                  activeChapterTtsKey === "current"
                    ? "rgba(34,197,94,0.7)"
                    : "rgba(14,116,144,0.4)",
                backgroundColor:
                  activeChapterTtsKey === "current"
                    ? "rgba(34,197,94,0.2)"
                    : "rgba(14,165,233,0.14)",
              }}
            >
              <Text style={{ fontSize: 11, color: "#0f172a", opacity: 0.72 }}>{t("Chapter")}</Text>
              <Text style={{ fontSize: 18, fontWeight: "800", color: "#0f172a" }}>{selectionChapter}</Text>
              <Text numberOfLines={2} style={{ marginTop: 3, fontSize: 10, color: "#0f172a", textAlign: "center" }}>
                {chapterTitleByRow.current || "—"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              ref={(node) => registerAnchor("chapter-next", node)}
              {...withAssistivePress(
                "chapter-next",
                `${formatChapterLabel(chapterNext)}. ${chapterTitleByRow.next || ""}`,
                () => speakChapterText("next", chapterTextByRow.next, "chapter-next")
              )}
              style={{
                width: squareSize,
                height: squareSize,
                minWidth: 48,
                minHeight: 48,
                borderRadius: 8,
                borderWidth: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: 4,
                borderColor:
                  activeChapterTtsKey === "next"
                    ? "rgba(34,197,94,0.7)"
                    : "rgba(15,23,42,0.24)",
                backgroundColor:
                  activeChapterTtsKey === "next"
                    ? "rgba(34,197,94,0.2)"
                    : "rgba(15,23,42,0.06)",
              }}
            >
              <Text style={{ fontSize: 11, color: "#0f172a", opacity: 0.72 }}>{t("Chapter")}</Text>
              <Text style={{ fontSize: 18, fontWeight: "800", color: "#0f172a" }}>{chapterNext}</Text>
              <Text numberOfLines={2} style={{ marginTop: 3, fontSize: 10, color: "#0f172a", textAlign: "center" }}>
                {chapterTitleByRow.next || "—"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              {...withAssistivePress(
                "verse-prev",
                `${formatVerseLabel(`${versePrevChapter}.${versePrev}`)}. ${verseSanskritByRow.prev || ""}`,
                () => goToVerse(-1)
              )}
              style={{
                width: squareSize,
                height: squareSize,
                minWidth: 48,
                minHeight: 48,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: "rgba(15,23,42,0.24)",
                backgroundColor: "rgba(15,23,42,0.06)",
                alignItems: "center",
                justifyContent: "center",
                padding: 6,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#0f172a", opacity: 0.86 }}>
                {formatVerseLabel(`${versePrevChapter}.${versePrev}`)}
              </Text>
              <Text numberOfLines={3} style={{ marginTop: 4, fontSize: 11, color: "#0f172a", textAlign: "center" }}>
                {verseSanskritByRow.prev || "—"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              {...withAssistivePress(
                "verse-current-audio",
                `${formatVerseLabel(`${selectionChapter}.${selectionVerse}`)}. ${verseSanskritByRow.current || ""}`,
                toggleCurrentVerseLearn2ReciteAudio
              )}
              style={{
                width: squareSize,
                height: squareSize,
                minWidth: 48,
                minHeight: 48,
                borderRadius: 8,
                borderWidth: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: 6,
                borderColor:
                  activeVerseAudioKey === `${selectionChapter}:${selectionVerse}` && isVerseAudioPlaying
                    ? "rgba(34,197,94,0.75)"
                    : "rgba(14,116,144,0.4)",
                backgroundColor:
                  activeVerseAudioKey === `${selectionChapter}:${selectionVerse}` && isVerseAudioPlaying
                    ? "rgba(34,197,94,0.22)"
                    : "rgba(14,165,233,0.14)",
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#0f172a", opacity: 0.86 }}>
                {formatVerseLabel(`${selectionChapter}.${selectionVerse}`)}
              </Text>
              <Text numberOfLines={3} style={{ marginTop: 4, fontSize: 11, color: "#0f172a", textAlign: "center" }}>
                {verseSanskritByRow.current || "—"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              {...withAssistivePress(
                "verse-next",
                `${formatVerseLabel(`${verseNextChapter}.${verseNext}`)}. ${verseSanskritByRow.next || ""}`,
                () => goToVerse(1)
              )}
              style={{
                width: squareSize,
                height: squareSize,
                minWidth: 48,
                minHeight: 48,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: "rgba(15,23,42,0.24)",
                backgroundColor: "rgba(15,23,42,0.06)",
                alignItems: "center",
                justifyContent: "center",
                padding: 6,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#0f172a", opacity: 0.86 }}>
                {formatVerseLabel(`${verseNextChapter}.${verseNext}`)}
              </Text>
              <Text numberOfLines={3} style={{ marginTop: 4, fontSize: 11, color: "#0f172a", textAlign: "center" }}>
                {verseSanskritByRow.next || "—"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ marginTop: 14, gap: 12 }}>
          {relatedVerses.length ? (
            <View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={centeredTileRowStyle}>
                {relatedVerses.map((item, idx) =>
                  renderActionTile(
                    `related-${item.chapter}-${item.verse}-${idx}`,
                    localizeVerseLabel(
                      ensureVersePrefix(item.shlok || `${item.chapter}.${item.verse}`) ||
                        `Verse ${item.chapter}.${item.verse}`
                    ),
                    () => updateSelection({ chapter: item.chapter, verse: item.verse }),
                    {
                      subtitle: t("Related"),
                      meta: toPreviewWords(item.sanskrit || ""),
                    }
                  )
                )}
              </ScrollView>
            </View>
          ) : null}

          {humanDilemmas.length ? (
            <View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={centeredTileRowStyle}>
                {humanDilemmas.map((item, idx) => {
                  const mediaUrl = dilemmaMediaById[item.id] || item.mediaUrl || item?.raw?.image || "";
                  const tileKey = `dilemma-${item.id}-${idx}`;
                  const dilemmaTtsText = normalizeMarqueeText(
                    String(dilemmaTextById[item.id] || item.text || item.name || "").trim()
                  );
                  const isActive = activeGenericTtsKey === tileKey;
                  return (
                    <TouchableOpacity
                      key={tileKey}
                      ref={(node) => registerAnchor(tileKey, node)}
                      {...withAssistivePress(
                        tileKey,
                        item.name || t("Dilemma"),
                        () => {
                          const now = Date.now();
                          const prev = dilemmaTapRef.current;
                          if (prev && prev.key === tileKey && now - prev.at <= 320) {
                            if (prev.timer) clearTimeout(prev.timer);
                            dilemmaTapRef.current = null;
                            const summary = String(dilemmaTextById[item.id] || item.text || "").trim();
                            const image = String(dilemmaMediaById[item.id] || mediaUrl || "").trim();
                            router.push({
                              pathname: "/dilemma",
                              params: {
                                id: String(item.id),
                                summary,
                                image,
                              },
                            });
                            return;
                          }
                          if (prev?.timer) {
                            clearTimeout(prev.timer);
                          }
                          const timer = setTimeout(() => {
                            toggleGenericTtsForText(tileKey, dilemmaTtsText);
                            if (dilemmaTapRef.current?.key === tileKey) {
                              dilemmaTapRef.current = null;
                            }
                          }, 320);
                          dilemmaTapRef.current = { key: tileKey, at: now, timer };
                        },
                        !dilemmaTtsText
                      )}
                      disabled={!dilemmaTtsText}
                      style={{
                        width: actionTileSize,
                        height: actionTileSize,
                        minWidth: 48,
                        minHeight: 48,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: isActive ? "rgba(34,197,94,0.75)" : "rgba(15,23,42,0.22)",
                        backgroundColor: isActive ? "rgba(34,197,94,0.2)" : "rgba(15,23,42,0.06)",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 6,
                        marginRight: 10,
                        overflow: "hidden",
                        opacity: dilemmaTtsText ? 1 : 0.6,
                      }}
                    >
                      <DilemmaTileMedia url={mediaUrl} />
                      <View
                        pointerEvents="none"
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          backgroundColor: mediaUrl ? "rgba(15,23,42,0.22)" : "transparent",
                        }}
                      />
                      <Text
                        numberOfLines={2}
                        style={{
                          textAlign: "center",
                          color: mediaUrl ? "#ffffff" : "#0f172a",
                          fontSize: 12,
                          fontWeight: "700",
                        }}
                      >
                        {item.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={centeredTileRowStyle}>
              {renderActionTile(
                "audio-parayan",
                t("Parayan"),
                handleParayanAudio,
                {
                  subtitle: t("Chapter"),
                  meta: currentParayanFeed?.previewText || "",
                  active: activeVerseAudioKey === `audio-parayan-${selectionChapter}` && isVerseAudioPlaying,
                  disabled: false,
                }
              )}
              {promotedRecitePlaylistTrack
                ? renderActionTile(
                    "audio-playlist-recite",
                    t("Recite"),
                    () =>
                      toggleStreamAudio(
                        "audio-playlist-recite",
                        promotedRecitePlaylistTrack.url,
                        sanskrit
                      ),
                    {
                      active: activeVerseAudioKey === "audio-playlist-recite" && isVerseAudioPlaying,
                      meta: toPreviewWords(sanskrit),
                    }
                  )
                : null}
              {renderActionTile(
                "audio-recital",
                t("Learn2Recite"),
                () =>
                  toggleStreamAudio(
                    "audio-recital",
                    currentAudioByType.recite,
                    currentAudioTextByType.recite
                  ),
                {
                  active: activeVerseAudioKey === "audio-recital" && isVerseAudioPlaying,
                  disabled: !currentAudioByType.recite,
                  meta: toPreviewWords(currentAudioTextByType.recite),
                }
              )}
            </ScrollView>
          </View>

          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={centeredTileRowStyle}>
              {renderActionTile(
                "audio-hindi",
                t("Narration Hindi"),
                handleHindiNarrationAudio,
                {
                  active: activeVerseAudioKey === "audio-hindi" && isVerseAudioPlaying,
                  disabled: !currentAudioByType.hindiNarration,
                  meta: toPreviewWords(currentAudioTextByType.hindiNarration),
                }
              )}
              {renderActionTile(
                "audio-language",
                t("Narration (F)"),
                () =>
                  handleNarrationAudioWithFallback(
                    "audio-language",
                    currentAudioByType.languageNarration,
                    currentAudioTextByType.languageNarration,
                    "female"
                  ),
                {
                  active:
                    (activeVerseAudioKey === "audio-language" && isVerseAudioPlaying) ||
                    activeGenericTtsKey === "audio-language",
                  disabled: !currentAudioByType.languageNarration && !currentAudioTextByType.languageNarration,
                  meta: toPreviewWords(currentAudioTextByType.languageNarration),
                }
              )}
              {remainingAudioPlaylistTracks.length
                ? remainingAudioPlaylistTracks.map((track, idx) =>
                    (() => {
                      const normalizedLabel = String(track?.label || "").trim().toLowerCase();
                      const isMaleTrack = normalizedLabel === "male";
                      return renderActionTile(
                        `playlist-${idx}`,
                        isMaleTrack
                          ? t("Narration (M)")
                          : sanitizeTileLabelText(track.label) || t("Track {index}", { index: idx + 1 }),
                        () =>
                          isMaleTrack
                            ? handleNarrationAudioWithFallback(
                                `playlist-${idx}`,
                                track.url,
                                currentAudioTextByType.languageNarration,
                                "male"
                              )
                            : toggleStreamAudio(
                                `playlist-${idx}`,
                                track.url,
                                undefined
                              ),
                        {
                          active:
                            (activeVerseAudioKey === `playlist-${idx}` && isVerseAudioPlaying) ||
                            (isMaleTrack && activeGenericTtsKey === `playlist-${idx}`),
                          disabled:
                            !track.url && (!isMaleTrack || !currentAudioTextByType.languageNarration),
                          meta: isMaleTrack ? toPreviewWords(currentAudioTextByType.languageNarration) : undefined,
                        }
                      );
                    })()
                  )
                : renderActionTile("playlist-empty", t("No Tracks"), () => {}, { disabled: true })}
            </ScrollView>
          </View>

          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={centeredTileRowStyle}>
              {renderActionTile(
                "tts-ai-expl",
                t("Explanation"),
                () =>
                  toggleGenericTtsForText(
                    "tts-ai-expl",
                    withTtsHeader(t("Explanation"), aiExplanationText, t("AI")),
                    "default"
                  ),
                {
                  subtitle: t("AI"),
                  meta: toPreviewWords(aiExplanationText),
                  active: activeGenericTtsKey === "tts-ai-expl",
                  disabled: aiActionsLoading || !aiExplanationText,
                }
              )}
              {renderActionTile(
                "tts-modern-context",
                modernContextTileLabel,
                () =>
                  toggleGenericTtsForText(
                    "tts-modern-context",
                    withTtsHeader(modernContextTileLabel, resolvedModernContextTtsSource, t("Gita")),
                    "default"
                  ),
                {
                  subtitle: t("Gita"),
                  meta: toPreviewWords(resolvedModernContextTtsSource),
                  active: activeGenericTtsKey === "tts-modern-context",
                  disabled: !resolvedModernContextTtsSource,
                }
              )}
              {renderActionTile(
                "tts-sattvic-logic",
                sattvicLogicTileLabel,
                () =>
                  router.push("/sattviclogic"),
                {
                  subtitle: lang,
                  meta: toPreviewWords(verseSanskritByRow.current || sanskrit, 10),
                }
              )}
            </ScrollView>
          </View>

          {aiScholarItems.length ? (
            <View>
              <Text style={{ color: "#0f172a", fontWeight: "700", marginBottom: 8 }}>{t("Scholar View")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={centeredTileRowStyle}>
                {aiScholarItems.map((item, idx) =>
                  renderActionTile(
                    `scholar-${idx}`,
                    sanitizeTileLabelText(item.title) || t("Scholar {index}", { index: idx + 1 }),
                    () =>
                      toggleGenericTtsForText(
                        `scholar-${idx}`,
                        withTtsHeader(
                          sanitizeTileLabelText(item.title) || t("Scholar {index}", { index: idx + 1 }),
                          item.text
                        )
                      ),
                    {
                      meta: toPreviewWords(item.text),
                      active: activeGenericTtsKey === `scholar-${idx}`,
                    }
                  )
                )}
              </ScrollView>
            </View>
          ) : null}

          {aiMultiFaithItems.length ? (
            <View>
              <Text style={{ color: "#0f172a", fontWeight: "700", marginBottom: 8 }}>{t("Multi Faith")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={centeredTileRowStyle}>
                {aiMultiFaithItems.map((item, idx) =>
                  renderActionTile(
                    `faith-${idx}`,
                    sanitizeTileLabelText(item.title) || t("View {index}", { index: idx + 1 }),
                    () =>
                      toggleGenericTtsForText(
                        `faith-${idx}`,
                        withTtsHeader(
                          sanitizeTileLabelText(item.title) || t("View {index}", { index: idx + 1 }),
                          item.text
                        )
                      ),
                    {
                      meta: toPreviewWords(item.text),
                      active: activeGenericTtsKey === `faith-${idx}`,
                    }
                  )
                )}
              </ScrollView>
            </View>
          ) : null}

          <View>
            <Text style={{ color: "#0f172a", fontWeight: "700", marginBottom: 8 }}>{t("Legendary Stories")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={centeredTileRowStyle}>
              {legendaryLoadingActions
                ? renderActionTile("legend-loading", t("Loading..."), () => {}, { disabled: true })
                : legendaryStories.length
                ? legendaryStories.map((item) =>
                    renderActionTile(
                      `legend-${item.id}`,
                      sanitizeTileLabelText(item.title) || t("Story"),
                      () =>
                        toggleGenericTtsForText(
                          `legend-${item.id}`,
                          withTtsHeader(sanitizeTileLabelText(item.title) || t("Story"), item.text)
                        ),
                      {
                        meta: toPreviewWords(item.text),
                        active: activeGenericTtsKey === `legend-${item.id}`,
                      }
                    )
                  )
                : renderActionTile("legend-empty", t("No Stories"), () => {}, { disabled: true })}
            </ScrollView>
          </View>

          <View>
            <Text style={{ color: "#0f172a", fontWeight: "700", marginBottom: 8 }}>{t("Curated YouTube Video")}</Text>
            {activeYouTubeItem?.videoId ? (
              <View
                style={{
                  marginBottom: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "rgba(15,23,42,0.18)",
                  overflow: "hidden",
                  backgroundColor: "#000",
                }}
              >
                <YouTube
                  key={`yt-player-${activeYouTubeItem.tileId}-${youtubePlayerSeed}`}
                  height={Math.max(210, Math.round(actionTileSize * 1.35))}
                  width={Math.round(width - 28)}
                  play
                  videoId={activeYouTubeItem.videoId}
                  initialPlayerParams={{ controls: true, modestbranding: true, rel: false, playsinline: true }}
                />
              </View>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={centeredTileRowStyle}>
              {youtubeItems.length
                ? youtubeItems.map((item) => (
                    <TouchableOpacity
                      key={`yt-${item.tileId}`}
                      {...withAssistivePress(
                        `yt-${item.tileId}`,
                        item.title || t("YouTube video"),
                        () => {
                          if (item.videoId) {
                            stopOtherMedia("youtube");
                            setActiveYouTubeTileId(item.tileId);
                            setYouTubePlayerSeed((prev) => prev + 1);
                          } else {
                            stopOtherMedia("youtube");
                            Linking.openURL(item.url).catch(() => {});
                          }
                        }
                      )}
                      style={{
                        width: Math.round(actionTileSize * 1.7),
                        height: actionTileSize,
                        minWidth: 132,
                        minHeight: 78,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor:
                          activeYouTubeTileId === item.tileId ? "rgba(34,197,94,0.75)" : "rgba(15,23,42,0.22)",
                        backgroundColor:
                          activeYouTubeTileId === item.tileId ? "rgba(34,197,94,0.2)" : "rgba(15,23,42,0.06)",
                        marginRight: 10,
                        overflow: "hidden",
                      }}
                    >
                      {item.thumbnail ? (
                        <Image
                          source={{ uri: item.thumbnail }}
                          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 1 }}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 8 }}>
                          <Text numberOfLines={2} style={{ color: "#0f172a", fontSize: 12, fontWeight: "700", textAlign: "center" }}>
                            {item.title}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))
                : renderActionTile("yt-empty", t("No Videos"), () => {}, { disabled: true })}
            </ScrollView>
          </View>
        </View>
        <View style={{ marginTop: 12 }}>
          <PageBottomMeta />
        </View>
      </ScrollView>

    </View>
  );
}
