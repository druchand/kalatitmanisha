import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { usePathname } from "expo-router";
import AppIcon from "./AppIcon";
import { useTeleprompter } from "../context/TeleprompterContext";
import { upsertAudioTextLookup } from "../utils/audioTextLookup";
import { getExpoSpeechModule, getWebSpeechSynthesis, resolveTtsLocale, speakWithResolvedVoice, stopResolvedSpeech } from "../utils/ttsSupport";

const Speech = getExpoSpeechModule();

type InlineTtsButtonProps = {
  text: string;
  lang?: string;
  ttsHeader?: string;
  ttsSubheader?: string;
  playLabel?: string;
  pauseLabel?: string;
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

export default function InlineTtsButton({
  text,
  lang = "EN",
  ttsHeader,
  ttsSubheader,
  playLabel = "Play",
  pauseLabel = "Pause",
}: InlineTtsButtonProps) {
  const pathname = usePathname();
  const { registerAnchor, openTeleprompter, closeTeleprompter } = useTeleprompter();
  const anchorKeyRef = useRef(`inlinetts-${Math.random().toString(36).slice(2, 10)}`);
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<any>(null);
  const spokenText = useMemo(
    () => composeSpokenText(text, ttsHeader, ttsSubheader),
    [text, ttsHeader, ttsSubheader]
  );
  const ttsLocale = useMemo(() => resolveTtsLocale(lang, spokenText), [lang, spokenText]);

  const stop = useCallback(() => {
    setSpeaking(false);
    void stopResolvedSpeech(Speech);
    const webSynth = getWebSpeechSynthesis();
    if (webSynth) {
      try {
        webSynth.cancel();
      } catch {}
    }
    utteranceRef.current = null;
    closeTeleprompter();
  }, [closeTeleprompter]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  const onToggle = useCallback(() => {
    if (!spokenText) return;
    if (speaking) {
      stop();
      return;
    }

    if (Platform.OS !== "web" || Speech) {
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
        source: "InlineTtsButton",
      });
      try {
        void speakWithResolvedVoice(Speech, lang, spokenText, {
          onDone: () => setSpeaking(false),
          onStopped: () => setSpeaking(false),
          onError: () => setSpeaking(false),
        }).catch(() => setSpeaking(false));
        return;
      } catch {
        setSpeaking(false);
      }
    }

    const webSynth = getWebSpeechSynthesis();
    if (!webSynth) return;
    try {
      const WebUtterance =
        (globalThis as any)?.SpeechSynthesisUtterance ??
        (globalThis as any)?.window?.SpeechSynthesisUtterance;
      if (!WebUtterance) return;
      webSynth.cancel();
      const utterance = new WebUtterance(spokenText);
      utterance.lang = ttsLocale;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      utteranceRef.current = utterance;
      setSpeaking(true);
      void openTeleprompter({
        anchorKey: anchorKeyRef.current,
        text: spokenText,
        speechRate: 1,
        pageKey: String(pathname || "/unknown"),
        playerKey: anchorKeyRef.current,
        kind: "tts",
      });
      webSynth.speak(utterance);
    } catch {
      setSpeaking(false);
    }
  }, [spokenText, speaking, stop, ttsLocale]);

  if (!spokenText) return null;

  return (
    <Pressable
      ref={(node) => registerAnchor(anchorKeyRef.current, node)}
      onPress={onToggle}
      className="mt-2 flex-row items-center self-start rounded-full border border-slate-300 bg-white px-3 py-1.5"
    >
      <AppIcon family="ion" name={speaking ? "pause" : "play"} size={14} color="#0f172a" />
      <Text className="ml-1.5 text-sm font-semibold text-slate-800">{speaking ? pauseLabel : playLabel}</Text>
      <View className={`ml-2 h-2 w-2 rounded-full ${speaking ? "bg-emerald-500" : "bg-slate-300"}`} />
    </Pressable>
  );
}
