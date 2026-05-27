import React from 'react';
import { View, TouchableOpacity, useWindowDimensions, Image, Platform, Vibration, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../auth/AuthModalContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTeleprompter } from '../../context/TeleprompterContext';
import { guardProtectedNavigation } from '../../utils/routeAccess';
import { upsertAudioTextLookup } from '../../utils/audioTextLookup';
import { getExpoSpeechModule, resolveTtsLocale, speakWithResolvedVoice, stopResolvedSpeech } from '../../utils/ttsSupport';
import { APP_LOGO_IMAGE } from '../../utils/logoAssets';
import AppIcon from '../AppIcon';

type FooterProps = {
  onMenuPress?: () => void;
  menuOpen?: boolean;
};

const Speech = getExpoSpeechModule();

const Footer = ({
  onMenuPress,
  menuOpen = false,
}: FooterProps) => {
  const { width } = useWindowDimensions();
  const isCompactFooter = width < 768;
  const router = useRouter();
  const auth = useAuth();
  const { lang, t } = useLanguage();
  const { registerAnchor, openTeleprompter, closeTeleprompter } = useTeleprompter();
  const controlNodeMapRef = React.useRef<Record<string, any>>({});
  const longPressTriggeredRef = React.useRef(false);

  const ttsLocale = React.useMemo(() => {
    const code = String(lang || "EN").trim().toUpperCase();
    if (code === "HI" || code === "SA") return "hi-IN";
    if (code === "TA") return "ta-IN";
    return "en-US";
  }, [lang]);

  const speakLabel = React.useCallback((anchorKey: string, label: string) => {
    const text = String(label || "").trim();
    if (!text) return;
    const playerKey = String(anchorKey || "").trim() || `footer-${text.toLowerCase().replace(/\s+/g, "-")}`;
    void openTeleprompter({
      anchorKey: playerKey,
      text,
      speechRate: 1,
      pageKey: "_footer",
      playerKey,
      kind: "tts",
    });
    upsertAudioTextLookup({
      pageKey: "_footer",
      playerKey,
      kind: "tts",
      text,
      source: "Footer",
    });
    if (Platform.OS !== "web" || Speech) {
      try {
        void stopResolvedSpeech(Speech);
        void speakWithResolvedVoice(Speech, lang, text, {
          onDone: () => closeTeleprompter(),
          onStopped: () => closeTeleprompter(),
          onError: () => closeTeleprompter(),
        }).catch(() => closeTeleprompter());
        return;
      } catch {}
    }
    if (Platform.OS === "web") {
      try {
        const webWindow = (globalThis as any)?.window;
        const synth = webWindow?.speechSynthesis ?? (globalThis as any)?.speechSynthesis;
        const Utterance = webWindow?.SpeechSynthesisUtterance;
        if (!synth || !Utterance) return;
        synth.cancel();
        const utterance = new Utterance(text);
        utterance.lang = ttsLocale;
        utterance.onend = () => closeTeleprompter();
        utterance.onerror = () => closeTeleprompter();
        synth.speak(utterance);
      } catch {}
    }
  }, [closeTeleprompter, openTeleprompter, ttsLocale]);

  const setControlNodeRef = React.useCallback((key: string, node: any) => {
    const normalized = String(key || "").trim();
    if (!normalized) return;
    if (node) {
      controlNodeMapRef.current[normalized] = node;
      registerAnchor(normalized, node);
    } else {
      delete controlNodeMapRef.current[normalized];
      registerAnchor(normalized, null);
    }
  }, [registerAnchor]);

  const triggerHaptic = React.useCallback(() => {
    if (Platform.OS === "web") return;
    try {
      Vibration.vibrate(8);
    } catch {}
  }, []);

  const withAssistivePress = React.useCallback(
    (anchorKey: string, label: string, onTap: () => void) => ({
      onPressIn: triggerHaptic,
      delayLongPress: 320,
      onLongPress: () => {
        longPressTriggeredRef.current = true;
        speakLabel(anchorKey, label);
      },
      onPress: () => {
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          return;
        }
        onTap();
      },
    }),
    [speakLabel, triggerHaptic]
  );

  const footerHomeLink = {
    path: '/home',
    icon: { family: "feather" as const, name: "home" },
  };

  return (
    <View className={`flex-shrink-0 ${isCompactFooter ? "px-2 py-1.5" : "px-4 md:px-6"}`}>
      <View className="relative">
        <View className={`flex flex-row items-center justify-center ${isCompactFooter ? "px-2 py-1.5" : "px-4 py-3"}`}>
          <View className={`w-full flex flex-row items-end justify-between ${isCompactFooter ? "gap-1.5" : "gap-3"}`}>
            <View className="items-center" style={{ width: 58 }}>
              <TouchableOpacity
                ref={(node) => setControlNodeRef("footer-home", node)}
                {...withAssistivePress("footer-home", t("Home"), () => {
                  guardProtectedNavigation({
                    targetPath: footerHomeLink.path,
                    sessionId: auth.sessionId,
                    openLogin: auth.openLogin,
                    onAllowed: () => router.push(footerHomeLink.path as any),
                  });
                })}
                className="items-center justify-center h-16 w-16"
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "#cbd5e1",
                  backgroundColor: "#f8fafc",
                }}
              >
                <AppIcon family={footerHomeLink.icon.family} name={footerHomeLink.icon.name} size={24} color="#0f172a" />
              </TouchableOpacity>
              <View style={{ marginTop: 6 }}>
                <Text className="text-[11px] font-semibold text-slate-700 text-center">{t("Home")}</Text>
              </View>
            </View>
            <View style={{ width: 58 }} />
            <View style={{ width: 58 }} />
            <View className="items-center" style={{ width: 58 }}>
              <TouchableOpacity
                ref={(node) => setControlNodeRef("footer-menu", node)}
                {...withAssistivePress("footer-menu", t("Menu"), () => {
                  if (typeof onMenuPress === "function") onMenuPress();
                })}
                className="items-center justify-center h-16 w-16"
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: menuOpen ? "#7dd3fc" : "#cbd5e1",
                  backgroundColor: menuOpen ? "rgba(14,165,233,0.12)" : "#f8fafc",
                }}
              >
                <AppIcon family="feather" name={menuOpen ? "x" : "menu"} size={22} color="#0f172a" />
              </TouchableOpacity>
              <View style={{ marginTop: 6 }}>
                <Text className="text-[11px] font-semibold text-slate-700 text-center">{t("Menu")}</Text>
              </View>
            </View>
          </View>
        </View>
        <View
          pointerEvents="box-none"
          className="absolute items-center justify-center rounded-full"
          style={{
            left: "50%",
            top: -4,
            width: 74,
            height: 74,
            transform: [{ translateX: -37 }],
            zIndex: 20,
          }}
        >
          <TouchableOpacity
            ref={(node) => setControlNodeRef("footer-ai-chat", node)}
            {...withAssistivePress("footer-ai-chat", t("AI Chat"), () => router.push("/aichat"))}
            accessibilityLabel="AI Chat"
            className="h-16 w-16 items-center justify-center rounded-full bg-white/20 shadow-lg"
            style={{
              borderWidth: 1,
              borderColor: "rgba(0,0,0,0.25)",
            }}
          >
            <Image
              source={APP_LOGO_IMAGE}
              style={{ width: 58, height: 58, borderRadius: 999 }}
              resizeMode="cover"
            />
          </TouchableOpacity>
          <View style={{ position: "absolute", top: 72, width: 90, alignItems: "center" }}>
            <Text className="text-[11px] font-semibold text-slate-700 text-center">{t("AI Chat")}</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

export default Footer;
