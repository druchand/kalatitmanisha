import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AppState, Platform } from "react-native";
import { functionUrl } from "../utils/functionApi";

type AppSwitches = {
  translateService: boolean;
  aiService: boolean;
  textToAudioService: boolean;
  webEnabled: boolean;
  countryEnabled: boolean;
};

type AppSettingsCtx = {
  loading: boolean;
  switches: AppSwitches;
};

const SWITCHES_ENDPOINT = functionUrl("switches");

const DEFAULT_SWITCHES: AppSwitches = {
  translateService: true,
  aiService: true,
  textToAudioService: true,
  // Fail open by default so UI controls remain visible unless CMS explicitly disables them.
  webEnabled: true,
  countryEnabled: true,
};

const AppSettingsContext = createContext<AppSettingsCtx>({
  loading: true,
  switches: DEFAULT_SWITCHES,
});

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["true", "t", "1", "yes", "y", "on", "enabled"].includes(raw)) return true;
  if (["false", "f", "0", "no", "n", "off", "disabled"].includes(raw)) return false;
  return fallback;
};

const normalizeSwitches = (value: any): AppSwitches => ({
  translateService: toBoolean(value?.translateService, DEFAULT_SWITCHES.translateService),
  aiService: toBoolean(value?.aiService, DEFAULT_SWITCHES.aiService),
  textToAudioService: toBoolean(value?.textToAudioService, DEFAULT_SWITCHES.textToAudioService),
  webEnabled: toBoolean(
    value?.webEnabled ?? value?.WebEnabled ?? DEFAULT_SWITCHES.webEnabled,
    DEFAULT_SWITCHES.webEnabled
  ),
  countryEnabled: toBoolean(
    value?.countryEnabled ?? value?.CountryEnabled ?? DEFAULT_SWITCHES.countryEnabled,
    DEFAULT_SWITCHES.countryEnabled
  ),
});

const setGlobalWebAuthToggle = (enabled: boolean) => {
  (globalThis as any).__webAuthEnabled = Boolean(enabled);
};

async function fetchSwitchesFromServer(): Promise<AppSwitches> {
  const cacheBuster = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const endpoint = `${SWITCHES_ENDPOINT}?_ts=${encodeURIComponent(cacheBuster)}`;
  const response = await fetch(endpoint, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const json = await response.json();
  return normalizeSwitches(json);
}

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [switches, setSwitches] = useState<AppSwitches>(DEFAULT_SWITCHES);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const refreshSwitches = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const normalized = await fetchSwitchesFromServer();
        if (!cancelled) setSwitches(normalized);
        setGlobalWebAuthToggle(normalized.webEnabled);
      } catch (err) {
        if (__DEV__) {
          console.warn("[app-settings] switch fetch failed; using defaults", err);
        }
        if (!cancelled) setSwitches(DEFAULT_SWITCHES);
        setGlobalWebAuthToggle(DEFAULT_SWITCHES.webEnabled);
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    };

    void refreshSwitches();

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshSwitches();
      }
    });

    const onWindowFocus = () => {
      void refreshSwitches();
    };
    const webWindow = (globalThis as any)?.window;
    if (Platform.OS === "web" && webWindow?.addEventListener) {
      webWindow.addEventListener("focus", onWindowFocus);
      webWindow.addEventListener("visibilitychange", onWindowFocus);
    }

    return () => {
      cancelled = true;
      appStateSub.remove();
      if (Platform.OS === "web" && webWindow?.removeEventListener) {
        webWindow.removeEventListener("focus", onWindowFocus);
        webWindow.removeEventListener("visibilitychange", onWindowFocus);
      }
    };
  }, []);

  const value = useMemo(
    () => ({
      loading,
      switches,
    }),
    [loading, switches]
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  return useContext(AppSettingsContext);
}
