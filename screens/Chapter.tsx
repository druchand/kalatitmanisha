import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus, type AudioSource } from "expo-audio";

import GitaVerseImageCard from "../components/gitaVerse/GitaVerseImageCard";
import PageBottomMeta from "../components/layout/PageBottomMeta";
import { useLanguage } from "../context/LanguageContext";
import { useTeleprompter } from "../context/TeleprompterContext";
import { useVerseSelection } from "../context/VerseSelectionContext";
import {
  getExpoSpeechModule,
  pauseResolvedSpeech,
  resumeResolvedSpeech,
  speakWithResolvedVoice,
  stopResolvedSpeech,
} from "../utils/ttsSupport";
import { functionUrl } from "../utils/functionApi";

const CHAPTER_PAYLOAD_ENDPOINT = functionUrl("chapterPayload");
const GITA_PARAYAN_CHAPTER_FEED_ENDPOINT = functionUrl("GitaParayanChapterFeed");
const CHAPTER_VERSES_PAGE_SIZE = 5;
const MIN_CHAPTER_NUMBER = 1;
const MAX_CHAPTER_NUMBER = 18;
const MIN_VERSE_NUMBER = 1;
const VERSE_PREFETCH_LOOKAHEAD = 3;
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

type ChapterPayload = {
  chapter?: number;
  lang?: string;
  title?: string;
  text?: string;
  description?: string;
  ytDescription?: string;
  totalVerses?: number;
  verseCount?: number;
};

type ChapterPayloadVerse = {
  verse?: number;
  verseLang?: string;
  sourceLang?: string;
  hasTranslation?: boolean;
  sanskrit?: string;
  translation?: string;
  transliteration?: string;
  recite?: string;
  learn2recite?: string;
  audioOptions?: Array<{ label?: string; url?: string; gender?: string }>;
};

type ChapterPayloadResponse = {
  chapter?: number;
  lang?: string;
  chLang?: string;
  chapterData?: ChapterPayload | null;
  verses?: ChapterPayloadVerse[];
  skip?: number;
  limit?: number;
  pageSize?: number;
  totalVerses?: number;
  verseCount?: number;
  hasMore?: boolean;
  nextSkip?: number | null;
};

type VerseSnapshot = {
  chapter: number;
  verse: number;
  sanskrit: string;
  narrationText: string;
  reciteUrl: string;
  learn2reciteUrl: string;
  title: string;
  chapterDescription: string;
};

type ParayanFeed = {
  chapter: number;
  verseCount: number;
  audioUrl: string;
  teleprompterText: string;
};

type GuidedSegment =
  | { kind: "tts"; resolve: () => void; paused: boolean }
  | {
      kind: "audio";
      resolve: () => void;
      paused: boolean;
      started: boolean;
      startedAt: number;
      key: string;
      text: string;
      url: string;
    }
  | null;

const Speech = getExpoSpeechModule();

const clampChapter = (value: number) =>
  Math.max(MIN_CHAPTER_NUMBER, Math.min(MAX_CHAPTER_NUMBER, Math.floor(value || MIN_CHAPTER_NUMBER)));

