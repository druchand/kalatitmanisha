import { SocialAuthPayload } from "../utils/authApi";

type SocialProvider = "google" | "facebook" | "apple" | "linkedin";
type TokenPayload = Partial<SocialAuthPayload> | null;
type ProviderTokenGetter = () => Promise<TokenPayload> | TokenPayload;
type SocialTokenFactory = (provider: SocialProvider) => Promise<TokenPayload> | TokenPayload;

type GlobalWithSocialHooks = typeof globalThis & {
  __socialAuthTokenFactory?: SocialTokenFactory;
  __getGoogleIdToken?: ProviderTokenGetter;
  __getFacebookAccessToken?: ProviderTokenGetter;
  __getAppleIdToken?: ProviderTokenGetter;
  __getLinkedInAccessToken?: ProviderTokenGetter;
};

function normalizePayload(
  provider: SocialProvider,
  payload: TokenPayload
): TokenPayload {
  if (!payload || typeof payload !== "object") return null;

  if (provider === "google") {
    const idToken = String(payload.idToken || "").trim();
    const accessToken = String(payload.accessToken || "").trim();
    if (!idToken && !accessToken) return null;
    return { ...payload, ...(idToken ? { idToken } : {}), ...(accessToken ? { accessToken } : {}) };
  }

  if (provider === "facebook") {
    const accessToken = String(payload.accessToken || "").trim();
    const authCode = String(payload.authCode || "").trim();
    const redirectUri = String(payload.redirectUri || "").trim();
    if (!accessToken && !authCode) return null;
    return {
      ...payload,
      ...(accessToken ? { accessToken } : {}),
      ...(authCode ? { authCode } : {}),
      ...(redirectUri ? { redirectUri } : {}),
    };
  }

  if (provider === "linkedin") {
    const accessToken = String(payload.accessToken || "").trim();
    const authCode = String(payload.authCode || "").trim();
    const redirectUri = String(payload.redirectUri || "").trim();
    if (!accessToken && !authCode) return null;
    return {
      ...payload,
      ...(accessToken ? { accessToken } : {}),
      ...(authCode ? { authCode } : {}),
      ...(redirectUri ? { redirectUri } : {}),
    };
  }

  const idToken = String(payload.idToken || "").trim();
  if (!idToken) return null;
  return { ...payload, idToken };
}

export function setupDefaultSocialTokenFactory(): void {
  const root = globalThis as GlobalWithSocialHooks;
  if (typeof root.__socialAuthTokenFactory === "function") return;

  root.__socialAuthTokenFactory = async (provider: SocialProvider) => {
    try {
      if (provider === "google") {
        const payload = await Promise.resolve(root.__getGoogleIdToken?.());
        return normalizePayload(provider, payload ?? null);
      }
      if (provider === "facebook") {
        const payload = await Promise.resolve(root.__getFacebookAccessToken?.());
        return normalizePayload(provider, payload ?? null);
      }
      if (provider === "linkedin") {
        const payload = await Promise.resolve(root.__getLinkedInAccessToken?.());
        return normalizePayload(provider, payload ?? null);
      }
      const payload = await Promise.resolve(root.__getAppleIdToken?.());
      return normalizePayload(provider, payload ?? null);
    } catch (err) {
      console.warn("[setupDefaultSocialTokenFactory] token provider failed", provider, err);
      throw err;
    }
  };
}
