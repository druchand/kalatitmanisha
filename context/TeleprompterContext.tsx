import React from "react";
import { PanResponder, Platform, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useLanguage } from "./LanguageContext";
import { upsertAudioTextLookup } from "../utils/audioTextLookup";
import { getExpoSpeechModule, getSpeechSupportStatus, pauseResolvedSpeech, resumeResolvedSpeech, type SpeechSupportStatus } from "../utils/ttsSupport";

type TeleprompterStartOptions = {
  anchorKey?: string;
  anchorNode?: any;
  text: string;
  speechRate?: number;
  pageKey?: string;
  playerKey?: string;
  kind?: "tts" | "stream";
  preferredPlacement?: "auto" | "above" | "below";
};

type TeleprompterContextValue = {
  registerAnchor: (key: string, node: any) => void;
  openTeleprompter: (options: TeleprompterStartOptions) => Promise<void>;
  closeTeleprompter: () => void;
  isVisible: boolean;
};

const TeleprompterContext = React.createContext<TeleprompterContextValue | null>(null);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeText = (value: string) =>
  String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u2028\u2029]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ ]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

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
const describeLanguage = (langCode: string, t: (key: string) => string) => {
  const normalized = String(langCode || "").trim().toUpperCase();
  switch (normalized) {
    case "HI":
      return t("Hindi");
    case "GU":
      return t("Gujarati");
    case "TA":
      return t("Tamil");
    case "TE":
      return t("Telugu");
    case "BN":
      return t("Bengali");
    case "KN":
      return t("Kannada");
    case "ML":
      return t("Malayalam");
    case "MR":
      return t("Marathi");
    case "OR":
      return t("Odia");
    case "PA":
      return t("Punjabi");
    case "SA":
      return t("Sanskrit");
    case "UR":
      return t("Urdu");
    default:
      return t("English");
  }
};
const buildHumanReadableTtsStatus = (
  status: SpeechSupportStatus,
  t: (key: string) => string
) => {
  const selectedLanguage = describeLanguage(status.selectedLang, t);
  const textLanguage = describeLanguage(status.textLang, t);
  if (status.engine === "none") {
    if (status.selectedLang !== status.textLang) {
      return `${t("This text is in")} ${textLanguage}. ${t("No installed voice is available for it on this device.")}`;
    }
    return `${textLanguage} ${t("voice is not installed on this device.")}`;
  }
  if (status.selectedLang !== status.textLang) {
    return `${t("Reading")} ${textLanguage} ${t("text instead of the selected")} ${selectedLanguage} ${t("voice.")}`;
  }
  if (status.engine === "rn-tts") {
    return `${textLanguage} ${t("voice is using device fallback. Quality may vary.")}`;
  }
  if (status.engine === "browser") {
    return `${textLanguage} ${t("voice is using browser speech.")}`;
  }
  return `${textLanguage} ${t("voice is ready.")}`;
};

