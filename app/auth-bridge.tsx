import React, { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { FUNCTIONS_BASE } from "../utils/functionApi";

const AUTH_BRIDGE_STORAGE_KEY = "kalatit:auth-bridge";
const NATIVE_AUTH_BRIDGE_URI = "kalatitmanisha://auth-bridge";

type BridgeParams = {
  token?: string | string[];
  resetToken?: string | string[];
  passwordResetToken?: string | string[];
  recoveryToken?: string | string[];
  email?: string | string[];
  status?: string | string[];
  success?: string | string[];
  error?: string | string[];
  access_token?: string | string[];
  code?: string | string[];
  id_token?: string | string[];
};

const toSingle = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
};

const isTruthyFlag = (value: string): boolean => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "success" || normalized === "ok";
};

async function completeWebSocialAuthFromBridge(payload: {
  provider: string;
  access_token?: string;
  code?: string;
  id_token?: string;
  redirect_uri?: string;
}): Promise<{ success: boolean; sessionId?: string }> {
  const provider = String(payload.provider || "").trim().toLowerCase();
  if (!provider) return { success: false };
  const body: Record<string, string> = { provider };
  const accessToken = String(payload.access_token || "").trim();
  const authCode = String(payload.code || "").trim();
  const idToken = String(payload.id_token || "").trim();
  const redirectUri = String(payload.redirect_uri || "").trim();
  if (accessToken) body.accessToken = accessToken;
  if (authCode) body.authCode = authCode;
  if (idToken) body.idToken = idToken;
  if (redirectUri) body.redirectUri = redirectUri;
  if (!body.accessToken && !body.authCode && !body.idToken) return { success: false };

  try {
    const extra = (Constants?.expoConfig?.extra || {}) as Record<string, unknown>;
    const configuredAuthBase = String(extra.AUTH_BASE_URL || extra.authBaseUrl || "").trim();
    const authBase = configuredAuthBase || FUNCTIONS_BASE;
    const endpoint = `${authBase.replace(/\/$/, "")}/socialAuth`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const sessionId = String(data?.sessionId || "").trim();
    if (!res.ok || !data?.success || !sessionId) {
      return { success: false };
    }
    try {
      const webWindow = (globalThis as { window?: any }).window;
      const member =
        data?.result?.memberData ||
        data?.memberData ||
        data?.result?.member ||
        data?.member ||
        null;
      const memberId = String(member?._id || member?.id || member?.memberId || "").trim();
      webWindow?.localStorage?.setItem("sessionId", sessionId);
      if (memberId) {
        webWindow?.localStorage?.setItem("userId", memberId);
      }
    } catch {
      // ignore persistence errors
    }
    return { success: true, sessionId };
  } catch {
    return { success: false };
  }
}

