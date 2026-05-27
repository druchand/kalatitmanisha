// src/utils/authApi.ts
import Constants from "expo-constants";
import { Platform } from "react-native";
import { FUNCTIONS_BASE } from "../../utils/functionApi";

/** =========================
 * Config: base URL
 * ========================= */
const DEFAULT_BASE = FUNCTIONS_BASE;
const EXPO_EXTRA = (Constants?.expoConfig?.extra || {}) as Record<string, unknown>;
const runtimeAuthBase = String((globalThis as any)?.AUTH_BASE_URL || "").trim();
const envAuthBase = String(process?.env?.EXPO_PUBLIC_AUTH_BASE_URL || "").trim();
const devAuthBase =
  typeof __DEV__ !== "undefined" && __DEV__
    ? String(EXPO_EXTRA.AUTH_BASE_URL_DEV || EXPO_EXTRA.authBaseUrlDev || "").trim()
    : "";
const configAuthBase = String(EXPO_EXTRA.AUTH_BASE_URL || EXPO_EXTRA.authBaseUrl || "").trim();

export const AUTH_BASE: string =
  // 1) runtime override for quick tests on device/simulator
  runtimeAuthBase ||
  // 2) Expo public env (EAS profile/env based)
  envAuthBase ||
  // 3) dev-only explicit base from app config
  devAuthBase ||
  // 4) app config base
  configAuthBase ||
  DEFAULT_BASE;

/** =========================
 * Public types
 * ========================= */
export type MeScope = "BASIC" | "FULL";

export type AuthCredentials = {
  identifier: string; // email or phone
  password: string;
  securityCode?: string | null; // optional second factor / future use
};
export type RegisterPayload = {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
};

export type UpdateProfilePayload = {
  memberId: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
  nickname?: string;
};

export type SocialProvider = "google" | "facebook" | "apple" | "linkedin";
export type SocialAuthPayload = {
  provider: SocialProvider;
  idToken?: string;
  accessToken?: string;
  authCode?: string;
  redirectUri?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  redirectUrl?: string;
};

export type LoginResult = {
  success: boolean;
  sessionId?: string; // JWS.* token returned by backend
  token?: string;     // if backend also returns a token field
  errorCode?: string;
  result?: any;
  memberData?: any;
  message?: string;
  error?: string;     // normalized alias of message/error for caller convenience
  [k: string]: any;   // allow backend to return extra fields
};

/** =========================
 * Internal helpers
 * ========================= */
function rid(len = 8): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function safeJson(res: Response): Promise<any | null> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function joinUrl(base: string, path: string): string {
  if (path.startsWith("http")) return path;
  const slash = path.startsWith("/") ? "" : "/";
  return `${base}${slash}${path}`;
}

function getPasswordRecoveryRedirectUrl(): string {
  const extra = EXPO_EXTRA as Record<string, any>;
  const dev = String(extra.PASSWORD_REDIRECT_DEV || "").trim();
  const web = String(extra.PASSWORD_REDIRECT_WEB || "").trim();
  const native = String(extra.PASSWORD_REDIRECT_NATIVE || "kalatitmanisha://auth-bridge").trim();
  const fallbackWebBase = String(extra.baseUrl || "https://app.kalatitmanisha.com").trim().replace(/\/$/, "");
  const canonicalizeWebBridge = (value: string): string => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:") return "";
      const host = String(parsed.hostname || "").toLowerCase();
      if (host === "kalatitmanisha.com" || host.endsWith(".kalatitmanisha.com")) {
        parsed.hostname = "app.kalatitmanisha.com";
        if (!parsed.pathname || parsed.pathname === "/") {
          parsed.pathname = "/auth-bridge";
        }
        return parsed.toString();
      }
      if (host === "app.kalatitmanisha.com") {
        if (!parsed.pathname || parsed.pathname === "/") {
          parsed.pathname = "/auth-bridge";
        }
        return parsed.toString();
      }
      return "";
    } catch {
      return "";
    }
  };

  if (typeof __DEV__ !== "undefined" && __DEV__ && dev) {
    return canonicalizeWebBridge(dev) || dev;
  }
  if (Platform.OS === "web") {
    return canonicalizeWebBridge(web) || `${fallbackWebBase}/auth-bridge`;
  }
  return native;
}

