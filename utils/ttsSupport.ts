import { Alert, NativeModules, Platform } from "react-native";

type BaseSpeakOptions = {
  language?: string;
  voice?: string;
  pitch?: number;
  rate?: number;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: () => void;
};

type SpeechVoice = {
  identifier?: string;
  language?: string;
  name?: string;
  quality?: string;
};

type WebSpeechVoice = {
  default?: boolean;
  lang?: string;
  localService?: boolean;
  name?: string;
  voiceURI?: string;
};

type ReactNativeTtsVoice = {
  id: string;
  name: string;
  language: string;
  quality: number;
  latency: number;
  networkConnectionRequired: boolean;
  notInstalled: boolean;
};

type ReactNativeTtsModule = {
  getInitStatus: () => Promise<"success">;
  setDefaultVoice?: (voiceId: string) => Promise<"success">;
  setDefaultLanguage?: (language: string) => Promise<"success">;
  setDefaultPitch?: (pitch: number) => Promise<"success">;
  setDefaultRate?: (rate: number, skipTransform?: boolean) => Promise<"success">;
  voices?: () => Promise<ReactNativeTtsVoice[]>;
  speak: (utterance: string, options?: string | { iosVoiceId?: string; rate?: number; androidParams?: any }) => string | number;
  stop: (onWordBoundary?: boolean) => Promise<boolean>;
  pause?: (onWordBoundary?: boolean) => Promise<boolean>;
  resume?: () => Promise<boolean>;
  addEventListener: (type: "tts-finish" | "tts-error" | "tts-cancel", handler: (event: any) => void) => void;
  removeEventListener: (type: "tts-finish" | "tts-error" | "tts-cancel", handler: (event: any) => void) => void;
};

export type ExpoSpeechModule = {
  stop: () => void;
  speak: (text: string, options?: BaseSpeakOptions) => void;
  getAvailableVoicesAsync?: () => Promise<SpeechVoice[]>;
  pause?: () => Promise<void>;
  resume?: () => Promise<void>;
};

export type SpeechSupportStatus = {
  selectedLang: string;
  selectedLocale: string;
  textLang: string;
  textLocale: string;
  engine: "expo" | "rn-tts" | "browser" | "none";
  reason: string;
  voiceName: string;
  voiceId: string;
  status: string;
};

const TTS_LOCALE_BY_LANG: Record<string, string> = {
  EN: "en-US",
  HI: "hi-IN",
  SA: "hi-IN",
  BN: "bn-IN",
  TA: "ta-IN",
  TE: "te-IN",
  MR: "mr-IN",
  GU: "gu-IN",
  KN: "kn-IN",
  ML: "ml-IN",
  PA: "pa-IN",
  OR: "or-IN",
  UR: "ur-IN",
  AR: "ar-SA",
  HE: "he-IL",
  FA: "fa-IR",
};

const SCRIPT_LANG_RANGES: Array<{ lang: string; start: number; end: number }> = [
  { lang: "HI", start: 0x0900, end: 0x097f },
  { lang: "BN", start: 0x0980, end: 0x09ff },
  { lang: "PA", start: 0x0a00, end: 0x0a7f },
  { lang: "GU", start: 0x0a80, end: 0x0aff },
  { lang: "OR", start: 0x0b00, end: 0x0b7f },
  { lang: "TA", start: 0x0b80, end: 0x0bff },
  { lang: "TE", start: 0x0c00, end: 0x0c7f },
  { lang: "KN", start: 0x0c80, end: 0x0cff },
  { lang: "ML", start: 0x0d00, end: 0x0d7f },
  { lang: "UR", start: 0x0600, end: 0x06ff },
];
const NOVELTY_VOICE_PATTERNS = [
  "trinoids",
  "zarvox",
  "bad news",
  "good news",
  "bubbles",
  "cellos",
  "organ",
  "wobble",
  "whisper",
  "jester",
  "superstar",
  "bells",
  "boing",
];
const NATURAL_VOICE_HINTS = [
  "siri",
  "premium",
  "enhanced",
  "default",
  "natural",
  "neural",
  "female",
  "male",
  "alex",
  "samantha",
  "daniel",
  "karen",
  "moira",
  "aaron",
];
const ENGLISH_VOICE_NAME_PATTERNS = [
  "karen",
  "samantha",
  "alex",
  "victoria",
  "daniel",
  "aaron",
  "moira",
  "tessa",
  "veena",
  "fiona",
  "serena",
  "allison",
  "ava",
  "nicky",
  "fred",
  "joelle",
];