export default function AuthBridgeScreen(): React.ReactElement {
  const params = useLocalSearchParams<BridgeParams>();
  const router = useRouter();
  const routedRef = useRef(false);

  const token = useMemo(() => toSingle(params.token), [params.token]);
  const resetToken = useMemo(() => toSingle(params.resetToken), [params.resetToken]);
  const passwordResetToken = useMemo(() => toSingle(params.passwordResetToken), [params.passwordResetToken]);
  const recoveryToken = useMemo(() => toSingle(params.recoveryToken), [params.recoveryToken]);
  const email = useMemo(() => toSingle(params.email), [params.email]);
  const status = useMemo(() => toSingle(params.status), [params.status]);
  const success = useMemo(() => toSingle(params.success), [params.success]);
  const error = useMemo(() => toSingle(params.error), [params.error]);
  const accessTokenParam = useMemo(() => toSingle(params.access_token), [params.access_token]);
  const codeParam = useMemo(() => toSingle(params.code), [params.code]);
  const idTokenParam = useMemo(() => toSingle(params.id_token), [params.id_token]);

  useEffect(() => {
    if (routedRef.current) return;
    routedRef.current = true;

    // Ensure web popup OAuth flows (especially Facebook implicit token flows)
    // can resolve back to the opener before this screen navigates away.
    try {
      WebBrowser.maybeCompleteAuthSession();
    } catch {
      // ignore auth completion guard failures
    }

    const persistedParamsFromRoute = {
      ...(codeParam ? { code: codeParam } : {}),
      ...(accessTokenParam ? { access_token: accessTokenParam } : {}),
      ...(idTokenParam ? { id_token: idTokenParam } : {}),
      ...(error ? { error } : {}),
      ...(status ? { status } : {}),
      ...(success ? { success } : {}),
      ...(token ? { token } : {}),
      ...(resetToken ? { resetToken } : {}),
      ...(passwordResetToken ? { passwordResetToken } : {}),
      ...(recoveryToken ? { recoveryToken } : {}),
      ...(email ? { email } : {}),
      capturedAt: Date.now(),
    };
    if (Object.keys(persistedParamsFromRoute).length > 1) {
      (globalThis as any).__lastOAuthRedirectParams = {
        ...(globalThis as any).__lastOAuthRedirectParams,
        ...persistedParamsFromRoute,
      };
    }

    const webWindow = (globalThis as { window?: any }).window;
    if (webWindow?.location) {
      try {
        const url = String(webWindow.location.href || "");
        const parsed = new URL(url);
        const hashParams = new URLSearchParams(String(parsed.hash || "").replace(/^#/, ""));
        const searchParams = parsed.searchParams;
        const bridgePayload = {
          provider: "",
          url,
          access_token: String(hashParams.get("access_token") || searchParams.get("access_token") || "").trim(),
          code: String(hashParams.get("code") || searchParams.get("code") || "").trim(),
          id_token: String(hashParams.get("id_token") || searchParams.get("id_token") || "").trim(),
          error: String(hashParams.get("error") || searchParams.get("error") || "").trim(),
          state: String(hashParams.get("state") || searchParams.get("state") || "").trim(),
          redirect_uri: `${parsed.origin}${parsed.pathname}`,
          ts: Date.now(),
        };
        const state = String(bridgePayload.state || "").trim();
        bridgePayload.provider =
          /^native_gg_/i.test(state)
            ? "google"
            : bridgePayload.id_token
            ? "apple"
            : bridgePayload.access_token
              ? "facebook"
              : bridgePayload.code
                ? "linkedin"
                : "";
        if (bridgePayload.access_token || bridgePayload.code || bridgePayload.id_token || bridgePayload.error) {
          (globalThis as any).__lastOAuthRedirectParams = {
            ...(globalThis as any).__lastOAuthRedirectParams,
            ...bridgePayload,
            capturedAt: Date.now(),
          };
        }
        try {
          webWindow.localStorage?.setItem(AUTH_BRIDGE_STORAGE_KEY, JSON.stringify(bridgePayload));
        } catch {
          // ignore storage fallback failures
        }
        if (webWindow?.opener) {
          const payload = {
            type: "expo-auth-session",
            url,
            params: {
              provider: bridgePayload.provider,
              access_token: bridgePayload.access_token,
              code: bridgePayload.code,
              id_token: bridgePayload.id_token,
              error: bridgePayload.error,
              state: bridgePayload.state,
            },
          };
          webWindow.opener.postMessage(payload, "*");
        }

        const openerExists = Boolean(webWindow?.opener);
        if (!openerExists && (bridgePayload.access_token || bridgePayload.code || bridgePayload.id_token || bridgePayload.error)) {
          const nativeFacebookState = /^native_fb_/i.test(String(bridgePayload.state || "").trim());
          const nativeGoogleState = /^native_gg_/i.test(String(bridgePayload.state || "").trim());
          const nativeLinkedInState = /^native_li_/i.test(String(bridgePayload.state || "").trim());
          if (bridgePayload.provider === "google" && nativeGoogleState) {
            const deepLink = [
              NATIVE_AUTH_BRIDGE_URI,
              "?provider=google",
              `&state=${encodeURIComponent(String(bridgePayload.state || "").trim())}`,
              bridgePayload.id_token ? `&id_token=${encodeURIComponent(bridgePayload.id_token)}` : "",
              bridgePayload.access_token ? `&access_token=${encodeURIComponent(bridgePayload.access_token)}` : "",
              bridgePayload.code ? `&code=${encodeURIComponent(bridgePayload.code)}` : "",
              bridgePayload.error ? `&error=${encodeURIComponent(bridgePayload.error)}` : "",
            ].join("");
            try {
              webWindow.location.replace(deepLink);
            } catch {
              try {
                webWindow.location.href = deepLink;
              } catch {
                // ignore and continue to web fallback
              }
            }
            return;
          }
          if (bridgePayload.provider === "facebook" && nativeFacebookState) {
            const deepLink = [
              NATIVE_AUTH_BRIDGE_URI,
              "?provider=facebook",
              `&state=${encodeURIComponent(String(bridgePayload.state || "").trim())}`,
              bridgePayload.access_token ? `&access_token=${encodeURIComponent(bridgePayload.access_token)}` : "",
              bridgePayload.error ? `&error=${encodeURIComponent(bridgePayload.error)}` : "",
            ].join("");
            try {
              webWindow.location.replace(deepLink);
            } catch {
              try {
                webWindow.location.href = deepLink;
              } catch {
                // ignore and continue to web fallback
              }
            }
            return;
          }
          if (bridgePayload.provider === "linkedin" && nativeLinkedInState) {
            const deepLink = [
              NATIVE_AUTH_BRIDGE_URI,
              "?provider=linkedin",
              `&state=${encodeURIComponent(String(bridgePayload.state || "").trim())}`,
              bridgePayload.code ? `&code=${encodeURIComponent(bridgePayload.code)}` : "",
              bridgePayload.error ? `&error=${encodeURIComponent(bridgePayload.error)}` : "",
            ].join("");
            try {
              webWindow.location.replace(deepLink);
            } catch {
              try {
                webWindow.location.href = deepLink;
              } catch {
                // ignore and continue to web fallback
              }
            }
            return;
          }
          // Web browser OAuth callback (Safari/Chrome): keep it in-browser.
          // Avoid custom-scheme attempts here; iOS Safari shows
          // "cannot open page because the address is invalid".
          if (bridgePayload.provider && (bridgePayload.access_token || bridgePayload.code || bridgePayload.id_token)) {
            completeWebSocialAuthFromBridge({
              provider: bridgePayload.provider,
              access_token: bridgePayload.access_token,
              code: bridgePayload.code,
              id_token: bridgePayload.id_token,
              redirect_uri: bridgePayload.redirect_uri,
            })
              .catch(() => ({ success: false }))
              .finally(() => {
                try {
                  webWindow.location.replace("/home");
                } catch {
                  // ignore web fallback failures
                }
              });
            return;
          }
          try {
            webWindow.location.replace("/home");
          } catch {
            // ignore web fallback failures
          }
          return;
        }
      } catch {
        // ignore postMessage fallback failures
      }
      if (webWindow?.opener) {
        const tryClose = () => {
          try {
            webWindow.close();
          } catch {
            // ignore window close failures
          }
          try {
            webWindow.open("", "_self");
            webWindow.close();
          } catch {
            // ignore window close failures
          }
        };
        setTimeout(tryClose, 50);
        setTimeout(tryClose, 250);
        setTimeout(tryClose, 1000);
        return;
      }
    }

    const resetTokenValue = token || resetToken || passwordResetToken || recoveryToken;
    if (resetTokenValue) {
      router.replace({
        pathname: "/home",
        params: {
          reset: "legacy",
          ...(email ? { email } : {}),
        },
      });
      return;
    }

    // Social OAuth callbacks can land here with access_token/code; send user home.
    if (accessTokenParam || codeParam || idTokenParam) {
      router.replace("/home");
      return;
    }

    // Web OAuth token may be returned in hash fragment; treat as social success.
    const webWindowHash = (globalThis as { window?: { location?: { hash?: string } } }).window;
    if (webWindowHash?.location) {
      try {
        const hash = String(webWindowHash.location.hash || "").replace(/^#/, "");
        const hashParams = new URLSearchParams(hash);
        const hashAccessToken = String(hashParams.get("access_token") || "").trim();
        const hashCode = String(hashParams.get("code") || "").trim();
        const hashIdToken = String(hashParams.get("id_token") || "").trim();
        if (hashAccessToken || hashCode || hashIdToken) {
          router.replace("/home");
          return;
        }
      } catch {
        // ignore and continue with default route handling
      }
    }

    const resetSucceeded = isTruthyFlag(status) || isTruthyFlag(success);
    if (resetSucceeded) {
      router.replace({
        pathname: "/home",
        params: {
          reset: "success",
          ...(email ? { email } : {}),
        },
      });
      return;
    }

    // Unknown bridge callback should return to home instead of forcing forgot-password.
    router.replace("/home");
  }, [
    accessTokenParam,
    codeParam,
    idTokenParam,
    email,
    error,
    passwordResetToken,
    recoveryToken,
    resetToken,
    router,
    status,
    success,
    token,
  ]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f8fafc",
        paddingHorizontal: 20,
      }}
    >
      <ActivityIndicator size="small" color="#0ea5e9" />
      <Text style={{ marginTop: 12, color: "#334155", textAlign: "center" }}>
        Redirecting securely...
      </Text>
    </View>
  );
}