/** =========================
 * Low-level HTTP
 * ========================= */
export async function postJson<T = any>(path: string, body?: any, headers?: Record<string, string>): Promise<{
  ok: boolean;
  status: number;
  json: T | null;
}> {
  const url = joinUrl(AUTH_BASE, path);
  const reqId = rid();
  const previewBody =
    body && typeof body === "object"
      ? JSON.stringify({
          ...body,
          ...(body.password ? { password: "•••" } : {}),
        })
      : undefined;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await safeJson(res);
  return { ok: res.ok, status: res.status, json: (json as T) ?? null };
}

export async function getJson<T = any>(path: string, headers?: Record<string, string>): Promise<{
  ok: boolean;
  status: number;
  json: T | null;
}> {
  const url = joinUrl(AUTH_BASE, path);
  const reqId = rid();

  const res = await fetch(url, { method: "GET", headers });
  const json = await safeJson(res);

  return { ok: res.ok, status: res.status, json: (json as T) ?? null };
}

// small helper: avoid dumping huge blobs to the console
function truncateForLog(v: any): any {
  try {
    const s = JSON.stringify(v);
    if (s.length > 400) return JSON.parse(s.slice(0, 400) + '…"');
  } catch {
    /* ignore */
  }
  return v;
}

function previewAuth(token: string): string {
  if (!token) return "(empty)";
  return token.length <= 12 ? token : token.slice(0, 12) + "…";
}

function findSessionIdFromPayload(payload: any): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (typeof payload.sessionId === "string" && payload.sessionId.trim()) {
    return payload.sessionId;
  }
  if (typeof payload.token === "string" && payload.token.trim()) {
    return payload.token;
  }
  if (payload.result) {
    const nested = findSessionIdFromPayload(payload.result);
    if (nested) return nested;
  }
  const keys = Object.keys(payload);
  for (const key of keys) {
    const candidate = payload[key];
    if (candidate && typeof candidate === "object") {
      const nested = findSessionIdFromPayload(candidate);
      if (nested) return nested;
    }
  }
  return undefined;
}

function parseAuthResponse(payload: any): {
  merged: any;
  nestedResult: any | undefined;
  sessionId?: string;
  message?: string;
} {
  const data = (payload as any) ?? {};
  const nestedResult = data?.result && typeof data?.result === "object" ? data.result : undefined;
  const merged = nestedResult ? { ...data, ...nestedResult } : data;
  const sessionId = findSessionIdFromPayload(merged);
  const message = merged.message ?? merged.error ?? undefined;
  return { merged, nestedResult, sessionId, message };
}

/** =========================
 * High-level API
 * ========================= */

/** POST /login  ->  { success, sessionId, token, ... } */
export async function login(creds: AuthCredentials): Promise<LoginResult> {
  // Backend expects { identifier, password, securityCode? }
  const r = await postJson<any>("/login", creds);

  if (!r.ok) {
    const msg = (r.json as any)?.message || (r.json as any)?.error || `HTTP ${r.status}`;
    return {
      success: false,
      errorCode: (r.json as any)?.errorCode,
      message: msg,
      error: msg,
      status: r.status,
    };
  }

  const { merged, nestedResult, sessionId, message } = parseAuthResponse(r.json);

  return {
    ...merged,
    success: merged.success ?? !!sessionId,
    sessionId,
    token: merged.token,
    errorCode: merged.errorCode,
    message,
    error: message, // normalized alias so callers using `res.error` keep working
    result: nestedResult,
  };
}