const normalizeLocale = (value: string) => String(value || "").trim().replace(/_/g, "-").toLowerCase();
const normalizeLang = (value: string) => String(value || "").trim().toUpperCase() || "EN";
const isLatinLetter = (char: string) => /[A-Za-z]/.test(char);
const matchesLocale = (voiceLocale: string, locale: string) => {
  const normalizedVoice = normalizeLocale(voiceLocale);
  const normalizedTarget = normalizeLocale(locale);
  if (!normalizedVoice || !normalizedTarget) return false;
  return (
    normalizedVoice === normalizedTarget ||
    normalizedVoice.split("-")[0] === normalizedTarget.split("-")[0]
  );
};

export const getExpoSpeechModule = (): ExpoSpeechModule | null => {
  try {
    return require("expo-speech") as ExpoSpeechModule;
  } catch {
    return null;
  }
};

const getReactNativeTtsModule = (): ReactNativeTtsModule | null => {
  if (Platform.OS === "web") return null;
  if (!NativeModules?.TextToSpeech) return null;
  try {
    return require("react-native-tts").default as ReactNativeTtsModule;
  } catch {
    return null;
  }
};

export const getWebSpeechSynthesis = () => {
  if (Platform.OS !== "web") return null;
  const webWindow = (globalThis as any)?.window;
  const synth = webWindow?.speechSynthesis ?? (globalThis as any)?.speechSynthesis;
  if (!synth || typeof synth.speak !== "function" || typeof synth.cancel !== "function") {
    return null;
  }
  return synth;
};

export const resolveTtsLocale = (langCode: string, text = ""): string => {
  const normalizedLang = normalizeLang(langCode);
  if (TTS_LOCALE_BY_LANG[normalizedLang]) return TTS_LOCALE_BY_LANG[normalizedLang];
  const detected = detectTextLanguage(text, normalizedLang);
  return TTS_LOCALE_BY_LANG[detected] || "en-US";
};

export const detectTextLanguage = (text: string, selectedLang = "EN"): string => {
  const counts: Record<string, number> = {};
  let latinCount = 0;
  for (const char of String(text || "")) {
    if (isLatinLetter(char)) {
      latinCount += 1;
      continue;
    }
    const code = char.codePointAt(0) || 0;
    const match = SCRIPT_LANG_RANGES.find((entry) => code >= entry.start && code <= entry.end);
    if (match) {
      counts[match.lang] = (counts[match.lang] || 0) + 1;
    }
  }
  const topIndic = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || null;
  const topIndicCount = topIndic?.[1] || 0;
  if (topIndicCount > latinCount && topIndic?.[0]) return topIndic[0];
  if (latinCount > 0) return "EN";
  return normalizeLang(selectedLang);
};

let expoVoiceListPromise: Promise<SpeechVoice[]> | null = null;
let rnTtsVoiceListPromise: Promise<ReactNativeTtsVoice[]> | null = null;
const shownMissingVoiceAlerts = new Set<string>();

const getExpoVoices = async () => {
  const speech = getExpoSpeechModule();
  if (!speech || typeof speech.getAvailableVoicesAsync !== "function") return [];
  if (!expoVoiceListPromise) {
    expoVoiceListPromise = speech.getAvailableVoicesAsync().catch(() => []);
  }
  return expoVoiceListPromise;
};

const getWebVoices = async (): Promise<WebSpeechVoice[]> => {
  const synth = getWebSpeechSynthesis();
  if (!synth || typeof synth.getVoices !== "function") return [];
  try {
    const immediate = synth.getVoices() as WebSpeechVoice[];
    if (Array.isArray(immediate) && immediate.length > 0) return immediate;
  } catch {}

  return await new Promise<WebSpeechVoice[]>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        const voices = synth.getVoices() as WebSpeechVoice[];
        resolve(Array.isArray(voices) ? voices : []);
      } catch {
        resolve([]);
      }
    };

    const timeoutId = setTimeout(finish, 250);
    const handler = () => {
      clearTimeout(timeoutId);
      try {
        synth.removeEventListener?.("voiceschanged", handler as any);
      } catch {}
      finish();
    };

    try {
      synth.addEventListener?.("voiceschanged", handler as any);
    } catch {
      clearTimeout(timeoutId);
      finish();
    }
  });
};

