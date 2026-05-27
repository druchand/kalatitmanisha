import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  Vibration,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "../auth/AuthModalContext";
import { useLanguage } from "../context/LanguageContext";
import { useTeleprompter } from "../context/TeleprompterContext";
import { guardProtectedNavigation } from "../utils/routeAccess";
import { upsertAudioTextLookup } from "../utils/audioTextLookup";
import { getExpoSpeechModule, resolveTtsLocale, speakWithResolvedVoice, stopResolvedSpeech } from "../utils/ttsSupport";
import { functionUrl } from "../utils/functionApi";
import PageBottomMeta from "../components/layout/PageBottomMeta";

const MY_FAVOURATES_ENDPOINT = functionUrl("GitaMyFavourites");

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

type FavourateItem = {
  recordId: string;
  pageId: string;
  pagePath?: string;
  chapter?: number | null;
  verse?: number | null;
  dilemmaId?: string;
  sanskritLabel?: string;
  dilemmaLabel?: string;
  commentText?: string;
  like?: boolean;
  bookmark?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

function parseResponsePayload(raw: string): any {
  const parsed = raw ? JSON.parse(raw) : {};
  if (parsed?.body && typeof parsed.body === "string") {
    return JSON.parse(parsed.body);
  }
  return parsed?.body ?? parsed ?? {};
}

function derivePathFromPageId(pageId: string): string {
  const raw = String(pageId || "").trim();
  if (!raw) return "/home";
  if (raw.startsWith("/")) {
    return raw.split("?")[0] || "/home";
  }
  try {
    const url = new URL(raw);
    return String(url.pathname || "/home");
  } catch {
    const cleaned = raw.replace(/^\/+|\/+$/g, "");
    return cleaned ? `/${cleaned}` : "/home";
  }
}

function normalizePath(pathname: string): string {
  const raw = String(pathname || "").trim().toLowerCase();
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  if (!normalized || normalized === "/" || normalized === "/index") return "/home";
  if (normalized === "/gitaverse" || normalized === "/gitaverse/") return "/gitaverse";
  return normalized;
}

function isGitaVersePath(pathname: string): boolean {
  return normalizePath(pathname).toLowerCase() === "/gitaverse";
}

function isDilemmaPath(pathname: string): boolean {
  return normalizePath(pathname) === "/dilemma";
}

function deriveRouteFromPageId(pageId: string): { pathname: string; params: Record<string, string> } {
  const raw = String(pageId || "").trim();
  if (!raw) return { pathname: "/home", params: {} };
  if (raw.startsWith("/")) {
    const [pathPart, queryPart = ""] = raw.split("?");
    const params: Record<string, string> = {};
    const search = new URLSearchParams(queryPart);
    search.forEach((value, key) => {
      params[key] = value;
    });
    const pathname = normalizePath(pathPart || "/home");
    if (isGitaVersePath(pathname)) {
      const nextParams: Record<string, string> = {};
      if (params.chapter) nextParams.chapter = params.chapter;
      if (params.verse) nextParams.verse = params.verse;
      return { pathname: "/gitaverse", params: nextParams };
    }
    if (isDilemmaPath(pathname)) {
      return { pathname: "/dilemma", params: params.id ? { id: params.id } : {} };
    }
    return { pathname, params: {} };
  }
  try {
    const url = new URL(raw);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    const pathname = normalizePath(String(url.pathname || "/home"));
    if (isGitaVersePath(pathname)) {
      const nextParams: Record<string, string> = {};
      if (params.chapter) nextParams.chapter = params.chapter;
      if (params.verse) nextParams.verse = params.verse;
      return { pathname: "/gitaverse", params: nextParams };
    }
    if (isDilemmaPath(pathname)) {
      return { pathname: "/dilemma", params: params.id ? { id: params.id } : {} };
    }
    return { pathname, params: {} };
  } catch {
    return { pathname: normalizePath(raw), params: {} };
  }
}

function toPageName(pathname: string, homeLabel = "Home"): string {
  const normalized = normalizePath(pathname);
  if (!normalized || normalized === "/") return homeLabel;
  const cleaned = normalized.replace(/^\/+|\/+$/g, "");
  if (!cleaned) return homeLabel;
  const words = cleaned
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  return words.join(" ");
}

export default function MyFavourates() {
  const router = useRouter();
  const auth = useAuth();
  const { lang, t } = useLanguage();
  const { width } = useWindowDimensions();
  const safeLang = useMemo(() => String(lang || "EN").toUpperCase(), [lang]);
  const [items, setItems] = useState<FavourateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const speechRef = React.useRef<ExpoSpeechModule | null>(null);
  const controlNodeMapRef = React.useRef<Record<string, any>>({});
  const activeTtsKeyRef = React.useRef<string | null>(null);
  const ttsRunIdRef = React.useRef(0);
  const longPressTriggeredRef = React.useRef(false);
  const { registerAnchor, openTeleprompter, closeTeleprompter } = useTeleprompter();
  const tileSize = width < 768 ? 104 : 120;

  useEffect(() => {
    speechRef.current = getExpoSpeechModule();
  }, []);

  const stopTts = useCallback(() => {
    ttsRunIdRef.current += 1;
    activeTtsKeyRef.current = null;
    void stopResolvedSpeech(speechRef.current);
    if (Platform.OS === "web") {
      try {
        (globalThis as any)?.speechSynthesis?.cancel?.();
      } catch {}
    }
    closeTeleprompter();
  }, [closeTeleprompter]);

  const setControlNodeRef = useCallback(
    (key: string, node: any) => {
      const normalized = String(key || "").trim();
      if (!normalized) return;
      if (node) {
        controlNodeMapRef.current[normalized] = node;
        registerAnchor(normalized, node);
      } else {
        delete controlNodeMapRef.current[normalized];
        registerAnchor(normalized, null);
      }
    },
    [registerAnchor]
  );

  const speakLabel = useCallback(
    (key: string, text: string, anchorKey = key) => {
      const normalized = String(text || "").replace(/\s+/g, " ").trim();
      if (!normalized) return;
      if (activeTtsKeyRef.current === key) {
        stopTts();
        return;
      }
      stopTts();
      const runId = ttsRunIdRef.current + 1;
      ttsRunIdRef.current = runId;
      activeTtsKeyRef.current = key;
      void openTeleprompter({
        anchorKey,
        text: normalized,
        speechRate: 1,
        pageKey: "/myfavourates",
        playerKey: key,
        kind: "tts",
      });
      upsertAudioTextLookup({
        pageKey: "/myfavourates",
        playerKey: key,
        kind: "tts",
        text: normalized,
        source: "MyFavourates",
      });
      const done = () => {
        if (ttsRunIdRef.current !== runId) return;
        activeTtsKeyRef.current = null;
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
        if (!synth || !Utterance) {
          done();
          return;
        }
        const utterance = new Utterance(normalized);
        utterance.lang = resolveTtsLocale(safeLang, normalized);
        utterance.onend = done;
        utterance.onerror = done;
        synth.speak(utterance);
        return;
      }

      done();
    },
    [openTeleprompter, safeLang, stopTts]
  );

  useEffect(() => {
    return () => {
      stopTts();
    };
  }, [stopTts]);

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
        speakLabel(`fav-tile-${key}`, normalizedLabel, `fav-tile-${key}`);
      },
      onPress: () => {
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          return;
        }
        onTap();
      },
    }),
    [speakLabel, triggerTileHaptic]
  );

  const fetchItems = useCallback(async (isRefresh = false) => {
    if (!auth.sessionId) {
      setItems([]);
      setError(t("Guest mode is active. Sign in to view your favourites."));
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const url = new URL(MY_FAVOURATES_ENDPOINT);
      url.searchParams.set("sessionId", auth.sessionId);
      url.searchParams.set("session", auth.sessionId);
      const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = parseResponsePayload(raw);
      const list = Array.isArray(payload?.items) ? payload.items : [];
      setItems(
        list.map((entry: any) => ({
          recordId: String(entry?.recordId || ""),
          pageId: String(entry?.pageId || ""),
          pagePath: String(entry?.pagePath || ""),
          chapter: typeof entry?.chapter === "number" ? entry.chapter : null,
          verse: typeof entry?.verse === "number" ? entry.verse : null,
          dilemmaId: String(entry?.dilemmaId || ""),
          sanskritLabel: String(entry?.sanskritLabel || ""),
          dilemmaLabel: String(entry?.dilemmaLabel || ""),
          commentText: String(entry?.commentText || entry?.CommentText || ""),
          like: Boolean(entry?.like),
          bookmark: Boolean(entry?.bookmark ?? entry?.star),
          createdAt: entry?.createdAt ?? null,
          updatedAt: entry?.updatedAt ?? null,
        }))
      );
    } catch (err: any) {
      setError(err?.message || t("Unable to load favourites."));
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [auth.sessionId, t]);

  useEffect(() => {
    fetchItems(false);
  }, [fetchItems]);

  const groupedItems = useMemo(() => {
    const dilemma: FavourateItem[] = [];
    const gitaVerses: FavourateItem[] = [];
    const other: FavourateItem[] = [];
    items.forEach((item) => {
      const path = normalizePath(derivePathFromPageId(item.pageId));
      if (isDilemmaPath(path)) {
        dilemma.push(item);
        return;
      }
      if (isGitaVersePath(path)) {
        gitaVerses.push(item);
        return;
      }
      other.push(item);
    });
    return { dilemma, gitaVerses, other };
  }, [items]);

  const openItem = useCallback((item: FavourateItem) => {
    const { pathname, params } = deriveRouteFromPageId(item.pageId);
    const chapter = params.chapter;
    const verse = params.verse;
    guardProtectedNavigation({
      targetPath: pathname || "/home",
      sessionId: auth.sessionId,
      openLogin: auth.openLogin,
      onAllowed: () => {
        if (pathname === "/gitaverse" && chapter && verse) {
          router.push({
            pathname: "/gitaverse",
            params: { chapter, verse, lang: safeLang },
          });
          return;
        }
        if (pathname === "/dilemma" && params.id) {
          router.push({ pathname: "/dilemma", params: { id: params.id } });
          return;
        }
        router.push(pathname as any);
      },
    });
  }, [auth.openLogin, auth.sessionId, router, safeLang]);

  return (
    <ScrollView
      className="flex-1 bg-slate-50 px-4 py-5"
      contentContainerStyle={{ paddingBottom: 42 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => fetchItems(true)} />
      }
    >
      <View className="mb-4">
        <Text className="text-2xl font-bold text-slate-900">{t("Favourites")}</Text>
        <Text className="mt-1 text-sm text-slate-500">
          {t("Pages you liked and bookmarked.")}
        </Text>
      </View>

      {loading ? (
        <View className="items-center py-10">
          <ActivityIndicator size="small" color="#334155" />
          <Text className="mt-2 text-sm text-slate-500">{t("Loading your list...")}</Text>
        </View>
      ) : error ? (
        <View className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
          <Text className="text-sm text-rose-700">{error}</Text>
          {!auth.sessionId ? (
            <TouchableOpacity
              onPress={() =>
                auth.promptRestrictedAction(
                  t("You need to sign up or sign in to view favourites."),
                  "signup"
                )
              }
              activeOpacity={0.85}
              className="mt-3 self-start rounded-full border border-rose-300 bg-white px-3 py-2"
            >
              <Text className="text-xs font-semibold text-rose-700">{t("Sign up to continue")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : items.length === 0 ? (
        <View className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <Text className="text-sm text-slate-600">{t("No liked or bookmarked pages yet.")}</Text>
        </View>
      ) : (
        <View className="gap-4">
          {groupedItems.dilemma.length ? (
            <View className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
              <Text className="mb-3 text-sm font-bold text-slate-800">{t("Dilemma")}</Text>
              <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                {groupedItems.dilemma.map((item) => {
                  const label = String(item.dilemmaLabel || "").trim();
                  return (
                    <TouchableOpacity
                      key={item.recordId || item.pageId}
                      ref={(node) => setControlNodeRef(`fav-tile-dilemma-${item.recordId || item.pageId}`, node)}
                      {...withTileAssistivePress(
                        `dilemma-${item.recordId || item.pageId}`,
                        label || t("Label unavailable"),
                        () => openItem(item)
                      )}
                      activeOpacity={0.85}
                      className="rounded-xl border border-slate-300 bg-slate-100 items-center justify-center"
                      style={{ width: tileSize, height: tileSize, paddingHorizontal: 8, paddingVertical: 10 }}
                    >
                      <Text className="text-xs font-semibold text-slate-800 text-center" numberOfLines={3}>
                        {label || t("Label unavailable")}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {groupedItems.gitaVerses.length ? (
            <View className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
              <Text className="mb-3 text-sm font-bold text-slate-800">{t("Gita Verses")}</Text>
              <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                  {groupedItems.gitaVerses.map((item) => {
                    const label = String(item.sanskritLabel || "").trim();
                    return (
                      <TouchableOpacity
                        key={item.recordId || item.pageId}
                        ref={(node) => setControlNodeRef(`fav-tile-verse-${item.recordId || item.pageId}`, node)}
                        {...withTileAssistivePress(
                          `verse-${item.recordId || item.pageId}`,
                          label || t("Verse label unavailable"),
                          () => openItem(item)
                        )}
                        activeOpacity={0.85}
                        className="rounded-xl border border-slate-300 bg-slate-100 items-center justify-center"
                        style={{ width: tileSize, height: tileSize, paddingHorizontal: 8, paddingVertical: 10 }}
                      >
                        <Text className="text-xs font-semibold leading-4 text-slate-800 text-center" numberOfLines={4}>
                          {label || t("Verse label unavailable")}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
              </View>
            </View>
          ) : null}

          {groupedItems.other.length ? (
            <View className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
              <Text className="mb-3 text-sm font-bold text-slate-800">{t("Other")}</Text>
              <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                {groupedItems.other.map((item) => {
                  const pageName = toPageName(normalizePath(derivePathFromPageId(item.pageId)), t("Home"));
                  return (
                    <TouchableOpacity
                      key={item.recordId || item.pageId}
                      ref={(node) => setControlNodeRef(`fav-tile-other-${item.recordId || item.pageId}`, node)}
                      {...withTileAssistivePress(
                        `other-${item.recordId || item.pageId}`,
                        pageName,
                        () => openItem(item)
                      )}
                      activeOpacity={0.85}
                      className="rounded-xl border border-slate-300 bg-slate-100 items-center justify-center"
                      style={{ width: tileSize, height: tileSize, paddingHorizontal: 8, paddingVertical: 10 }}
                    >
                      <Text className="text-xs font-semibold text-slate-800 text-center" numberOfLines={3}>
                        {pageName}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      )}
      <View style={{ marginTop: 8 }}>
        <PageBottomMeta />
      </View>
    </ScrollView>
  );
}