export async function refreshSession(sessionId: string): Promise<LoginResult> {
  if (!sessionId) {
    return { success: false, error: "sessionId is required" };
  }

  const response = await postJson<any>("/refreshSession", { sessionId });
  if (!response.ok) {
    const msg = (response.json as any)?.message || (response.json as any)?.error || `HTTP ${response.status}`;
    return {
      success: false,
      status: response.status,
      message: msg,
      error: msg,
    };
  }

  const { merged, nestedResult, sessionId: refreshedSessionId, message } = parseAuthResponse(response.json);

  return {
    ...merged,
    success: merged.success ?? !!refreshedSessionId,
    sessionId: refreshedSessionId,
    token: merged.token,
    errorCode: merged.errorCode,
    message,
    error: message,
    result: nestedResult,
  };
}

export async function signOut(sessionId?: string): Promise<{ success: boolean; status?: number; message?: string; error?: string }> {
  if (!sessionId) {
    return { success: false, error: "sessionId is required" };
  }
  const response = await postJson<any>("/signOut", { sessionId });
  if (!response.ok) {
    const msg = (response.json as any)?.message || (response.json as any)?.error || `HTTP ${response.status}`;
    return { success: false, status: response.status, message: msg, error: msg };
  }
  const data = (response.json as any) ?? {};
  return {
    success: data.success ?? true,
    status: response.status,
    message: data.message,
    error: data.error,
  };
}

/** GET /me?scope=MIN|FULL (Authorization header carries raw sessionId) */
export async function getMe(scope: MeScope = "FULL", sessionId?: string): Promise<{
  success: boolean;
  user?: any;
  status?: number;
  error?: string;
}> {
  const qs = `?scope=${encodeURIComponent(scope)}`;
  const headers: Record<string, string> = {};
  if (sessionId) headers.Authorization = sessionId;

  const r = await getJson<any>(`/me${qs}`, headers);

  if (!r.ok) {
    const msg = (r.json as any)?.message || (r.json as any)?.error || `HTTP ${r.status}`;
    return { success: false, status: r.status, error: msg };
  }

  // Expecting { success: boolean, user: { ... } }
  return (r.json as any) ?? { success: false, error: "Empty response" };
}

/** POST /forgotPassword */
export async function forgotPassword(
  identifier: string,
  options?: { delivery?: "email"; redirectUrl?: string }
): Promise<{
  success: boolean;
  status?: number;
  errorCode?: string;
  message?: string;
  error?: string;
  nextAction?: string;
  resetToken?: string;
  email?: string;
}> {
  const trimmedIdentifier = String(identifier || "").trim();
  const delivery = "email";
  const redirectUrl = String(options?.redirectUrl || getPasswordRecoveryRedirectUrl()).trim();
  if (!trimmedIdentifier) {
    return { success: false, status: 400, errorCode: "MISSING_PARAMETERS", error: "identifier is required" };
  }

  const r = await postJson<any>("/forgotPassword", {
    identifier: trimmedIdentifier,
    delivery,
    ...(redirectUrl ? { redirectUrl } : {}),
  });

  if (!r.ok) {
    const msg = (r.json as any)?.message || (r.json as any)?.error || `HTTP ${r.status}`;
    return {
      success: false,
      status: r.status,
      errorCode: (r.json as any)?.errorCode,
      message: msg,
      error: msg,
    };
  }

  const data = (r.json as any) ?? {};
  return {
    success: data.success ?? true,
    status: r.status,
    errorCode: data.errorCode,
    message: data.message,
    ...(data ?? {}),
  };
}

/** POST /register -> direct email/password signup (if available) */
export async function register(payload: RegisterPayload) {
  const redirectUrl = getPasswordRecoveryRedirectUrl();
  const body = {
    email: String(payload?.email || "").trim(),
    firstName: payload?.firstName?.trim(),
    lastName: payload?.lastName?.trim(),
    phone: payload?.phone?.trim(),
    ...(redirectUrl ? { redirectUrl } : {}),
  };
  const r = await postJson<any>("/register", body);
  const data = (r.json as any) ?? {};

  if (!r.ok || data.success === false) {
    const msg = data?.message || data?.error || `HTTP ${r.status}`;
    return {
      success: false,
      status: r.status,
      error: msg,
      message: msg,
      ...data,
    };
  }

  return { success: true, ...data };
}

