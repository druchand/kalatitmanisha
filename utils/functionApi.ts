import Constants from "expo-constants";

const EXPO_EXTRA = (Constants?.expoConfig?.extra || {}) as Record<string, unknown>;
const runtimeAuthBase = String((globalThis as any)?.AUTH_BASE_URL || "").trim();
const envAuthBase = String(process?.env?.EXPO_PUBLIC_AUTH_BASE_URL || "").trim();
const devAuthBase =
  typeof __DEV__ !== "undefined" && __DEV__
    ? String(EXPO_EXTRA.AUTH_BASE_URL_DEV || EXPO_EXTRA.authBaseUrlDev || "").trim()
    : "";
const configAuthBase = String(EXPO_EXTRA.AUTH_BASE_URL || EXPO_EXTRA.authBaseUrl || "").trim();

export const FUNCTIONS_BASE =
  runtimeAuthBase ||
  envAuthBase ||
  devAuthBase ||
  configAuthBase ||
  "https://kalatitmanisha.com/_functions";

export const FUNCTIONS_ORIGIN = FUNCTIONS_BASE.replace(/\/_functions\/?$/, "");

export function functionUrl(path: string): string {
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return `${FUNCTIONS_BASE.replace(/\/$/, "")}/${normalizedPath}`;
}
