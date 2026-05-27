// src/context/AuthModalContext.tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Buffer } from "buffer";

import {
  AuthCredentials,
  RegisterPayload,
  UpdateProfilePayload,
  forgotPassword as apiForgotPassword,
  getMemberProfile as apiGetMemberProfile,
  login as apiLogin,
  register as apiRegister,
  refreshSession as apiRefreshSession,
  signOut as apiSignOut,
  updateProfile as apiUpdateProfile,
} from "@/utils/authApi";
import {
  clearSessionToken,
  getSessionToken,
  setSessionToken,
  setUserId,
  clearUserId,
} from "@/utils/storage";
import { cacheSessionPayload, removeSessionCacheEntry } from "@/utils/sessionCache";

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

const SIGNUP_PROVIDERS: Array<{ value: string; label: string; icon: string }> = [
  { value: "google", label: "Google", icon: "google" },
  { value: "facebook", label: "Facebook", icon: "facebook" },
  { value: "apple", label: "Apple", icon: "apple" },
  { value: "email", label: "Email", icon: "envelope" },
];

type RawUser = Partial<User> & Record<string, any>;

const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toGuid = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  return GUID_REGEX.test(value.trim()) ? value.trim() : undefined;
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
    toGuid(fallback?.id);

  const fallbackRawName = (source.name ?? fallback?.name ?? "").trim();
  const fallbackRawFirstName = fallbackRawName ? fallbackRawName.split(" ")[0] : undefined;

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
    (source.name ??
      profile.nickname ??
      [firstName, lastName].filter(Boolean).join(" ")) ||
    (loginEmail || "").split("@")[0] ||
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
  initializing: boolean;
  mode: AuthMode;
  openLogin: (nextMode?: AuthMode) => void;
  closeLogin: () => void;
  login: (payload: AuthCredentials) => Promise<{ success: boolean; user?: User }>;
  signUp: (payload: Pick<RegisterPayload, "email" | "firstName" | "lastName" | "phone">) => Promise<{ success: boolean; message?: string }>;
  forgotPassword: (identifier: string) => Promise<{ success: boolean; message: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateProfile: (payload: { firstName?: string; lastName?: string; phone?: string; nickname?: string; avatarUrl?: string }) => Promise<void>;
  getProfile: () => Promise<void>;
  setUser: (user: User | null) => void;
};

const AuthModalContext = createContext<AuthModalContextValue | undefined>(undefined);

export function useAuth(): AuthModalContextValue {
  const ctx = useContext(AuthModalContext);
  if (!ctx) throw new Error("useAuth must be used within AuthModalProvider");
  return ctx;
}

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
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
    async (payload: { firstName?: string; lastName?: string; phone?: string; nickname?: string }) => {
      if (!sessionId) throw new Error("Not authenticated");
      if (!user?.id) throw new Error("Missing user id");
      const body: UpdateProfilePayload = { memberId: user.id };
      const firstName = payload.firstName?.trim();
      const lastName = payload.lastName?.trim();
      const phone = payload.phone?.trim();
      const nickname = payload.nickname?.trim();
      if (firstName) body.firstName = firstName;
      if (lastName) body.lastName = lastName;
      if (phone) body.phone = phone;
      if (nickname) body.nickname = nickname;
      if (!body.firstName && !body.lastName && !body.phone && !body.nickname) {
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

  const openLogin = useCallback((nextMode: AuthMode = "login") => {
    changeMode(nextMode);
    setErrorMsg(null);
    setStatusMsg(null);
    setSubmitting(false);
    setOpen(true);
  }, [changeMode]);

  const closeLogin = useCallback(() => {
    setOpen(false);
    setTimeout(() => {
      resetForms();
      changeMode("login");
    }, 250);
  }, [resetForms, changeMode]);

  const login = useCallback(
    async (payload: AuthCredentials) => {
      const identifier = (payload.identifier || (payload as any).email || "").trim();
      const password = payload.password;
      if (!identifier || !password) throw new Error("Email and password are required");

      const response = await apiLogin({ ...payload, identifier });
      if (!response.success || !response.sessionId) {
        throw new Error(response.message ?? response.error ?? "Invalid credentials");
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
    [closeLogin, commitSession, clearSession]
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
        password: "placeholder", // backend ignores password, sends set-password email
        firstName: firstName?.trim(),
        lastName: lastName?.trim(),
        phone: phone?.trim(),
      });

      if (!response.success) {
        throw new Error(response.message ?? response.error ?? "Unable to create account");
      }

      return { success: true, message: response.message ?? "Check your email to finish creating your account." };
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
      initializing,
      mode,
      openLogin,
      closeLogin,
      login,
      signUp,
      forgotPassword,
      logout,
      refreshUser,
      updateProfile,
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
      closeLogin,
      login,
      signUp,
      forgotPassword,
      logout,
      refreshUser,
      updateProfile,
      getProfile,
    ]
  );

  const handlePrimary = useCallback(async () => {
    try {
      setSubmitting(true);
      setErrorMsg(null);
      setStatusMsg(null);
      if (mode === "login") {
        await login({ identifier: loginEmail.trim(), password: loginPassword });
      } else if (mode === "signup") {
        const trimmedName = signupName.trim();
        const [first = "", ...rest] = trimmedName.split(" ");
        const last = rest.join(" ");
        const result = await signUp({
          firstName: first,
          lastName: last,
          email: signupEmail.trim(),
          phone: signupPhone.trim(),
        });
        setStatusMsg(result.message ?? "Check your email to finish creating your account.");
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
  ]);

  const isEmailValid = (value: string) => /\S+@\S+\.\S+/.test(value.trim());
  const forgotDisabled = !isEmailValid(forgotEmail);
  const signupDisabled = !signupName.trim() || !isEmailValid(signupEmail);
  const primaryDisabled =
    submitting ||
    (mode === "forgot" ? forgotDisabled : mode === "signup" ? signupDisabled : false);

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
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  secondary: { backgroundColor: "#eee" },
  primary: { backgroundColor: "#2e7d32" },
  btnText: { fontWeight: "600" },
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