export function TeleprompterProvider({ children }: { children: React.ReactNode }) {
  const { lang, t } = useLanguage();
  const safeLang = React.useMemo(() => (typeof lang === "string" ? lang.toUpperCase() : "EN"), [lang]);
  const [ttsStatus, setTtsStatus] = React.useState<string>("Checking TTS…");
  const { width, height } = useWindowDimensions();
  const anchorMapRef = React.useRef<Record<string, any>>({});
  const [visible, setVisible] = React.useState(false);
  const [text, setText] = React.useState("");
  const [anchorRect, setAnchorRect] = React.useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [preferredPlacement, setPreferredPlacement] = React.useState<"auto" | "above" | "below">("auto");
  const [fontProgress, setFontProgress] = React.useState(0.42);
  const [speedFactor, setSpeedFactor] = React.useState(1);
  const [leadMs, setLeadMs] = React.useState(0);
  const [userBoxWidth, setUserBoxWidth] = React.useState<number | null>(null);
  const [userBoxHeight, setUserBoxHeight] = React.useState<number | null>(null);
  const [contentHeight, setContentHeight] = React.useState(0);
  const [wordIndex, setWordIndex] = React.useState(0);
  const [speechRate, setSpeechRate] = React.useState(1);
  const [paused, setPaused] = React.useState(false);
  const startAtRef = React.useRef(0);
  const pausedAtRef = React.useRef(0);
  const totalPausedMsRef = React.useRef(0);
  const scrollRef = React.useRef<ScrollView | null>(null);
  const speechModuleRef = React.useRef(getExpoSpeechModule());

  const registerAnchor = React.useCallback((key: string, node: any) => {
    const normalized = String(key || "").trim();
    if (!normalized) return;
    if (node) anchorMapRef.current[normalized] = node;
    else delete anchorMapRef.current[normalized];
  }, []);

  const readAnchor = React.useCallback(
    (anchorKey?: string, anchorNode?: any): Promise<{ x: number; y: number; width: number; height: number } | null> =>
      new Promise((resolve) => {
        const directNode = anchorNode || anchorMapRef.current[String(anchorKey || "").trim()];
        if (!directNode || typeof directNode.measureInWindow !== "function") {
          resolve(null);
          return;
        }
        try {
          directNode.measureInWindow((x: number, y: number, w: number, h: number) => {
            if ([x, y, w, h].every((n) => Number.isFinite(n)) && w > 0 && h > 0) {
              resolve({ x, y, width: w, height: h });
              return;
            }
            resolve(null);
          });
        } catch {
          resolve(null);
        }
      }),
    []
  );

  const closeTeleprompter = React.useCallback(() => {
    setVisible(false);
    setWordIndex(0);
    setPaused(false);
    pausedAtRef.current = 0;
    totalPausedMsRef.current = 0;
  }, []);

  const openTeleprompter = React.useCallback(
    async (options: TeleprompterStartOptions) => {
      const normalizedText = normalizeText(options.text);
      if (!normalizedText) return;
      const rect = await readAnchor(options.anchorKey, options.anchorNode);
      setText(normalizedText);
      setAnchorRect(rect);
      setPreferredPlacement(options.preferredPlacement || "auto");
      setSpeechRate(clamp(Number(options.speechRate || 1), 0.4, 2));
      setWordIndex(0);
      setPaused(false);
      startAtRef.current = Date.now();
      pausedAtRef.current = 0;
      totalPausedMsRef.current = 0;
      setVisible(true);

      if (options.pageKey && options.playerKey) {
        upsertAudioTextLookup({
          pageKey: options.pageKey,
          playerKey: options.playerKey,
          kind: options.kind || "tts",
          text: normalizedText,
          source: "teleprompter",
        });
      }
    },
    [readAnchor]
  );

  const fontSize = React.useMemo(() => Math.round(13 + fontProgress * 13), [fontProgress]);
  const baseBoxHeight = React.useMemo(() => {
    const targetLines = 10 - fontProgress * 4;
    const lineHeight = fontSize * 1.26;
    return Math.round(clamp(lineHeight * targetLines + 82, 210, 360));
  }, [fontProgress, fontSize]);
  const baseBoxWidth = React.useMemo(() => Math.round(clamp(300, 300, width - 12)), [width]);
  const boxWidth = React.useMemo(
    () => Math.round(clamp(userBoxWidth ?? baseBoxWidth, 280, width - 12)),
    [baseBoxWidth, userBoxWidth, width]
  );
  const boxHeight = React.useMemo(
    () => Math.round(clamp(userBoxHeight ?? baseBoxHeight, 210, height - 20)),
    [baseBoxHeight, height, userBoxHeight]
  );
  const textViewportHeight = React.useMemo(() => Math.max(120, boxHeight - 126), [boxHeight]);
  const textViewportWidth = React.useMemo(() => boxWidth - 20, [boxWidth]);
  const startInset = React.useMemo(() => Math.round(textViewportHeight * 0.66), [textViewportHeight]);
  const tokens = React.useMemo(() => tokenizeTeleprompterText(text), [text]);
  const wordCount = React.useMemo(
    () => tokens.reduce((count, token) => count + (token.type === "word" ? 1 : 0), 0),
    [tokens]
  );
  const durationMs = React.useMemo(() => {
    const effectiveWordCount = Math.max(1, wordCount);
    const effective = clamp(speechRate * speedFactor, 0.35, 3.5);
    return Math.max(2600, Math.round((effectiveWordCount * 360) / effective));
  }, [speechRate, speedFactor, wordCount]);

  React.useEffect(() => {
    if (!visible || !wordCount || paused) return;
    if (!startAtRef.current) startAtRef.current = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startAtRef.current - totalPausedMsRef.current;
      const progress = clamp((elapsed + leadMs) / Math.max(1, durationMs), 0, 1);
      const nextWord = Math.min(Math.max(0, wordCount - 1), Math.floor(progress * wordCount));
      setWordIndex(nextWord);
    }, 80);
    return () => clearInterval(timer);
  }, [durationMs, leadMs, paused, visible, wordCount]);

  React.useEffect(() => {
    if (!visible || !wordCount) return;
    const maxScroll = Math.max(0, contentHeight - textViewportHeight);
    if (maxScroll <= 0) return;
    const progress = wordCount <= 1 ? 0 : wordIndex / (wordCount - 1);
    scrollRef.current?.scrollTo({ y: Math.round(maxScroll * progress), animated: true });
  }, [contentHeight, textViewportHeight, visible, wordCount, wordIndex]);

  const layout = React.useMemo(() => {
    const margin = 8;
    const fallbackTop = 86;
    const fallbackLeft = Math.round((width - boxWidth) / 2);
    if (!anchorRect) {
      return {
        top: clamp(fallbackTop, margin, Math.max(margin, height - boxHeight - margin)),
        left: clamp(fallbackLeft, margin, Math.max(margin, width - boxWidth - margin)),
      };
    }
    const centeredLeft = Math.round(anchorRect.x + anchorRect.width / 2 - boxWidth / 2);
    const left = clamp(centeredLeft, margin, Math.max(margin, width - boxWidth - margin));
    const canRenderAbove = anchorRect.y > boxHeight + margin + 6;
    const renderBelow = preferredPlacement === "below";
    const renderAbove = preferredPlacement === "above";
    const top = renderBelow
      ? anchorRect.y + anchorRect.height + 6
      : renderAbove
      ? anchorRect.y - boxHeight - 6
      : canRenderAbove
      ? anchorRect.y - boxHeight - 6
      : anchorRect.y + anchorRect.height + 6;
    return {
      top: clamp(top, margin, Math.max(margin, height - boxHeight - margin)),
      left,
    };
  }, [anchorRect, boxHeight, boxWidth, height, preferredPlacement, width]);

  const resizeStartRef = React.useRef<{ width: number; height: number } | null>(null);
  const resizePanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          resizeStartRef.current = { width: boxWidth, height: boxHeight };
        },
        onPanResponderMove: (_, gestureState) => {
          const start = resizeStartRef.current;
          if (!start) return;
          const maxWidth = Math.max(280, width - layout.left - 8);
          const maxHeight = Math.max(210, height - layout.top - 8);
          setUserBoxWidth(clamp(Math.round(start.width + gestureState.dx), 280, maxWidth));
          setUserBoxHeight(clamp(Math.round(start.height + gestureState.dy), 210, maxHeight));
        },
        onPanResponderRelease: () => {
          resizeStartRef.current = null;
        },
        onPanResponderTerminate: () => {
          resizeStartRef.current = null;
        },
      }),
    [boxHeight, boxWidth, height, layout.left, layout.top, width]
  );

  React.useEffect(() => {
    let cancelled = false;
    setTtsStatus("Checking TTS...");
    (async () => {
      try {
        const status = await getSpeechSupportStatus(safeLang, text);
        if (cancelled) return;
        if (__DEV__) {
          console.debug("[teleprompter][tts]", {
            selectedLang: status.selectedLang,
            selectedLocale: status.selectedLocale,
            textLang: status.textLang,
            textLocale: status.textLocale,
            engine: status.engine,
            voiceName: status.voiceName,
            voiceId: status.voiceId,
            reason: status.reason,
            rawStatus: status.status,
          });
        }
        setTtsStatus(buildHumanReadableTtsStatus(status, t));
      } catch (err: any) {
        if (cancelled) return;
        const message = typeof err?.message === "string" ? err.message : "unknown";
        if (__DEV__) {
          console.debug("[teleprompter][tts][error]", message);
        }
        setTtsStatus(t("Speech status could not be checked."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeLang, t, text]);

  const togglePaused = React.useCallback(async () => {
    if (!visible) return;
    if (paused) {
      if (pausedAtRef.current > 0) {
        totalPausedMsRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = 0;
      }
      await resumeResolvedSpeech(speechModuleRef.current);
      setPaused(false);
      return;
    }
    pausedAtRef.current = Date.now();
    await pauseResolvedSpeech(speechModuleRef.current);
    setPaused(true);
  }, [paused, visible]);

  const adjustFontProgress = React.useCallback((delta: number) => {
    setFontProgress((current) => clamp(Number((current + delta).toFixed(2)), 0, 1));
  }, []);

  const adjustSpeedFactor = React.useCallback((delta: number) => {
    setSpeedFactor((current) => clamp(Number((current + delta).toFixed(2)), 0.5, 2));
  }, []);

  const value = React.useMemo(
    () => ({ registerAnchor, openTeleprompter, closeTeleprompter, isVisible: visible }),
    [closeTeleprompter, openTeleprompter, registerAnchor, visible]
  );

  return (
    <TeleprompterContext.Provider value={value}>
      {children}
      {visible ? (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            top: layout.top,
            left: layout.left,
            width: boxWidth,
            height: boxHeight,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "rgba(15,23,42,0.24)",
            backgroundColor: "rgba(255,255,255,0.98)",
            paddingTop: 14,
            paddingLeft: 8,
            paddingRight: 12,
            paddingBottom: 6,
            shadowColor: "#0f172a",
            shadowOpacity: 0.22,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
            zIndex: 2000,
          }}
        >
          <TouchableOpacity
            onPress={togglePaused}
            style={{
              position: "absolute",
              right: 36,
              top: 6,
              zIndex: 5,
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "rgba(15,23,42,0.28)",
              backgroundColor: "rgba(255,255,255,0.95)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#0f172a", fontSize: 12, fontWeight: "800", lineHeight: 14 }}>
              {paused ? ">" : "||"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={closeTeleprompter}
            style={{
              position: "absolute",
              right: 6,
              top: 6,
              zIndex: 5,
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "rgba(15,23,42,0.28)",
              backgroundColor: "rgba(255,255,255,0.95)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#0f172a", fontSize: 14, fontWeight: "800", lineHeight: 16 }}>X</Text>
          </TouchableOpacity>
          <View style={{ marginTop: 2, marginRight: 62, paddingLeft: 2 }}>
            <Text
              style={{ color: "#0f172a", fontSize: 10, fontWeight: "700" }}
              numberOfLines={2}
            >
              {ttsStatus || "Checking TTS..."}
            </Text>
          </View>
          <View
            style={{
              marginTop: 8,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              paddingHorizontal: 2,
            }}
          >
            <View style={{ flex: 1, marginRight: 4 }}>
              <Text style={{ color: "#475569", fontSize: 9, fontWeight: "700", marginBottom: 4 }}>
                {t("Font")}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <TouchableOpacity
                  onPress={() => adjustFontProgress(-0.12)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "rgba(15,23,42,0.2)",
                    backgroundColor: "rgba(255,255,255,0.96)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#0f172a", fontSize: 14, fontWeight: "800" }}>-</Text>
                </TouchableOpacity>
                <Text
                  style={{
                    flex: 1,
                    textAlign: "center",
                    color: "#0f172a",
                    fontSize: 11,
                    fontWeight: "700",
                  }}
                >
                  {fontSize}
                </Text>
                <TouchableOpacity
                  onPress={() => adjustFontProgress(0.12)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "rgba(15,23,42,0.2)",
                    backgroundColor: "rgba(255,255,255,0.96)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#0f172a", fontSize: 14, fontWeight: "800" }}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ flex: 1, marginLeft: 4 }}>
              <Text style={{ color: "#475569", fontSize: 9, fontWeight: "700", marginBottom: 4 }}>
                {t("Speed")}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <TouchableOpacity
                  onPress={() => adjustSpeedFactor(-0.1)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "rgba(15,23,42,0.2)",
                    backgroundColor: "rgba(255,255,255,0.96)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#0f172a", fontSize: 14, fontWeight: "800" }}>-</Text>
                </TouchableOpacity>
                <Text
                  style={{
                    flex: 1,
                    textAlign: "center",
                    color: "#0f172a",
                    fontSize: 11,
                    fontWeight: "700",
                  }}
                >
                  {`${speedFactor.toFixed(1)}x`}
                </Text>
                <TouchableOpacity
                  onPress={() => adjustSpeedFactor(0.1)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "rgba(15,23,42,0.2)",
                    backgroundColor: "rgba(255,255,255,0.96)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#0f172a", fontSize: 14, fontWeight: "800" }}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          <View
            style={{
              marginTop: 8,
              height: textViewportHeight,
              borderRadius: 8,
              backgroundColor: "rgba(15,23,42,0.03)",
              overflow: "hidden",
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}
          >
            <ScrollView
              ref={scrollRef}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={(_, h) => {
                const next = Math.ceil(h);
                if (next > 0 && next !== contentHeight) setContentHeight(next);
              }}
              contentContainerStyle={{ paddingTop: startInset, paddingBottom: 8 }}
            >
              <Text
                style={{
                  width: textViewportWidth - 12,
                  color: "#64748b",
                  fontSize,
                  lineHeight: Math.round(fontSize * 1.26),
                  fontWeight: "600",
                }}
              >
                {(() => {
                  let seenWordIndex = -1;
                  return tokens.map((token, idx) => {
                    if (token.type === "newline") {
                      return (
                        <Text key={`tpn-${idx}`}>
                          {token.value === "\n\n" ? "\n\u00A0\n" : "\n"}
                        </Text>
                      );
                    }
                    seenWordIndex += 1;
                    const isCurrent = seenWordIndex === wordIndex;
                    const isDone = seenWordIndex < wordIndex;
                    const nextToken = tokens[idx + 1];
                    return (
                      <Text
                        key={`tpw-${idx}`}
                        style={{
                          color: isCurrent ? "#0f172a" : isDone ? "#1d4ed8" : "#64748b",
                          backgroundColor: isCurrent ? "rgba(14,165,233,0.24)" : "transparent",
                          fontWeight: isCurrent ? "800" : isDone ? "700" : "600",
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
          <View
            {...resizePanResponder.panHandlers}
            style={{
              position: "absolute",
              right: 4,
              bottom: 4,
              width: 24,
              height: 24,
              alignItems: "center",
              justifyContent: "center",
              zIndex: 6,
            }}
          >
            <Text
              style={{
                color: "rgba(15,23,42,0.38)",
                fontSize: 16,
                fontWeight: "800",
                lineHeight: 16,
              }}
            >
              ⤡
            </Text>
          </View>
        </View>
      ) : null}
    </TeleprompterContext.Provider>
  );
}

export function useTeleprompter() {
  const ctx = React.useContext(TeleprompterContext);
  if (!ctx) {
    throw new Error("useTeleprompter must be used within TeleprompterProvider");
  }
  return ctx;
}