/** POST /updateProfile */
export async function updateProfile(payload: UpdateProfilePayload, sessionId?: string) {
  const headers: Record<string, string> = {};
  if (sessionId) {
    headers.Authorization = sessionId;
  }
  const r = await postJson<any>("/updateProfile", payload, headers);
  const data = (r.json as any) ?? {};

  if (!r.ok || data.success === false) {
    const msg = data?.message || data?.error || `HTTP ${r.status}`;
    return {
      success: false,
      status: r.status,
      error: msg,
      message: msg,
      ...data,
    };
  }

  return { success: true, ...data };
}

/** POST /deleteAccount */
export async function deleteAccount(sessionId?: string) {
  const headers: Record<string, string> = {};
  if (sessionId) {
    headers.Authorization = sessionId;
    headers["x-session-id"] = sessionId;
  }
  const r = await postJson<any>("/deleteAccount", {}, headers);
  const data = (r.json as any) ?? {};

  if (!r.ok || data.success === false) {
    const msg = data?.message || data?.error || `HTTP ${r.status}`;
    return {
      success: false,
      status: r.status,
      error: msg,
      message: msg,
      ...data,
    };
  }

  return { success: true, ...data };
}

export async function getProfile(memberId: string, sessionId?: string) {
  const headers: Record<string, string> = {};
  if (sessionId) {
    headers.Authorization = sessionId;
  }
  const r = await postJson<any>("/updateProfile", { memberId }, headers);
  const data = (r.json as any) ?? {};

  if (!r.ok || data.success === false) {
    const msg = data?.message || data?.error || `HTTP ${r.status}`;
    return {
      success: false,
      status: r.status,
      error: msg,
      message: msg,
      ...data,
    };
  }

  return { success: true, ...data };
}

export async function getMemberProfile(memberId: string, sessionId?: string) {
  if (!memberId) {
    return { success: false, status: 400, error: "memberId is required" };
  }

  const headers: Record<string, string> = {};
  if (sessionId) {
    headers.Authorization = sessionId;
  }

  const query = `?memberId=${encodeURIComponent(memberId)}`;
  const r = await getJson<any>(`/memberProfile${query}`, headers);
  const data = (r.json as any) ?? {};

  if (!r.ok || data.success === false) {
    const msg = data?.message || data?.error || `HTTP ${r.status}`;
    return {
      success: false,
      status: r.status,
      error: msg,
      message: msg,
      ...data,
    };
  }

  return { success: true, ...data };
}

/** POST /socialAuth */
export async function socialAuth(payload: SocialAuthPayload): Promise<LoginResult> {
  const provider = String(payload?.provider || "").trim().toLowerCase();
  if (!provider) {
    return { success: false, status: 400, error: "provider is required" };
  }
  const r = await postJson<any>("/socialAuth", {
    provider,
    idToken: payload?.idToken,
    accessToken: payload?.accessToken,
    authCode: payload?.authCode,
    redirectUri: payload?.redirectUri,
    email: payload?.email,
    firstName: payload?.firstName,
    lastName: payload?.lastName,
    name: payload?.name,
    redirectUrl: payload?.redirectUrl || getPasswordRecoveryRedirectUrl(),
  });

  if (!r.ok) {
    const data = (r.json as any) ?? {};
    const msg = data?.message || data?.error || `HTTP ${r.status}`;
    return {
      success: false,
      errorCode: data?.errorCode,
      status: r.status,
      message: msg,
      error: msg,
      ...data,
    };
  }

  const { merged, nestedResult, sessionId, message } = parseAuthResponse(r.json);
  return {
    ...merged,
    success: merged.success ?? !!sessionId,
    sessionId,
    token: merged.token,
    errorCode: merged.errorCode,
    message,
    error: message,
    result: nestedResult,
  };
}

/** =========================
 * Default export (object style)
 * ========================= */
const authApi = {
  AUTH_BASE,
  login,
  getMe,
  forgotPassword,
  register,
  socialAuth,
  deleteAccount,
  updateProfile,
  getProfile,
  getMemberProfile,
  postJson,
  getJson,
};

export default authApi;