const getReactNativeTtsVoices = async () => {
  const tts = getReactNativeTtsModule();
  if (!tts || typeof tts.voices !== "function") return [];
  if (!rnTtsVoiceListPromise) {
    rnTtsVoiceListPromise = tts
      .getInitStatus()
      .then(() => tts.voices?.() || [])
      .catch(() => []);
  }
  return rnTtsVoiceListPromise;
};

const scoreExpoVoice = (voice: SpeechVoice, locale: string) => {
  const normalizedLocale = normalizeLocale(locale);
  const voiceLocale = normalizeLocale(String(voice.language || ""));
  const baseLocale = normalizedLocale.split("-")[0];
  let score = 0;
  if (voiceLocale === normalizedLocale) score += 100;
  else if (voiceLocale.split("-")[0] === baseLocale) score += 60;
  const quality = String(voice.quality || "").toLowerCase();
  if (quality === "enhanced") score += 20;
  const name = String(voice.name || "").toLowerCase();
  if (name.includes("siri")) score += 10;
  if (NATURAL_VOICE_HINTS.some((hint) => name.includes(hint))) score += 12;
  if (NOVELTY_VOICE_PATTERNS.some((hint) => name.includes(hint))) score -= 120;
  if (baseLocale !== "en" && ENGLISH_VOICE_NAME_PATTERNS.some((hint) => name.includes(hint))) score -= 140;
  if (name.includes("compact")) score -= 2;
  return score;
};

const scoreReactNativeTtsVoice = (voice: ReactNativeTtsVoice, locale: string) => {
  if (voice.notInstalled) return -1;
  const normalizedLocale = normalizeLocale(locale);
  const voiceLocale = normalizeLocale(String(voice.language || ""));
  const baseLocale = normalizedLocale.split("-")[0];
  let score = 0;
  if (voiceLocale === normalizedLocale) score += 100;
  else if (voiceLocale.split("-")[0] === baseLocale) score += 60;
  if (voice.quality >= 500) score += 20;
  if (voice.networkConnectionRequired) score -= 5;
  const name = String(voice.name || "").toLowerCase();
  if (NATURAL_VOICE_HINTS.some((hint) => name.includes(hint))) score += 12;
  if (NOVELTY_VOICE_PATTERNS.some((hint) => name.includes(hint))) score -= 120;
  if (baseLocale !== "en" && ENGLISH_VOICE_NAME_PATTERNS.some((hint) => name.includes(hint))) score -= 140;
  return score;
};

