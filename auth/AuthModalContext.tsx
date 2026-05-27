// src/context/AuthModalContext.tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Buffer } from "buffer";
import Constants from "expo-constants";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter } from "expo-router";
import AppIcon from "../components/AppIcon";

import {
  AuthCredentials,
  RegisterPayload,
  SocialAuthPayload,
  UpdateProfilePayload,
  deleteAccount as apiDeleteAccount,
  forgotPassword as apiForgotPassword,
  getMemberProfile as apiGetMemberProfile,
  login as apiLogin,
  register as apiRegister,
  refreshSession as apiRefreshSession,
  socialAuth as apiSocialAuth,
  signOut as apiSignOut,
  updateProfile as apiUpdateProfile,
} from "./utils/authApi";
import {
  clearSessionToken,
  getSessionToken,
  getUserId,
  setSessionToken,
  setUserId,
  clearUserId,
} from "./utils/storage";
import { cacheSessionPayload, removeSessionCacheEntry } from "./utils/sessionCache";

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed;
  } catch (e) {
    console.error("Failed to decode JWT payload", e);
    return null;
  }
}

function extractTokenFromAuthUrl(url: string | undefined | null, key: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const fromQuery = parsed.searchParams.get(key);
    if (fromQuery) return String(fromQuery).trim();
    const hash = String(parsed.hash || "").replace(/^#/, "");
    if (!hash) return "";
    const hashParams = new URLSearchParams(hash);
    return String(hashParams.get(key) || "").trim();
  } catch {
    const hashPart = raw.includes("#") ? raw.split("#")[1] : "";
    const queryPart = raw.includes("?") ? raw.split("?")[1].split("#")[0] : "";
    const parts = [queryPart, hashPart].filter(Boolean).join("&");
    if (!parts) return "";
    const params = new URLSearchParams(parts);
    return String(params.get(key) || "").trim();
  }
}

function mapGoogleAuthErrorToUserMessage(error: unknown): string {
  const rawMessage = String((error as any)?.message || error || "").trim();
  const serialized = (() => {
    try {
      return JSON.stringify(error ?? {});
    } catch {
      return "";
    }
  })();
  const combined = `${rawMessage} ${serialized}`.toLowerCase();

  if (
    combined.includes("invalid_grant") ||
    combined.includes("authorization grant") ||
    combined.includes("does not match the redirection uri")
  ) {
    return "Google sign-in session expired or is invalid. Please try again in a minute.";
  }
  if (
    combined.includes("rate limit") ||
    combined.includes("rate_limit") ||
    combined.includes("quota")
  ) {
    return "Google sign-in is temporarily rate limited. Please try again after some time.";
  }
  if (combined.includes("bad request") || combined.includes("invalid_request")) {
    return "Google OAuth is misconfigured (client ID or redirect URI mismatch). Verify iOS OAuth client, bundle ID, and redirect URI settings.";
  }
  return rawMessage || "Google sign-in failed. Please try again.";
}

function isGoogleInvalidGrantLikeError(error: unknown): boolean {
  const serialized = (() => {
    try {
      return JSON.stringify(error ?? {});
    } catch {
      return "";
    }
  })();
  const raw = `${String((error as any)?.message || error || "")} ${serialized}`.toLowerCase();
  return (
    raw.includes("invalid_grant") ||
    raw.includes("authorization grant") ||
    raw.includes("refresh token is invalid") ||
    raw.includes("does not match the redirection uri") ||
    raw.includes("bad request")
  );
}

function isGoogleHostedFlowPolicyError(error: unknown): boolean {
  const rawMessage = String((error as any)?.message || error || "").trim().toLowerCase();
  const serialized = (() => {
    try {
      return JSON.stringify(error ?? {}).toLowerCase();
    } catch {
      return "";
    }
  })();
  const combined = `${rawMessage} ${serialized}`;
  return (
    combined.includes("invalid_request") ||
    combined.includes("authorization error") ||
    combined.includes("access blocked") ||
    combined.includes("oauth 2.0 policy") ||
    combined.includes("doesn't comply with google's oauth") ||
    combined.includes("does not comply with google's oauth")
  );
}

function mapFacebookAuthErrorToUserMessage(error: unknown): string {
  const rawMessage = String((error as any)?.message || error || "").trim();
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes("network")) {
    return "Facebook sign-in failed due to a network issue. Please try again.";
  }
  return rawMessage || "Facebook sign-in failed. Please try again.";
}

function mapAppleAuthErrorToUserMessage(error: unknown): string {
  const rawMessage = String((error as any)?.message || error || "").trim();
  const code = String((error as any)?.code || "").trim().toUpperCase();
  if (
    code.includes("CANCELED") ||
    code.includes("ERR_REQUEST_CANCELED") ||
    rawMessage.toLowerCase().includes("canceled")
  ) {
    return "cancelled";
  }
  return rawMessage || "Apple sign-in failed. Please try again.";
}

function pickFirstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function readAuthBridgeStoragePayload(): Record<string, any> | null {
  if (Platform.OS !== "web") return null;
  try {
    const win = (globalThis as { window?: { localStorage?: Storage } }).window;
    const raw = String(win?.localStorage?.getItem(AUTH_BRIDGE_STORAGE_KEY) || "").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function clearAuthBridgeStoragePayload(): void {
  if (Platform.OS !== "web") return;
  try {
    const win = (globalThis as { window?: { localStorage?: Storage } }).window;
    win?.localStorage?.removeItem(AUTH_BRIDGE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function clearLastOAuthRedirectParams(): void {
  try {
    delete (globalThis as any).__lastOAuthRedirectParams;
  } catch {
    (globalThis as any).__lastOAuthRedirectParams = undefined;
  }
}

function isIOSWebSafari(): boolean {
  if (Platform.OS !== "web") return false;
  try {
    const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
    const ua = String(nav?.userAgent || "").toLowerCase();
    const isiOS = /iphone|ipad|ipod/.test(ua);
    const isSafari = ua.includes("safari") && !ua.includes("crios") && !ua.includes("fxios") && !ua.includes("edgios");
    return isiOS && isSafari;
  } catch {
    return false;
  }
}

function navigateWebSameTab(url: string): void {
  if (Platform.OS !== "web") return;
  try {
    const webWindow = (globalThis as { window?: { location?: { assign?: (u: string) => void; href?: string } } }).window;
    webWindow?.location?.assign?.(url);
  } catch {
    try {
      const webWindow = (globalThis as { window?: { location?: { href?: string } } }).window;
      if (webWindow?.location) webWindow.location.href = url;
    } catch {
      // ignore
    }
  }
}

async function waitForOAuthRedirectParams(
  timeoutMs = 6000,
  pollMs = 120
): Promise<Record<string, any> | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const cached = (globalThis as any)?.__lastOAuthRedirectParams;
    if (cached && typeof cached === "object") {
      return cached as Record<string, any>;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  const finalCached = (globalThis as any)?.__lastOAuthRedirectParams;
  return finalCached && typeof finalCached === "object"
    ? (finalCached as Record<string, any>)
    : null;
}

async function waitForAuthBridgeOAuthPayload(
  provider: "google" | "facebook" | "linkedin",
  startedAt: number,
  timeoutMs = 7000,
  pollMs = 140
): Promise<Record<string, any> | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payload = readAuthBridgeStoragePayload();
    if (payload && typeof payload === "object") {
      const payloadProvider = String(payload.provider || "").trim().toLowerCase();
      const ts = Number(payload.ts || 0);
      const hasOAuthFields = Boolean(
        String(payload.access_token || "").trim() ||
          String(payload.code || "").trim() ||
          String(payload.error || "").trim()
      );
      if (hasOAuthFields && (!payloadProvider || payloadProvider === provider) && (!ts || ts >= startedAt)) {
        return payload;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return null;
}

async function exchangeGoogleAuthCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<{ idToken?: string; accessToken?: string }> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", params.code);
  body.set("client_id", params.clientId);
  body.set("redirect_uri", params.redirectUri);
  if (params.codeVerifier) {
    body.set("code_verifier", params.codeVerifier);
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const raw = await res.text();
  let data: any = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }

  if (!res.ok) {
    const description = String(data?.error_description || data?.error || "").trim();
    throw new Error(description || `Google token exchange failed (${res.status})`);
  }

  return {
    idToken: pickFirstNonEmpty(data?.id_token, data?.idToken) || undefined,
    accessToken: pickFirstNonEmpty(data?.access_token, data?.accessToken) || undefined,
  };
}

WebBrowser.maybeCompleteAuthSession();


export type User = {
  id?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  email?: string;
  avatarUrl?: string;
  phone?: string;
  mainPhone?: string;
  phones?: string[];
  language?: string;
  addresses?: any[];
  slug?: string;
  privacyStatus?: string;
  status?: string;
  lastLoginDate?: string;
  createdDate?: string;
};

type AuthMode = "login" | "signup" | "forgot";
type SocialProvider = "google" | "facebook" | "apple" | "linkedin";
type SocialButtonProvider = SocialProvider | "linkedin";
type SocialButtonConfig = {
  value: SocialButtonProvider;
  label: string;
  enabled: boolean;
};

const SOCIAL_BUTTONS: SocialButtonConfig[] = [
  { value: "google", label: "Google", enabled: true },
  { value: "facebook", label: "Facebook", enabled: true },
  { value: "apple", label: "Apple", enabled: true },
  { value: "linkedin", label: "LinkedIn", enabled: true },
];

const getFriendlySocialAuthError = (provider: SocialProvider, message: string) => {
  const raw = String(message || "").trim();
  if (
    raw.includes("SOCIAL_MEMBER_CREATE_FAILED") ||
    raw.includes("SOCIAL_SESSION_CREATE_FAILED") ||
    raw.includes("WIX_SESSION_CREATE_FAILED")
  ) {
    return "We could not finish signing you in. Please try again, or use Forgot password with the same email.";
  }
  if (
    provider === "apple" &&
    (raw.includes("Social sign-in did not return an email") ||
      raw.includes("SOCIAL_EMAIL_REQUIRED"))
  ) {
    return "Apple did not return an email for this sign-in. Apple usually shares email only on the first authorization. Remove this app under Apple ID > Sign in with Apple and try again, or sign in with your existing method.";
  }
  return raw || "Social sign in failed";
};

// Runtime config can lag in some iOS dev-client sessions; keep a fallback so FB auth remains testable.
const FACEBOOK_APP_ID_FALLBACK = "1400517912087706";
const FACEBOOK_WEB_REDIRECT_FALLBACK = "https://app.kalatitmanisha.com/auth-bridge";
const LINKEDIN_CLIENT_ID_FALLBACK = "86aisjxj99rhpv";
const LINKEDIN_WEB_REDIRECT_FALLBACK = "https://app.kalatitmanisha.com/auth-bridge";
const APPLE_WEB_CLIENT_ID_FALLBACK = "com.deepakruchandani.kalatitmanisha.web";
const APPLE_WEB_REDIRECT_FALLBACK = "https://app.kalatitmanisha.com/auth-bridge";
const AUTH_BRIDGE_STORAGE_KEY = "kalatit:auth-bridge";

const normalizeHostedRedirectUri = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return FACEBOOK_WEB_REDIRECT_FALLBACK;
  try {
    const parsed = new URL(raw);
    const host = String(parsed.hostname || "").toLowerCase();
    if (host === "kalatitmanisha.com") {
      parsed.hostname = "app.kalatitmanisha.com";
      parsed.protocol = "https:";
      if (!parsed.pathname || parsed.pathname === "/") {
        parsed.pathname = "/auth-bridge";
      }
    }
    return parsed.toString();
  } catch {
    return FACEBOOK_WEB_REDIRECT_FALLBACK;
  }
};

const resolveWebRedirectForRuntime = (configuredUrl: string): string => {
  const fallback = normalizeHostedRedirectUri(configuredUrl);
  if (Platform.OS !== "web") return fallback;
  const win = (globalThis as { window?: { location?: { origin?: string; hostname?: string } } }).window;
  const hostname = String(win?.location?.hostname || "").toLowerCase();
  const origin = String(win?.location?.origin || "").trim();
  const isLocalRuntime =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local");
  if (isLocalRuntime && origin) {
    return `${origin.replace(/\/$/, "")}/auth-bridge`;
  }
  return fallback;
};

const createRandomState = (length = 24): string => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let output = "";
  for (let i = 0; i < length; i += 1) {
    output += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return output;
};

const sanitizeClientId = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (
    lower.includes("your_client_id_here") ||
    lower.includes("missing_") ||
    lower.includes("placeholder")
  ) {
    return "";
  }
  return raw;
};

type RawUser = Partial<User> & Record<string, any>;

const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toGuid = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  return GUID_REGEX.test(value.trim()) ? value.trim() : undefined;
};

const toEntityId = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized;
};

const pickMemberPayload = (payload: any): RawUser | null => {
  if (!payload || typeof payload !== "object") return null;

  const candidates: any[] = [];
  if (payload.result && typeof payload.result === "object" && payload.result !== payload) {
    candidates.push(payload.result);
  }
  candidates.push(payload);

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    if (candidate.memberData) return candidate.memberData as RawUser;
    if (candidate.member) return candidate.member as RawUser;
    if (candidate.user) return candidate.user as RawUser;
    if (candidate.data && typeof candidate.data === "object") return candidate.data as RawUser;
    if (candidate.profile && candidate.contactDetails) return candidate as RawUser;
    if (
      candidate.success !== undefined &&
      candidate.member === undefined &&
      candidate.user === undefined
    ) {
      const keys = Object.keys(candidate).filter((key) => !["success", "error", "message"].includes(key));
      for (const key of keys) {
        const nested = (candidate as any)[key];
        if (nested && typeof nested === "object") return nested as RawUser;
      }
    }
    if (candidate && typeof candidate === "object") return candidate as RawUser;
  }

  return null;
};

