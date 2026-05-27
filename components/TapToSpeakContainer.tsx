import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, Vibration, ViewStyle } from "react-native";
import { usePathname } from "expo-router";
import { useTeleprompter } from "../context/TeleprompterContext";
import { upsertAudioTextLookup } from "../utils/audioTextLookup";
import { getExpoSpeechModule, getWebSpeechSynthesis, resolveTtsLocale, speakWithResolvedVoice, stopResolvedSpeech } from "../utils/ttsSupport";

const Speech = getExpoSpeechModule();

type TapToSpeakContainerProps = {
  text: string;
  lang?: string;
  ttsHeader?: string;
  ttsSubheader?: string;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
};

const composeSpokenText = (text: string, header?: string, subheader?: string) => {
  const body = String(text || "").trim();
  if (!body) return "";
  const prefix = [String(header || "").trim(), String(subheader || "").trim()]
    .filter(Boolean)
    .join(". ");
  if (!prefix) return body;
  const normalizedBody = body.replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedPrefix = prefix.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalizedBody.startsWith(normalizedPrefix)) return body;
  return `${prefix}\n${body}`;
};

export default function TapToSpeakContainer({
  text,
  lang = "EN",
  ttsHeader,
  ttsSubheader,
  style,
  children,
}: TapToSpeakContainerProps) {
  const pathname = usePathname();
  const { registerAnchor, openTeleprompter, closeTeleprompter } = useTeleprompter();
  const anchorKeyRef = useRef(`taptts-${Math.random().toString(36).slice(2, 10)}`);
  const [speaking, setSpeaking] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const runIdRef = useRef(0);
  const spokenText = useMemo(
    () => composeSpokenText(text, ttsHeader, ttsSubheader),
    [text, ttsHeader, ttsSubheader]
  );
  const ttsLocale = useMemo(() => resolveTtsLocale(lang, spokenText), [lang, spokenText]);

  const stop = useCallback(() => {
    void stopResolvedSpeech(Speech);
    try {
      getWebSpeechSynthesis()?.cancel();
    } catch {}
    runIdRef.current += 1;
    setSpeaking(false);
    closeTeleprompter();
  }, [closeTeleprompter]);

  useEffect(() => {
    if (speaking) {
      pulseLoopRef.current?.stop();
      pulse.setValue(0);
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 850, useNativeDriver: true }),
        ])
      );
      pulseLoopRef.current.start();
      return;
    }
    pulseLoopRef.current?.stop();
    pulseLoopRef.current = null;
    Animated.timing(pulse, { toValue: 0, duration: 180, useNativeDriver: true }).start();
  }, [pulse, speaking]);

  useEffect(() => {
    return () => {
      pulseLoopRef.current?.stop();
      stop();
    };
  }, [stop]);

  const onToggle = useCallback(() => {
    if (!spokenText) return;
    if (speaking) {
      stop();
      return;
    }

    const webSynth = getWebSpeechSynthesis();
    const canSpeak = Platform.OS !== "web" || Boolean(Speech || webSynth);
    if (!canSpeak) return;

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setSpeaking(true);
    void openTeleprompter({
      anchorKey: anchorKeyRef.current,
      text: spokenText,
      speechRate: 1,
      pageKey: String(pathname || "/unknown"),
      playerKey: anchorKeyRef.current,
      kind: "tts",
    });
    upsertAudioTextLookup({
      pageKey: String(pathname || "/unknown"),
      playerKey: anchorKeyRef.current,
      kind: "tts",
      text: spokenText,
      source: "TapToSpeakContainer",
    });
    try {
      Vibration.vibrate(8);
    } catch {}

    const onDone = () => {
      if (runIdRef.current !== runId) return;
      setSpeaking(false);
    };

    try {
      if (Platform.OS !== "web" || Speech) {
        void speakWithResolvedVoice(Speech, lang, spokenText, {
          onDone,
          onStopped: onDone,
          onError: onDone,
        }).catch(onDone);
        return;
      }
      if (webSynth) {
        const WebUtterance =
          (globalThis as any)?.SpeechSynthesisUtterance ??
          (globalThis as any)?.window?.SpeechSynthesisUtterance;
        if (!WebUtterance) {
          onDone();
          return;
        }
        webSynth.cancel();
        const utterance = new WebUtterance(spokenText);
        utterance.lang = ttsLocale;
        utterance.onend = onDone;
        utterance.onerror = onDone;
        webSynth.speak(utterance);
      }
    } catch {
      onDone();
    }
  }, [spokenText, speaking, stop, ttsLocale]);

  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.012],
  });

  const animatedStyle = {
    transform: [{ scale }],
    borderColor: speaking ? "rgba(34,197,94,0.58)" : "transparent",
    borderWidth: speaking ? 1 : 0,
    backgroundColor: speaking ? "rgba(34,197,94,0.08)" : "transparent",
  };

  return (
    <Pressable
      ref={(node) => registerAnchor(anchorKeyRef.current, node)}
      onPress={onToggle}
    >
      <Animated.View style={[style as any, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}