const pickBestExpoVoice = (voices: SpeechVoice[], locale: string) => {
  const ranked = [...voices]
    .map((voice) => ({ voice, score: scoreExpoVoice(voice, locale) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.voice || null;
};

const pickBestReactNativeTtsVoice = (voices: ReactNativeTtsVoice[], locale: string) => {
  const ranked = [...voices]
    .map((voice) => ({ voice, score: scoreReactNativeTtsVoice(voice, locale) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.voice || null;
};

const scoreWebVoice = (voice: WebSpeechVoice, locale: string) => {
  const normalizedLocale = normalizeLocale(locale);
  const voiceLocale = normalizeLocale(String(voice.lang || ""));
  const baseLocale = normalizedLocale.split("-")[0];
  let score = 0;
  if (voiceLocale === normalizedLocale) score += 100;
  else if (voiceLocale.split("-")[0] === baseLocale) score += 60;
  if (voice.default) score += 10;
  if (voice.localService) score += 6;
  const name = String(voice.name || "").toLowerCase();
  if (NATURAL_VOICE_HINTS.some((hint) => name.includes(hint))) score += 12;
  if (NOVELTY_VOICE_PATTERNS.some((hint) => name.includes(hint))) score -= 120;
  if (baseLocale !== "en" && ENGLISH_VOICE_NAME_PATTERNS.some((hint) => name.includes(hint))) score -= 140;
  return score;
};

const pickBestWebVoice = (voices: WebSpeechVoice[], locale: string) => {
  const ranked = [...voices]
    .map((voice) => ({ voice, score: scoreWebVoice(voice, locale) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.voice || null;
};

const buildStatusLine = (status: Omit<SpeechSupportStatus, "status">) => {
  const selectedPart = `sel ${status.selectedLang}`;
  const textPart = `text ${status.textLang}`;
  const enginePart =
    status.engine === "none"
      ? "no voice"
      : status.voiceName
        ? `${status.engine} ${status.voiceName}`
        : `${status.engine} ${status.textLocale}`;
  return `${selectedPart} | ${textPart} | ${enginePart}${status.reason ? ` | ${status.reason}` : ""}`;
};

const describeLanguage = (langCode: string) => {
  switch (normalizeLang(langCode)) {
    case "HI":
      return "Hindi";
    case "GU":
      return "Gujarati";
    case "TA":
      return "Tamil";
    case "TE":
      return "Telugu";
    case "BN":
      return "Bengali";
    case "KN":
      return "Kannada";
    case "ML":
      return "Malayalam";
    case "MR":
      return "Marathi";
    case "OR":
      return "Odia";
    case "PA":
      return "Punjabi";
    case "SA":
      return "Sanskrit";
    case "UR":
      return "Urdu";
    default:
      return "English";
  }
};

const maybeShowMissingVoiceAlert = (status: SpeechSupportStatus) => {
  if (Platform.OS === "web") return;
  if (status.engine !== "none") return;
  const alertKey = `${Platform.OS}:${status.textLocale}`;
  if (shownMissingVoiceAlerts.has(alertKey)) return;
  shownMissingVoiceAlerts.add(alertKey);
  const languageLabel = describeLanguage(status.textLang);
  const body =
    Platform.OS === "ios"
      ? `${languageLabel} voice is not available on this device.\n\nCheck Settings > Accessibility > Read & Speak for installed voices. If ${languageLabel} is not listed there, Apple does not currently provide it on this device.`
      : `${languageLabel} voice is not installed on this device.\n\nCheck your device text-to-speech language and voice settings.`;
  try {
    Alert.alert(`${languageLabel} voice unavailable`, body);
  } catch {}
};

export const getSpeechSupportStatus = async (selectedLang: string, text = ""): Promise<SpeechSupportStatus> => {
  const normalizedSelectedLang = normalizeLang(selectedLang);
  const textLang = detectTextLanguage(text, normalizedSelectedLang);
  const selectedLocale = resolveTtsLocale(normalizedSelectedLang, text);
  const textLocale = resolveTtsLocale(textLang, text);
  const mismatch = textLang !== normalizedSelectedLang;
  const mismatchReason = mismatch ? `using ${textLang} for actual text` : "";

  if (Platform.OS === "web") {
    const browserSynth = getWebSpeechSynthesis();
    const browserVoices = browserSynth ? await getWebVoices() : [];
    const browserVoice = pickBestWebVoice(browserVoices, textLocale);
    const status: Omit<SpeechSupportStatus, "status"> = {
      selectedLang: normalizedSelectedLang,
      selectedLocale,
      textLang,
      textLocale,
      engine: browserSynth ? "browser" : "none",
      reason:
        mismatchReason ||
        (browserSynth
          ? browserVoice
            ? "browser synthesis"
            : "browser synthesis; default voice fallback"
          : "no browser synthesis"),
      voiceName: String(browserVoice?.name || "").trim(),
      voiceId: String(browserVoice?.voiceURI || "").trim(),
    };
    return { ...status, status: buildStatusLine(status) };
  }

  const expoSpeech = getExpoSpeechModule();
  if (expoSpeech) {
    const expoVoice = pickBestExpoVoice(await getExpoVoices(), textLocale);
    if (expoVoice) {
      const status: Omit<SpeechSupportStatus, "status"> = {
        selectedLang: normalizedSelectedLang,
        selectedLocale,
        textLang,
        textLocale,
        engine: "expo",
        reason: mismatchReason,
        voiceName: String(expoVoice.name || "").trim() || textLocale,
        voiceId: String(expoVoice.identifier || "").trim(),
      };
      return { ...status, status: buildStatusLine(status) };
    }
  }

  const rnTts = getReactNativeTtsModule();
  if (rnTts) {
    const rnVoice = pickBestReactNativeTtsVoice(await getReactNativeTtsVoices(), textLocale);
    if (rnVoice) {
      const status: Omit<SpeechSupportStatus, "status"> = {
        selectedLang: normalizedSelectedLang,
        selectedLocale,
        textLang,
        textLocale,
        engine: "rn-tts",
        reason: mismatchReason || "native fallback; quality may vary",
        voiceName: String(rnVoice.name || "").trim() || textLocale,
        voiceId: String(rnVoice.id || "").trim(),
      };
      return { ...status, status: buildStatusLine(status) };
    }
  }

  const status: Omit<SpeechSupportStatus, "status"> = {
    selectedLang: normalizedSelectedLang,
    selectedLocale,
    textLang,
    textLocale,
    engine: "none",
    reason: mismatchReason || "no installed voice",
    voiceName: "",
    voiceId: "",
  };
  return { ...status, status: buildStatusLine(status) };
};

export const buildExpoSpeechOptions = async (
  selectedLang: string,
  text: string,
  options: Omit<BaseSpeakOptions, "language" | "voice"> = {}
) => {
  const status = await getSpeechSupportStatus(selectedLang, text);
  return {
    status,
    options: {
      ...options,
      language: status.textLocale,
      voice: status.engine === "expo" ? status.voiceId || undefined : undefined,
    } as BaseSpeakOptions,
  };
};

const speakWithReactNativeTts = async (
  tts: ReactNativeTtsModule,
  status: SpeechSupportStatus,
  text: string,
  options: Omit<BaseSpeakOptions, "language" | "voice"> = {}
) => {
  await tts.getInitStatus();
  try {
    if (status.voiceId && typeof tts.setDefaultVoice === "function") {
      await tts.setDefaultVoice(status.voiceId);
    }
  } catch {}
  try {
    if (status.textLocale && typeof tts.setDefaultLanguage === "function") {
      await tts.setDefaultLanguage(status.textLocale);
    }
  } catch {}
  try {
    if (typeof options.pitch === "number" && typeof tts.setDefaultPitch === "function") {
      await tts.setDefaultPitch(options.pitch);
    }
  } catch {}
  try {
    if (typeof options.rate === "number" && typeof tts.setDefaultRate === "function") {
      await tts.setDefaultRate(options.rate, true);
    }
  } catch {}

  const utteranceId = tts.speak(text, Platform.OS === "ios" ? { iosVoiceId: status.voiceId || undefined, rate: options.rate } : undefined);

  if (!options.onDone && !options.onStopped && !options.onError) return;

  const normalizedUtteranceId = String(utteranceId);
  const finishHandler = (event: any) => {
    if (String(event?.utteranceId) !== normalizedUtteranceId) return;
    cleanup();
    options.onDone?.();
  };
  const cancelHandler = (event: any) => {
    if (String(event?.utteranceId) !== normalizedUtteranceId) return;
    cleanup();
    options.onStopped?.();
  };
  const errorHandler = (event: any) => {
    if (String(event?.utteranceId) !== normalizedUtteranceId) return;
    cleanup();
    options.onError?.();
  };
  const cleanup = () => {
    tts.removeEventListener("tts-finish", finishHandler);
    tts.removeEventListener("tts-cancel", cancelHandler);
    tts.removeEventListener("tts-error", errorHandler);
  };

  tts.addEventListener("tts-finish", finishHandler);
  tts.addEventListener("tts-cancel", cancelHandler);
  tts.addEventListener("tts-error", errorHandler);
};

const speakWithBrowserTts = async (
  status: SpeechSupportStatus,
  text: string,
  options: Omit<BaseSpeakOptions, "language" | "voice"> = {}
) => {
  const synth = getWebSpeechSynthesis();
  const WebUtterance =
    (globalThis as any)?.SpeechSynthesisUtterance ??
    (globalThis as any)?.window?.SpeechSynthesisUtterance;
  if (!synth || !WebUtterance) {
    options.onError?.();
    throw new Error("Browser speech synthesis unavailable");
  }

  const voices = await getWebVoices();
  const selectedVoice = pickBestWebVoice(voices, status.textLocale);

  await new Promise<void>((resolve, reject) => {
    try {
      synth.cancel();
    } catch {}

    const utterance = new WebUtterance(text);
    utterance.lang = selectedVoice?.lang || status.textLocale || status.selectedLocale || "en-US";
    if (selectedVoice) utterance.voice = selectedVoice as any;
    if (typeof options.pitch === "number") utterance.pitch = options.pitch;
    if (typeof options.rate === "number") utterance.rate = options.rate;

    let settled = false;
    const finish = (cb?: () => void) => {
      if (settled) return;
      settled = true;
      cb?.();
      resolve();
    };
    utterance.onend = () => finish(options.onDone);
    utterance.onerror = () => {
      if (settled) return;
      settled = true;
      options.onError?.();
      reject(new Error(`Browser speech synthesis failed for ${utterance.lang}`));
    };

    try {
      synth.speak(utterance);
      if (typeof synth.resume === "function") {
        try {
          synth.resume();
        } catch {}
      }
      const idleTimer = setTimeout(() => {
        const pending = Boolean((synth as any)?.pending);
        const speaking = Boolean((synth as any)?.speaking);
        if (!pending && !speaking) finish(options.onDone);
      }, 300);
      const prevEnd = utterance.onend;
      utterance.onend = () => {
        clearTimeout(idleTimer);
        prevEnd?.(new Event("end"));
      };
      const prevError = utterance.onerror;
      utterance.onerror = (event: any) => {
        clearTimeout(idleTimer);
        prevError?.(event);
      };
    } catch (error) {
      options.onError?.();
      reject(error instanceof Error ? error : new Error("Browser speech synthesis threw"));
    }
  });
};

export const speakWithResolvedVoice = async (
  speech: ExpoSpeechModule | null,
  selectedLang: string,
  text: string,
  options: Omit<BaseSpeakOptions, "language" | "voice"> = {}
) => {
  const status = await getSpeechSupportStatus(selectedLang, text);
  if (status.engine === "browser") {
    await speakWithBrowserTts(status, text, options);
    return { status, options: { ...options, language: status.textLocale, voice: status.voiceId || undefined } };
  }
  if (status.engine === "expo" && speech) {
    const resolved = await buildExpoSpeechOptions(selectedLang, text, options);
    speech.speak(text, resolved.options);
    return { ...resolved, status };
  }

  if (status.engine === "rn-tts") {
    const tts = getReactNativeTtsModule();
    if (!tts) {
      options.onError?.();
      throw new Error(`react-native-tts unavailable for ${status.textLocale}`);
    }
    await speakWithReactNativeTts(tts, status, text, options);
    return { status, options: { ...options, language: status.textLocale, voice: status.voiceId || undefined } };
  }

  maybeShowMissingVoiceAlert(status);
  options.onError?.();
  throw new Error(`No speech engine available for ${status.textLocale}`);
};

export const stopResolvedSpeech = async (speech: ExpoSpeechModule | null) => {
  const webSynth = getWebSpeechSynthesis();
  try {
    if (webSynth && typeof webSynth.cancel === "function") webSynth.cancel();
  } catch {}
  try {
    speech?.stop();
  } catch {}
  try {
    await getReactNativeTtsModule()?.stop();
  } catch {}
};

export const pauseResolvedSpeech = async (speech: ExpoSpeechModule | null) => {
  const webSynth = getWebSpeechSynthesis();
  try {
    if (webSynth && typeof webSynth.pause === "function") webSynth.pause();
  } catch {}
  try {
    if (speech && typeof speech.pause === "function") {
      await speech.pause();
      return true;
    }
  } catch {}
  try {
    const tts = getReactNativeTtsModule();
    if (tts && typeof tts.pause === "function") {
      await tts.pause();
      return true;
    }
  } catch {}
  return false;
};

export const resumeResolvedSpeech = async (speech: ExpoSpeechModule | null) => {
  const webSynth = getWebSpeechSynthesis();
  try {
    if (webSynth && typeof webSynth.resume === "function") webSynth.resume();
  } catch {}
  try {
    if (speech && typeof speech.resume === "function") {
      await speech.resume();
      return true;
    }
  } catch {}
  try {
    const tts = getReactNativeTtsModule();
    if (tts && typeof tts.resume === "function") {
      await tts.resume();
      return true;
    }
  } catch {}
  return false;
};

export const canReactNativeTtsSpeakLocale = async (locale: string) => {
  const voices = await getReactNativeTtsVoices();
  return voices.some((voice) => !voice.notInstalled && matchesLocale(String(voice.language || ""), locale));
};