const toPlayableAudioUrl = (value: any): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const wixAudio = raw.match(/^wix:audio:\/\/v1\/([^/#?]+)$/i);
  if (wixAudio?.[1]) return `https://static.wixstatic.com/mp3/${wixAudio[1]}`;
  return "";
};

const parseJsonSafe = (text: string) => {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
};

const normalizeText = (value: any) =>
  String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const tokenizeTeleprompterText = (value: string) => {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const parts = normalized.match(/\n{2,}|\n|[^\s\n]+/g) || [];
  return parts.map((part) => {
    if (part.startsWith("\n")) {
      return {
        type: "newline" as const,
        value: part.length >= 2 ? "\n\n" : "\n",
      };
    }
    return {
      type: "word" as const,
      value: part,
    };
  });
};

const firstValue = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const buildGuidedVerseTeleprompterText = (verse: VerseSnapshot) => {
  const sanskrit = normalizeText(verse.sanskrit);
  const narration = normalizeText(verse.narrationText);
  return [sanskrit, narration].filter(Boolean).join("\n\n");
};

export default function Chapter() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ chapter?: string | string[]; title?: string | string[]; lang?: string | string[] }>();
  const { lang, t } = useLanguage();
  const { width } = useWindowDimensions();
  const { updateSelection } = useVerseSelection();
  const { closeTeleprompter } = useTeleprompter();
  const audioPlayer = useAudioPlayer();
  const audioStatus = useAudioPlayerStatus(audioPlayer);

  const routeLang = useMemo(() => String(lang || firstValue(routeParams.lang) || "EN").trim().toUpperCase(), [lang, routeParams.lang]);
  const routeChapter = useMemo(() => clampChapter(Number(firstValue(routeParams.chapter) || 1)), [routeParams.chapter]);
  const routeTitle = useMemo(() => normalizeText(firstValue(routeParams.title) || ""), [routeParams.title]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chapterData, setChapterData] = useState<ChapterPayload | null>(null);
  const [parayanFeed, setParayanFeed] = useState<ParayanFeed | null>(null);
  const [heroSanskrit, setHeroSanskrit] = useState<string>("");
  const [pendingAudioTeleprompter, setPendingAudioTeleprompter] = useState<{ key: string; text: string } | null>(null);
  const [inlineTeleprompterVisible, setInlineTeleprompterVisible] = useState(false);
  const [inlineTeleprompterText, setInlineTeleprompterText] = useState("");
  const [inlineTeleprompterWordIndex, setInlineTeleprompterWordIndex] = useState(0);
  const [inlineTeleprompterContentHeight, setInlineTeleprompterContentHeight] = useState(0);
  const [inlineTeleprompterFontScale, setInlineTeleprompterFontScale] = useState(1);
  const [inlineTeleprompterScrollSpeed, setInlineTeleprompterScrollSpeed] = useState(1);
  const [activeParayan, setActiveParayan] = useState(false);
  const [guidedState, setGuidedState] = useState<"idle" | "running" | "paused">("idle");
  const [guidedStageLabel, setGuidedStageLabel] = useState<string>("");
  const [playbackHint, setPlaybackHint] = useState<string>("Use Parayan or Guided to start the chapter teleprompter.");
  const [knownVerseCount, setKnownVerseCount] = useState<number>(KNOWN_VERSE_COUNT_BY_CHAPTER[routeChapter] || 1);

  const verseCacheRef = useRef<Map<string, VerseSnapshot>>(new Map());
  const verseInFlightRef = useRef<Map<string, Promise<VerseSnapshot>>>(new Map());
  const chapterPageCacheRef = useRef<Map<string, ChapterPayloadResponse>>(new Map());
  const chapterPageInFlightRef = useRef<Map<string, Promise<ChapterPayloadResponse>>>(new Map());
  const parayanCacheRef = useRef<Map<number, ParayanFeed>>(new Map());
  const inlineTeleprompterScrollRef = useRef<ScrollView | null>(null);
  const inlineTeleprompterModeRef = useRef<"idle" | "tts" | "audio">("idle");
  const inlineTeleprompterStartedAtRef = useRef(0);
  const inlineTeleprompterPausedAtRef = useRef(0);
  const inlineTeleprompterTotalPausedMsRef = useRef(0);
  const guidedRunIdRef = useRef(0);
  const guidedSegmentRef = useRef<GuidedSegment>(null);
  const currentModeRef = useRef<"idle" | "parayan" | "guided">("idle");
  const audioStatusRef = useRef<any>(audioStatus);
  const guidedAudioProgressRef = useRef<{ key: string; currentTime: number; updatedAt: number }>({
    key: "",
    currentTime: 0,
    updatedAt: 0,
  });

  const chapterTitle = normalizeText(chapterData?.title || routeTitle) || `${t("Chapter")} ${routeChapter}`;
  const chapterDescription = normalizeText(
    chapterData?.text || chapterData?.description || chapterData?.ytDescription || ""
  );
  const heroWidth = useMemo(() => Math.min(Math.max(width - 32, 280), 420), [width]);
  const actionTileSize = useMemo(() => {
    if (width < 380) return 104;
    if (width < 440) return 112;
    return 124;
  }, [width]);
  const actionTileBaseStyle = useMemo(
    () => ({
      width: actionTileSize,
      height: actionTileSize,
      minWidth: 48,
      minHeight: 48,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingHorizontal: 8,
      paddingVertical: 10,
    }),
    [actionTileSize]
  );

  const inlineTeleprompterTokens = useMemo(
    () => tokenizeTeleprompterText(inlineTeleprompterText),
    [inlineTeleprompterText]
  );
  const inlineTeleprompterFontSize = useMemo(
    () => Math.round(16 * inlineTeleprompterFontScale),
    [inlineTeleprompterFontScale]
  );
  const inlineTeleprompterLineHeight = useMemo(
    () => Math.round(inlineTeleprompterFontSize * 1.9),
    [inlineTeleprompterFontSize]
  );
  const inlineTeleprompterWordCount = useMemo(
    () =>
      inlineTeleprompterTokens.reduce((count, token) => count + (token.type === "word" ? 1 : 0), 0),
    [inlineTeleprompterTokens]
  );
  const inlineTeleprompterDurationMs = useMemo(() => {
    const effectiveWordCount = Math.max(1, inlineTeleprompterWordCount);
    return Math.max(
      2600,
      Math.round((effectiveWordCount * 360) / clampNumber(inlineTeleprompterScrollSpeed, 0.35, 3.5))
    );
  }, [inlineTeleprompterScrollSpeed, inlineTeleprompterWordCount]);
  const inlineTeleprompterViewportHeight = 260;
  const inlineTeleprompterStartInset = Math.round(inlineTeleprompterViewportHeight * 0.66);

  const showInlineTeleprompter = useCallback((text: string, mode: "tts" | "audio" = "tts") => {
    const normalized = normalizeText(text);
    if (!normalized) return;
    inlineTeleprompterModeRef.current = mode;
    inlineTeleprompterStartedAtRef.current = Date.now();
    inlineTeleprompterPausedAtRef.current = 0;
    inlineTeleprompterTotalPausedMsRef.current = 0;
    setInlineTeleprompterText(normalized);
    setInlineTeleprompterWordIndex(0);
    setInlineTeleprompterContentHeight(0);
    setInlineTeleprompterVisible(true);
  }, []);

  const collapseInlineTeleprompter = useCallback(() => {
    setInlineTeleprompterVisible(false);
  }, []);

  const resetInlineTeleprompter = useCallback(() => {
    inlineTeleprompterModeRef.current = "idle";
    inlineTeleprompterStartedAtRef.current = 0;
    inlineTeleprompterPausedAtRef.current = 0;
    inlineTeleprompterTotalPausedMsRef.current = 0;
    setInlineTeleprompterVisible(false);
    setInlineTeleprompterText("");
    setInlineTeleprompterWordIndex(0);
    setInlineTeleprompterContentHeight(0);
  }, []);

  const revealInlineTeleprompter = useCallback(() => {
    if (!inlineTeleprompterText) return;
    setInlineTeleprompterVisible(true);
  }, [inlineTeleprompterText]);

  const buildChapterPayloadUrl = useCallback(
    (chapter: number, langCode = routeLang, skip = 0, limit = CHAPTER_VERSES_PAGE_SIZE) => {
      const url = new URL(CHAPTER_PAYLOAD_ENDPOINT);
      url.searchParams.set("chapter", String(chapter));
      url.searchParams.set("lang", String(langCode || routeLang).trim().toUpperCase());
      url.searchParams.set("skip", String(Math.max(0, Math.floor(skip))));
      url.searchParams.set(
        "limit",
        String(Math.max(1, Math.min(CHAPTER_VERSES_PAGE_SIZE, Math.floor(limit || CHAPTER_VERSES_PAGE_SIZE))))
      );
      return url.toString();
    },
    [routeLang]
  );

  const loadChapterSnapshots = useCallback(
    async (chapter: number, langCode = routeLang, options: { skip?: number; limit?: number } = {}) => {
      const normalizedLang = String(langCode || routeLang).trim().toUpperCase();
      const requestedSkip = Math.max(0, Math.floor(Number(options.skip || 0)));
      const requestedLimit = Math.max(
        1,
        Math.min(CHAPTER_VERSES_PAGE_SIZE, Math.floor(Number(options.limit || CHAPTER_VERSES_PAGE_SIZE)))
      );
      const pageKey = `${normalizedLang}:${chapter}:${requestedSkip}:${requestedLimit}`;
      const cachedPage = chapterPageCacheRef.current.get(pageKey);
      if (cachedPage) return cachedPage;
      const inFlight = chapterPageInFlightRef.current.get(pageKey);
      if (inFlight) return inFlight;

      const requestPromise = (async () => {
        const response = await fetch(buildChapterPayloadUrl(chapter, langCode, requestedSkip, requestedLimit), {
          headers: { Accept: "application/json" },
        });
        const rawText = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = parseJsonSafe(rawText) as ChapterPayloadResponse;
        const nextChapterData = payload?.chapterData || null;
        const verses = Array.isArray(payload?.verses) ? payload.verses : [];

        verses.forEach((item) => {
          const verseNumber = Number(item?.verse || 0);
          if (!verseNumber) return;
          const key = `${normalizedLang}:${chapter}:${verseNumber}`;
          const narrationText = normalizeText(item?.translation || "");
          const snapshot: VerseSnapshot = {
            chapter,
            verse: verseNumber,
            sanskrit: normalizeText(item?.sanskrit || ""),
            narrationText,
            reciteUrl: toPlayableAudioUrl(item?.recite),
            learn2reciteUrl: toPlayableAudioUrl(item?.learn2recite),
            title: normalizeText(nextChapterData?.title || ""),
            chapterDescription: normalizeText(
              nextChapterData?.text || nextChapterData?.description || nextChapterData?.ytDescription || ""
            ),
          };
          verseCacheRef.current.set(key, snapshot);
        });

        const firstVerse = verses.find((item) => Number(item?.verse || 0) === MIN_VERSE_NUMBER);
        if (requestedSkip === 0 && firstVerse?.sanskrit) {
          setHeroSanskrit(normalizeText(firstVerse?.sanskrit || ""));
        }

        if (nextChapterData) {
          setChapterData((current) => ({
            ...(current || {}),
            ...(nextChapterData || {}),
          }));
        }

        const maybeVerseCount =
          Number(
            payload?.totalVerses ||
              payload?.verseCount ||
              nextChapterData?.totalVerses ||
              nextChapterData?.verseCount ||
              0
          ) || KNOWN_VERSE_COUNT_BY_CHAPTER[chapter];
        if (maybeVerseCount) setKnownVerseCount(maybeVerseCount);

        const normalizedResponse: ChapterPayloadResponse = {
          ...(payload || {}),
          chapterData: nextChapterData,
          verses,
          skip: requestedSkip,
          limit: requestedLimit,
          pageSize: requestedLimit,
          totalVerses: maybeVerseCount,
          verseCount: maybeVerseCount,
          hasMore: Boolean(
            Number(maybeVerseCount) &&
              requestedSkip + verses.length < Number(maybeVerseCount)
          ),
          nextSkip:
            Number(maybeVerseCount) && requestedSkip + verses.length < Number(maybeVerseCount)
              ? requestedSkip + verses.length
              : null,
        };
        chapterPageCacheRef.current.set(pageKey, normalizedResponse);
        return normalizedResponse;
      })();

      chapterPageInFlightRef.current.set(pageKey, requestPromise);
      try {
        return await requestPromise;
      } finally {
        chapterPageInFlightRef.current.delete(pageKey);
      }
    },
    [buildChapterPayloadUrl, routeLang]
  );

  const fetchVerseSnapshot = useCallback(
    async (chapter: number, verse: number, langCode = routeLang): Promise<VerseSnapshot> => {
      const key = `${String(langCode || routeLang).toUpperCase()}:${chapter}:${verse}`;
      const cached = verseCacheRef.current.get(key);
      if (cached) return cached;
      const inFlight = verseInFlightRef.current.get(key);
      if (inFlight) return inFlight;

      const requestPromise = (async () => {
        const pageStart = Math.max(
          0,
          Math.floor((Math.max(MIN_VERSE_NUMBER, verse) - 1) / CHAPTER_VERSES_PAGE_SIZE) *
            CHAPTER_VERSES_PAGE_SIZE
        );
        await loadChapterSnapshots(chapter, langCode, {
          skip: pageStart,
          limit: CHAPTER_VERSES_PAGE_SIZE,
        });
        const snapshot = verseCacheRef.current.get(key);
        if (!snapshot) {
          throw new Error(`Verse ${chapter}.${verse} is missing from chapter payload.`);
        }
        return snapshot;
      })();

      verseInFlightRef.current.set(key, requestPromise);
      try {
        return await requestPromise;
      } finally {
        verseInFlightRef.current.delete(key);
      }
    },
    [loadChapterSnapshots, routeLang]
  );

  const prefetchVerses = useCallback(
    (startVerse: number) => {
      for (let offset = 1; offset <= VERSE_PREFETCH_LOOKAHEAD; offset += 1) {
        const verse = startVerse + offset;
        if (verse > knownVerseCount) break;
        void fetchVerseSnapshot(routeChapter, verse).catch(() => null);
      }
    },
    [fetchVerseSnapshot, knownVerseCount, routeChapter]
  );

  const fetchParayanFeed = useCallback(async (chapter: number): Promise<ParayanFeed | null> => {
    const normalizedChapter = clampChapter(chapter);
    const cached = parayanCacheRef.current.get(normalizedChapter);
    if (cached) return cached;
    const url = new URL(GITA_PARAYAN_CHAPTER_FEED_ENDPOINT);
    url.searchParams.set("chapter", String(normalizedChapter));
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    const rawText = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = parseJsonSafe(rawText);
    const feed: ParayanFeed | null = payload?.audio?.audioUrl
      ? {
          chapter: Number(payload?.chapter || normalizedChapter),
          verseCount: Number(payload?.verseCount || KNOWN_VERSE_COUNT_BY_CHAPTER[normalizedChapter] || 0),
          audioUrl: toPlayableAudioUrl(payload?.audio?.audioUrl),
          teleprompterText: normalizeText(payload?.teleprompterText || ""),
        }
      : null;
    if (feed) {
      parayanCacheRef.current.set(normalizedChapter, feed);
      setKnownVerseCount(feed.verseCount || KNOWN_VERSE_COUNT_BY_CHAPTER[normalizedChapter] || 1);
    }
    return feed;
  }, []);

  const clearGuidedSegment = useCallback(() => {
    const current = guidedSegmentRef.current;
    if (!current) return;
    guidedSegmentRef.current = null;
    if (current.kind === "audio") {
      guidedAudioProgressRef.current = { key: "", currentTime: 0, updatedAt: 0 };
    }
    current.resolve();
  }, []);

  const resolveActiveAudioSegment = useCallback((options: { closeTeleprompter?: boolean; hint?: string } = {}) => {
    const current = guidedSegmentRef.current;
    if (!current || current.kind !== "audio") return;
    guidedSegmentRef.current = null;
    guidedAudioProgressRef.current = { key: "", currentTime: 0, updatedAt: 0 };
    setPendingAudioTeleprompter(null);
    if (options.closeTeleprompter) {
      closeTeleprompter();
    }
    if (options.hint) {
      setPlaybackHint(options.hint);
    }
    current.resolve();
  }, [closeTeleprompter]);

  const stopAllPlayback = useCallback(
    async (options: { preserveHint?: boolean } = {}) => {
      guidedRunIdRef.current += 1;
      currentModeRef.current = "idle";
      setActiveParayan(false);
      setGuidedState("idle");
      setGuidedStageLabel("");
      setPendingAudioTeleprompter(null);
      resetInlineTeleprompter();
      clearGuidedSegment();
      closeTeleprompter();
      try {
        audioPlayer.pause();
      } catch {}
      try {
        audioPlayer.remove();
      } catch {}
      await stopResolvedSpeech(Speech);
      if (!options.preserveHint) {
        setPlaybackHint("Playback stopped.");
      }
    },
    [audioPlayer, clearGuidedSegment, closeTeleprompter, resetInlineTeleprompter]
  );

  const waitForAudioSegment = useCallback(
    async (key: string, url: string, text: string) => {
      if (!url) return;
      await stopResolvedSpeech(Speech);
      try {
        audioPlayer.pause();
      } catch {}
      try {
        audioPlayer.remove();
      } catch {}
      setPendingAudioTeleprompter({ key, text });
      await new Promise<void>((resolve) => {
        guidedSegmentRef.current = {
          kind: "audio",
          resolve,
          paused: false,
          started: false,
          startedAt: Date.now(),
          key,
          text,
          url,
        };
        guidedAudioProgressRef.current = { key, currentTime: 0, updatedAt: Date.now() };
        try {
          audioPlayer.replace({ uri: url } as AudioSource);
          const playResult = (audioPlayer.play as any)?.call(audioPlayer);
          if (playResult && typeof (playResult as PromiseLike<void>).then === "function") {
            void (playResult as PromiseLike<void>).then(undefined, () => {
              resolveActiveAudioSegment({
                hint: "Verse recite audio was blocked by the browser, continuing with TTS.",
              });
            });
          }
        } catch {
          resolveActiveAudioSegment({
            hint: "Verse recite audio was blocked by the browser, continuing with TTS.",
          });
        }
      });
    },
    [audioPlayer, resolveActiveAudioSegment]
  );

  const waitForTtsSegment = useCallback(
    async (text: string) => {
      const normalized = normalizeText(text);
      if (!normalized) return;
      try {
        audioPlayer.pause();
      } catch {}
      try {
        audioPlayer.remove();
      } catch {}
      await stopResolvedSpeech(Speech);
      await new Promise<void>((resolve) => {
        guidedSegmentRef.current = {
          kind: "tts",
          resolve,
          paused: false,
        };
        void speakWithResolvedVoice(Speech, routeLang, normalized, {
          onDone: resolve,
          onStopped: resolve,
          onError: resolve,
        }).catch(resolve);
      });
      if (guidedSegmentRef.current?.kind === "tts") {
        guidedSegmentRef.current = null;
      }
    },
    [routeLang]
  );

  const runGuidedSequence = useCallback(async () => {
    const runId = guidedRunIdRef.current + 1;
    guidedRunIdRef.current = runId;
    currentModeRef.current = "guided";
    setGuidedState("running");
    setActiveParayan(false);
    setPlaybackHint("Guided chapter playback started.");

    const firstVerse = await fetchVerseSnapshot(routeChapter, MIN_VERSE_NUMBER).catch(() => null);
    if (!firstVerse || guidedRunIdRef.current !== runId) {
      setGuidedState("idle");
      currentModeRef.current = "idle";
      return;
    }

    const introText = normalizeText(firstVerse.chapterDescription || chapterDescription);
    if (introText) {
      setGuidedStageLabel("Chapter Description");
      showInlineTeleprompter(introText, "tts");
      await waitForTtsSegment(introText);
      if (guidedRunIdRef.current !== runId) return;
    }

    const maxVerse = Math.max(1, knownVerseCount || KNOWN_VERSE_COUNT_BY_CHAPTER[routeChapter] || 1);
    for (let verse = MIN_VERSE_NUMBER; verse <= maxVerse; verse += 1) {
      if (guidedRunIdRef.current !== runId) return;
      const snapshot = verse === MIN_VERSE_NUMBER ? firstVerse : await fetchVerseSnapshot(routeChapter, verse).catch(() => null);
      if (!snapshot) continue;
      prefetchVerses(verse);

      const sanskritOnly = normalizeText(snapshot.sanskrit);
      const combinedText = buildGuidedVerseTeleprompterText(snapshot);
      const narrationText = normalizeText(snapshot.narrationText);

      setGuidedStageLabel(`Verse ${verse}`);
      if (sanskritOnly) {
        showInlineTeleprompter(sanskritOnly, "audio");
      }

      const recitalUrl = snapshot.reciteUrl;
      if (recitalUrl) {
        await waitForAudioSegment(`chapter-guided-recite-${routeChapter}-${verse}`, recitalUrl, sanskritOnly || combinedText);
        if (guidedRunIdRef.current !== runId) return;
      }

      if (combinedText) {
        showInlineTeleprompter(combinedText, "tts");
      }
      if (narrationText) {
        await waitForTtsSegment(narrationText);
      }
    }

    if (guidedRunIdRef.current !== runId) return;
    currentModeRef.current = "idle";
    setGuidedState("idle");
    setGuidedStageLabel("");
    setPlaybackHint("Chapter playback completed.");
  }, [
    chapterDescription,
    fetchVerseSnapshot,
    knownVerseCount,
    prefetchVerses,
    routeChapter,
    showInlineTeleprompter,
    waitForAudioSegment,
    waitForTtsSegment,
  ]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setChapterData(null);
    setParayanFeed(null);
    setHeroSanskrit("");
    resetInlineTeleprompter();
    setKnownVerseCount(KNOWN_VERSE_COUNT_BY_CHAPTER[routeChapter] || 1);

    void loadChapterSnapshots(routeChapter, routeLang, {
      skip: 0,
      limit: CHAPTER_VERSES_PAGE_SIZE,
    })
      .then((snapshot) => {
        if (!active) return;
        const firstVerseKey = `${routeLang}:${routeChapter}:${MIN_VERSE_NUMBER}`;
        const firstVerse = verseCacheRef.current.get(firstVerseKey);
        setChapterData((current) => ({
          ...(current || {}),
          chapter: routeChapter,
          lang: routeLang,
          title: normalizeText(snapshot?.chapterData?.title || current?.title || routeTitle),
          text: normalizeText(snapshot?.chapterData?.text || current?.text || firstVerse?.chapterDescription || ""),
          ytDescription: normalizeText(
            snapshot?.chapterData?.ytDescription || current?.ytDescription || firstVerse?.chapterDescription || ""
          ),
        }));
        if (firstVerse?.chapterDescription || snapshot?.chapterData?.text) {
          setPlaybackHint("Teleprompter ready for chapter narration and verse flow.");
        }
      })
      .catch((err: any) => {
        if (!active) return;
        setError(err?.message || "Unable to load chapter.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    void fetchParayanFeed(routeChapter)
      .then((feed) => {
        if (!active) return;
        setParayanFeed(feed);
      })
      .catch(() => {
        if (!active) return;
        setParayanFeed(null);
      });

    return () => {
      active = false;
    };
  }, [fetchParayanFeed, loadChapterSnapshots, resetInlineTeleprompter, routeChapter, routeLang, routeTitle]);

  useEffect(() => {
    verseCacheRef.current.clear();
    verseInFlightRef.current.clear();
    chapterPageCacheRef.current.clear();
    chapterPageInFlightRef.current.clear();
  }, [routeChapter, routeLang]);

  useEffect(() => {
    audioStatusRef.current = audioStatus;
  }, [audioStatus, resolveActiveAudioSegment]);

  useEffect(() => {
    const segment = guidedSegmentRef.current;
    if (!segment || segment.kind !== "audio") return;
    const status = (audioStatus as any) || {};
    const isPlaying = Boolean(status.playing);
    const didJustFinish = Boolean(status.didJustFinish);
    const currentTime = Number(status.currentTime || 0);
    const duration = Number(status.duration || 0);
    const playbackState = String(status.playbackState || "").trim().toLowerCase();

    if (currentTime > guidedAudioProgressRef.current.currentTime + 0.05) {
      guidedAudioProgressRef.current = {
        key: segment.key,
        currentTime,
        updatedAt: Date.now(),
      };
      if (currentTime > 0) {
        segment.started = true;
      }
    }

    if (isPlaying) {
      segment.started = true;
      return;
    }
    if (!segment.started || segment.paused) return;

    const isNearEnd = duration > 0 && currentTime > 0 && currentTime >= Math.max(duration - 0.35, duration * 0.98);
    const playbackEnded = playbackState === "ended";
    if (didJustFinish || isNearEnd || playbackEnded) {
      resolveActiveAudioSegment();
    }
  }, [audioStatus]);

  useEffect(() => {
    const interval = setInterval(() => {
      const segment = guidedSegmentRef.current;
      if (!segment || segment.kind !== "audio" || segment.paused) return;

      const status = (audioStatusRef.current as any) || {};
      const isPlaying = Boolean(status.playing);
      const currentTime = Number(status.currentTime || 0);
      const duration = Number(status.duration || 0);
      const isLoaded = status.isLoaded !== false;
      const playbackState = String(status.playbackState || "").trim().toLowerCase();
      const progress = guidedAudioProgressRef.current;
      const now = Date.now();

      if (currentTime > progress.currentTime + 0.05) {
        guidedAudioProgressRef.current = {
          key: segment.key,
          currentTime,
          updatedAt: now,
        };
        segment.started = true;
        return;
      }

      const isNearEnd = duration > 0 && currentTime > 0 && currentTime >= Math.max(duration - 0.35, duration * 0.98);
      const stalledAfterProgress =
        segment.started &&
        !isPlaying &&
        currentTime > 0 &&
        progress.updatedAt > 0 &&
        now - progress.updatedAt > 4000;
      const startedButNoProgress =
        !segment.started &&
        !isPlaying &&
        isLoaded &&
        playbackState !== "buffering" &&
        now - segment.startedAt > 8000;

      if (isNearEnd || stalledAfterProgress || startedButNoProgress) {
        resolveActiveAudioSegment({
          hint: stalledAfterProgress || startedButNoProgress ? "Verse recite stalled, continuing with TTS." : undefined,
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [resolveActiveAudioSegment]);

  useEffect(() => {
    const segment = guidedSegmentRef.current;
    if (!segment || segment.kind !== "audio" || segment.started || segment.paused || !segment.url) return;

    const candidates = [
      (audioPlayer as any)?._audio,
      (audioPlayer as any)?.audio,
      (audioPlayer as any)?._element,
      (audioPlayer as any)?.element,
    ].filter(Boolean) as Array<{
      addEventListener?: (type: string, listener: (...args: any[]) => void) => void;
      removeEventListener?: (type: string, listener: (...args: any[]) => void) => void;
      src?: string;
      currentSrc?: string;
    }>;

    if (!candidates.length) return;

    const currentElement =
      candidates.find((entry) => {
        const source = String(entry.currentSrc || entry.src || "").trim();
        return !source || source === segment.url;
      }) || candidates[0];

    let cleanedUp = false;
    const markStarted = () => {
      const active = guidedSegmentRef.current;
      if (!active || active.kind !== "audio" || active.url !== segment.url) return;
      active.started = true;
    };

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      currentElement.removeEventListener?.("playing", markStarted);
      currentElement.removeEventListener?.("play", markStarted);
      currentElement.removeEventListener?.("canplay", markStarted);
    };

    currentElement.addEventListener?.("playing", markStarted);
    currentElement.addEventListener?.("play", markStarted);
    currentElement.addEventListener?.("canplay", markStarted);

    return cleanup;
  }, [audioPlayer, audioStatus]);

  useEffect(() => {
    if (!pendingAudioTeleprompter || !Boolean((audioStatus as any)?.playing)) return;
    showInlineTeleprompter(pendingAudioTeleprompter.text, "audio");
    setPendingAudioTeleprompter(null);
  }, [audioStatus, pendingAudioTeleprompter, showInlineTeleprompter]);

  useEffect(() => {
    if (!inlineTeleprompterVisible || inlineTeleprompterWordCount <= 0) return;
    if (inlineTeleprompterModeRef.current !== "tts") return;
    if (guidedState === "paused") return;
    if (!inlineTeleprompterStartedAtRef.current) {
      inlineTeleprompterStartedAtRef.current = Date.now();
    }
    const timer = setInterval(() => {
      const elapsed =
        Date.now() -
        inlineTeleprompterStartedAtRef.current -
        inlineTeleprompterTotalPausedMsRef.current;
      const progress = clampNumber(elapsed / Math.max(1, inlineTeleprompterDurationMs), 0, 1);
      const nextWord = Math.min(
        Math.max(0, inlineTeleprompterWordCount - 1),
        Math.floor(progress * inlineTeleprompterWordCount)
      );
      setInlineTeleprompterWordIndex(nextWord);
    }, 80);
    return () => clearInterval(timer);
  }, [guidedState, inlineTeleprompterDurationMs, inlineTeleprompterVisible, inlineTeleprompterWordCount]);

  useEffect(() => {
    if (!inlineTeleprompterVisible || inlineTeleprompterWordCount <= 0) return;
    if (inlineTeleprompterModeRef.current !== "audio") return;
    const currentTime = Number((audioStatus as any)?.currentTime || 0);
    const duration = Number((audioStatus as any)?.duration || 0);
    if (!(duration > 0)) return;
    const progress = clampNumber(currentTime / duration, 0, 1);
    const nextWord = Math.min(
      Math.max(0, inlineTeleprompterWordCount - 1),
      Math.floor(progress * inlineTeleprompterWordCount)
    );
    setInlineTeleprompterWordIndex(nextWord);
  }, [audioStatus, inlineTeleprompterVisible, inlineTeleprompterWordCount]);

  useEffect(() => {
    if (!inlineTeleprompterVisible || inlineTeleprompterModeRef.current !== "tts") return;
    if (guidedState === "paused") {
      if (!inlineTeleprompterPausedAtRef.current) {
        inlineTeleprompterPausedAtRef.current = Date.now();
      }
      return;
    }
    if (inlineTeleprompterPausedAtRef.current) {
      inlineTeleprompterTotalPausedMsRef.current += Date.now() - inlineTeleprompterPausedAtRef.current;
      inlineTeleprompterPausedAtRef.current = 0;
    }
  }, [guidedState, inlineTeleprompterVisible]);

  useEffect(() => {
    if (!inlineTeleprompterVisible) return;
    inlineTeleprompterScrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [guidedStageLabel, inlineTeleprompterText, inlineTeleprompterVisible]);

  useEffect(() => {
    if (!inlineTeleprompterVisible || inlineTeleprompterWordCount <= 0) return;
    const maxScroll = Math.max(0, inlineTeleprompterContentHeight - inlineTeleprompterViewportHeight);
    if (maxScroll <= 0) return;
    const progress =
      inlineTeleprompterWordCount <= 1 ? 0 : inlineTeleprompterWordIndex / (inlineTeleprompterWordCount - 1);
    const scrollProgress = clampNumber(progress * inlineTeleprompterScrollSpeed, 0, 1);
    inlineTeleprompterScrollRef.current?.scrollTo({ y: Math.round(maxScroll * scrollProgress), animated: true });
  }, [
    inlineTeleprompterContentHeight,
    inlineTeleprompterScrollSpeed,
    inlineTeleprompterVisible,
    inlineTeleprompterWordCount,
    inlineTeleprompterWordIndex,
  ]);

  useEffect(() => {
    return () => {
      void stopAllPlayback({ preserveHint: true });
    };
  }, [stopAllPlayback]);

  const navigateToChapter = useCallback(
    async (chapter: number) => {
      const target = clampChapter(chapter);
      await stopAllPlayback({ preserveHint: true });
      updateSelection({ chapter: target, verse: 1 });
      router.replace({
        pathname: "/chapter",
        params: {
          chapter: String(target),
          lang: routeLang,
        },
      });
    },
    [routeLang, router, stopAllPlayback, updateSelection]
  );

  const handleParayanPress = useCallback(async () => {
    if (currentModeRef.current === "parayan" && activeParayan && Boolean((audioStatus as any)?.playing)) {
      try {
        audioPlayer.pause();
      } catch {}
      collapseInlineTeleprompter();
      setActiveParayan(false);
      setPlaybackHint("Parayan playback paused.");
      return;
    }

    if (currentModeRef.current === "parayan" && !Boolean((audioStatus as any)?.playing) && parayanFeed?.audioUrl) {
      revealInlineTeleprompter();
      try {
        audioPlayer.play();
      } catch {}
      setActiveParayan(true);
      setPlaybackHint("Parayan playback resumed.");
      return;
    }

    await stopAllPlayback({ preserveHint: true });
    const feed = parayanFeed || (await fetchParayanFeed(routeChapter).catch(() => null));
    if (!feed?.audioUrl) {
      setPlaybackHint("Parayan audio is not available for this chapter.");
      return;
    }
    setParayanFeed(feed);
    currentModeRef.current = "parayan";
    setActiveParayan(true);
    setGuidedState("idle");
    setGuidedStageLabel("Parayan");
    setPlaybackHint("Parayan audio started.");
    showInlineTeleprompter(feed.teleprompterText || `${chapterTitle}\n\n${chapterDescription}`, "audio");
    setPendingAudioTeleprompter({
      key: `chapter-parayan-${routeChapter}`,
      text: feed.teleprompterText || `${chapterTitle}\n\n${chapterDescription}`,
    });
    audioPlayer.replace({ uri: feed.audioUrl } as AudioSource);
    audioPlayer.play();
  }, [
    audioPlayer,
    audioStatus,
    chapterDescription,
    chapterTitle,
    fetchParayanFeed,
    parayanFeed,
    routeChapter,
    stopAllPlayback,
    activeParayan,
    collapseInlineTeleprompter,
    revealInlineTeleprompter,
  ]);

  const handleGuidedToggle = useCallback(async () => {
    if (guidedState === "running") {
      const current = guidedSegmentRef.current;
      if (current?.kind === "tts") {
        current.paused = true;
        await pauseResolvedSpeech(Speech);
      } else if (current?.kind === "audio") {
        current.paused = true;
        try {
          audioPlayer.pause();
        } catch {}
      }
      collapseInlineTeleprompter();
      setGuidedState("paused");
      setPlaybackHint("Guided playback paused.");
      return;
    }

    if (guidedState === "paused") {
      revealInlineTeleprompter();
      const current = guidedSegmentRef.current;
      if (current?.kind === "tts") {
        current.paused = false;
        await resumeResolvedSpeech(Speech);
      } else if (current?.kind === "audio") {
        current.paused = false;
        try {
          audioPlayer.play();
        } catch {}
      }
      setGuidedState("running");
      setPlaybackHint("Guided playback resumed.");
      return;
    }

    await stopAllPlayback({ preserveHint: true });
    void runGuidedSequence().catch(async () => {
      await stopAllPlayback({ preserveHint: true });
      setError("Unable to start guided chapter playback.");
    });
  }, [audioPlayer, collapseInlineTeleprompter, guidedState, revealInlineTeleprompter, runGuidedSequence, stopAllPlayback]);

  useEffect(() => {
    if (currentModeRef.current !== "parayan") return;
    const status = (audioStatus as any) || {};
    const isPlaying = Boolean(status.playing);
    const didJustFinish = Boolean(status.didJustFinish);
    const currentTime = Number(status.currentTime || 0);
    const duration = Number(status.duration || 0);
    const playbackState = String(status.playbackState || "").trim().toLowerCase();

    if (isPlaying) {
      setActiveParayan(true);
      return;
    }

    setActiveParayan(false);

    const isNearEnd =
      duration > 0 && currentTime > 0 && currentTime >= Math.max(duration - 0.35, duration * 0.98);
    const playbackEnded = playbackState === "ended";
    if (didJustFinish || isNearEnd || playbackEnded) {
      currentModeRef.current = "idle";
      setGuidedStageLabel("");
      setPlaybackHint("Parayan playback completed.");
    }
  }, [audioStatus]);

  const guidedButtonLabel =
    guidedState === "running" ? "Pause Guided" : guidedState === "paused" ? "Resume Guided" : "Play Guided";
  const disablePrevChapter = routeChapter <= MIN_CHAPTER_NUMBER;
  const disableNextChapter = routeChapter >= MAX_CHAPTER_NUMBER;

  return (
    <ScrollView
      className="flex-1 bg-slate-50 px-4 py-5"
      contentContainerStyle={{ paddingBottom: 20, alignItems: "center" }}
    >
      <View className="w-full max-w-3xl gap-4">
        <View className="rounded-[24px] border border-amber-200 bg-white px-5 py-4 shadow-sm">
          <View className="flex-row items-start gap-4">
            <View className="min-w-[56px] items-start">
              <Text className="text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-700">
                {t("Chapter")}
              </Text>
              <Text className="mt-1 text-5xl font-black leading-none text-slate-900">{routeChapter}</Text>
            </View>
            <View className="flex-1 pt-1">
              <Text className="text-xl font-bold leading-7 text-slate-900">{chapterTitle}</Text>
              <Text className="mt-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                {routeLang}
              </Text>
            </View>
          </View>
        </View>

        {!loading && heroSanskrit ? (
          <View className="rounded-[24px] border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <GitaVerseImageCard
              sanskritText={heroSanskrit}
              chapter={routeChapter}
              verse={1}
              width={heroWidth}
              showVerseLabel={false}
              minimalChrome
            />
            {chapterDescription ? (
              <Text className="px-2 pt-3 text-center text-sm leading-6 text-slate-600" numberOfLines={3}>
                {chapterDescription}
              </Text>
            ) : null}
          </View>
        ) : null}

        {inlineTeleprompterVisible ? (
          <View className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <Text className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              Reading Panel
            </Text>
            <Text className="mt-3 text-lg font-bold text-slate-900">
              {guidedStageLabel || (activeParayan ? "Parayan" : "Playback")}
            </Text>
            <Text className="mt-2 text-sm leading-6 text-slate-500">{playbackHint}</Text>
            <View className="mt-4 flex-row flex-wrap gap-2">
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setInlineTeleprompterFontScale((current) => clampNumber(current - 0.1, 0.85, 1.45))}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <Text className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">A-</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setInlineTeleprompterFontScale((current) => clampNumber(current + 0.1, 0.85, 1.45))}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <Text className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">A+</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setInlineTeleprompterScrollSpeed((current) => clampNumber(current - 0.15, 0.7, 1.6))}
                className="rounded-full border border-sky-200 bg-sky-50 px-3 py-2"
              >
                <Text className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Slower</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setInlineTeleprompterScrollSpeed((current) => clampNumber(current + 0.15, 0.7, 1.6))}
                className="rounded-full border border-sky-200 bg-sky-50 px-3 py-2"
              >
                <Text className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Faster</Text>
              </TouchableOpacity>
            </View>
            <View className="mt-4 h-[260px] rounded-2xl bg-slate-50 px-4 py-4">
              <ScrollView
                ref={inlineTeleprompterScrollRef}
                scrollEnabled={false}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                style={{ flex: 1 }}
                onContentSizeChange={(_, h) => {
                  const next = Math.ceil(h);
                  if (next > 0 && next !== inlineTeleprompterContentHeight) {
                    setInlineTeleprompterContentHeight(next);
                  }
                }}
                contentContainerStyle={{
                  paddingTop: inlineTeleprompterStartInset,
                  paddingBottom: 12,
                }}
              >
                <Text
                  style={{
                    color: "#64748b",
                    fontSize: inlineTeleprompterFontSize,
                    lineHeight: inlineTeleprompterLineHeight,
                  }}
                >
                  {(() => {
                    let seenWordIndex = -1;
                    return inlineTeleprompterTokens.map((token, idx) => {
                      if (token.type === "newline") {
                        return (
                          <Text key={`inline-tpn-${idx}`}>
                            {token.value === "\n\n" ? "\n\u00A0\n" : "\n"}
                          </Text>
                        );
                      }
                      seenWordIndex += 1;
                      const isCurrent = seenWordIndex === inlineTeleprompterWordIndex;
                      const isDone = seenWordIndex < inlineTeleprompterWordIndex;
                      const nextToken = inlineTeleprompterTokens[idx + 1];
                      return (
                        <Text
                          key={`inline-tpw-${idx}`}
                          style={{
                            color: isCurrent ? "#0f172a" : isDone ? "#1d4ed8" : "#64748b",
                            backgroundColor: isCurrent ? "rgba(14,165,233,0.24)" : "transparent",
                            fontWeight: isCurrent ? "800" : isDone ? "700" : "600",
                            fontSize: inlineTeleprompterFontSize,
                            lineHeight: inlineTeleprompterLineHeight,
                          }}
                        >
                          {token.value}
                          {nextToken?.type === "word" ? " " : ""}
                        </Text>
                      );
                    });
                  })()}
                </Text>
              </ScrollView>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View className="items-center justify-center rounded-3xl border border-slate-200 bg-white px-6 py-10">
            <ActivityIndicator size="small" color="#475569" />
            <Text className="mt-3 text-sm text-slate-500">Loading chapter playback…</Text>
          </View>
        ) : null}

        {!loading ? (
          <View
            className="items-center gap-3 rounded-[24px] border border-slate-200 bg-white px-3 py-3 shadow-sm"
          >
            <Text className="px-2 text-center text-sm font-medium leading-6 text-slate-600">
              {guidedStageLabel ? `${guidedStageLabel}. ${playbackHint}` : playbackHint}
            </Text>

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => void handleGuidedToggle()}
                activeOpacity={0.85}
                style={[
                  actionTileBaseStyle,
                  {
                    borderColor:
                      guidedState === "idle" ? "rgba(217,119,6,0.45)" : "rgba(180,83,9,0.55)",
                    backgroundColor:
                      guidedState === "idle"
                        ? "rgba(245,158,11,0.16)"
                        : guidedState === "paused"
                        ? "rgba(217,119,6,0.18)"
                        : "rgba(146,64,14,0.22)",
                  },
                ]}
              >
                <Text className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-amber-900">
                  Guided
                </Text>
                <Text className="mt-2 text-center text-base font-bold text-slate-900">{guidedButtonLabel}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => void handleParayanPress()}
                activeOpacity={0.85}
                style={[
                  actionTileBaseStyle,
                  {
                    borderColor: activeParayan ? "rgba(21,128,61,0.6)" : "rgba(15,23,42,0.22)",
                    backgroundColor: activeParayan ? "rgba(34,197,94,0.18)" : "rgba(15,23,42,0.06)",
                  },
                ]}
              >
                <Text className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-slate-700">
                  Parayan
                </Text>
                <Text className="mt-2 text-center text-base font-bold text-slate-900">
                  {activeParayan ? "Stop" : "Play"}
                </Text>
              </TouchableOpacity>
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => void navigateToChapter(routeChapter - 1)}
                disabled={disablePrevChapter}
                activeOpacity={0.85}
                style={[
                  actionTileBaseStyle,
                  {
                    borderColor: "rgba(15,23,42,0.22)",
                    backgroundColor: "rgba(15,23,42,0.04)",
                    opacity: disablePrevChapter ? 0.45 : 1,
                  },
                ]}
              >
                <Text className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Chapter
                </Text>
                <Text className="mt-2 text-center text-lg font-black text-slate-900">{Math.max(MIN_CHAPTER_NUMBER, routeChapter - 1)}</Text>
                <Text className="mt-1 text-center text-sm font-semibold text-slate-700">Previous</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => void navigateToChapter(routeChapter + 1)}
                disabled={disableNextChapter}
                activeOpacity={0.85}
                style={[
                  actionTileBaseStyle,
                  {
                    borderColor: "rgba(15,23,42,0.22)",
                    backgroundColor: "rgba(15,23,42,0.04)",
                    opacity: disableNextChapter ? 0.45 : 1,
                  },
                ]}
              >
                <Text className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Chapter
                </Text>
                <Text className="mt-2 text-center text-lg font-black text-slate-900">{Math.min(MAX_CHAPTER_NUMBER, routeChapter + 1)}</Text>
                <Text className="mt-1 text-center text-sm font-semibold text-slate-700">Next</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {!loading ? (
          <TouchableOpacity
            onPress={() => {
              updateSelection({ chapter: routeChapter, verse: 1 });
              router.push({
                pathname: "/gitaverse",
                params: {
                  chapter: String(routeChapter),
                  verse: "1",
                  lang: routeLang,
                },
              });
            }}
            className="items-center rounded-lg border border-slate-300 bg-white px-5 py-4"
            activeOpacity={0.85}
          >
            <Text className="text-base font-semibold text-slate-900">Open Chapter Verses</Text>
          </TouchableOpacity>
        ) : null}

        {error ? (
          <View className="rounded-3xl border border-red-200 bg-red-50 px-5 py-4">
            <Text className="text-sm font-medium text-red-700">{error}</Text>
          </View>
        ) : null}
      </View>

      <PageBottomMeta />
    </ScrollView>
  );
}