type Email = { id?: string; tag: string; email: string; primary?: boolean };
type Phone = { id?: string; tag: string; phone?: string; value?: string; primary?: boolean };

const isApplePrivateRelayEmail = (value?: string | null): boolean =>
  String(value || "").trim().toLowerCase().endsWith("@privaterelay.appleid.com");

const isEmailLocalPartFallback = (value: unknown, email: string): boolean => {
  const text = typeof value === "string" ? value.trim() : "";
  const localPart = String(email || "").split("@")[0]?.trim();
  return Boolean(text && localPart && text.toLowerCase() === localPart.toLowerCase());
};

const normalizeUser = (raw?: RawUser, fallback?: RawUser): User => {
  const source = raw ?? fallback ?? {};
  const profile = source.profile ?? {};
  const contact = source.contact ?? source.contactDetails ?? {};
  const emails: Email[] = contact.emails ?? [];
  const phones: Phone[] = contact.phones ?? [];
  const addresses = contact.addresses ?? [];

  const primaryEmail = emails.find((e) => e.primary)?.email;
  const loginEmail = source.email ?? source.loginEmail ?? primaryEmail ?? emails[0]?.email ?? fallback?.email ?? "";

  const normalizedId =
    toGuid(source._id) ??
    toGuid(source.id) ??
    toGuid(source.memberId) ??
    toGuid(source.contactId) ??
    toGuid(source.userId) ??
    toGuid(fallback?.id) ??
    toEntityId(source._id) ??
    toEntityId(source.id) ??
    toEntityId(source.memberId) ??
    toEntityId(source.contactId) ??
    toEntityId(source.userId) ??
    toEntityId(fallback?.id);

  const fallbackRawName = (source.name ?? fallback?.name ?? "").trim();
  const shouldIgnoreRelayFallbackName =
    isApplePrivateRelayEmail(loginEmail) && isEmailLocalPartFallback(fallbackRawName, loginEmail);
  const fallbackRawFirstName =
    fallbackRawName && !shouldIgnoreRelayFallbackName ? fallbackRawName.split(" ")[0] : undefined;

  const firstName =
    source.firstName ??
    source.firtName ??
    contact.firstName ??
    profile.firstName ??
    (profile.nickname ? String(profile.nickname).split(" ")[0] : undefined) ??
    fallback?.firstName ??
    fallbackRawFirstName;

  const lastName =
    source.lastName ??
    contact.lastName ??
    profile.lastName ??
    (profile.nickname ? String(profile.nickname).split(" ").slice(1).join(" ") : undefined) ??
    fallback?.lastName;

  const name =
    ((shouldIgnoreRelayFallbackName ? undefined : source.name) ??
      profile.nickname ??
      [firstName, lastName].filter(Boolean).join(" ")) ||
    (isApplePrivateRelayEmail(loginEmail) ? "Apple User" : (loginEmail || "").split("@")[0]) ||
    "Guest";

  const primaryPhone = phones.find((p) => p.primary);
  const mobilePhone = phones.find((p) => p.tag === "MOBILE") ?? phones[0];
  
  const phoneFromContact =
    contact.mainPhone ??
    primaryPhone?.phone ??
    primaryPhone?.value ??
    mobilePhone?.phone ??
    mobilePhone?.value ??
    contact.phone;

  const rawPhones: string[] = Array.isArray(source.phones) ? source.phones : [];

  const phone =
    source.mainPhone ?? // from JSON
    (rawPhones.length > 0 ? rawPhones[0] : undefined) ?? // from JSON
    phoneFromContact ??
    fallback?.phone;

  const contactPhoneNumbers = phones
    .map((p) => (typeof p.phone === "string" && p.phone.trim() ? p.phone.trim() : p.value?.trim()))
    .filter((value): value is string => Boolean(value));
  if (contact.mainPhone && !contactPhoneNumbers.includes(contact.mainPhone)) {
    contactPhoneNumbers.unshift(contact.mainPhone);
  }
  const additionalPhones = rawPhones
    .map((entry) => (typeof entry === "string" ? entry.trim() : undefined))
    .filter((value): value is string => Boolean(value));
  const normalizedPhones = Array.from(new Set([...contactPhoneNumbers, ...additionalPhones]));
  const resolvedMainPhone = source.mainPhone ?? contact.mainPhone ?? phoneFromContact;

  const avatarUrl =
    source.picture ??
    profile.photo?.url ??
    profile.picture?.url ??
    profile.profilePhoto?.url ??
    source.avatarUrl ??
    fallback?.avatarUrl;

  return {
    id: normalizedId,
    name,
    firstName,
    lastName,
    nickname: source.nickname ?? profile.nickname,
    email: loginEmail,
    avatarUrl,
    phone: typeof phone === "string" ? phone.trim() : undefined,
    mainPhone: resolvedMainPhone,
    phones: normalizedPhones.length > 0 ? normalizedPhones : undefined,
    language: source.language ?? profile.language ?? fallback?.language,
    addresses,
    slug: source.slug ?? profile.slug,
    privacyStatus: source.privacyStatus,
    status: source.status,
    lastLoginDate: source.lastLogin ?? source.lastLoginDate,
    createdDate: source._createdDate ?? source.createdDate,
  };
};

const ensureFirstNamePrimary = (user: User, fallback?: RawUser): User => {
  const fallbackName = (fallback?.name ?? "").trim();
  const fallbackFirst =
    fallback?.firstName ??
    fallback?.firtName ??
    (fallbackName ? fallbackName.split(" ")[0] : undefined);
  const fallbackLast =
    fallback?.lastName ??
    (fallbackName ? fallbackName.split(" ").slice(1).join(" ").trim() : undefined);

  const firstName = user.firstName ?? fallbackFirst;
  const lastName = user.lastName ?? fallbackLast;
  const name =
    user.name ??
    fallback?.name ??
    (firstName || lastName
      ? [firstName, lastName].filter(Boolean).join(" ")
      : undefined);

  return { ...user, firstName, lastName, name };
};

export type AuthModalContextValue = {
  isOpen: boolean;
  user: User | null;
  sessionId: string | null;
  isGuest: boolean;
  initializing: boolean;
  mode: AuthMode;
  openLogin: (nextMode?: AuthMode) => void;
  promptLogin: (identifier?: string) => void;
  promptRestrictedAction: (message?: string, nextMode?: AuthMode) => void;
  closeLogin: () => void;
  login: (payload: AuthCredentials) => Promise<{ success: boolean; user?: User }>;
  signUp: (payload: Pick<RegisterPayload, "email" | "firstName" | "lastName" | "phone">) => Promise<{ success: boolean; message?: string }>;
  forgotPassword: (
    identifier: string
  ) => Promise<{ success: boolean; message: string; nextAction?: string; resetToken?: string; email?: string }>;
  socialSignIn: (
    provider: SocialProvider,
    payload?: Partial<SocialAuthPayload>
  ) => Promise<{ success: boolean; user?: User }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateProfile: (payload: { firstName?: string; lastName?: string; phone?: string; nickname?: string; avatarUrl?: string }) => Promise<void>;
  deleteAccount: () => Promise<void>;
  getProfile: () => Promise<void>;
  setUser: (user: User | null) => void;
};

const AuthModalContext = createContext<AuthModalContextValue | undefined>(undefined);

function getSocialTokenFactory():
  | ((provider: SocialProvider) => Promise<Partial<SocialAuthPayload> | null> | Partial<SocialAuthPayload> | null)
  | null {
  const fn = (globalThis as any)?.__socialAuthTokenFactory;
  return typeof fn === "function" ? fn : null;
}

