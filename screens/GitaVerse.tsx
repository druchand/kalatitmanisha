import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  Vibration,
  useWindowDimensions,
  View,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthModalContext';
import { useLanguage } from '../context/LanguageContext';
import { useVerseSelection } from '../context/VerseSelectionContext';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAudioPlayer, useAudioPlayerStatus, type AudioSource } from "expo-audio";
import YouTube from 'react-native-youtube-iframe';
import GitaVerseImageCard from '../components/gitaVerse/GitaVerseImageCard';
import PageBottomMeta from "../components/layout/PageBottomMeta";
import {
  SectionId,
  normalizeGitaAIRoot,
  wrapRootForSection,
  extractTextForSection,
  extractNarrationFromRaw,
} from '../utils/gitaAISectionHelpers';
import { getExpoSpeechModule, getWebSpeechSynthesis, resolveTtsLocale, speakWithResolvedVoice, stopResolvedSpeech } from '../utils/ttsSupport';
import { functionUrl } from '../utils/functionApi';

const GITA_NARRATION_ENDPOINT = functionUrl('gitaVerse');
const LEGENDARY_STORIES_ENDPOINT = functionUrl('GitaLegendaryStories');

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

const Speech: ExpoSpeechModule | null = getExpoSpeechModule();

const BUTTON_BORDER_COLOR = 'rgba(15,23,42,0.28)';
const BASE_BUTTON_STYLE: ViewStyle = {
  paddingVertical: 12,
  paddingHorizontal: 28,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: BUTTON_BORDER_COLOR,
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 150,
};
const PREVIOUS_BUTTON_STYLE: ViewStyle = {
  ...BASE_BUTTON_STYLE,
  backgroundColor: 'rgba(15,23,42,0.06)',
};
const NEXT_BUTTON_STYLE: ViewStyle = {
  ...BASE_BUTTON_STYLE,
  backgroundColor: 'rgba(34,197,94,0.25)',
  borderColor: 'rgba(34,197,94,0.6)',
};
const RELATED_PILL_COLOR = '#fef08a';
const DILEMMA_PILL_COLOR = '#7dd3fc';
const PILL_TEXT_COLOR = '#0f172a';
const RELATED_PILL_STYLE: ViewStyle = {
  ...BASE_BUTTON_STYLE,
  minWidth: 130,
  maxWidth: 200,
  paddingHorizontal: 14,
  marginRight: 12,
  backgroundColor: RELATED_PILL_COLOR,
  borderColor: 'rgba(250,204,21,0.9)',
  alignItems: 'flex-start',
};
const DILEMMA_PILL_STYLE: ViewStyle = {
  ...BASE_BUTTON_STYLE,
  minWidth: 130,
  maxWidth: 200,
  paddingHorizontal: 14,
  marginRight: 12,
  backgroundColor: DILEMMA_PILL_COLOR,
  borderColor: 'rgba(14,165,233,0.9)',
  alignItems: 'flex-start',
};
const PILL_TEXT_STYLE: TextStyle = {
  color: PILL_TEXT_COLOR,
  fontWeight: '700',
  fontSize: 14,
  textAlign: 'center',
};

type ScholarCard = {
  id: string;
  text: string;
  image?: string;
};

type CuratedYouTubeVideo = {
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  description?: string;
};

const IMAGE_URL_REGEX = /https?:\/\/\S+\.(?:png|jpe?g|webp|gif)/gi;

const AI_SECTION_IDS: SectionId[] = ["1", "2", "3", "4", "5"];
const SECTION_DISPLAY_NAMES: Record<SectionId, string | null> = {
  "1": "Explanation",
  "2": null,
  "3": "Scholars View",
  "4": null,
  "5": "MultiFaith Views",
};
const AI_SECTION_ORDER: SectionId[] = ["1", "3", "5"];
const HORIZONTAL_AI_SECTIONS: Set<SectionId> = new Set(["3", "5"]);
const SECTION4_EXTRA_KEY = "_section4ExtraText";
const MIN_VERSE_NUMBER = 1;
const MIN_CHAPTER_NUMBER = 1;
const MAX_CHAPTER_NUMBER = 18;
const PREFETCH_WINDOW_SIZE = 5;
const PREFETCH_RADIUS = 2;
const DEFAULT_MAX_VERSE_FALLBACK = 72;
const YOUTUBE_ASPECT_RATIO = 16 / 9;
const YOUTUBE_MIN_WIDTH = 280;
const YOUTUBE_MAX_WIDTH = 860;
const AI_RESPONSE_STATE_HEADER = 'X-AI-Response-State';
const AI_PENDING_PLACEHOLDER_TEXT = 'Please wait, building AI response in progress.';
const AI_RETRY_BASE_DELAY_MS = 1200;
const AI_RETRY_MAX_DELAY_MS = 9000;
const AI_MAX_RETRY_ATTEMPTS = 7;
const GITA_VERSE_RESPONSE_STATE_HEADER = 'X-Gita-Verse-Response-State';
const GITA_VERSE_RETRY_BASE_DELAY_MS = 500;
const GITA_VERSE_RETRY_MAX_DELAY_MS = 4000;
const GITA_VERSE_MAX_RETRY_ATTEMPTS = 6;
const LEGENDARY_RESPONSE_STATE_HEADER = 'X-Legendary-Response-State';
const LEGENDARY_RETRY_BASE_DELAY_MS = 1200;
const LEGENDARY_RETRY_MAX_DELAY_MS = 9000;
const LEGENDARY_MAX_RETRY_ATTEMPTS = 7;
const VERSE_SWIPE_ACTIVATE_THRESHOLD = 18;
const VERSE_SWIPE_TRIGGER_THRESHOLD = 56;
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

type NarrationDataset = {
  chapterData: any;
  verseData: any;
  responseState?: string;
  sourceLang?: string;
};

type RelatedVerse = {
  chapter: number;
  verse: number;
  shlok: string;
  sanskrit?: string | null;
  raw?: any;
};

type HumanDilemmaItem = {
  id: string;
  name: string;
  text: string;
  raw?: any;
};

const toPositiveInt = (value: any): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
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
  if (/^verse\b/i.test(raw) || /^shlok\b/i.test(raw)) return raw;
  if (/^\d+\.\d+$/.test(raw)) return `Verse ${raw}`;
  return raw;
};

const parseChapterVerseFromShlok = (value: any): { chapter: number; verse: number } | null => {
  if (typeof value !== 'string') return null;
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
): RelatedVerse[] => {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((item: any) => {
      const chapterFromFields = toPositiveInt(item?.chapter ?? item?.ch ?? item?.chapterNo);
      const verseFromFields = toPositiveInt(item?.verse ?? item?.v ?? item?.verseNo);
      const fromShlok = parseChapterVerseFromShlok(item?.shlok ?? item?.slok ?? item?.reference);
      const chapter = chapterFromFields ?? fromShlok?.chapter ?? fallbackChapter;
      const verse = verseFromFields ?? fromShlok?.verse ?? fallbackVerse;
      const shlokRaw = String(item?.shlok ?? item?.slok ?? `${chapter}.${verse}`).trim();
      const shlok = ensureVersePrefix(shlokRaw);
      const sanskritValue = item?.sanskrit ?? item?.text ?? item?.verseText ?? null;
      return {
        chapter,
        verse,
        shlok,
        sanskrit: typeof sanskritValue === 'string' ? sanskritValue : null,
        raw: item,
      };
    })
    .filter((item) => item.chapter >= 1 && item.verse >= 1);
};

const normalizeHumanDilemmaItems = (entries: any): HumanDilemmaItem[] => {
  if (!Array.isArray(entries)) return [];
  return entries.reduce<HumanDilemmaItem[]>((acc, item: any, idx: number) => {
      const id = String(item?.id ?? item?._id ?? item?.dilemmaId ?? '').trim();
      const name = String(item?.name ?? item?.title ?? '').trim();
      const text = String(item?.text ?? item?.description ?? item?.summary ?? '').trim();
      if (!id || (!name && !text)) return acc;
      acc.push({
        id,
        name: name || `Dilemma ${idx + 1}`,
        text,
        raw: item,
      });
      return acc;
    }, []);
};

const extractChapterVerseCount = (chapterData: any): number | null => {
  if (!chapterData || typeof chapterData !== 'object') return null;
  const candidateValues = [
    chapterData?.totalVerses,
    chapterData?.totalVerse,
    chapterData?.verseCount,
    chapterData?.versesCount,
    chapterData?.maxVerse,
    chapterData?.maxVerses,
    chapterData?.verse_count,
    chapterData?.verses_count,
    chapterData?.meta?.totalVerses,
    chapterData?.meta?.verseCount,
    chapterData?.pagination?.totalVerses,
    chapterData?.pagination?.verseCount,
  ];
  for (const value of candidateValues) {
    const parsed = toPositiveInt(value);
    if (parsed) return parsed;
  }
  return null;
};

const buildVerseWindow = (centerVerse: number, maxVerse: number): number[] => {
  if (!Number.isFinite(maxVerse) || maxVerse < MIN_VERSE_NUMBER) return [];
  const effectiveMax = Math.max(MIN_VERSE_NUMBER, Math.floor(maxVerse));
  const clampedCenter = Math.min(effectiveMax, Math.max(MIN_VERSE_NUMBER, Math.floor(centerVerse)));
  const targetSize = Math.min(PREFETCH_WINDOW_SIZE, effectiveMax);

  let start = clampedCenter - PREFETCH_RADIUS;
  let end = clampedCenter + PREFETCH_RADIUS;

  if (start < MIN_VERSE_NUMBER) {
    const delta = MIN_VERSE_NUMBER - start;
    start = MIN_VERSE_NUMBER;
    end = Math.min(effectiveMax, end + delta);
  }
  if (end > effectiveMax) {
    const delta = end - effectiveMax;
    end = effectiveMax;
    start = Math.max(MIN_VERSE_NUMBER, start - delta);
  }

  while (end - start + 1 < targetSize) {
    if (start > MIN_VERSE_NUMBER) {
      start -= 1;
    } else if (end < effectiveMax) {
      end += 1;
    } else {
      break;
    }
  }

  const verses: number[] = [];
  for (let verse = start; verse <= end; verse += 1) {
    verses.push(verse);
  }
  return verses;
};

const buildEmptyAiSections = (): Record<SectionId, any> => {
  return AI_SECTION_IDS.reduce<Record<SectionId, any>>((acc, id) => {
    acc[id] = undefined;
    return acc;
  }, {} as Record<SectionId, any>);
};

const mergeSectionOneAndFour = (primary: any, extra: any): any => {
  if (!extra) return primary;
  if (!primary) return extra;
  const extraText = flattenSectionValue(extra);
  if (!extraText) return primary;
  if (typeof primary === 'object' && !Array.isArray(primary)) {
    return { ...primary, [SECTION4_EXTRA_KEY]: extraText };
  }
  const primaryText = flattenSectionValue(primary);
  if (!primaryText) return extraText;
  return [primaryText, extraText].filter(Boolean).join('\n\n');
};

const extractPillItems = (sectionData: any): string[] => {
  if (!sectionData) return [];
  const candidates: any[] = [];
  const pushCandidates = (items: any[]) => {
    items.forEach((item) => candidates.push(item));
  };
  if (Array.isArray(sectionData)) {
    pushCandidates(sectionData);
  } else if (Array.isArray(sectionData.items)) {
    pushCandidates(sectionData.items);
  } else if (Array.isArray(sectionData.data)) {
    pushCandidates(sectionData.data);
  } else if (Array.isArray(sectionData.sections)) {
    pushCandidates(sectionData.sections);
  } else if (Array.isArray(sectionData.entries)) {
    pushCandidates(sectionData.entries);
  } else {
    candidates.push(sectionData);
  }
  return candidates
    .map((entry) => flattenSectionValue(entry))
    .filter((text): text is string => Boolean(text))
    .map((text) => text.trim())
    .filter(Boolean);
};