export function useAuth(): AuthModalContextValue {
  const ctx = useContext(AuthModalContext);
  if (!ctx) throw new Error("useAuth must be used within AuthModalProvider");
  return ctx;
}

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const expoExtra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const manifestExtra = ((Constants as any)?.manifest2?.extra?.expoClient?.extra ?? {}) as Record<string, unknown>;
  const env = ((globalThis as any)?.process?.env ?? {}) as Record<string, string | undefined>;
  const readClientId = (key: string, envKey: string) =>
    String(
      expoExtra[key] ??
      manifestExtra[key] ??
      env[envKey] ??
      ""
    ).trim();
  const readAnyClientId = (keys: string[], envKeys: string[]) => {
    for (const key of keys) {
      const value = String(expoExtra[key] ?? manifestExtra[key] ?? "").trim();
      if (value) return value;
    }
    for (const envKey of envKeys) {
      const value = String(env[envKey] ?? "").trim();
      if (value) return value;
    }
    return "";
  };
  const googleWebClientId = readClientId("googleWebClientId", "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID");
  const googleExpoClientId = readClientId("googleExpoClientId", "EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID");
  const googleAndroidClientId = readClientId("googleAndroidClientId", "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID");
  const googleIosClientId = readClientId("googleIosClientId", "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID");
  const googleWebRedirectUri = resolveWebRedirectForRuntime(readAnyClientId(
    ["googleRedirectUriWeb"],
    ["EXPO_PUBLIC_GOOGLE_REDIRECT_URI_WEB"]
  ) || AuthSession.makeRedirectUri({ preferLocalhost: true, path: "auth-bridge" }));
  const googleUseHostedRedirectOnNative = /^(1|true|yes|on)$/i.test(
    readAnyClientId(
      ["googleUseHostedRedirectOnNative"],
      ["EXPO_PUBLIC_GOOGLE_USE_HOSTED_REDIRECT_ON_NATIVE"]
    ) || "false"
  );
  const linkedinClientId = sanitizeClientId(readAnyClientId(
    ["linkedinClientId", "linkedInClientId", "linkedinAppId", "linkedInAppId"],
    ["EXPO_PUBLIC_LINKEDIN_CLIENT_ID", "EXPO_PUBLIC_LINKEDIN_APP_ID"]
  )) || LINKEDIN_CLIENT_ID_FALLBACK;
  const appleWebClientId = readAnyClientId(
    ["appleWebClientId", "appleClientId", "appleServiceId"],
    ["EXPO_PUBLIC_APPLE_WEB_CLIENT_ID", "EXPO_PUBLIC_APPLE_CLIENT_ID", "EXPO_PUBLIC_APPLE_SERVICE_ID"]
  ) || APPLE_WEB_CLIENT_ID_FALLBACK;
  const appleWebRedirectUri = normalizeHostedRedirectUri(
    readAnyClientId(["appleRedirectUriWeb"], ["EXPO_PUBLIC_APPLE_REDIRECT_URI_WEB"]) ||
      APPLE_WEB_REDIRECT_FALLBACK
  );
  const facebookAppId = readAnyClientId(
    ["facebookAppId", "facebookClientId", "facebookAppID"],
    ["EXPO_PUBLIC_FACEBOOK_APP_ID", "EXPO_PUBLIC_FACEBOOK_APPID"]
  ) || FACEBOOK_APP_ID_FALLBACK;
  const defaultFacebookNativeRedirectUri = facebookAppId ?
    `fb${facebookAppId}://authorize` :
    "kalatitmanisha://";
  const configuredFacebookNativeRedirectUri = readAnyClientId(
    ["facebookRedirectUriNative", "facebookRedirectUri"],
    ["EXPO_PUBLIC_FACEBOOK_REDIRECT_URI_NATIVE", "EXPO_PUBLIC_FACEBOOK_REDIRECT_URI"]
  );
  const facebookWebRedirectUri = resolveWebRedirectForRuntime(readAnyClientId(
    ["facebookRedirectUriWeb"],
    ["EXPO_PUBLIC_FACEBOOK_REDIRECT_URI_WEB"]
  ) || AuthSession.makeRedirectUri({ preferLocalhost: true, path: "auth-bridge" }));
  const facebookUseHostedRedirectOnNative = /^(1|true|yes|on)$/i.test(
    readAnyClientId(
      ["facebookUseHostedRedirectOnNative"],
      ["EXPO_PUBLIC_FACEBOOK_USE_HOSTED_REDIRECT_ON_NATIVE"]
    ) || "false"
  );
  const facebookNativeRedirectUri =
    configuredFacebookNativeRedirectUri || defaultFacebookNativeRedirectUri;
  const effectiveFacebookRedirectUri =
    Platform.OS === "web"
      ? facebookWebRedirectUri || facebookNativeRedirectUri
      : (facebookUseHostedRedirectOnNative ? facebookWebRedirectUri : facebookNativeRedirectUri);
  const googleClientId =
    Platform.OS === "ios" ?
    googleIosClientId :
    Platform.OS === "android" ?
    googleAndroidClientId :
    googleWebClientId;
  const iosGoogleSchemePrefix = String(googleIosClientId || "")
    .trim()
    .replace(/\.apps\.googleusercontent\.com$/i, "");
  const iosNativeRedirectUri = iosGoogleSchemePrefix
    ? `com.googleusercontent.apps.${iosGoogleSchemePrefix}:/oauthredirect`
    : undefined;
  // Let Expo AuthSession determine native redirect URIs for standalone builds.
  // Hardcoding these can cause Android Google OAuth invalid_request mismatches.
  const nativeRedirectUri = Platform.OS === "ios" ? iosNativeRedirectUri : undefined;
  const webRedirectUri =
    Platform.OS === "web" ?
    AuthSession.makeRedirectUri({
      preferLocalhost: true,
    }) :
    undefined;
  const [googleRequest, , promptGoogleAuthAsync] = Google.useIdTokenAuthRequest({
    webClientId: googleWebClientId || undefined,
    androidClientId: googleAndroidClientId || undefined,
    iosClientId: googleIosClientId || undefined,
    redirectUri: Platform.OS === "web" ? webRedirectUri : nativeRedirectUri,
    shouldAutoExchangeCode: false,
    scopes: ["openid", "profile", "email"],
  });
  // Use a single HTTPS redirect URI across platforms to align with
  // Meta "Valid OAuth Redirect URIs" validation rules.
  const facebookRedirectUri = effectiveFacebookRedirectUri;
  const [facebookRequest, , promptFacebookAuthAsync] = AuthSession.useAuthRequest(
    {
      clientId: facebookAppId || "MISSING_FACEBOOK_APP_ID",
      responseType: "token",
      scopes: ["public_profile", "email"],
      redirectUri: facebookRedirectUri,
      usePKCE: false,
      extraParams: {
        redirect_uri: facebookRedirectUri,
      },
    },
    {
      authorizationEndpoint: "https://www.facebook.com/v19.0/dialog/oauth",
      tokenEndpoint: "https://graph.facebook.com/v19.0/oauth/access_token",
    }
  );
  const hasFacebookConfig = Boolean(facebookAppId);
  const linkedinWebRedirectUri = normalizeHostedRedirectUri(readAnyClientId(
    ["linkedinRedirectUriWeb", "linkedInRedirectUriWeb"],
    ["EXPO_PUBLIC_LINKEDIN_REDIRECT_URI_WEB"]
  ) || LINKEDIN_WEB_REDIRECT_FALLBACK);
  const configuredLinkedInNativeRedirectUri = readAnyClientId(
    ["linkedinRedirectUriNative", "linkedInRedirectUriNative", "linkedinRedirectUri"],
    ["EXPO_PUBLIC_LINKEDIN_REDIRECT_URI_NATIVE", "EXPO_PUBLIC_LINKEDIN_REDIRECT_URI"]
  );
  const linkedinUseHostedRedirectOnNative = /^(1|true|yes|on)$/i.test(
    readAnyClientId(
      ["linkedinUseHostedRedirectOnNative", "linkedInUseHostedRedirectOnNative"],
      ["EXPO_PUBLIC_LINKEDIN_USE_HOSTED_REDIRECT_ON_NATIVE"]
    ) || "false"
  );
  const defaultLinkedInNativeRedirectUri = "kalatitmanisha://oauthredirect";
  const linkedinNativeRedirectUri =
    Platform.OS === "web" ?
    undefined :
    (configuredLinkedInNativeRedirectUri || defaultLinkedInNativeRedirectUri);
  const linkedinRedirectUri =
    Platform.OS === "web" ?
    linkedinWebRedirectUri :
    (linkedinUseHostedRedirectOnNative ? linkedinWebRedirectUri : linkedinNativeRedirectUri);
  const effectiveLinkedInRedirectUri = linkedinRedirectUri || linkedinWebRedirectUri;
  const [linkedinRequest, , promptLinkedInAuthAsync] = AuthSession.useAuthRequest(
    {
      clientId: linkedinClientId || "MISSING_LINKEDIN_CLIENT_ID",
      responseType: "code",
      // LinkedIn OIDC scopes.
      scopes: ["openid", "profile", "email"],
      redirectUri: effectiveLinkedInRedirectUri,
      usePKCE: false,
      extraParams: {
        redirect_uri: effectiveLinkedInRedirectUri,
      },
    },
    {
      authorizationEndpoint: "https://www.linkedin.com/oauth/v2/authorization",
      tokenEndpoint: "https://www.linkedin.com/oauth/v2/accessToken",
    }
  );
  const hasLinkedInConfig = Boolean(linkedinClientId);

  const [isOpen, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<AuthMode>("login");
  const [sessionId, setSessionIdState] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupProvider, setSignupProvider] = useState<string>("email");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotComplete, setForgotComplete] = useState(false);
  const [forgotSentTo, setForgotSentTo] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSubmitting(false);
    }
  }, [isOpen, mode]);

  useEffect(() => {
    let active = true;
    if (Platform.OS !== "ios") {
      setAppleAuthAvailable(false);
      return () => {
        active = false;
      };
    }
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (!active) return;
        setAppleAuthAvailable(Boolean(available));
      })
      .catch(() => {
        if (!active) return;
        setAppleAuthAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const root = globalThis as typeof globalThis & {
      __getGoogleIdToken?: () => Promise<Partial<SocialAuthPayload> | null>;
      __getFacebookAccessToken?: () => Promise<Partial<SocialAuthPayload> | null>;
      __getAppleIdToken?: () => Promise<Partial<SocialAuthPayload> | null>;
      __getLinkedInAccessToken?: () => Promise<Partial<SocialAuthPayload> | null>;
    };
    const previous = root.__getGoogleIdToken;
    const previousFacebook = root.__getFacebookAccessToken;
    const previousApple = root.__getAppleIdToken;
    const previousLinkedIn = root.__getLinkedInAccessToken;
    const hasGoogleConfig = Boolean(
      googleWebClientId || googleExpoClientId || googleAndroidClientId || googleIosClientId
    );

    const AUTH_DEBUG = __DEV__ && Boolean((globalThis as any).__KM_AUTH_DEBUG__);
    if (AUTH_DEBUG) {
      console.debug("[google-auth] config", {
        appOwnership: Constants.appOwnership,
        platform: Platform.OS,
        hasGoogleConfig,
        nativeRedirectUri,
        webRedirectUri,
        redirectUri: googleRequest?.redirectUri,
        clientId: googleClientId ? "set" : "missing",
        webClientId: googleWebClientId ? "set" : "missing",
        expoClientId: googleExpoClientId ? "set" : "missing",
        iosClientId: googleIosClientId ? "set" : "missing",
        androidClientId: googleAndroidClientId ? "set" : "missing",
      });
      console.debug("[facebook-auth] config", {
        appOwnership: Constants.appOwnership,
        platform: Platform.OS,
        hasFacebookConfig,
        facebookAppId: facebookAppId ? "set" : "missing",
        nativeRedirectUri: facebookNativeRedirectUri,
        webRedirectUri: facebookWebRedirectUri,
        redirectUri: facebookRequest?.redirectUri ?? facebookRedirectUri,
        useHostedRedirectOnNative: facebookUseHostedRedirectOnNative,
      });
      console.debug("[linkedin-auth] config", {
        appOwnership: Constants.appOwnership,
        platform: Platform.OS,
        hasLinkedInConfig,
        linkedinClientId: linkedinClientId ? "set" : "missing",
        redirectUri: linkedinRequest?.redirectUri ?? linkedinRedirectUri,
        webRedirectUri: linkedinWebRedirectUri,
        nativeRedirectUri: linkedinNativeRedirectUri,
        useHostedRedirectOnNative: linkedinUseHostedRedirectOnNative,
      });
    }

    const getGoogleIdToken = async (): Promise<Partial<SocialAuthPayload> | null> => {
      const runGoogleHostedFlow = async (
        redirectUri: string,
        options?: { nativeReturnUrl?: string; nativeStatePrefix?: string }
      ): Promise<Partial<SocialAuthPayload> | null> => {
        const hostedClientId = String(googleWebClientId || googleClientId || "").trim();
        if (!hostedClientId) {
          throw new Error("Google web client ID is missing for hosted sign-in.");
        }

        clearAuthBridgeStoragePayload();
        const startedAt = Date.now();
        const statePrefix = String(options?.nativeStatePrefix || "");
        const state = `${statePrefix}${createRandomState(28)}`;
        const nonce = createRandomState(28);
        const authUrl = [
          "https://accounts.google.com/o/oauth2/v2/auth",
          `?client_id=${encodeURIComponent(hostedClientId)}`,
          `&redirect_uri=${encodeURIComponent(redirectUri)}`,
          "&response_type=token%20id_token",
          `&scope=${encodeURIComponent("openid profile email")}`,
          "&prompt=select_account",
          "&include_granted_scopes=true",
          `&state=${encodeURIComponent(state)}`,
          `&nonce=${encodeURIComponent(nonce)}`,
        ].join("");

        let result:
          | { type: "success"; url: string }
          | { type: string; url?: string };
        try {
          const returnUrl = String(options?.nativeReturnUrl || redirectUri).trim() || redirectUri;
          result = (await WebBrowser.openAuthSessionAsync(
            authUrl,
            returnUrl
          )) as { type: string; url?: string };
        } catch (authErr) {
          throw new Error(mapGoogleAuthErrorToUserMessage(authErr));
        }

        const callbackUrl = String(result?.url || "").trim();
        const parseFromUrl = (rawUrl: string) => ({
          idToken: extractTokenFromAuthUrl(rawUrl, "id_token"),
          accessToken: extractTokenFromAuthUrl(rawUrl, "access_token"),
          authCode: extractTokenFromAuthUrl(rawUrl, "code"),
          returnedState: extractTokenFromAuthUrl(rawUrl, "state"),
          oauthError:
            extractTokenFromAuthUrl(rawUrl, "error") ||
            extractTokenFromAuthUrl(rawUrl, "error_description"),
        });
        let parsed = parseFromUrl(callbackUrl);

        if (!parsed.idToken && !parsed.accessToken && !parsed.authCode && !parsed.oauthError) {
          const bridgePayload = await waitForAuthBridgeOAuthPayload("google", startedAt);
          const cached =
            bridgePayload ||
            (await waitForOAuthRedirectParams()) ||
            readAuthBridgeStoragePayload() ||
            (globalThis as any)?.__lastOAuthRedirectParams ||
            null;
          if (cached && typeof cached === "object") {
            parsed = {
              idToken: pickFirstNonEmpty(
                cached.id_token,
                cached.idToken,
                Array.isArray(cached.id_token) ? cached.id_token[0] : "",
                Array.isArray(cached.idToken) ? cached.idToken[0] : ""
              ),
              accessToken: pickFirstNonEmpty(
                cached.access_token,
                cached.accessToken,
                Array.isArray(cached.access_token) ? cached.access_token[0] : "",
                Array.isArray(cached.accessToken) ? cached.accessToken[0] : ""
              ),
              authCode: pickFirstNonEmpty(
                cached.code,
                Array.isArray(cached.code) ? cached.code[0] : ""
              ),
              returnedState: pickFirstNonEmpty(
                cached.state,
                Array.isArray(cached.state) ? cached.state[0] : ""
              ),
              oauthError: pickFirstNonEmpty(
                cached.error,
                cached.error_description,
                Array.isArray(cached.error) ? cached.error[0] : ""
              ),
            };
          }
        }

        if (parsed.oauthError) {
          throw new Error(`Google sign-in failed: ${parsed.oauthError}`);
        }
        if (parsed.returnedState && parsed.returnedState !== state) {
          throw new Error("Google sign-in state mismatch. Please retry.");
        }
        if (!parsed.idToken && !parsed.accessToken && !parsed.authCode) {
          return null;
        }

        clearAuthBridgeStoragePayload();
        return {
          ...(parsed.idToken ? { idToken: parsed.idToken } : {}),
          ...(parsed.accessToken ? { accessToken: parsed.accessToken } : {}),
          ...(parsed.authCode ? { authCode: parsed.authCode } : {}),
          redirectUri,
        };
      };

      if (!hasGoogleConfig) {
        throw new Error(
          "Google OAuth client IDs are missing. Set expo.extra.googleWebClientId/googleAndroidClientId/googleIosClientId."
        );
      }
      if (Platform.OS !== "web" && googleUseHostedRedirectOnNative && googleWebClientId) {
        try {
          return await runGoogleHostedFlow(googleWebRedirectUri, {
            nativeReturnUrl: "kalatitmanisha://auth-bridge",
            nativeStatePrefix: "native_gg_",
          });
        } catch (hostedErr) {
          if (Platform.OS === "android" && isGoogleHostedFlowPolicyError(hostedErr)) {
            if (__DEV__) {
              console.warn("[google-auth] hosted flow rejected by Google policy; retrying native flow", {
                message: String((hostedErr as any)?.message || hostedErr || ""),
              });
            }
          } else {
            throw hostedErr;
          }
        }
      }
      if (!googleRequest) {
        throw new Error("Google sign-in is still initializing. Please wait a moment and try again.");
      }

      let result: any;
      try {
        if (Platform.OS !== "web") {
          clearLastOAuthRedirectParams();
        }
        result = await promptGoogleAuthAsync();
      } catch (authErr) {
        if (isGoogleInvalidGrantLikeError(authErr)) {
          if (__DEV__) {
            console.debug("[google-auth] suppressed non-fatal invalid grant", {
              message: String((authErr as any)?.message || authErr || ""),
            });
          }
          return null;
        }
        if (__DEV__) {
          console.warn("[google-auth] prompt failed", {
            message: String((authErr as any)?.message || authErr || ""),
            details: authErr,
            redirectUri: googleRequest?.redirectUri,
            nativeRedirectUri,
          });
        }
        throw new Error(mapGoogleAuthErrorToUserMessage(authErr));
      }
      if (result?.type !== "success") {
        const directResultUrl = String((result as any)?.url || "").trim();
        const directCode = extractTokenFromAuthUrl(directResultUrl, "code");
        const directIdToken = extractTokenFromAuthUrl(directResultUrl, "id_token");
        const directAccessToken = extractTokenFromAuthUrl(directResultUrl, "access_token");
        const directOAuthError = pickFirstNonEmpty(
          extractTokenFromAuthUrl(directResultUrl, "error"),
          extractTokenFromAuthUrl(directResultUrl, "error_description")
        );
        if (directOAuthError) {
          throw new Error(`Google sign-in failed: ${directOAuthError}`);
        }
        if (directCode || directIdToken || directAccessToken) {
          result = {
            type: "success",
            url: directResultUrl,
            params: {
              ...(directCode ? { code: directCode } : {}),
              ...(directIdToken ? { id_token: directIdToken } : {}),
              ...(directAccessToken ? { access_token: directAccessToken } : {}),
            },
          };
        }
      }
      if (result?.type !== "success") {
        let cachedParams =
          (globalThis as any)?.__lastOAuthRedirectParams ||
          readAuthBridgeStoragePayload() ||
          null;
        if (Platform.OS !== "web" && !cachedParams) {
          const awaitedParams = await waitForOAuthRedirectParams();
          cachedParams =
            awaitedParams ||
            readAuthBridgeStoragePayload() ||
            (globalThis as any)?.__lastOAuthRedirectParams ||
            null;
        }
        const cachedCode = pickFirstNonEmpty(
          cachedParams?.code,
          Array.isArray(cachedParams?.code) ? cachedParams.code[0] : ""
        );
        const cachedIdToken = pickFirstNonEmpty(
          cachedParams?.id_token,
          cachedParams?.idToken,
          Array.isArray(cachedParams?.id_token) ? cachedParams.id_token[0] : "",
          Array.isArray(cachedParams?.idToken) ? cachedParams.idToken[0] : ""
        );
        const cachedAccessToken = pickFirstNonEmpty(
          cachedParams?.access_token,
          cachedParams?.accessToken,
          Array.isArray(cachedParams?.access_token) ? cachedParams.access_token[0] : "",
          Array.isArray(cachedParams?.accessToken) ? cachedParams.accessToken[0] : ""
        );
        if (__DEV__) {
          console.debug("[google-auth] prompt non-success", {
            resultType: result?.type,
            platform: Platform.OS,
            hasCachedParams: Boolean(cachedParams),
            hasCachedCode: Boolean(cachedCode),
            hasCachedIdToken: Boolean(cachedIdToken),
            hasCachedAccessToken: Boolean(cachedAccessToken),
          });
        }
        if (!cachedCode && !cachedIdToken && !cachedAccessToken) {
          return null;
        }
        result = {
          type: "success",
          params: {
            ...(cachedCode ? { code: cachedCode } : {}),
            ...(cachedIdToken ? { id_token: cachedIdToken } : {}),
            ...(cachedAccessToken ? { access_token: cachedAccessToken } : {}),
          },
        };
      }

      // Expo Google Auth can return tokens in different fields depending on platform/runtime.
      const rawUrl = (result as any)?.url;
      const urlIdToken = extractTokenFromAuthUrl(rawUrl, "id_token");
      const urlAccessToken = extractTokenFromAuthUrl(rawUrl, "access_token");
      const urlCode = extractTokenFromAuthUrl(rawUrl, "code");
      const authCode = pickFirstNonEmpty((result as any)?.params?.code, urlCode);
      const idToken = pickFirstNonEmpty(
        (result as any)?.params?.id_token,
        (result as any)?.params?.idToken,
        (result as any)?.authentication?.idToken,
        (result as any)?.authentication?.id_token,
        (result as any)?.authentication?.idtoken,
        urlIdToken
      );
      const accessToken = pickFirstNonEmpty(
        (result as any)?.params?.access_token,
        (result as any)?.params?.accessToken,
        (result as any)?.authentication?.accessToken,
        (result as any)?.authentication?.access_token,
        urlAccessToken
      );

      let resolvedIdToken = idToken;
      let resolvedAccessToken = accessToken;
      if (!resolvedIdToken && !resolvedAccessToken && authCode) {
        const redirectUriForExchange = pickFirstNonEmpty(
          googleRequest?.redirectUri,
          nativeRedirectUri,
          webRedirectUri
        );
        const exchangeClientId = pickFirstNonEmpty(
          googleClientId,
          Platform.OS === "ios" ? googleIosClientId : "",
          Platform.OS === "android" ? googleAndroidClientId : "",
          googleWebClientId
        );

        if (redirectUriForExchange && exchangeClientId) {
          try {
            const exchanged = await exchangeGoogleAuthCode({
              code: authCode,
              clientId: exchangeClientId,
              redirectUri: redirectUriForExchange,
              codeVerifier: (googleRequest as any)?.codeVerifier,
            });
            resolvedIdToken = exchanged.idToken || "";
            resolvedAccessToken = exchanged.accessToken || "";
          } catch (exchangeErr) {
            if (isGoogleInvalidGrantLikeError(exchangeErr)) {
              if (__DEV__) {
                console.debug("[google-auth] suppressed stale/invalid grant during exchange", {
                  message: String((exchangeErr as any)?.message || exchangeErr || ""),
                });
              }
              clearLastOAuthRedirectParams();
              clearAuthBridgeStoragePayload();
              if (Platform.OS !== "web" && googleWebClientId) {
                try {
                  return await runGoogleHostedFlow(googleWebRedirectUri, {
                    nativeReturnUrl: "kalatitmanisha://auth-bridge",
                    nativeStatePrefix: "native_gg_retry_",
                  });
                } catch (hostedErr) {
                  if (__DEV__) {
                    console.warn("[google-auth] hosted fallback after invalid grant failed", {
                      message: String((hostedErr as any)?.message || hostedErr || ""),
                    });
                  }
                }
              }
              return null;
            }
            throw exchangeErr;
          }
        }
      }

      if (!resolvedIdToken && !resolvedAccessToken) {
        if (__DEV__) {
          console.warn("[google-auth] no token in successful response", {
            resultType: result?.type,
            hasParams: Boolean((result as any)?.params),
            paramsKeys: Object.keys((result as any)?.params || {}),
            hasAuthentication: Boolean((result as any)?.authentication),
            authenticationKeys: Object.keys((result as any)?.authentication || {}),
            hasUrl: Boolean(rawUrl),
            hasCode: Boolean((result as any)?.params?.code || urlCode),
          });
        }
        if (authCode) {
          throw new Error(
            "Google OAuth returned an authorization code but no token. Please verify iOS/Android client IDs and redirect URI configuration."
          );
        }
        throw new Error("Google sign-in completed but no token was returned. Please retry and finish the Google prompt.");
      }

      const claims = decodeJwtPayload(resolvedIdToken) || {};
      return {
        idToken: resolvedIdToken || undefined,
        accessToken: resolvedAccessToken || undefined,
        email: String(claims?.email || "").trim() || undefined,
        firstName: String(claims?.given_name || "").trim() || undefined,
        lastName: String(claims?.family_name || "").trim() || undefined,
        name: String(claims?.name || "").trim() || undefined,
      };
    };

    const getFacebookAccessToken = async (): Promise<Partial<SocialAuthPayload> | null> => {
      if (!facebookAppId) {
        throw new Error(
          "Facebook App ID is missing. Set expo.extra.facebookAppId or EXPO_PUBLIC_FACEBOOK_APP_ID."
        );
      }
      const runFacebookHostedFlow = async (
        redirectUri: string,
        options?: { sameTabIOSWeb?: boolean; nativeReturnUrl?: string; nativeStatePrefix?: string }
      ): Promise<Partial<SocialAuthPayload> | null> => {
        clearAuthBridgeStoragePayload();
        const startedAt = Date.now();
        const statePrefix = String(options?.nativeStatePrefix || "");
        const state = `${statePrefix}${createRandomState(28)}`;
        const authUrl = [
          "https://www.facebook.com/v19.0/dialog/oauth",
          `?client_id=${encodeURIComponent(facebookAppId)}`,
          `&redirect_uri=${encodeURIComponent(redirectUri)}`,
          "&response_type=token",
          "&scope=public_profile,email",
          "&display=popup",
          `&state=${encodeURIComponent(state)}`,
        ].join("");

        if (options?.sameTabIOSWeb && isIOSWebSafari()) {
          navigateWebSameTab(authUrl);
          // Same-tab navigation on iOS Safari unloads current JS context.
          // Keep promise pending to avoid false "No token" errors before unload.
          return await new Promise(() => {});
        }

        let result:
          | { type: "success"; url: string }
          | { type: string; url?: string };
        try {
          const returnUrl = String(options?.nativeReturnUrl || redirectUri).trim() || redirectUri;
          result = (await WebBrowser.openAuthSessionAsync(
            authUrl,
            returnUrl
          )) as { type: string; url?: string };
        } catch (authErr) {
          throw new Error(mapFacebookAuthErrorToUserMessage(authErr));
        }

        const callbackUrl = String(result?.url || "").trim();
        const parseFromUrl = (rawUrl: string) => ({
          accessToken: extractTokenFromAuthUrl(rawUrl, "access_token"),
          authCode: extractTokenFromAuthUrl(rawUrl, "code"),
          returnedState: extractTokenFromAuthUrl(rawUrl, "state"),
          oauthError: extractTokenFromAuthUrl(rawUrl, "error") || extractTokenFromAuthUrl(rawUrl, "error_description"),
        });
        let parsed = parseFromUrl(callbackUrl);
        if (!parsed.accessToken && !parsed.authCode && !parsed.oauthError) {
          const bridgePayload = await waitForAuthBridgeOAuthPayload("facebook", startedAt);
          const cached =
            bridgePayload ||
            (await waitForOAuthRedirectParams()) ||
            readAuthBridgeStoragePayload() ||
            (globalThis as any)?.__lastOAuthRedirectParams ||
            null;
          if (cached && typeof cached === "object") {
            parsed = {
              accessToken: pickFirstNonEmpty(
                cached.access_token,
                cached.accessToken,
                Array.isArray(cached.access_token) ? cached.access_token[0] : "",
                Array.isArray(cached.accessToken) ? cached.accessToken[0] : ""
              ),
              authCode: pickFirstNonEmpty(
                cached.code,
                Array.isArray(cached.code) ? cached.code[0] : ""
              ),
              returnedState: pickFirstNonEmpty(
                cached.state,
                Array.isArray(cached.state) ? cached.state[0] : ""
              ),
              oauthError: pickFirstNonEmpty(
                cached.error,
                cached.error_description,
                Array.isArray(cached.error) ? cached.error[0] : ""
              ),
            };
          }
        }
        if (parsed.oauthError) {
          throw new Error(`Facebook sign-in failed: ${parsed.oauthError}`);
        }
        if (parsed.returnedState && parsed.returnedState !== state) {
          throw new Error("Facebook sign-in state mismatch. Please retry.");
        }
        if (!parsed.accessToken && !parsed.authCode) {
          return null;
        }
        clearAuthBridgeStoragePayload();
        return {
          ...(parsed.accessToken ? { accessToken: parsed.accessToken } : {}),
          ...(parsed.authCode ? { authCode: parsed.authCode } : {}),
          redirectUri,
        };
      };
      if (Platform.OS === "web") {
        return await runFacebookHostedFlow(facebookWebRedirectUri, { sameTabIOSWeb: true });
      }
      if (facebookUseHostedRedirectOnNative) {
        return await runFacebookHostedFlow(facebookWebRedirectUri, {
          nativeReturnUrl: "kalatitmanisha://oauthredirect",
          nativeStatePrefix: "native_fb_",
        });
      }
      if (!facebookRequest) {
        throw new Error("Facebook sign-in is still initializing. Please wait a moment and try again.");
      }

      let result: any;
      try {
        result = await promptFacebookAuthAsync();
      } catch (authErr) {
        throw new Error(mapFacebookAuthErrorToUserMessage(authErr));
      }

      let resolved = result;
      if (resolved?.type !== "success") {
        let cachedParams =
          (globalThis as any)?.__lastOAuthRedirectParams ||
          readAuthBridgeStoragePayload() ||
          null;
        const urlToken = extractTokenFromAuthUrl((resolved as any)?.url, "access_token");
        const urlCode = extractTokenFromAuthUrl((resolved as any)?.url, "code");
        let cachedAccessToken = pickFirstNonEmpty(
          urlToken,
          cachedParams?.access_token,
          cachedParams?.accessToken,
          Array.isArray(cachedParams?.access_token) ? cachedParams.access_token[0] : "",
          Array.isArray(cachedParams?.accessToken) ? cachedParams.accessToken[0] : ""
        );
        let cachedCode = pickFirstNonEmpty(
          urlCode,
          cachedParams?.code,
          Array.isArray(cachedParams?.code) ? cachedParams.code[0] : ""
        );
        if (!cachedAccessToken && !cachedCode) {
          const awaitedParams = await waitForOAuthRedirectParams();
          cachedParams = awaitedParams || readAuthBridgeStoragePayload() || cachedParams;
          cachedAccessToken = pickFirstNonEmpty(
            urlToken,
            cachedParams?.access_token,
            cachedParams?.accessToken,
            Array.isArray(cachedParams?.access_token) ? cachedParams.access_token[0] : "",
            Array.isArray(cachedParams?.accessToken) ? cachedParams.accessToken[0] : ""
          );
          cachedCode = pickFirstNonEmpty(
            urlCode,
            cachedParams?.code,
            Array.isArray(cachedParams?.code) ? cachedParams.code[0] : ""
          );
        }
        if (!cachedAccessToken && !cachedCode) {
          return null;
        }
        resolved = {
          type: "success",
          params: {
            ...(cachedAccessToken ? { access_token: cachedAccessToken } : {}),
            ...(cachedCode ? { code: cachedCode } : {}),
          },
        };
      }

      const accessToken = pickFirstNonEmpty(
        (resolved as any)?.params?.access_token,
        (resolved as any)?.authentication?.accessToken,
        extractTokenFromAuthUrl((resolved as any)?.url, "access_token")
      );
      const authCode = pickFirstNonEmpty(
        (resolved as any)?.params?.code,
        extractTokenFromAuthUrl((resolved as any)?.url, "code")
      );
      if (!accessToken && !authCode) {
        throw new Error("Facebook sign-in completed but no access token was returned.");
      }
      clearAuthBridgeStoragePayload();
      return {
        ...(accessToken ? { accessToken } : {}),
        ...(authCode ? { authCode } : {}),
        redirectUri: facebookRedirectUri,
      };
    };
    const getAppleIdToken = async (): Promise<Partial<SocialAuthPayload> | null> => {
      if (Platform.OS === "web") {
        if (!appleWebClientId) {
          throw new Error(
            "Apple web client ID is missing. Set expo.extra.appleWebClientId (Services ID) and appleRedirectUriWeb."
          );
        }
        const state = createRandomState(28);
        const nonce = createRandomState(28);
        const authUrl = [
          "https://appleid.apple.com/auth/authorize",
          `?client_id=${encodeURIComponent(appleWebClientId)}`,
          `&redirect_uri=${encodeURIComponent(appleWebRedirectUri)}`,
          "&response_type=code%20id_token",
          "&response_mode=fragment",
          `&state=${encodeURIComponent(state)}`,
          `&nonce=${encodeURIComponent(nonce)}`,
        ].join("");
        if (isIOSWebSafari()) {
          clearAuthBridgeStoragePayload();
          navigateWebSameTab(authUrl);
          return await new Promise(() => {});
        }
        let result:
          | { type: "success"; url: string }
          | { type: string; url?: string };
        try {
          result = (await WebBrowser.openAuthSessionAsync(
            authUrl,
            appleWebRedirectUri
          )) as { type: string; url?: string };
        } catch (authErr) {
          throw new Error(mapAppleAuthErrorToUserMessage(authErr));
        }
        if (result.type !== "success") {
          return null;
        }
        const callbackUrl = String(result.url || "").trim();
        const returnedState = pickFirstNonEmpty(
          extractTokenFromAuthUrl(callbackUrl, "state")
        );
        if (returnedState && returnedState !== state) {
          throw new Error("Apple sign-in state mismatch. Please retry.");
        }
        const idToken = pickFirstNonEmpty(
          extractTokenFromAuthUrl(callbackUrl, "id_token")
        );
        if (!idToken) {
          throw new Error("Apple sign-in completed but no identity token was returned.");
        }
        const claims = decodeJwtPayload(idToken) || {};
        const email = String(claims?.email || "").trim();
        const firstName = String(claims?.given_name || "").trim();
        const lastName = String(claims?.family_name || "").trim();
        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
        return {
          idToken,
          ...(email ? { email } : {}),
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
          ...(fullName ? { name: fullName } : {}),
        };
      }
      if (Platform.OS !== "ios") {
        throw new Error("Apple sign-in is available on iOS and web.");
      }
      if (!appleAuthAvailable) {
        throw new Error("Apple sign-in is unavailable on this device.");
      }

      try {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });

        const idToken = String(credential?.identityToken || "").trim();
        if (!idToken) {
          throw new Error("Apple sign-in completed but no identity token was returned.");
        }

        const claims = decodeJwtPayload(idToken) || {};
        const firstName = String(
          credential?.fullName?.givenName || claims?.given_name || ""
        ).trim();
        const lastName = String(
          credential?.fullName?.familyName || claims?.family_name || ""
        ).trim();
        const email = String(credential?.email || claims?.email || "").trim();
        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

        return {
          idToken,
          ...(email ? { email } : {}),
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
          ...(fullName ? { name: fullName } : {}),
        };
      } catch (authErr) {
        const mapped = mapAppleAuthErrorToUserMessage(authErr);
        if (mapped === "cancelled") return null;
        throw new Error(mapped);
      }
    };

    const getLinkedInAccessToken = async (): Promise<Partial<SocialAuthPayload> | null> => {
      if (!hasLinkedInConfig) {
        throw new Error(
          "LinkedIn OAuth client ID is missing. Set expo.extra.linkedinClientId or EXPO_PUBLIC_LINKEDIN_CLIENT_ID."
        );
      }
      const runLinkedInHostedFlow = async (
        redirectUri: string,
        options?: { sameTabIOSWeb?: boolean; nativeReturnUrl?: string; nativeStatePrefix?: string }
      ): Promise<Partial<SocialAuthPayload> | null> => {
        clearAuthBridgeStoragePayload();
        const startedAt = Date.now();
        const statePrefix = String(options?.nativeStatePrefix || "");
        const state = `${statePrefix}${createRandomState(28)}`;
        const authUrl = [
          "https://www.linkedin.com/oauth/v2/authorization",
          `?response_type=code`,
          `&client_id=${encodeURIComponent(linkedinClientId)}`,
          `&redirect_uri=${encodeURIComponent(redirectUri)}`,
          `&state=${encodeURIComponent(state)}`,
          `&scope=${encodeURIComponent("openid profile email")}`,
        ].join("");

        if (options?.sameTabIOSWeb && isIOSWebSafari()) {
          navigateWebSameTab(authUrl);
          return await new Promise(() => {});
        }

        let result:
          | { type: "success"; url: string }
          | { type: string; url?: string };
        try {
          const returnUrl = String(options?.nativeReturnUrl || redirectUri).trim() || redirectUri;
          result = (await WebBrowser.openAuthSessionAsync(
            authUrl,
            returnUrl
          )) as { type: string; url?: string };
        } catch (authErr) {
          const message = String((authErr as any)?.message || authErr || "").trim();
          throw new Error(message || "LinkedIn sign-in failed. Please try again.");
        }

        const callbackUrl = String(result?.url || "").trim();
        const parseFromUrl = (rawUrl: string) => ({
          accessToken: extractTokenFromAuthUrl(rawUrl, "access_token"),
          authCode: extractTokenFromAuthUrl(rawUrl, "code"),
          returnedState: extractTokenFromAuthUrl(rawUrl, "state"),
          oauthError:
            extractTokenFromAuthUrl(rawUrl, "error") ||
            extractTokenFromAuthUrl(rawUrl, "error_description"),
        });
        let parsed = parseFromUrl(callbackUrl);

        if (!parsed.accessToken && !parsed.authCode && !parsed.oauthError) {
          const bridgePayload = await waitForAuthBridgeOAuthPayload("linkedin", startedAt);
          const cached =
            bridgePayload ||
            (await waitForOAuthRedirectParams()) ||
            readAuthBridgeStoragePayload() ||
            (globalThis as any)?.__lastOAuthRedirectParams ||
            null;
          if (cached && typeof cached === "object") {
            parsed = {
              accessToken: pickFirstNonEmpty(
                cached.access_token,
                cached.accessToken,
                Array.isArray(cached.access_token) ? cached.access_token[0] : "",
                Array.isArray(cached.accessToken) ? cached.accessToken[0] : ""
              ),
              authCode: pickFirstNonEmpty(
                cached.code,
                Array.isArray(cached.code) ? cached.code[0] : ""
              ),
              returnedState: pickFirstNonEmpty(
                cached.state,
                Array.isArray(cached.state) ? cached.state[0] : ""
              ),
              oauthError: pickFirstNonEmpty(
                cached.error,
                cached.error_description,
                Array.isArray(cached.error) ? cached.error[0] : ""
              ),
            };
          }
        }

        if (parsed.oauthError) {
          throw new Error(`LinkedIn sign-in failed: ${parsed.oauthError}`);
        }
        if (parsed.returnedState && parsed.returnedState !== state) {
          throw new Error("LinkedIn sign-in state mismatch. Please retry.");
        }
        if (!parsed.accessToken && !parsed.authCode) {
          return null;
        }

        clearAuthBridgeStoragePayload();
        return {
          ...(parsed.accessToken ? { accessToken: parsed.accessToken } : {}),
          ...(parsed.authCode ? { authCode: parsed.authCode } : {}),
          redirectUri,
        };
      };

      if (Platform.OS === "web") {
        const primary = await runLinkedInHostedFlow(linkedinWebRedirectUri, { sameTabIOSWeb: true });
        if (primary?.accessToken || primary?.authCode) return primary;
        return null;
      }
      if (linkedinUseHostedRedirectOnNative) {
        const primary = await runLinkedInHostedFlow(linkedinWebRedirectUri, {
          nativeReturnUrl: "kalatitmanisha://oauthredirect",
          nativeStatePrefix: "native_li_",
        });
        if (primary?.accessToken || primary?.authCode) return primary;
        return null;
      }
      if (!linkedinRequest) {
        throw new Error("LinkedIn sign-in is still initializing. Please wait a moment and try again.");
      }

      let result: any;
      try {
        clearLastOAuthRedirectParams();
        result = await promptLinkedInAuthAsync();
      } catch (authErr) {
        const message = String((authErr as any)?.message || authErr || "").trim();
        throw new Error(message || "LinkedIn sign-in failed. Please try again.");
      }

      if (result?.type !== "success") {
        if (__DEV__) {
          console.debug("[linkedin-auth] ignoring cached redirect params on native non-success", {
            resultType: result?.type,
          });
        }
        return null;
      }

      const accessToken = pickFirstNonEmpty(
        (result as any)?.params?.access_token,
        (result as any)?.authentication?.accessToken,
        extractTokenFromAuthUrl((result as any)?.url, "access_token")
      );
      const authCode = pickFirstNonEmpty(
        (result as any)?.params?.code,
        extractTokenFromAuthUrl((result as any)?.url, "code")
      );
      if (!accessToken && !authCode) {
        throw new Error("LinkedIn sign-in completed but no token/code was returned.");
      }
      clearAuthBridgeStoragePayload();
      return {
        ...(accessToken ? { accessToken } : {}),
        ...(authCode ? { authCode } : {}),
        redirectUri: linkedinRequest?.redirectUri ?? linkedinRedirectUri,
      };
    };
    root.__getGoogleIdToken = getGoogleIdToken;
    root.__getFacebookAccessToken = getFacebookAccessToken;
    root.__getAppleIdToken = getAppleIdToken;
    root.__getLinkedInAccessToken = getLinkedInAccessToken;
    return () => {
      if (root.__getGoogleIdToken === getGoogleIdToken) {
        root.__getGoogleIdToken = previous;
      }
      if (root.__getFacebookAccessToken === getFacebookAccessToken) {
        root.__getFacebookAccessToken = previousFacebook;
      }
      if (root.__getAppleIdToken === getAppleIdToken) {
        root.__getAppleIdToken = previousApple;
      }
      if (root.__getLinkedInAccessToken === getLinkedInAccessToken) {
        root.__getLinkedInAccessToken = previousLinkedIn;
      }
    };
  }, [
    googleRequest?.redirectUri,
    googleRequest,
    googleWebRedirectUri,
    googleUseHostedRedirectOnNative,
    facebookRequest,
    facebookAppId,
    nativeRedirectUri,
    googleClientId,
    googleExpoClientId,
    googleWebClientId,
    googleAndroidClientId,
    googleIosClientId,
    appleAuthAvailable,
    hasFacebookConfig,
    facebookRedirectUri,
    facebookNativeRedirectUri,
    facebookWebRedirectUri,
    facebookRequest?.redirectUri,
    promptGoogleAuthAsync,
    promptFacebookAuthAsync,
    promptLinkedInAuthAsync,
    linkedinClientId,
    linkedinRedirectUri,
    linkedinNativeRedirectUri,
    linkedinWebRedirectUri,
    linkedinUseHostedRedirectOnNative,
    linkedinRequest,
    linkedinRequest?.redirectUri,
    hasLinkedInConfig,
    appleWebClientId,
    appleWebRedirectUri,
  ]);

  const commitSession = useCallback(async (nextSessionId: string) => {
    setSessionIdState(nextSessionId);
    await setSessionToken(nextSessionId);
  }, []);

  const clearSession = useCallback(async () => {
    removeSessionCacheEntry(sessionIdRef.current ?? undefined);
    setSessionIdState(null);
    setUser(null);
    await clearSessionToken();
    await clearUserId();
  }, []);

  const resetForms = useCallback(() => {
    setLoginEmail("");
    setLoginPassword("");
    setSignupName("");
    setSignupEmail("");
    setSignupPhone("");
    setForgotEmail("");
    setForgotComplete(false);
    setForgotSentTo("");
    setErrorMsg(null);
    setStatusMsg(null);
  }, []);

  const fetchMemberProfile = useCallback(
    async (memberId: string, token: string) => {
      if (!memberId || !token) return null;
      try {
        const response = await apiGetMemberProfile(memberId, token);
      if (!response.success) {
        if (__DEV__) {
          console.debug("[fetchMemberProfile] payload missing success:", response);
        }
        return null;
      }
        const payload = pickMemberPayload(response);
      if (!payload) {
        if (__DEV__) console.debug("[fetchMemberProfile] missing payload", response);
        return null;
      }
      const normalized = normalizeUser(payload);
      const result = normalized.id ? normalized : null;
      if (!result && __DEV__) {
        console.debug("[fetchMemberProfile] normalized lacks id", payload);
      }
      return result;
      } catch (error) {
        if (__DEV__) console.debug("[auth] fetchMemberProfile failed:", error);
        return null;
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedSession = await getSessionToken();

        if (!storedSession) {
          await clearSession();
          if (!cancelled) setInitializing(false);
          return;
        }
        if (cancelled) return;

        setSessionIdState(storedSession);
        setUser(null);

        // refresh logging removed to reduce noise
        const refreshResponse = await apiRefreshSession(storedSession);
        // refresh logging removed to reduce noise
        if (!refreshResponse.success) {
          await clearSession();
          return;
        }
        if (cancelled) return;

        const fallbackProfile = refreshResponse.memberData ?? refreshResponse.result ?? refreshResponse ?? {};
        const memberPayload = pickMemberPayload(refreshResponse);
        if (!memberPayload && Object.keys(fallbackProfile).length === 0) {
          await clearSession();
          return;
        }

        const normalizedUser = ensureFirstNamePrimary(
          normalizeUser(memberPayload ?? fallbackProfile, fallbackProfile),
          fallbackProfile as RawUser
        );
        if (normalizedUser.id) {
          await setUserId(normalizedUser.id);
        }
        setUser(normalizedUser);
        const refreshedSessionId = refreshResponse.sessionId ?? storedSession;
        if (!refreshedSessionId) {
          await clearSession();
          return;
        }
        cacheSessionPayload(refreshedSessionId, fallbackProfile);
        await commitSession(refreshedSessionId);
      } catch (error) {
        if (__DEV__) console.debug("[auth] hydrate failed:", error);
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearSession, commitSession]);

  const changeMode = useCallback(
    (nextMode: AuthMode) => {
      setMode(nextMode);
      setSubmitting(false);
      setErrorMsg(null);
      if (nextMode !== "forgot") setStatusMsg(null);
      if (nextMode !== "forgot") {
        setForgotComplete(false);
        setForgotSentTo("");
        setSignupProvider("email");
      }
    },
    []
  );

  const refreshUser = useCallback(async () => {
    if (!sessionId || !user?.id) return;
    try {
      const normalized = await fetchMemberProfile(user.id, sessionId);
      if (normalized) {
        setUser(normalized);
      } else {
        await clearSession();
      }
    } catch (error) {
      if (__DEV__) console.debug("[auth] refresh user failed:", error);
    }
  }, [sessionId, user?.id, fetchMemberProfile, clearSession]);


  const getProfile = useCallback(async () => {
    if (!sessionId || !user?.id) return;
    try {
      const normalized = await fetchMemberProfile(user.id, sessionId);
      if (normalized) {
        setUser(normalized);
      } else {
        await clearSession();
      }
    } catch (error) {
      if (__DEV__) console.debug("[auth] get profile failed:", error);
    }
  }, [sessionId, user?.id, fetchMemberProfile, clearSession]);

  const updateProfile = useCallback(
    async (payload: { firstName?: string; lastName?: string; phone?: string; nickname?: string; avatarUrl?: string }) => {
      if (!sessionId) throw new Error("Not authenticated");
      const resolvedUserId = user?.id || (await getUserId()) || "";
      if (!resolvedUserId) throw new Error("Missing user id");
      const body: UpdateProfilePayload = { memberId: resolvedUserId };
      const firstName = payload.firstName?.trim();
      const lastName = payload.lastName?.trim();
      const phone = payload.phone?.trim();
      const nickname = payload.nickname?.trim();
      const avatarUrl = payload.avatarUrl?.trim();
      if (firstName) body.firstName = firstName;
      if (lastName) body.lastName = lastName;
      if (phone) body.phone = phone;
      if (nickname) body.nickname = nickname;
      if (avatarUrl) body.avatarUrl = avatarUrl;
      if (!body.firstName && !body.lastName && !body.phone && !body.nickname && !body.avatarUrl) {
        return;
      }
      const response = await apiUpdateProfile(body, sessionId);
      if (!response.success) {
        throw new Error(response.message ?? response.error ?? "Unable to update profile");
      }
      await refreshUser();
    },
    [apiUpdateProfile, refreshUser, sessionId, user?.id]
  );

  const deleteAccount = useCallback(async () => {
    if (!sessionId) throw new Error("Not authenticated");
    const response = await apiDeleteAccount(sessionId);
    if (!response.success) {
      const rawMessage = String(response.message ?? response.error ?? "").trim();
      const normalized = rawMessage.toLowerCase();
      if (
        normalized.includes("not found") ||
        normalized.includes("site member not found") ||
        normalized.includes("member_not_found")
      ) {
        await clearSession();
        return;
      }
      throw new Error(rawMessage || "Unable to delete account");
    }
    await clearSession();
  }, [clearSession, sessionId]);

  const openLogin = useCallback((nextMode: AuthMode = "login") => {
    const webAuthEnabled = (globalThis as any).__webAuthEnabled !== false;
    const webAuthOverride = (globalThis as any).__webAuthOverride === true;
    const loginEnabled = webAuthEnabled || webAuthOverride;
    if (Platform.OS === "web" && !loginEnabled) return;
    changeMode(nextMode);
    setErrorMsg(null);
    setStatusMsg(null);
    setSubmitting(false);
    setOpen(true);
  }, [changeMode]);

  const promptLogin = useCallback((identifier?: string) => {
    const webAuthEnabled = (globalThis as any).__webAuthEnabled !== false;
    const webAuthOverride = (globalThis as any).__webAuthOverride === true;
    const loginEnabled = webAuthEnabled || webAuthOverride;
    if (Platform.OS === "web" && !loginEnabled) return;
    const normalizedIdentifier = String(identifier || "").trim();
    changeMode("login");
    setErrorMsg(null);
    setStatusMsg(null);
    setSubmitting(false);
    setLoginPassword("");
    if (normalizedIdentifier) {
      setLoginEmail(normalizedIdentifier);
    }
    setOpen(true);
  }, [changeMode]);

  const promptRestrictedAction = useCallback(
    (
      message = "You need to sign up or sign in to use this feature.",
      nextMode: AuthMode = "signup"
    ) => {
      const webAuthEnabled = (globalThis as any).__webAuthEnabled !== false;
      const webAuthOverride = (globalThis as any).__webAuthOverride === true;
      const loginEnabled = webAuthEnabled || webAuthOverride;
      if (Platform.OS === "web" && !loginEnabled) return;
      changeMode(nextMode);
      setErrorMsg(null);
      setStatusMsg(String(message || "").trim());
      setSubmitting(false);
      setOpen(true);
    },
    [changeMode]
  );

  const closeLogin = useCallback(() => {
    setOpen(false);
    setTimeout(() => {
      resetForms();
      changeMode("login");
    }, 250);
  }, [resetForms, changeMode]);

  const completeAuthSession = useCallback(
    async (response: any) => {
      if (!response?.success || !response?.sessionId) {
        throw new Error(response?.message ?? response?.error ?? "Authentication failed");
      }

      await commitSession(response.sessionId);

      const fallbackProfile = response.memberData ?? response.result ?? response ?? {};
      const memberPayload = pickMemberPayload(response);
      cacheSessionPayload(response.sessionId, fallbackProfile);

      const normalizedUser = ensureFirstNamePrimary(
        normalizeUser(memberPayload ?? fallbackProfile, fallbackProfile),
        fallbackProfile as RawUser
      );
      if (normalizedUser.id) {
        await setUserId(normalizedUser.id);
      }
      setUser(normalizedUser);
      closeLogin();
      return { success: true, user: normalizedUser };
    },
    [closeLogin, commitSession]
  );

  const login = useCallback(
    async (payload: AuthCredentials) => {
      const identifier = (payload.identifier || (payload as any).email || "").trim();
      const password = payload.password;
      if (!identifier || !password) throw new Error("Email and password are required");

      const response = await apiLogin({ ...payload, identifier });
      return completeAuthSession(response);
    },
    [completeAuthSession]
  );

  const socialSignIn = useCallback(
    async (provider: SocialProvider, payload: Partial<SocialAuthPayload> = {}) => {
      const response = await apiSocialAuth({
        provider,
        ...payload,
      });
      if (__DEV__) {
        console.debug("[auth] socialAuth response", {
          provider,
          success: response?.success,
          errorCode: response?.errorCode,
          message: response?.message || response?.error,
          hasSessionId: Boolean(response?.sessionId),
          wixSessionLinked: (response as any)?.result?.wixSessionLinked,
        });
      }
      if (!response?.success) {
        if (response?.errorCode === "SOCIAL_EMAIL_ALREADY_EXISTS") {
          const existingEmail = String((response as any)?.email || payload?.email || signupEmail || "").trim();
          closeLogin();
          const fallbackStatus =
            response?.message ||
            "Account already exists. Reset instructions were sent to your email.";
          router.push({
            pathname: "/forgot-password",
            params: {
              ...(existingEmail ? { identifier: existingEmail } : {}),
              status: fallbackStatus,
            },
          });
          return { success: false };
        }
        throw new Error(response?.message ?? response?.error ?? "Social sign in failed");
      }
      const setupEmail = String(
        (response as any)?.result?.memberData?.email ??
          (response as any)?.memberData?.email ??
          (response as any)?.email ??
          payload?.email ??
          signupEmail ??
          ""
      ).trim();
      const needsPasswordSetup =
        Boolean((response as any)?.requiresPasswordSetup) ||
        response?.errorCode === "PASSWORD_SETUP_REQUIRED" ||
        response?.errorCode === "PASSWORD_SETUP_EMAIL_SENT";
      if (response?.success && !response?.sessionId && needsPasswordSetup) {
        closeLogin();
        router.push({
          pathname: "/forgot-password",
          params: {
            ...(setupEmail ? { identifier: setupEmail } : {}),
            status:
              response?.message ??
              "Password setup email sent. Please complete setup from your inbox.",
          },
        });
        return { success: true, requiresPasswordSetup: true };
      }
      const authResult = await completeAuthSession(response);
      const shouldCompleteProfile =
        Boolean((response as any)?.shouldCompleteProfile) ||
        Boolean((response as any)?.result?.shouldCompleteProfile) ||
        Boolean((response as any)?.isNewMember) ||
        Boolean((response as any)?.result?.isNewMember);
      if (shouldCompleteProfile) {
        router.push("/profile");
      }
      return authResult;
    },
    [closeLogin, completeAuthSession, router, signupEmail]
  );

  const signUp = useCallback(
    async ({
      firstName,
      lastName,
      email,
      phone,
    }: Pick<RegisterPayload, "email" | "firstName" | "lastName" | "phone">) => {
      const trimmedEmail = email?.trim();
      if (!trimmedEmail) throw new Error("Email is required");

      const response = await apiRegister({
        email: trimmedEmail,
        firstName: firstName?.trim(),
        lastName: lastName?.trim(),
        phone: phone?.trim(),
      });

      if (!response.success) {
        const isExistingEmail = response.errorCode === "EMAIL_ALREADY_REGISTERED" || response.status === 409;
        if (isExistingEmail) {
          const recovery = await apiForgotPassword(trimmedEmail);
          if (recovery?.success) {
            return {
              success: true,
              message:
                recovery.message ??
                "Account already exists. We sent a password reset link to your email.",
            };
          }
          throw new Error(
            recovery?.message ??
            recovery?.error ??
            "Account already exists and password recovery email could not be delivered."
          );
        }
        throw new Error(response.message ?? response.error ?? "Unable to create account");
      }

      return {
        success: true,
        message:
          response.message ??
          "Account created. Check your email, set your password, then sign in to continue.",
      };
    },
    []
  );

  const forgotPassword = useCallback(async (identifier: string) => {
    const trimmed = identifier.trim();
    if (!trimmed) throw new Error("Please enter your email");

    const response = await apiForgotPassword(trimmed);
    if (!response.success) {
      const serverMessage =
        response.error ??
        (response as any)?.message ??
        (response as any)?.errorDescription ??
        (response as any)?.errorMessage;
      throw new Error(serverMessage ?? "Unable to process request");
    }

    const message =
      (response as any)?.message ??
      "If an account exists for that email, you'll receive reset instructions shortly.";

    return {
      success: true,
      message,
      nextAction: String((response as any)?.nextAction || "").trim(),
      resetToken: String((response as any)?.resetToken || "").trim() || undefined,
      email: String((response as any)?.email || trimmed).trim() || undefined,
    };
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    const runSignOut = async () => {
      try {
        if (sessionId) {
          const response = await apiSignOut(sessionId);
          if (!response.success && __DEV__) {
            console.debug("[auth] signOut failed:", response);
          }
        }
      } catch (error) {
        if (__DEV__) console.debug("[auth] signOut error:", error);
      } finally {
        await clearSession();
      }
    };
    void runSignOut();
  }, [clearSession, sessionId]);

  const value = useMemo<AuthModalContextValue>(
    () => ({
      isOpen,
      user,
      sessionId,
      isGuest: !sessionId,
      initializing,
      mode,
      openLogin,
      promptLogin,
      promptRestrictedAction,
      closeLogin,
      login,
      signUp,
      forgotPassword,
      socialSignIn,
      logout,
      refreshUser,
      updateProfile,
      deleteAccount,
      getProfile,
      setUser,
    }),
    [
      isOpen,
      user,
      sessionId,
      initializing,
      mode,
      openLogin,
      promptLogin,
      promptRestrictedAction,
      closeLogin,
      login,
      signUp,
      forgotPassword,
      socialSignIn,
      logout,
      refreshUser,
      updateProfile,
      deleteAccount,
      getProfile,
    ]
  );

  const handlePrimary = useCallback(async () => {
    if (submitting) return;
    try {
      setSubmitting(true);
      setErrorMsg(null);
      setStatusMsg(null);
      if (mode === "login") {
        const identifier = loginEmail.trim();
        if (!identifier || !loginPassword) {
          throw new Error("Please enter email and password");
        }
        await login({ identifier: loginEmail.trim(), password: loginPassword });
        closeLogin();
      } else if (mode === "signup") {
        const trimmedEmail = signupEmail.trim();
        if (!isEmailValid(trimmedEmail)) {
          throw new Error("Please enter a valid email");
        }
        const trimmedName = signupName.trim();
        const [first = "", ...rest] = trimmedName.split(" ");
        const last = rest.join(" ");
        const result = await signUp({
          firstName: first,
          lastName: last,
          email: trimmedEmail,
          phone: signupPhone.trim(),
        });
        setStatusMsg(
          result.message ?? "Account created. Check your email, set your password, then sign in to continue."
        );
        setSignupName("");
        setSignupEmail("");
        setSignupPhone("");
        setForgotComplete(false);
        setMode("login");
      } else {
        const trimmed = forgotEmail.trim();
        if (!isEmailValid(trimmed)) {
          throw new Error("Please enter a valid email");
        }
        const result = await forgotPassword(trimmed);
        setStatusMsg(result.message);
        setForgotEmail("");
        setForgotComplete(true);
        setForgotSentTo(trimmed);
      }
    } catch (error: any) {
      setErrorMsg(error?.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }, [
    mode,
    login,
    loginEmail,
    loginPassword,
    signUp,
    signupName,
    signupEmail,
    signupPhone,
    forgotPassword,
    forgotEmail,
    closeLogin,
    router,
  ]);

  const isEmailValid = (value: string) => /\S+@\S+\.\S+/.test(value.trim());
  const visibleSocialButtons = useMemo(
    () =>
      SOCIAL_BUTTONS.filter((provider) => {
        if (!provider.enabled) return false;
        if (provider.value === "apple") return Platform.OS === "ios" || Platform.OS === "web";
        return true;
      }),
    []
  );
  const handleSocialProvider = useCallback(
    async (provider: SocialProvider) => {
      try {
        setSubmitting(true);
        setErrorMsg(null);
        setStatusMsg(null);

        const fallbackEmail = signupEmail.trim();
        const fallbackToPasswordRecovery = async () => {
          if (!isEmailValid(fallbackEmail)) return false;
          const recovery = await forgotPassword(fallbackEmail);
          setStatusMsg(
            recovery?.message ||
            "Account recovery email sent. Please check your inbox to continue."
          );
          setErrorMsg(null);
          return true;
        };

        const factory = getSocialTokenFactory();
        if (!factory) {
          const recovered = await fallbackToPasswordRecovery();
          if (recovered) return;
          throw new Error(
            "Social sign-in is unavailable right now. Enter your email and use 'Send signup link' or 'Forgot password'."
          );
        }

        const tokenPayload = await Promise.resolve(factory(provider));
        if (!tokenPayload) {
          const recovered = await fallbackToPasswordRecovery();
          if (recovered) return;
          throw new Error(
            `No ${provider} token received. Enter your email to continue with password setup/reset.`
          );
        }

        await socialSignIn(provider, {
          ...tokenPayload,
          // Preserve provider identity claims as source-of-truth.
          email: tokenPayload?.email || signupEmail.trim() || undefined,
          firstName: tokenPayload?.firstName || undefined,
          lastName: tokenPayload?.lastName || undefined,
          name: tokenPayload?.name || undefined,
        });
      } catch (error: any) {
        const rawMessage = String(error?.message || "Social sign in failed").trim();
        setErrorMsg(getFriendlySocialAuthError(provider, rawMessage));
      } finally {
        setSubmitting(false);
      }
    },
    [signupEmail, signupName, socialSignIn, forgotPassword]
  );

  const renderSocialButtons = useCallback(
    (modeKey: "login" | "signup") => (
      <View style={styles.socialRow}>
        {visibleSocialButtons.map((provider) => {
          const disabled = submitting || !provider.enabled;
          const isSupportedProvider =
            provider.value === "google" ||
            provider.value === "facebook" ||
            provider.value === "apple" ||
            provider.value === "linkedin";
          return (
            <TouchableOpacity
              key={`${modeKey}-${provider.value}`}
              style={[
                styles.btn,
                styles.secondary,
                styles.socialBtn,
                !provider.enabled && styles.socialBtnDisabled,
              ]}
              onPress={() => {
                if (!isSupportedProvider || !provider.enabled) return;
                void handleSocialProvider(provider.value as SocialProvider).catch((error: any) => {
                  const rawMessage = String(error?.message || "Social sign in failed").trim();
                  setErrorMsg(getFriendlySocialAuthError(provider.value as SocialProvider, rawMessage));
                  setSubmitting(false);
                });
              }}
              disabled={disabled}
            >
              <View style={[styles.socialIconBadge, !provider.enabled && styles.socialIconBadgeDisabled]}>
                <AppIcon
                  family="ion"
                  name={
                    provider.value === "google"
                      ? "logo-google"
                      : provider.value === "facebook"
                      ? "logo-facebook"
                      : provider.value === "linkedin"
                      ? "logo-linkedin"
                      : "logo-apple"
                  }
                  size={13}
                  color={
                    !provider.enabled
                      ? "#94a3b8"
                      : provider.value === "google"
                      ? "#db4437"
                      : provider.value === "facebook"
                      ? "#1877F2"
                      : provider.value === "linkedin"
                      ? "#0A66C2"
                      : "#111827"
                  }
                />
              </View>
              <Text style={[styles.btnText, !provider.enabled && styles.btnTextDisabled]}>
                {provider.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    ),
    [handleSocialProvider, submitting, visibleSocialButtons]
  );

  const primaryDisabled = submitting;

  const primaryLabel =
    mode === "login"
      ? "Sign in"
      : mode === "signup"
      ? "Send signup link"
      : forgotComplete
      ? "Resend link"
      : "Send reset link";

  return (
    <AuthModalContext.Provider value={value}>
      {children}

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={closeLogin}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            {/* tabs removed per UX feedback */}

            {mode === "login" && (
              <>
                <Text style={styles.title}>Welcome back</Text>
                <Text style={styles.desc}>Use your email to sign in.</Text>

                <TextInput
                  value={loginEmail}
                  onChangeText={setLoginEmail}
                  placeholder="Email"
                  style={styles.input}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TextInput
                  value={loginPassword}
                  onChangeText={setLoginPassword}
                  placeholder="Password"
                  style={styles.input}
                  secureTextEntry
                />
                <TouchableOpacity
                  style={{ alignSelf: "flex-end", marginTop: 6 }}
                  onPress={() => changeMode("forgot")}
                >
                  <Text style={styles.link}>Forgot password?</Text>
                </TouchableOpacity>
                <Text style={styles.inlineMeta}>or continue with</Text>
                {renderSocialButtons("login")}
                <View style={styles.inlineDivider} />
                <Text style={styles.inlineMeta}>New here?</Text>
                <TouchableOpacity onPress={() => changeMode("signup")}>
                  <Text style={styles.link}>Create an account →</Text>
                </TouchableOpacity>
              </>
            )}

            {mode === "signup" && (
              <>
                <Text style={styles.title}>Create your account</Text>
                <Text style={styles.desc}>We’ll email you a secure link to finish signup.</Text>

                <TextInput
                  value={signupName}
                  onChangeText={setSignupName}
                  placeholder="Full name"
                  style={styles.input}
                  autoCapitalize="words"
                />
                <TextInput
                  value={signupEmail}
                  onChangeText={setSignupEmail}
                  placeholder="Email"
                  style={styles.input}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TextInput
                  value={signupPhone}
                  onChangeText={setSignupPhone}
                  placeholder="Phone (optional)"
                  style={styles.input}
                  keyboardType="phone-pad"
                />
                <Text style={styles.inlineMeta}>or continue with</Text>
                {renderSocialButtons("signup")}
              </>
            )}

            {mode === "forgot" && (
              <>
                <Text style={styles.title}>Reset your password</Text>
                <Text style={styles.desc}>Enter the email you use for Gita App.</Text>
                {forgotComplete ? (
                  <View style={styles.successCard}>
                    <Text style={styles.successTitle}>Link sent</Text>
                    <Text style={styles.successBody}>
                      Check <Text style={styles.bold}>{forgotSentTo}</Text>. We sent password reset
                      instructions—follow the link to finish resetting your password.
                    </Text>
                    <TouchableOpacity
                      style={[styles.btn, styles.secondary, { marginTop: 12 }]}
                      onPress={() => {
                        setForgotComplete(false);
                        setStatusMsg(null);
                        setForgotEmail(forgotSentTo);
                      }}
                      disabled={submitting}
                    >
                      <Text style={styles.btnText}>Didn't get it? Resend</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ marginTop: 8 }}
                      onPress={() => changeMode("login")}
                    >
                      <Text style={styles.link}>Back to login →</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ marginTop: 10 }}
                      onPress={() => promptLogin(forgotSentTo)}
                    >
                      <Text style={styles.link}>I have reset password</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TextInput
                      value={forgotEmail}
                      onChangeText={setForgotEmail}
                      placeholder="Email"
                      style={styles.input}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    {!isEmailValid(forgotEmail) && forgotEmail.length > 0 ? (
                      <Text style={styles.helper}>Enter a valid email address</Text>
                    ) : null}
                  </>
                )}
              </>
            )}

            {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
            {statusMsg ? <Text style={styles.success}>{statusMsg}</Text> : null}

            <View style={styles.actions}>
              <Pressable style={[styles.btn, styles.secondary]} onPress={closeLogin} disabled={submitting}>
                <Text style={styles.btnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.primary]}
                onPress={handlePrimary}
                disabled={primaryDisabled}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={[styles.btnText, styles.primaryText]}>{primaryLabel}</Text>}
              </Pressable>
            </View>

            {mode !== "login" && (
              <TouchableOpacity
                onPress={() => changeMode(mode === "signup" ? "login" : "login")}
                disabled={submitting}
              >
                <Text style={styles.switcher}>Back to login</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </AuthModalContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    backgroundColor: "#fff",
    width: "100%",
    maxWidth: 520,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  tabRow: {
    flexDirection: "row",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d0d0d0",
    overflow: "hidden",
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: "#efefef",
  },
  tabLabel: {
    fontWeight: "600",
    color: "#666",
  },
  tabLabelActive: {
    color: "#000",
  },
  title: { fontSize: 20, fontWeight: "700" },
  desc: { color: "#555", marginBottom: 4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 8 },
  socialRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  socialBtn: {
    minWidth: 120,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  socialBtnDisabled: { opacity: 0.65 },
  socialIconBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#cbd5e1",
  },
  socialIconBadgeDisabled: {
    backgroundColor: "#e5e7eb",
    borderColor: "#d1d5db",
  },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  secondary: { backgroundColor: "#eee" },
  primary: { backgroundColor: "#2e7d32" },
  btnText: { fontWeight: "600" },
  btnTextDisabled: { color: "#64748b" },
  primaryText: { color: "#fff" },
  error: { color: "#b00020", marginTop: 8 },
  success: { color: "#1b5e20", marginTop: 8 },
  switcher: { marginTop: 12, textAlign: "center", color: "#007AFF", fontWeight: "600" },
  helper: { marginTop: 4, color: "#b00020", fontSize: 12 },
  successCard: {
    backgroundColor: "#f1f9f1",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#cde8cd",
    marginTop: 10,
  },
  successTitle: { fontSize: 16, fontWeight: "700", color: "#1b5e20" },
  successBody: { marginTop: 6, color: "#1b5e20" },
  bold: { fontWeight: "700" },
  link: { color: "#007AFF", fontWeight: "600" },
  inlineMeta: { marginTop: 12, color: "#666" },
  inlineDivider: {
    marginTop: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  providerRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  providerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#999",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  providerButtonActive: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
});