const flattenSectionValue = (value: any): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => flattenSectionValue(item)).filter(Boolean).join("\n\n");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, inner]) => {
        const flattened = flattenSectionValue(inner);
        return flattened ? `${key}: ${flattened}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return String(value);
};

const normalizeTtsPayloadText = (value: any): string => {
  const text = flattenSectionValue(value);
  return text.replace(/\n{3,}/g, '\n\n').trim();
};

const buildAiSectionTtsText = (sectionId: SectionId, sectionData: any): string => {
  if (!sectionData) return '';
  if (HORIZONTAL_AI_SECTIONS.has(sectionId)) {
    return normalizeTtsPayloadText(extractPillItems(sectionData));
  }

  const isPlainObject = typeof sectionData === 'object' && !Array.isArray(sectionData);
  if (!isPlainObject) {
    return normalizeTtsPayloadText(sectionData);
  }

  const entries = Object.entries(sectionData).filter(
    ([key]) =>
      key !== 'sections' &&
      key !== 'sectionRange' &&
      key !== SECTION4_EXTRA_KEY &&
      key !== 'raw' &&
      key !== 'data' &&
      key !== 'body' &&
      key !== 'payload' &&
      key !== 'payLoad' &&
      key !== 'success' &&
      key !== 'cached' &&
      key !== 'message' &&
      !/^\d+$/.test(key)
  );
  const sections: string[] = [];
  entries.forEach(([, value]) => {
    const text = normalizeTtsPayloadText(value);
    if (text) sections.push(text);
  });
  if (!entries.length && sectionData.text) {
    const textValue = normalizeTtsPayloadText(sectionData.text);
    if (textValue) sections.push(textValue);
  }
  const extraText =
    typeof sectionData[SECTION4_EXTRA_KEY] === 'string'
      ? sectionData[SECTION4_EXTRA_KEY].trim()
      : '';
  if (extraText) {
    sections.push(extraText);
  }
  return normalizeTtsPayloadText(sections);
};

const buildLegendaryStoriesTtsText = (payload: any): string => {
  if (!payload) return '';
  const stories = Array.isArray(payload?.stories) ? payload.stories : [];
  const segments: string[] = [];
  const simpleMeaning = String(payload?.simple_meaning || '').trim();
  if (simpleMeaning) segments.push(simpleMeaning);
  stories.forEach((story: any) => {
    const title = String(story?.title || '').trim();
    const body = String(story?.story_text || '').trim();
    if (title && body) {
      segments.push(`${title}.\n${body}`);
    } else if (title || body) {
      segments.push(title || body);
    }
  });
  return normalizeTtsPayloadText(segments);
};

const readHeaderCaseInsensitive = (headers: Headers, key: string): string => {
  const exact = headers.get(key);
  if (exact) return exact;
  const lower = headers.get(String(key || '').toLowerCase());
  if (lower) return lower;
  const upper = headers.get(String(key || '').toUpperCase());
  if (upper) return upper;
  return '';
};

const hasRenderableAiSectionValue = (value: any): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return false;
    if (text.toLowerCase() === AI_PENDING_PLACEHOLDER_TEXT.toLowerCase()) return false;
    return true;
  }
  const flattened = flattenSectionValue(value).trim();
  if (!flattened) return false;
  if (flattened.toLowerCase() === AI_PENDING_PLACEHOLDER_TEXT.toLowerCase()) return false;
  return flattened.length > 0;
};

function buildScholarCards(value?: string | null): ScholarCard[] {
  if (!value) return [];
  const segments = value
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  return segments.map((text, idx) => {
    const img = (text.match(IMAGE_URL_REGEX) || [])[0];
    return {
      id: `${idx}`,
      text: img ? text.replace(img, '').trim() : text,
      image: img,
    };
  });
}

function extractYoutubeVideoId(input: any): string {
  if (!input) return '';
  if (typeof input === 'string') return input.trim();
  const id =
    input?.videoId ||
    input?.id?.videoId ||
    input?.id ||
    input?.snippet?.resourceId?.videoId ||
    '';
  return typeof id === 'string' ? id.trim() : '';
}

function extractThumbnailUrl(input: any): string | undefined {
  const thumbs = input?.thumbnail || input?.thumbnails || input?.snippet?.thumbnails;
  const tryOrder = ['high', 'medium', 'default', 'standard', 'maxres'];
  for (const key of tryOrder) {
    const url = thumbs?.[key]?.url;
    if (typeof url === 'string' && url) return url;
  }
  return undefined;
}

function parseCuratedYouTubeVideos(raw: any): CuratedYouTubeVideo[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : raw?.items;
  if (!Array.isArray(list)) return [];
  return list
    .map((item: any) => {
      const videoId = extractYoutubeVideoId(item);
      return {
        videoId,
        title: item?.title || item?.snippet?.title || '',
        description: item?.description || item?.snippet?.description || '',
        thumbnailUrl:
          extractThumbnailUrl(item) ||
          (videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : undefined),
      };
    })
    .filter((video: CuratedYouTubeVideo) => Boolean(video.videoId));
}

export default function GitaVerse() {
  const auth = useAuth();
  const { lang, selectLanguage, t } = useLanguage();
  const routeParams = useLocalSearchParams<{
    chapter?: string | string[];
    verse?: string | string[];
    lang?: string | string[];
  }>();
  const safeLang = useMemo(
    () => (typeof lang === 'string' ? lang.toUpperCase() : 'EN'),
    [lang]
  );

  const { selection, updateSelection } = useVerseSelection();

  const firstParam = useCallback((value: string | string[] | undefined) => {
    if (Array.isArray(value)) return value[0];
    return value;
  }, []);

  const routeChapter = useMemo(
    () => toPositiveInt(firstParam(routeParams.chapter)),
    [firstParam, routeParams.chapter]
  );
  const routeVerse = useMemo(
    () => toPositiveInt(firstParam(routeParams.verse)),
    [firstParam, routeParams.verse]
  );
  const routeLang = useMemo(
    () => String(firstParam(routeParams.lang) || '').trim().toUpperCase(),
    [firstParam, routeParams.lang]
  );

  const appliedRouteSelectionRef = useRef<string>('');

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

  // Boot-stabilization: don’t fire “core” fetches until selection is valid.
  const selectionReady = useMemo(() => {
    const ch = Number((selection as any)?.chapter);
    const v = Number((selection as any)?.verse);
    return Number.isFinite(ch) && ch > 0 && Number.isFinite(v) && v > 0;
  }, [selection]);

  // Tracks the “latest” request key so stale in-flight responses can’t clobber state.
  const activeSelectionKeyRef = useRef<string>('');

  const [chapterData, setChapterData] = useState<any>(null);
  const [verseData, setVerseData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<string | undefined>(undefined);
  const narrationRequestKeyRef = useRef<string>('');
  const [chapterTextOpen, setChapterTextOpen] = useState(false);

  const sessionIdParam = useMemo(
    () => (auth.sessionId ?? '').trim(),
    [auth.sessionId]
  );

  const insets = useSafeAreaInsets();
  const scrollPaddingBottom = Math.max(insets.bottom + 36, 44);

  const headers = useMemo(
    () => ({
      Accept: 'application/json',
    }),
    []
  );

  const selectionKey = useMemo(() => {
    if (!selectionReady) return '';
    const ch = Number((selection as any).chapter);
    const v = Number((selection as any).verse);
    return `${safeLang}:${ch}:${v}:${sessionIdParam}`;
  }, [selectionReady, safeLang, selection, sessionIdParam]);

  const narrationCacheRef = useRef<Map<string, NarrationDataset>>(new Map());
  const narrationInFlightRef = useRef<Map<string, Promise<NarrationDataset | null>>>(new Map());
  const chapterVerseCountRef = useRef<Map<number, number>>(new Map());

  const buildNarrationKey = useCallback(
    (chapter: number, verse: number) => `${safeLang}:${chapter}:${verse}:${sessionIdParam}`,
    [safeLang, sessionIdParam]
  );

  const getMaxVerseForChapter = useCallback((chapter: number): number => {
    const normalizedChapter = Math.max(MIN_VERSE_NUMBER, Math.floor(chapter || 1));
    return (
      chapterVerseCountRef.current.get(normalizedChapter) ??
      KNOWN_VERSE_COUNT_BY_CHAPTER[normalizedChapter] ??
      DEFAULT_MAX_VERSE_FALLBACK
    );
  }, []);

  const rememberChapterVerseCount = useCallback((chapter: number, data: NarrationDataset | null) => {
    if (!data?.chapterData) return;
    const totalVerses = extractChapterVerseCount(data.chapterData);
    if (!totalVerses) return;
    chapterVerseCountRef.current.set(chapter, totalVerses);
  }, []);

  const buildUrl = useCallback(
    (chapter: number, verse: number) => {
      const url = new URL(GITA_NARRATION_ENDPOINT);
      url.searchParams.set('lang', safeLang);
      url.searchParams.set('chapter', String(chapter));
      url.searchParams.set('verse', String(verse));
      if (sessionIdParam) {
        url.searchParams.set('sessionId', sessionIdParam);
        url.searchParams.set('session', sessionIdParam);
      }
      return url.toString();
    },
    [safeLang, sessionIdParam]
  );

  const toggleChapterText = useCallback(() => {
    if (!chapterData?.text) return;
    setChapterTextOpen((prev) => !prev);
  }, [chapterData?.text]);

  const fetchNarrationDataset = useCallback(
    async (chapter: number, verse: number): Promise<NarrationDataset | null> => {
      const requestKey = buildNarrationKey(chapter, verse);
      const cached = narrationCacheRef.current.get(requestKey);
      if (cached) return cached;

      const existingPromise = narrationInFlightRef.current.get(requestKey);
      if (existingPromise) return existingPromise;

      const requestPromise = (async () => {
        const fetchWithRetry = async (attempt = 0): Promise<NarrationDataset | null> => {
          const url = buildUrl(chapter, verse);
          const response = await fetch(url, { headers });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const text = await response.text();
          let payload: any = null;
          if (text) {
            try {
              payload = JSON.parse(text);
            } catch {
              payload = null;
            }
          }

          const body = payload?.body ?? payload;
          const data = body?.payLoad ?? body?.payload ?? body;
          const responseStateHeader = readHeaderCaseInsensitive(
            response.headers,
            GITA_VERSE_RESPONSE_STATE_HEADER
          )
            .trim()
            .toLowerCase();
          const responseStateBody = String(body?.responseState || '')
            .trim()
            .toLowerCase();
          const responseState = responseStateHeader || responseStateBody || 'unknown';
          const sourceLang = String(body?.sourceLang || data?.verseData?.sourceLang || '')
            .trim()
            .toUpperCase();

          const normalized: NarrationDataset = {
            chapterData: data?.chapterData ?? null,
            verseData: data?.verseData ?? null,
            responseState,
            sourceLang: sourceLang || undefined,
          };

          const shouldRetry =
            attempt < GITA_VERSE_MAX_RETRY_ATTEMPTS &&
            (responseState === 'pending' ||
              responseState === 'fallback-en' ||
              responseState === 'fallback-hi');
          if (shouldRetry) {
            const nextAttempt = attempt + 1;
            const delayMs = Math.min(
              GITA_VERSE_RETRY_MAX_DELAY_MS,
              GITA_VERSE_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, nextAttempt - 1))
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return fetchWithRetry(nextAttempt);
          }

          return normalized;
        };

        try {
          const normalized = await fetchWithRetry(0);
          if (!normalized) return null;
          const isExact = String(normalized.responseState || '').toLowerCase() === 'exact';
          if (isExact) {
            narrationCacheRef.current.set(requestKey, normalized);
          }
          rememberChapterVerseCount(chapter, normalized);
          return normalized;
        } catch {
          return null;
        } finally {
          narrationInFlightRef.current.delete(requestKey);
        }
      })();

      narrationInFlightRef.current.set(requestKey, requestPromise);
      return requestPromise;
    },
    [buildNarrationKey, buildUrl, headers, rememberChapterVerseCount]
  );

  const prefetchNarrationWindow = useCallback(
    (chapter: number, verse: number) => {
      const maxVerse = getMaxVerseForChapter(chapter);
      const windowVerses = buildVerseWindow(verse, maxVerse);
      const pending = windowVerses.map((targetVerse) => fetchNarrationDataset(chapter, targetVerse));
      void Promise.allSettled(pending);
    },
    [fetchNarrationDataset, getMaxVerseForChapter]
  );

  useEffect(() => {
    if (!selectionReady) return;

    const chapter = Number(selection.chapter);
    const verse = Number(selection.verse);
    const maxVerse = getMaxVerseForChapter(chapter);
    const clampedVerse = Math.min(maxVerse, Math.max(MIN_VERSE_NUMBER, verse));

    if (clampedVerse !== verse) {
      updateSelection({ chapter, verse: clampedVerse });
      return;
    }

    const reqKey = selectionKey;
    narrationRequestKeyRef.current = reqKey;
    setError(null);

    const cached = narrationCacheRef.current.get(buildNarrationKey(chapter, verse));
    if (cached) {
      setChapterData(cached.chapterData ?? null);
      setVerseData(cached.verseData ?? null);
      setLoading(false);
      prefetchNarrationWindow(chapter, verse);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const activeData = await fetchNarrationDataset(chapter, verse);
        if (narrationRequestKeyRef.current !== reqKey) return;
        if (!activeData) {
          throw new Error('Unable to load verse, Please signin !');
        }
        setChapterData(activeData.chapterData ?? null);
        setVerseData(activeData.verseData ?? null);
        prefetchNarrationWindow(chapter, verse);
      } catch (err: any) {
        if (narrationRequestKeyRef.current !== reqKey) return;
        setError(err?.message ?? 'Unable to load verse');
        setChapterData(null);
        setVerseData(null);
      } finally {
        if (narrationRequestKeyRef.current === reqKey) {
          setLoading(false);
        }
      }
    })();
  }, [
    buildNarrationKey,
    fetchNarrationDataset,
    getMaxVerseForChapter,
    prefetchNarrationWindow,
    selection.chapter,
    selection.verse,
    selectionKey,
    selectionReady,
    updateSelection,
  ]);

  useEffect(() => {
    setChapterTextOpen(false);
  }, [selectionKey]);

  const verseTextLines = useMemo(() => {
    if (Array.isArray(verseData?.verseText)) {
      return verseData?.verseText;
    }
    if (typeof verseData?.verseText === 'string') {
      return [verseData.verseText];
    }
    return [];
  }, [verseData]);

  const relatedVerses = useMemo(() => {
    const entries =
      verseData?.relatedVerses ??
      verseData?.relatedVerse ??
      verseData?.related_shlokas ??
      verseData?.relatedShlokas;
    const fallbackChapter = toPositiveInt(selection?.chapter) ?? 1;
    const fallbackVerse = toPositiveInt(selection?.verse) ?? 1;
    return normalizeRelatedVerseItems(entries, fallbackChapter, fallbackVerse);
  }, [
    verseData?.relatedVerses,
    verseData?.relatedVerse,
    verseData?.related_shlokas,
    verseData?.relatedShlokas,
    selection?.chapter,
    selection?.verse,
  ]);

  const humanDilemmas = useMemo(() => {
    const entries = verseData?.humanDilemma ?? verseData?.humanDilemmas;
    return normalizeHumanDilemmaItems(entries);
  }, [verseData?.humanDilemma, verseData?.humanDilemmas]);

  useEffect(() => {
    setRelatedIndex((prev) =>
      relatedVerses.length ? Math.min(prev, relatedVerses.length - 1) : 0
    );
  }, [relatedVerses.length]);

  useEffect(() => {
    setDilemmaIndex((prev) =>
      humanDilemmas.length ? Math.min(prev, humanDilemmas.length - 1) : 0
    );
  }, [humanDilemmas.length]);

  const audioPlaylist = useMemo(() => {
    const playlist = verseData?.audioPlaylist;
    if (!Array.isArray(playlist)) return [];
    return playlist
      .map((item: any, idx: number) => {
        const url = toPlayableAudioUrl(item?.url);
        if (!url) return null;
        return {
          ...item,
          url,
          label: sanitizeTileLabelText(String(item?.label || `Track ${idx + 1}`)) || `Track ${idx + 1}`,
        };
      })
      .filter(Boolean);
  }, [verseData]);

  const [aiSections, setAiSections] = useState<Record<SectionId, any>>(buildEmptyAiSections);
  const [aiLoading, setAiLoading] = useState(false);
  const [activeAiSection, setActiveAiSection] = useState<SectionId>("1");
  const aiRequestKeyRef = useRef<string>('');
  const aiRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiHasRenderableContentRef = useRef<boolean>(false);

  const aiSectionKeys = useMemo(
    () =>
      AI_SECTION_ORDER.filter((id) => {
        const value = aiSections[id];
        return hasRenderableAiSectionValue(value);
      }),
    [aiSections]
  );

  const fetchAiSections = useCallback(
    async (attempt = 0) => {
      if (!selectionReady) return;

      const reqKey = `ai:${selectionKey}`;
      if (aiRequestKeyRef.current !== reqKey) return;

      setAiLoading(true);
      try {
        const aiUrl = new URL(functionUrl('aiGitaSnippet'));
        if (sessionIdParam) {
          aiUrl.searchParams.set('sessionId', sessionIdParam);
          aiUrl.searchParams.set('session', sessionIdParam);
        }
        const res = await fetch(aiUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chapter: selection.chapter,
            verse: selection.verse,
            language: safeLang,
            sections: '1-5',
            format: 'json',
          }),
        });

        const responseState = readHeaderCaseInsensitive(res.headers, AI_RESPONSE_STATE_HEADER).toLowerCase();
        const text = await res.text();
        let parsed: any = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
        }

        let root: any = parsed;
        if (root && typeof root === 'object') {
          root = root.data ?? root.body ?? root;
        }

        const normalized = normalizeGitaAIRoot(root ?? parsed);
        const langKey = safeLang.toLowerCase();
        const fallbackSections = AI_SECTION_IDS.reduce<Record<SectionId, string | undefined>>(
          (acc, id) => {
            const sectionRoot = wrapRootForSection(normalized.root, id);
            const textEntry =
              extractTextForSection(sectionRoot, id, langKey) ??
              (normalized.cleanedRaw
                ? extractNarrationFromRaw(normalized.cleanedRaw, id)
                : null);
            acc[id] = textEntry ?? undefined;
            return acc;
          },
          {} as Record<SectionId, string | undefined>
        );

        const sectionsFromPayload =
          normalized.root &&
          typeof normalized.root === 'object' &&
          normalized.root.sections &&
          typeof normalized.root.sections === 'object'
            ? normalized.root.sections
            : null;

        const mergedSections: Record<SectionId, any> = AI_SECTION_IDS.reduce(
          (acc, id) => {
            acc[id] =
              (sectionsFromPayload && sectionsFromPayload[id] !== undefined
                ? sectionsFromPayload[id]
                : sectionsFromPayload && sectionsFromPayload[`section${id}`] !== undefined
                ? sectionsFromPayload[`section${id}`]
                : sectionsFromPayload && sectionsFromPayload[`section_${id}`] !== undefined
                ? sectionsFromPayload[`section_${id}`]
                : fallbackSections[id]);
            return acc;
          },
          {} as Record<SectionId, any>
        );

        const finalSections = {
          ...mergedSections,
          "1": mergeSectionOneAndFour(mergedSections["1"], mergedSections["4"]),
        };

        if (aiRequestKeyRef.current !== reqKey) return;

        const hasRenderableContent = AI_SECTION_IDS.some((id) =>
          hasRenderableAiSectionValue(finalSections[id])
        );
        if (hasRenderableContent) {
          aiHasRenderableContentRef.current = true;
          setAiSections(finalSections);
        }

        const shouldRetryForUpgrade =
          (responseState === 'pending' || responseState === 'fallback-en' || responseState === 'fallback-hi') &&
          attempt < AI_MAX_RETRY_ATTEMPTS;
        console.log('[GitaVerse][AI] state', responseState || 'none', 'attempt', attempt, 'retry', shouldRetryForUpgrade);

        if (shouldRetryForUpgrade) {
          const nextAttempt = attempt + 1;
          const delayMs = Math.min(
            AI_RETRY_MAX_DELAY_MS,
            AI_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, nextAttempt - 1))
          );
          if (aiRetryTimerRef.current) {
            clearTimeout(aiRetryTimerRef.current);
          }
          aiRetryTimerRef.current = setTimeout(() => {
            fetchAiSections(nextAttempt);
          }, delayMs);
          setAiLoading(true);
          return;
        }

        setAiLoading(false);
      } catch {
        if (aiRequestKeyRef.current !== reqKey) return;

        const hasAnyContent = aiHasRenderableContentRef.current;
        const shouldRetry = !hasAnyContent && attempt < AI_MAX_RETRY_ATTEMPTS;
        if (shouldRetry) {
          const nextAttempt = attempt + 1;
          const delayMs = Math.min(
            AI_RETRY_MAX_DELAY_MS,
            AI_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, nextAttempt - 1))
          );
          if (aiRetryTimerRef.current) {
            clearTimeout(aiRetryTimerRef.current);
          }
          aiRetryTimerRef.current = setTimeout(() => {
            fetchAiSections(nextAttempt);
          }, delayMs);
          setAiLoading(true);
          return;
        }

        if (!hasAnyContent) {
          setAiSections(buildEmptyAiSections());
        }
        setAiLoading(false);
      }
    },
    [
      safeLang,
      selection.chapter,
      selection.verse,
      selectionKey,
      selectionReady,
      sessionIdParam,
    ]
  );

  const aiFetchKeyRef = useRef<string>('');

  useEffect(() => {
    if (openSection !== 'ai' || !selectionReady) return;
    if (aiFetchKeyRef.current === selectionKey) return;
    aiFetchKeyRef.current = selectionKey;
    const reqKey = `ai:${selectionKey}`;
    aiRequestKeyRef.current = reqKey;
    aiHasRenderableContentRef.current = false;
    if (aiRetryTimerRef.current) {
      clearTimeout(aiRetryTimerRef.current);
      aiRetryTimerRef.current = null;
    }
    setAiSections(buildEmptyAiSections());
    fetchAiSections(0);
  }, [openSection, selectionKey, selectionReady, fetchAiSections]);

  useEffect(() => {
    if (openSection === 'ai') return;
    aiFetchKeyRef.current = '';
    aiRequestKeyRef.current = '';
    if (aiRetryTimerRef.current) {
      clearTimeout(aiRetryTimerRef.current);
      aiRetryTimerRef.current = null;
    }
  }, [openSection]);

  useEffect(() => {
    return () => {
      if (aiRetryTimerRef.current) {
        clearTimeout(aiRetryTimerRef.current);
        aiRetryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!aiSectionKeys.length) return;
    if (!aiSectionKeys.includes(activeAiSection)) {
      setActiveAiSection(aiSectionKeys[0]);
    }
  }, [aiSectionKeys, activeAiSection]);

  const activeAiSectionId = aiSectionKeys.includes(activeAiSection)
    ? activeAiSection
    : aiSectionKeys[0];

  const renderAiTextSectionContent = (sectionData: any) => {
    if (!sectionData) {
      return (
        <Text style={{ color: '#0f172a', opacity: 0.75 }}>
          Section details are not available.
        </Text>
      );
    }

    const isPlainObject = typeof sectionData === 'object' && !Array.isArray(sectionData);
    if (isPlainObject) {
      const entries = Object.entries(sectionData).filter(
        ([key]) =>
          key !== 'sections' &&
          key !== 'sectionRange' &&
          key !== SECTION4_EXTRA_KEY &&
          key !== 'raw' &&
          key !== 'data' &&
          key !== 'body' &&
          key !== 'payload' &&
          key !== 'payLoad' &&
          key !== 'success' &&
          key !== 'cached' &&
          key !== 'message' &&
          !/^\d+$/.test(key)
      );
      const extraText =
        typeof sectionData[SECTION4_EXTRA_KEY] === 'string'
          ? sectionData[SECTION4_EXTRA_KEY].trim()
          : null;

      if (!entries.length && !sectionData.text) {
        const rawText = flattenSectionValue(sectionData);
        return (
          <Text style={{ color: '#0f172a', opacity: 0.92, lineHeight: 22 }}>
            {rawText || 'Section details are not available.'}
          </Text>
        );
      }

      return (
        <View>
          {entries.map(([key, value]) => {
            const text = flattenSectionValue(value);
            if (!text) return null;
            return (
              <View key={`field-${activeAiSectionId}-${key}`} style={{ marginBottom: 12 }}>
                <Text style={{ color: '#0f172a', fontWeight: '700', marginBottom: 6 }}>
                  {key}
                </Text>
                <Text
                  style={{
                    color: '#0f172a',
                    opacity: 0.85,
                    lineHeight: 22,
                    fontSize: 13,
                  }}
                >
                  {text}
                </Text>
              </View>
            );
          })}
          {!entries.length && sectionData.text ? (
            <Text style={{ color: '#0f172a', opacity: 0.92, lineHeight: 22 }}>
              {flattenSectionValue(sectionData.text)}
            </Text>
          ) : null}
          {extraText ? (
            <View style={{ marginTop: entries.length ? 12 : 0 }}>
              <Text style={{ color: '#0f172a', fontWeight: '700', marginBottom: 6 }}>
                Additional context
              </Text>
              <Text style={{ color: '#0f172a', opacity: 0.85, lineHeight: 22, fontSize: 13 }}>
                {extraText}
              </Text>
            </View>
          ) : null}
        </View>
      );
    }

    const text = flattenSectionValue(sectionData);
    return (
      <Text style={{ color: '#0f172a', opacity: 0.92, lineHeight: 22 }}>
        {text || 'Section details are not available.'}
      </Text>
    );
  };

  const renderActiveAiSectionContent = () => {
    const sectionId = activeAiSectionId;
    if (!sectionId) {
      return (
        <Text style={{ color: '#0f172a', opacity: 0.75 }}>
          Section details are not available.
        </Text>
      );
    }

    const sectionData = aiSections[sectionId];
    if (!sectionData) {
      return (
        <Text style={{ color: '#0f172a', opacity: 0.75 }}>
          Section details are not available.
        </Text>
      );
    }

    if (HORIZONTAL_AI_SECTIONS.has(sectionId)) {
      const pillItems = extractPillItems(sectionData);
      if (!pillItems.length) {
        return (
          <Text style={{ color: '#0f172a', opacity: 0.75 }}>
            Section details are not available.
          </Text>
        );
      }
      return (
        <View style={{ flexDirection: 'column' }}>
          {pillItems.map((item, index) => (
            <View
              key={`vertical-pill-${sectionId}-${index}`}
              style={{
                paddingVertical: 16,
                paddingHorizontal: 18,
                borderRadius: 16,
                backgroundColor: 'rgba(15,23,42,0.06)',
                marginBottom: index === pillItems.length - 1 ? 0 : 12,
              }}
            >
              <Text
                style={{
                  color: '#0f172a',
                  fontSize: 14,
                  lineHeight: 22,
                  textAlign: 'left',
                }}
              >
                {sanitizeTileLabelText(item) || String(item)}
              </Text>
            </View>
          ))}
        </View>
      );
    }

    return renderAiTextSectionContent(sectionData);
  };

  const [legendaryPayload, setLegendaryPayload] = useState<any>(null);
  const [legendaryLoading, setLegendaryLoading] = useState(false);
  const [legendaryError, setLegendaryError] = useState<string | null>(null);
  const legendaryRequestKeyRef = useRef<string>('');
  const legendaryRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const legendaryHasContentRef = useRef<boolean>(false);
  const normalizedLegendaryPayload = useMemo(() => {
    if (!legendaryPayload) return null;
    const base = legendaryPayload?.data ? legendaryPayload.data : legendaryPayload;
    const stories = Array.isArray(base?.stories) ? base.stories : [];
    return {
      ...base,
      stories,
      warning: legendaryPayload?.warning || null,
    };
  }, [legendaryPayload]);

  const legendaryUrl = useMemo(() => {
    if (!selection.chapter || !selection.verse) return null;
    const url = new URL(LEGENDARY_STORIES_ENDPOINT);
    url.searchParams.set('chapter', String(selection.chapter));
    url.searchParams.set('verse', String(selection.verse));
    url.searchParams.set('lang', safeLang);
    if (sessionIdParam) {
      url.searchParams.set('sessionId', sessionIdParam);
      url.searchParams.set('session', sessionIdParam);
    }
    return url.toString();
  }, [selection.chapter, selection.verse, safeLang, sessionIdParam]);

  const legendaryFetchKeyRef = useRef<string>('');

  const fetchLegendaryStories = useCallback(
    async (attempt = 0) => {
      if (!legendaryUrl) return;
      const reqKey = `stories:${legendaryUrl}`;
      if (legendaryRequestKeyRef.current !== reqKey) return;

      setLegendaryLoading(true);
      setLegendaryError(null);
      try {
        const requestUrl = new URL(legendaryUrl);
        requestUrl.searchParams.set('_rt', `${attempt}-${Date.now()}`);
        const res = await fetch(requestUrl.toString(), { headers });
        const responseState = readHeaderCaseInsensitive(res.headers, LEGENDARY_RESPONSE_STATE_HEADER).toLowerCase();
        const text = await res.text();
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${text || 'legendary stories'}`);
        }

        let parsed: any = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
        }
        const payload =
          parsed?.data && typeof parsed.data === 'object'
            ? parsed.data
            : parsed || null;
        const base = payload?.data && typeof payload?.data === 'object' ? payload.data : payload;
        const payloadLang = String(base?.language || '').trim().toUpperCase();
        const sourceLang = String(parsed?.sourceLang || '').trim().toUpperCase();
        const requestedLang = String(safeLang || '').trim().toUpperCase();
        const hasContent =
          !!(
            base &&
            (String(base?.simple_meaning || '').trim() ||
              String(base?.sanskrit_text || '').trim() ||
              (Array.isArray(base?.stories) && base.stories.length))
          );
        const sourceMismatch = Boolean(sourceLang && requestedLang && sourceLang !== requestedLang);
        const shouldFallbackPoll =
          !responseState &&
          requestedLang &&
          requestedLang !== 'EN' &&
          attempt < Math.min(LEGENDARY_MAX_RETRY_ATTEMPTS, 4);
        const payloadLangLooksLikeCode = /^[A-Z]{2,5}$/.test(payloadLang);
        const languageMismatch = Boolean(
          payloadLangLooksLikeCode &&
            payloadLang &&
            requestedLang &&
            payloadLang !== requestedLang
        );

        if (legendaryRequestKeyRef.current !== reqKey) return;

        if (hasContent) {
          legendaryHasContentRef.current = true;
          setLegendaryPayload(payload);
          setLegendaryError(null);
        } else if (!legendaryHasContentRef.current) {
          setLegendaryPayload(null);
        }

        const shouldRetryForUpgrade =
          attempt < LEGENDARY_MAX_RETRY_ATTEMPTS &&
          (
            responseState === 'pending' ||
            responseState === 'fallback-en' ||
            responseState === 'fallback-hi' ||
            sourceMismatch ||
            languageMismatch ||
            shouldFallbackPoll ||
            (!hasContent && responseState !== 'exact' && responseState !== 'server-error')
          );
        const shouldRetry = !(responseState === 'exact' && hasContent) && shouldRetryForUpgrade;
        console.log(
          '[GitaVerse][Stories] state',
          responseState || 'none',
          'attempt',
          attempt,
          'hasContent',
          hasContent,
          'sourceLang',
          sourceLang || 'none',
          'payloadLang',
          payloadLang || 'none',
          'requestedLang',
          requestedLang || 'none',
          'retry',
          shouldRetry
        );
        if (shouldRetry) {
          const nextAttempt = attempt + 1;
          const delayMs = Math.min(
            LEGENDARY_RETRY_MAX_DELAY_MS,
            LEGENDARY_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, nextAttempt - 1))
          );
          if (legendaryRetryTimerRef.current) {
            clearTimeout(legendaryRetryTimerRef.current);
          }
          legendaryRetryTimerRef.current = setTimeout(() => {
            fetchLegendaryStories(nextAttempt);
          }, delayMs);
          setLegendaryLoading(true);
          return;
        }

        setLegendaryLoading(false);
      } catch (err: any) {
        if (legendaryRequestKeyRef.current !== reqKey) return;

        const hasAnyContent = legendaryHasContentRef.current;
        const shouldRetry = !hasAnyContent && attempt < LEGENDARY_MAX_RETRY_ATTEMPTS;
        if (shouldRetry) {
          const nextAttempt = attempt + 1;
          const delayMs = Math.min(
            LEGENDARY_RETRY_MAX_DELAY_MS,
            LEGENDARY_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, nextAttempt - 1))
          );
          if (legendaryRetryTimerRef.current) {
            clearTimeout(legendaryRetryTimerRef.current);
          }
          legendaryRetryTimerRef.current = setTimeout(() => {
            fetchLegendaryStories(nextAttempt);
          }, delayMs);
          setLegendaryLoading(true);
          return;
        }

        if (!hasAnyContent) {
          setLegendaryPayload(null);
          setLegendaryError(err?.message || 'Failed to load stories');
        }
        setLegendaryLoading(false);
      }
    },
    [headers, legendaryUrl]
  );

  useEffect(() => {
    if (openSection !== 'stories' || !legendaryUrl) {
      return;
    }
    if (legendaryFetchKeyRef.current === legendaryUrl) return;
    legendaryFetchKeyRef.current = legendaryUrl;
    const reqKey = `stories:${legendaryUrl}`;
    legendaryRequestKeyRef.current = reqKey;
    legendaryHasContentRef.current = false;
    if (legendaryRetryTimerRef.current) {
      clearTimeout(legendaryRetryTimerRef.current);
      legendaryRetryTimerRef.current = null;
    }
    setLegendaryPayload(null);
    setLegendaryError(null);
    fetchLegendaryStories(0);

    return () => {
      if (legendaryRetryTimerRef.current) {
        clearTimeout(legendaryRetryTimerRef.current);
        legendaryRetryTimerRef.current = null;
      }
    };
  }, [legendaryUrl, openSection, fetchLegendaryStories]);

  useEffect(() => {
    if (openSection === 'stories') return;
    legendaryFetchKeyRef.current = '';
    legendaryRequestKeyRef.current = '';
    if (legendaryRetryTimerRef.current) {
      clearTimeout(legendaryRetryTimerRef.current);
      legendaryRetryTimerRef.current = null;
    }
  }, [openSection]);

  const [youtubePayload, setYoutubePayload] = useState<any>(null);
  const [youtubeVideos, setYoutubeVideos] = useState<CuratedYouTubeVideo[]>([]);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [activeYouTubeIndex, setActiveYouTubeIndex] = useState<number>(0);

  const youtubeFetchKeyRef = useRef<string>('');

  useEffect(() => {
    if (openSection !== 'youtube' || !selectionReady) return;
    const reqKey = `yt:${selectionKey}`;
    if (youtubeFetchKeyRef.current === reqKey) return;
    youtubeFetchKeyRef.current = reqKey;
    let cancelled = false;

    (async () => {
      if (!selectionReady) return;

      activeSelectionKeyRef.current = reqKey;

      setYoutubeLoading(true);
      setYoutubeError(null);
      setYoutubeVideos([]);
      setYoutubePayload(null);
      setActiveYouTubeIndex(0);

      try {
        const url = new URL(functionUrl('gitaYouTubeVivechan'));
        url.searchParams.set('chapter', String(selection.chapter));
        url.searchParams.set('verse', String(selection.verse));
        url.searchParams.set('lang', safeLang);
        if (sessionIdParam) {
          url.searchParams.set('sessionId', sessionIdParam);
          url.searchParams.set('session', sessionIdParam);
        }

        const response = await fetch(url.toString(), { headers });
        const text = await response.text().catch(() => '');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${text || 'youtube'}`);
        }

        const parsed = text ? JSON.parse(text) : null;
        const root = parsed?.data ?? parsed?.body ?? parsed ?? {};
        const data = root?.payload ?? root?.payLoad ?? root ?? {};
        const parsedLinks = parseCuratedYouTubeVideos(data?.videoLinks);

        if (cancelled) return;
        if (activeSelectionKeyRef.current !== reqKey) return;

        setYoutubePayload(data);
        setYoutubeVideos(parsedLinks);
        setActiveYouTubeIndex(0);

        if (!parsedLinks.length) {
          setYoutubeError('No YouTube videos available');
        }
      } catch (err: any) {
        if (cancelled) return;
        if (activeSelectionKeyRef.current !== reqKey) return;
        setYoutubeError(err?.message ?? 'Unable to load YouTube videos');
      } finally {
        if (cancelled) return;
        if (activeSelectionKeyRef.current !== reqKey) return;
        setYoutubeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openSection, selection.chapter, selection.verse, safeLang, headers, selectionKey, selectionReady, sessionIdParam]);

  const sanskrit =
    verseData?.sanskritText ||
    verseData?.sanskrit ||
    verseData?.verseSanskrit ||
    null;

  const translation =
    verseData?.translationText ||
    verseData?.translation ||
    verseData?.meaning ||
    null;
  const stickyVerseNavIndex = sanskrit ? 2 : 1;

  const router = useRouter();
  const { width } = useWindowDimensions();
  const isCompact = width < 768;
  const isWide = width >= 860;
  const youtubePlayerWidth = useMemo(() => {
    const horizontalMargin = isWide ? 220 : 44;
    const estimatedAvailable = Math.max(220, width - horizontalMargin);
    return Math.max(YOUTUBE_MIN_WIDTH, Math.min(YOUTUBE_MAX_WIDTH, estimatedAvailable));
  }, [isWide, width]);
  const youtubePlayerHeight = useMemo(
    () => Math.round(youtubePlayerWidth / YOUTUBE_ASPECT_RATIO),
    [youtubePlayerWidth]
  );

  const relatedScrollRef = useRef<ScrollView | null>(null);
  const [relatedIndex, setRelatedIndex] = useState(0);
  const dilemmaScrollRef = useRef<ScrollView | null>(null);
  const [dilemmaIndex, setDilemmaIndex] = useState(0);
  const dilemmaTapRef = useRef<{ key: string; at: number } | null>(null);

  const handleRelatedVersePress = useCallback(
    (item: RelatedVerse) => {
      updateSelection({ chapter: item.chapter, verse: item.verse });
    },
    [updateSelection]
  );

  const deriveIndexFromScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>, length: number) => {
    if (!length) return 0;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const totalScrollable = Math.max(contentSize.width - layoutMeasurement.width, 1);
    const ratio = Math.min(1, Math.max(0, contentOffset.x / totalScrollable));
    return Math.round(ratio * Math.max(length - 1, 0));
  }, []);

  const handleRelatedScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = deriveIndexFromScroll(event, relatedVerses.length);
      setRelatedIndex((prev) => (prev === nextIndex ? prev : nextIndex));
    },
    [deriveIndexFromScroll, relatedVerses.length]
  );

  const handleDilemmaScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = deriveIndexFromScroll(event, humanDilemmas.length);
      setDilemmaIndex((prev) => (prev === nextIndex ? prev : nextIndex));
    },
    [deriveIndexFromScroll, humanDilemmas.length]
  );

  const openHumanDilemma = useCallback(
    (item: HumanDilemmaItem) => {
      if (!item?.id) return;
      const summary = typeof item?.text === 'string' ? item.text : '';
      const image = typeof item?.raw?.image === 'string' ? item.raw.image : '';
      router.push({
        pathname: "/dilemma",
        params: {
          id: String(item.id),
          summary,
          image,
        },
      });
    },
    [router]
  );

  const handleHumanDilemmaDoubleTap = useCallback(
    (item: HumanDilemmaItem, idx: number) => {
      const key = String(item?.id || idx);
      const now = Date.now();
      const prev = dilemmaTapRef.current;
      if (prev && prev.key === key && now - prev.at <= 320) {
        dilemmaTapRef.current = null;
        openHumanDilemma(item);
        return;
      }
      dilemmaTapRef.current = { key, at: now };
    },
    [openHumanDilemma]
  );

  // Audio
  const audioPlayer = useAudioPlayer(null);
  const audioStatus = useAudioPlayerStatus(audioPlayer);
  const [activeAudioIndex, setActiveAudioIndex] = useState<number | null>(null);
  const isCurrentTrackPlaying = useMemo(
    () => Boolean(audioStatus?.playing),
    [audioStatus]
  );
  const playAudioTrack = useCallback(
    (index: number) => {
      const track = audioPlaylist[index];
      if (!track?.url) return;
      try {
        Speech?.stop();
        audioPlayer.replace({ uri: track.url } as AudioSource);
        audioPlayer.play();
        setActiveAudioIndex(index);
      } catch (err) {
        console.error('[GitaVerse] playAudioTrack failed', err);
        setActiveAudioIndex(null);
      }
    },
    [audioPlaylist, audioPlayer]
  );

  const playPreviousAudio = useCallback(() => {
    if (!audioPlaylist.length) return;
    const prevIndex =
      activeAudioIndex === null ? audioPlaylist.length - 1 : Math.max(0, activeAudioIndex - 1);
    playAudioTrack(prevIndex);
  }, [activeAudioIndex, audioPlaylist.length, playAudioTrack]);

  const playNextAudio = useCallback(() => {
    if (!audioPlaylist.length) return;
    const nextIndex =
      activeAudioIndex === null ? 0 : Math.min(audioPlaylist.length - 1, activeAudioIndex + 1);
    playAudioTrack(nextIndex);
  }, [activeAudioIndex, audioPlaylist.length, playAudioTrack]);

  const handlePlayCurrent = useCallback(() => {
    if (!audioPlaylist.length) return;
    const targetIndex = activeAudioIndex ?? 0;
    playAudioTrack(targetIndex);
  }, [activeAudioIndex, audioPlaylist.length, playAudioTrack]);

  const togglePlayPause = useCallback(async () => {
    if (activeAudioIndex === null) {
      handlePlayCurrent();
      return;
    }
    try {
      if (isCurrentTrackPlaying) {
        audioPlayer.pause();
      } else {
        Speech?.stop();
        audioPlayer.play();
      }
    } catch (err) {
      console.warn("[GitaVerse] togglePlayPause failed", err);
    }
  }, [activeAudioIndex, audioPlayer, handlePlayCurrent, isCurrentTrackPlaying]);

  const [activeTtsKey, setActiveTtsKey] = useState<string | null>(null);
  const ttsSpeakingRef = useRef(false);
  const ttsRunIdRef = useRef(0);
  const ttsUnavailableAlertedRef = useRef(false);

  const stopTtsPlayback = useCallback(() => {
    void stopResolvedSpeech(Speech);
    try {
      getWebSpeechSynthesis()?.cancel();
    } catch {}
    ttsSpeakingRef.current = false;
    ttsRunIdRef.current += 1;
    setActiveTtsKey(null);
  }, []);

  const toggleTtsForText = useCallback(
    (sectionKey: string, text: string) => {
      const normalizedText = normalizeTtsPayloadText(text);
      if (!normalizedText) return;
      const webSynth = getWebSpeechSynthesis();
      const canSpeak = Platform.OS !== "web" || Boolean(Speech || webSynth);
      if (!canSpeak) {
        if (!ttsUnavailableAlertedRef.current) {
          ttsUnavailableAlertedRef.current = true;
          const message =
            Platform.OS === "web"
              ? "TTS is unavailable in this browser."
              : "TTS is unavailable in this app build. Rebuild the dev client to include expo-speech.";
          try {
            Alert.alert("Text To Speech Unavailable", message);
          } catch {}
          console.warn("[GitaVerse] TTS unavailable", { platform: Platform.OS });
        }
        return;
      }
      if (activeTtsKey === sectionKey && ttsSpeakingRef.current) {
        stopTtsPlayback();
        return;
      }

      try {
        audioPlayer.pause();
      } catch {}

      try {
        Speech?.stop();
      } catch {}
      try {
        webSynth?.cancel();
      } catch {}

      const runId = ttsRunIdRef.current + 1;
      ttsRunIdRef.current = runId;
      ttsSpeakingRef.current = true;
      setActiveTtsKey(sectionKey);
      try {
        // Subtle feedback so users know TTS started, without visible controls.
        Vibration.vibrate(8);
      } catch {}

      const onDone = () => {
        if (ttsRunIdRef.current !== runId) return;
        ttsSpeakingRef.current = false;
        setActiveTtsKey(null);
      };
      if (Platform.OS !== "web" || Speech) {
        void speakWithResolvedVoice(Speech, safeLang, normalizedText, {
          onDone,
          onStopped: onDone,
          onError: onDone,
        }).catch(onDone);
      } else if (webSynth) {
        const webWindow = (globalThis as any)?.window;
        const Utterance = webWindow?.SpeechSynthesisUtterance;
        if (!Utterance) {
          onDone();
          return;
        }
        const utterance = new Utterance(normalizedText);
        utterance.lang = resolveTtsLocale(safeLang, normalizedText);
        utterance.onend = onDone;
        utterance.onerror = onDone;
        webSynth.speak(utterance);
      }
    },
    [activeTtsKey, audioPlayer, safeLang, stopTtsPlayback]
  );

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

  const sanskritSwipeTranslateX = useRef(new Animated.Value(0)).current;
  const swipeHintProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(swipeHintProgress, {
          toValue: 1,
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(swipeHintProgress, {
          toValue: 0,
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [swipeHintProgress]);

  const resetSanskritSwipePosition = useCallback(() => {
    Animated.spring(sanskritSwipeTranslateX, {
      toValue: 0,
      speed: 20,
      bounciness: 7,
      useNativeDriver: true,
    }).start();
  }, [sanskritSwipeTranslateX]);

  const verseSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          const absDx = Math.abs(gestureState.dx);
          const absDy = Math.abs(gestureState.dy);
          return absDx > VERSE_SWIPE_ACTIVATE_THRESHOLD && absDx > absDy * 1.2;
        },
        onPanResponderGrant: () => {
          sanskritSwipeTranslateX.stopAnimation();
        },
        onPanResponderMove: (_, gestureState) => {
          const bounded = Math.max(-42, Math.min(42, gestureState.dx * 0.42));
          sanskritSwipeTranslateX.setValue(bounded);
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx <= -VERSE_SWIPE_TRIGGER_THRESHOLD) {
            goToVerse(1);
          } else if (gestureState.dx >= VERSE_SWIPE_TRIGGER_THRESHOLD) {
            goToVerse(-1);
          }
          resetSanskritSwipePosition();
        },
        onPanResponderTerminate: () => {
          resetSanskritSwipePosition();
        },
      }),
    [goToVerse, resetSanskritSwipePosition, sanskritSwipeTranslateX]
  );

  const swipeHintTranslateX = swipeHintProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-8, 8],
  });

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const webWindow = (globalThis as any)?.window;
    if (!webWindow?.addEventListener) return;

    const onKeyDown = (event: any) => {
      const target = event?.target as any;
      if (target) {
        const tagName = String(target?.tagName ?? '').toLowerCase();
        const isEditable =
          tagName === 'input' ||
          tagName === 'textarea' ||
          Boolean(target?.isContentEditable);
        if (isEditable) return;
      }

      if (event?.key === 'ArrowLeft') {
        event.preventDefault();
        goToVerse(-1);
      } else if (event?.key === 'ArrowRight') {
        event.preventDefault();
        goToVerse(1);
      }
    };

    webWindow.addEventListener('keydown', onKeyDown);
    return () => {
      webWindow.removeEventListener('keydown', onKeyDown);
    };
  }, [goToVerse]);

  useEffect(() => {
    return () => {
      stopTtsPlayback();
      try {
        audioPlayer.pause();
      } catch {}
      try {
        audioPlayer.remove();
      } catch {}
    };
  }, [audioPlayer, stopTtsPlayback]);

  useEffect(() => {
    setActiveAudioIndex(null);
    stopTtsPlayback();
    try {
      audioPlayer.pause();
    } catch {}
    try {
      audioPlayer.remove();
    } catch {}
  }, [audioPlayer, selectionKey, stopTtsPlayback]);

  useEffect(() => {
    if (isCurrentTrackPlaying && ttsSpeakingRef.current) {
      stopTtsPlayback();
    }
  }, [isCurrentTrackPlaying, stopTtsPlayback]);

  const transliterationTtsText = useMemo(
    () => String(verseData?.transliteraton || '').trim(),
    [verseData?.transliteraton]
  );
  const narrationTtsText = useMemo(() => {
    const lines = [translation, ...(Array.isArray(verseTextLines) ? verseTextLines : [])]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
    return normalizeTtsPayloadText(lines);
  }, [translation, verseTextLines]);
  const activeAiSectionTtsText = useMemo(() => {
    if (!activeAiSectionId) return '';
    return buildAiSectionTtsText(activeAiSectionId, aiSections[activeAiSectionId]);
  }, [activeAiSectionId, aiSections]);
  const legendaryStoriesTtsText = useMemo(
    () => buildLegendaryStoriesTtsText(normalizedLegendaryPayload),
    [normalizedLegendaryPayload]
  );

  // UI helpers (unchanged)
  const toggleSection = useCallback((key: string) => {
    setOpenSection((prev) => (prev === key ? undefined : key));
  }, []);

  const SectionHeader = useCallback(
    ({ id, title }: { id: string; title: string }) => {
      const open = openSection === id;
      return (
        <TouchableOpacity
          onPress={() => toggleSection(id)}
          activeOpacity={0.8}
          style={{
            paddingVertical: 14,
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: 'rgba(15,23,42,0.05)',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 10,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#0f172a' }}>{title}</Text>
          <Text style={{ color: '#0f172a', opacity: 0.8 }}>{open ? '−' : '+'}</Text>
        </TouchableOpacity>
      );
    },
    [openSection, toggleSection]
  );

  const renderLegendaryStoriesContent = () => {
    if (!normalizedLegendaryPayload) return null;
    const { warning, language, sanskrit_text, simple_meaning, stories } = normalizedLegendaryPayload;
    return (
      <View>
        {warning ? (
          <Text style={{ color: '#ffecb3', marginBottom: 10 }}>{warning}</Text>
        ) : null}
        {language ? (
          <Text style={{ color: '#0f172a', fontWeight: '700', marginBottom: 4 }}>
            {t("Language")}: {language}
          </Text>
        ) : null}
        {sanskrit_text ? (
          <Text style={{ color: '#0f172a', opacity: 0.85, marginBottom: 10 }}>
            {sanskrit_text}
          </Text>
        ) : null}
        {simple_meaning ? (
          <View style={{ marginBottom: 12 }}>
            <Text style={{ color: '#0f172a', fontWeight: '700', marginBottom: 4 }}>{t("Meaning")}</Text>
            <Text style={{ color: '#0f172a', opacity: 0.85, lineHeight: 20 }}>{simple_meaning}</Text>
          </View>
        ) : null}
        {stories && stories.length ? (
          <View>
            {stories.map((story: any) => (
              <View
                key={story.id}
                style={{
                  marginBottom: 14,
                  padding: 12,
                  borderRadius: 10,
                  backgroundColor: 'rgba(15,23,42,0.045)',
                }}
              >
                {story.title ? (
                  <Text style={{ color: '#0f172a', fontWeight: '700', marginBottom: 6 }}>
                    {sanitizeTileLabelText(story.title) || String(story.title)}
                  </Text>
                ) : null}
                <Text style={{ color: '#0f172a', opacity: 0.85, lineHeight: 20 }}>
                  {sanitizeTileLabelText(story.story_text) || String(story.story_text || '')}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const showStickyNav = !isCompact;
  const showAuthPrompt = Boolean(
    !loading &&
      !sessionIdParam &&
      error &&
      /signin|sign in|session|unauthorized|access denied/i.test(String(error))
  );

  // ======= RENDER =======
  return (
    <View style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          stickyHeaderIndices={showStickyNav ? [stickyVerseNavIndex] : undefined}
          contentContainerStyle={{
            padding: 14,
            paddingTop: 14,
            paddingBottom: isCompact ? Math.max(insets.bottom + 18, 28) : scrollPaddingBottom,
            width: '100%',
          }}
        >
        <View style={{ marginBottom: 10, alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => {
              if (activeTtsKey === "chapter-description") {
                stopTtsPlayback();
              }
              toggleChapterText();
            }}
            activeOpacity={chapterData?.text ? 0.8 : 1}
            style={{ paddingVertical: 4, width: '100%', alignItems: 'center' }}
          >
            <Text style={{ color: '#0f172a', fontSize: isCompact ? 20 : 26, fontWeight: '800', textAlign: 'center', lineHeight: isCompact ? 26 : 32 }}>
              {chapterData?.title || `Chapter ${selection?.chapter ?? '—'} · Verse ${selection?.verse ?? '—'}`}
            </Text>
            <Text
              style={{
                color: '#0f172a',
                opacity: 0.7,
                marginTop: 6,
                fontSize: isCompact ? 16 : 18,
                fontWeight: '700',
                textAlign: 'center',
              }}
            >
              Chapter {selection?.chapter ?? '—'} · Verse {selection?.verse ?? '—'}
            </Text>
          </TouchableOpacity>
          {chapterTextOpen && chapterData?.text ? (
            <TouchableOpacity
              onPress={() => toggleTtsForText("chapter-description", String(chapterData.text))}
              activeOpacity={0.85}
              style={{
                padding: 12,
                borderRadius: 12,
                backgroundColor: activeTtsKey === "chapter-description"
                  ? 'rgba(34,197,94,0.18)'
                  : 'rgba(15,23,42,0.06)',
                borderWidth: 1,
                borderColor: activeTtsKey === "chapter-description"
                  ? 'rgba(34,197,94,0.55)'
                  : 'rgba(15,23,42,0.12)',
                marginTop: 10,
              }}
            >
              <Text
                style={{
                  color: '#0f172a',
                  opacity: 0.92,
                  lineHeight: 22,
                }}
              >
                {String(chapterData.text)}
              </Text>
              <Text
                style={{
                  color: '#0f172a',
                  opacity: 0.65,
                  marginTop: 8,
                  fontSize: 12,
                  fontWeight: '600',
                }}
                >
                {activeTtsKey === "chapter-description" ? t("Tap to stop audio") : t("Tap to play audio")}
              </Text>
            </TouchableOpacity>
          ) : null}

          {loading ? (
            <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator />
              <Text style={{ color: '#0f172a', marginLeft: 8, opacity: 0.8 }}>Loading…</Text>
            </View>
          ) : null}

          {error ? (
            <Text style={{ color: '#b91c1c', marginTop: 10 }}>{error}</Text>
          ) : null}
          {showAuthPrompt ? (
            <TouchableOpacity
              onPress={() => auth.openLogin("login")}
              style={{
                marginTop: 12,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 12,
                backgroundColor: 'rgba(34,197,94,0.18)',
                borderWidth: 1,
                borderColor: 'rgba(34,197,94,0.55)',
              }}
            >
              <Text style={{ color: '#0f172a', fontWeight: '700' }}>{t("Sign in to load this verse")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {sanskrit ? (
          <Animated.View
            style={{
              padding: 20,
              borderRadius: 12,
              backgroundColor: 'rgba(15,23,42,0.05)',
              marginTop: 6,
              transform: [{ translateX: sanskritSwipeTranslateX }],
            }}
            {...verseSwipeResponder.panHandlers}
          >
            <Text
              style={{
                color: '#0f172a',
                opacity: 0.92,
                lineHeight: 30,
                fontSize: 24,
                fontWeight: '800',
                textAlign: 'center',
              }}
            >
              {String(sanskrit)}
            </Text>
            <View style={{ marginTop: 14 }}>
              <GitaVerseImageCard
                sanskritText={String(sanskrit)}
                chapter={Number(selection?.chapter || 0)}
                verse={Number(selection?.verse || 0)}
                width={isCompact ? 320 : 420}
              />
            </View>
            <Animated.View
              style={{
                marginTop: 10,
                alignSelf: 'center',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                transform: [{ translateX: swipeHintTranslateX }],
              }}
            >
              {[0, 1, 2, 3, 4].map((dotIndex) => (
                <View
                  key={`swipe-dot-${dotIndex}`}
                  style={{
                    width: dotIndex === 2 ? 7 : 5,
                    height: dotIndex === 2 ? 7 : 5,
                    borderRadius: 999,
                    backgroundColor:
                      dotIndex === 2 ? 'rgba(15,23,42,0.78)' : 'rgba(15,23,42,0.38)',
                  }}
                />
              ))}
            </Animated.View>
          </Animated.View>
        ) : null}

        <View
          style={{
            marginTop: 8,
            marginBottom: 6,
            paddingVertical: 8,
            backgroundColor: '#fff',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 16,
            }}
          >
            <TouchableOpacity
              onPress={() => goToVerse(-1)}
              style={{
                ...PREVIOUS_BUTTON_STYLE,
                minWidth: isCompact ? 116 : PREVIOUS_BUTTON_STYLE.minWidth,
                paddingHorizontal: isCompact ? 18 : PREVIOUS_BUTTON_STYLE.paddingHorizontal,
              }}
            >
              <Text style={{ color: '#0f172a', fontWeight: '700' }}>{t("Previous")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => goToVerse(1)}
              style={{
                ...NEXT_BUTTON_STYLE,
                minWidth: isCompact ? 116 : NEXT_BUTTON_STYLE.minWidth,
                paddingHorizontal: isCompact ? 18 : NEXT_BUTTON_STYLE.paddingHorizontal,
              }}
            >
              <Text style={{ color: '#0f172a', fontWeight: '700' }}>{t("Next")}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {verseData?.transliteraton ? (
          <TouchableOpacity
            onPress={() => toggleTtsForText('transliteration', transliterationTtsText)}
            activeOpacity={transliterationTtsText ? 0.82 : 1}
            style={{
              padding: 16,
              borderRadius: 12,
              backgroundColor: 'rgba(15,23,42,0.05)',
              marginTop: 6,
              alignItems: 'center',
              borderWidth: activeTtsKey === 'transliteration' ? 1 : 0,
              borderColor: 'rgba(34,197,94,0.65)',
            }}
          >
            <Text
              style={{
                color: '#0f172a',
                opacity: 0.92,
                lineHeight: 24,
                fontSize: 18,
                fontWeight: '400',
                fontStyle: 'italic',
                textAlign: 'center',
              }}
            >
              {String(verseData.transliteraton)}
            </Text>
          </TouchableOpacity>
        ) : null}

        {translation ? (
          <TouchableOpacity
            onPress={() => toggleTtsForText('narration', narrationTtsText)}
            activeOpacity={narrationTtsText ? 0.84 : 1}
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: 'rgba(15,23,42,0.05)',
              marginTop: 10,
              borderWidth: activeTtsKey === 'narration' ? 1 : 0,
              borderColor: 'rgba(34,197,94,0.65)',
            }}
          >
            <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '700', marginBottom: 8 }}>
              {t("Translation")}
            </Text>
            <Text style={{ color: '#0f172a', opacity: 0.92, lineHeight: 22 }}>
              {String(translation)}
            </Text>
          </TouchableOpacity>
        ) : null}

        {verseTextLines.length ? (
          <TouchableOpacity
            onPress={() => toggleTtsForText('narration', narrationTtsText)}
            activeOpacity={narrationTtsText ? 0.84 : 1}
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: 'rgba(15,23,42,0.05)',
              marginTop: 6,
              borderWidth: activeTtsKey === 'narration' ? 1 : 0,
              borderColor: 'rgba(34,197,94,0.65)',
            }}
          >
            {verseTextLines.map((line: string, idx: number) => (
              <Text
                key={`${idx}`}
                style={{ color: '#0f172a', opacity: 0.92, lineHeight: 22, marginTop: idx ? 4 : 0 }}
              >
                {line}
              </Text>
            ))}
          </TouchableOpacity>
        ) : null}

        {relatedVerses.length ? (
          <View
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: 'rgba(15,23,42,0.04)',
              marginTop: 10,
            }}
          >
            <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '700', marginBottom: 8 }}>
              {t("Related Verses")}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 4 }}
              scrollEventThrottle={16}
              onScroll={handleRelatedScroll}
              onMomentumScrollEnd={handleRelatedScroll}
            >
              {relatedVerses.map((item, idx) => {
                const fallbackLabel = `Verse ${item.chapter}.${item.verse}`;
                const label = ensureVersePrefix(item.shlok || fallbackLabel) || fallbackLabel;
                return (
                  <TouchableOpacity
                    key={`related-${item.chapter}-${item.verse}-${idx}`}
                    onPress={() => handleRelatedVersePress(item)}
                    style={RELATED_PILL_STYLE}
                  >
                    <Text
                      numberOfLines={1}
                      style={{ ...PILL_TEXT_STYLE, width: '100%', textAlign: 'left' }}
                    >
                      {label}
                    </Text>
                    {item.sanskrit ? (
                      <Text
                        numberOfLines={2}
                        style={{
                          color: PILL_TEXT_COLOR,
                          opacity: 0.9,
                          fontSize: 12,
                          lineHeight: 16,
                          marginTop: 4,
                          width: '100%',
                        }}
                      >
                        {item.sanskrit}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                marginTop: 8,
                gap: 6,
              }}
            >
              {relatedVerses.map((_, idx) => (
                <View
                  key={`related-dot-${idx}`}
                  style={{
                    width: idx === relatedIndex ? 10 : 6,
                    height: idx === relatedIndex ? 10 : 6,
                    borderRadius: 5,
                    backgroundColor:
                      idx === relatedIndex ? '#fef08a' : 'rgba(15,23,42,0.28)',
                    marginHorizontal: 2,
                  }}
                />
              ))}
            </View>
          </View>
        ) : null}

        {humanDilemmas.length ? (
          <View
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: 'rgba(15,23,42,0.04)',
              marginTop: 10,
            }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 4 }}
              scrollEventThrottle={16}
              onScroll={handleDilemmaScroll}
              onMomentumScrollEnd={handleDilemmaScroll}
            >
              {humanDilemmas.map((item, idx) => (
                <TouchableOpacity
                  key={`dilemma-${item.id ?? idx}`}
                  onPress={() => handleHumanDilemmaDoubleTap(item, idx)}
                  style={DILEMMA_PILL_STYLE}
                >
                  <Text
                    numberOfLines={1}
                    style={{ ...PILL_TEXT_STYLE, width: '100%', textAlign: 'left' }}
                  >
                    {item.name}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={{
                      color: PILL_TEXT_COLOR,
                      opacity: 0.9,
                      fontSize: 12,
                      lineHeight: 16,
                      marginTop: 4,
                      width: '100%',
                    }}
                  >
                    {item.text || `Dilemma ${idx + 1}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                marginTop: 8,
                gap: 6,
              }}
            >
              {humanDilemmas.map((_, idx) => (
                <View
                  key={`dilemma-dot-${idx}`}
                  style={{
                    width: idx === dilemmaIndex ? 10 : 6,
                    height: idx === dilemmaIndex ? 10 : 6,
                    borderRadius: 5,
                    backgroundColor:
                      idx === dilemmaIndex ? '#22d3ee' : 'rgba(15,23,42,0.28)',
                    marginHorizontal: 2,
                  }}
                />
              ))}
            </View>
          </View>
        ) : null}

        {audioPlaylist.length ? (
          <View
            style={{
              marginTop: 10,
              padding: 14,
              borderRadius: 12,
              backgroundColor: 'rgba(15,23,42,0.05)',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
              }}
            >
              <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '700' }}>{t("Audio")}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <TouchableOpacity
                  onPress={playPreviousAudio}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: 'rgba(15,23,42,0.06)',
                    marginRight: 8,
                  }}
                >
                  <Text style={{ color: '#0f172a', fontWeight: '600' }}>{t("Previous")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={togglePlayPause}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: 'rgba(34,197,94,0.22)',
                  }}
                >
                  <Text style={{ color: '#0f172a', fontWeight: '600' }}>
                    {isCurrentTrackPlaying ? t("Pause") : t("Play")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={playNextAudio}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: 'rgba(15,23,42,0.06)',
                    marginLeft: 8,
                  }}
                >
                  <Text style={{ color: '#0f172a', fontWeight: '600' }}>{t("Next")}</Text>
                </TouchableOpacity>
              </View>
            </View>
            {activeAudioIndex !== null ? (
              <View style={{ marginTop: 12 }}>
                {audioPlaylist.map((item, idx) => {
                  const isActive = idx === activeAudioIndex;
                  return (
                    <TouchableOpacity
                      key={`${item.url ?? ''}-${idx}`}
                      onPress={() => playAudioTrack(idx)}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 10,
                        borderRadius: 10,
                        backgroundColor: isActive
                          ? 'rgba(34,197,94,0.22)'
                          : 'rgba(15,23,42,0.05)',
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: '#0f172a', fontWeight: '600', marginBottom: 2 }}>
                        {item.label || `Track ${idx + 1}`}
                      </Text>
                      <Text style={{ color: '#0f172a', opacity: 0.8, fontSize: 12 }}>
                        {isActive
                          ? isCurrentTrackPlaying
                            ? t("Playing")
                            : t("Paused")
                          : t("Tap to play")}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        <SectionHeader id="ai" title={t("More Audio")} />
        {openSection === 'ai' ? (
          <View
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: 'rgba(15,23,42,0.05)',
              marginTop: 10,
            }}
          >
            {aiLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ActivityIndicator />
                <Text style={{ color: '#0f172a', marginLeft: 8, opacity: 0.8 }}>{t("Loading AI…")}</Text>
              </View>
            ) : null}

            {!aiLoading && !aiSectionKeys.length ? (
              <Text style={{ color: '#0f172a', opacity: 0.75 }}>
                {t("No AI sections available right now.")}
              </Text>
            ) : null}

            {aiSectionKeys.length ? (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingVertical: 6 }}
                >
                  {aiSectionKeys.map((id) => {
                    const isActive = id === activeAiSectionId;
                    const rawLabel = SECTION_DISPLAY_NAMES[id] || `Section ${id}`;
                    const label = sanitizeTileLabelText(rawLabel) || rawLabel;
                    return (
                      <TouchableOpacity
                        key={`ai-pill-${id}`}
                        onPress={() => setActiveAiSection(id)}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 16,
                          borderRadius: 999,
                          backgroundColor: isActive ? '#4ade80' : 'rgba(15,23,42,0.06)',
                          borderWidth: 1,
                          borderColor: isActive ? '#22c55e' : 'rgba(15,23,42,0.16)',
                          marginRight: 8,
                        }}
                      >
                        <Text
                          style={{
                            color: isActive ? '#0b5f22' : '#0f172a',
                            fontWeight: '700',
                            fontSize: 14,
                          }}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <TouchableOpacity
                  onPress={() =>
                    toggleTtsForText(
                      `ai-${String(activeAiSectionId || 'none')}`,
                      activeAiSectionTtsText
                    )
                  }
                  activeOpacity={activeAiSectionTtsText ? 0.86 : 1}
                  style={{
                    marginTop: 18,
                    borderWidth:
                      activeAiSectionId && activeTtsKey === `ai-${String(activeAiSectionId)}`
                        ? 1
                        : 0,
                    borderColor: 'rgba(34,197,94,0.65)',
                    borderRadius: 12,
                    padding: 2,
                  }}
                >
                  {renderActiveAiSectionContent()}
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        ) : null}

        <SectionHeader id="stories" title={t("Legendary Stories")} />
        {openSection === 'stories' ? (
          <View
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: 'rgba(15,23,42,0.05)',
              marginTop: 10,
            }}
          >
            {legendaryLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ActivityIndicator />
                <Text style={{ color: '#0f172a', marginLeft: 8, opacity: 0.8 }}>
                  {normalizedLegendaryPayload ? t('Refreshing stories…') : t('Loading stories…')}
                </Text>
              </View>
            ) : null}

            {legendaryError && !normalizedLegendaryPayload ? (
              <Text style={{ color: '#b91c1c', marginTop: 10 }}>{legendaryError}</Text>
            ) : null}

            {normalizedLegendaryPayload ? (
              <TouchableOpacity
                onPress={() => toggleTtsForText('legendary-stories', legendaryStoriesTtsText)}
                activeOpacity={legendaryStoriesTtsText ? 0.86 : 1}
                style={{
                  borderWidth: activeTtsKey === 'legendary-stories' ? 1 : 0,
                  borderColor: 'rgba(34,197,94,0.65)',
                  borderRadius: 12,
                  padding: 2,
                }}
              >
                {renderLegendaryStoriesContent()}
              </TouchableOpacity>
            ) : null}

            {!legendaryLoading && !legendaryError && !normalizedLegendaryPayload ? (
              <Text style={{ color: '#0f172a', opacity: 0.75, marginTop: 10 }}>
                {t("No legendary stories available right now.")}
              </Text>
            ) : null}
          </View>
        ) : null}

        <SectionHeader id="youtube" title={t("YouTube Vivechan")} />
        {openSection === 'youtube' ? (
          <View
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: 'rgba(15,23,42,0.05)',
              marginTop: 10,
            }}
          >
            {youtubeLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ActivityIndicator />
                <Text style={{ color: '#0f172a', marginLeft: 8, opacity: 0.8 }}>
                  {t("Loading videos…")}
                </Text>
              </View>
            ) : null}

            {youtubeError ? (
              <Text style={{ color: '#b91c1c', marginTop: 10 }}>{youtubeError}</Text>
            ) : null}

            {!youtubeLoading && !youtubeError && youtubeVideos.length ? (
              <View style={{ marginTop: 10 }}>
                <View style={{ borderRadius: 12, overflow: 'hidden' }}>
                  {Platform.OS === 'web' ? (
                    <View
                      style={{
                        width: youtubePlayerWidth,
                        height: youtubePlayerHeight,
                        minWidth: YOUTUBE_MIN_WIDTH,
                        maxWidth: YOUTUBE_MAX_WIDTH,
                        borderRadius: 12,
                        overflow: 'hidden',
                        backgroundColor: 'rgba(15,23,42,0.05)',
                        alignSelf: 'center',
                      }}
                    >
                      {React.createElement('iframe' as any, {
                        key: youtubeVideos[activeYouTubeIndex]?.videoId || 'youtube-web-embed',
                        title: youtubeVideos[activeYouTubeIndex]?.title || 'YouTube video',
                        src: `https://www.youtube.com/embed/${encodeURIComponent(
                          youtubeVideos[activeYouTubeIndex]?.videoId || ''
                        )}`,
                        allow:
                          'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
                        allowFullScreen: true,
                        style: {
                          width: youtubePlayerWidth,
                          height: youtubePlayerHeight,
                          border: 'none',
                          display: 'block',
                        },
                      })}
                    </View>
                  ) : (
                    <YouTube
                      width={youtubePlayerWidth}
                      height={youtubePlayerHeight}
                      play={false}
                      videoId={youtubeVideos[activeYouTubeIndex]?.videoId}
                    />
                  )}
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ marginTop: 12, paddingRight: 8 }}
                >
                  {youtubeVideos.map((v, idx) => (
                    <TouchableOpacity
                      key={v.videoId}
                      onPress={() => setActiveYouTubeIndex(idx)}
                      style={{
                        width: 240,
                        borderRadius: 12,
                        overflow: 'hidden',
                        backgroundColor:
                          idx === activeYouTubeIndex
                            ? 'rgba(34,197,94,0.22)'
                            : 'rgba(15,23,42,0.05)',
                        borderWidth: idx === activeYouTubeIndex ? 1 : 0,
                        borderColor: idx === activeYouTubeIndex ? 'rgba(34,197,94,0.7)' : 'transparent',
                        marginRight: 10,
                      }}
                    >
                      {v.thumbnailUrl ? (
                        <Image
                          source={{ uri: v.thumbnailUrl }}
                          style={{ width: '100%', height: 128, backgroundColor: 'rgba(15,23,42,0.06)' }}
                          resizeMode="cover"
                        />
                      ) : null}
                      <View style={{ padding: 10 }}>
                        <Text numberOfLines={2} style={{ color: '#0f172a', fontWeight: '700' }}>
                          {v.title || `Video ${idx + 1}`}
                        </Text>
                          <Text
                            numberOfLines={2}
                            style={{ color: '#0f172a', opacity: 0.78, marginTop: 6, fontSize: 12, lineHeight: 16 }}
                          >
                            {String(v.description || t('Tap to play this YouTube video.'))}
                          </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={{ marginTop: 12 }}>
          <PageBottomMeta />
        </View>
        <View style={{ height: isCompact ? 12 : 28 }} />
        <TouchableOpacity
          onPress={() => router.back()}
          style={{
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: 'rgba(15,23,42,0.06)',
            alignSelf: 'flex-start',
          }}
        >
          <Text style={{ color: '#0f172a', fontWeight: '700' }}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
