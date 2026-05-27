type AuthOpenLogin = (nextMode?: "login" | "signup" | "forgot") => void;

type GuardNavigationArgs = {
  targetPath: string;
  sessionId?: string | null;
  openLogin: AuthOpenLogin;
  onAllowed: () => void;
};

let loginPromptSuppressed = true;

const PUBLIC_ROUTES = new Set([
  "/home",
  "/explore",
  "/aichat",
  "/about-sattvic-logic",
  "/about",
  "/marketing",
  "/privacy-policy",
  "/data-deletion",
  "/forgot-password",
]);

const normalizePath = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.split("?")[0].split("#")[0];
};

export const isPublicRoute = (path: string) => {
  const normalized = normalizePath(path);
  return PUBLIC_ROUTES.has(normalized);
};

export const setLoginPromptSuppressed = (suppressed: boolean) => {
  const next = Boolean(suppressed);
  loginPromptSuppressed = next;
  (globalThis as any).__suppressLoginPrompt = next;
};

export const isLoginPromptSuppressed = () => {
  const globalSuppress = Boolean((globalThis as any)?.__suppressLoginPrompt);
  const webAuthDisabled = (globalThis as any)?.__webAuthEnabled === false;
  return loginPromptSuppressed || globalSuppress || webAuthDisabled;
};

export const maybeOpenLogin = (
  openLogin: AuthOpenLogin,
  nextMode: "login" | "signup" | "forgot" = "login"
) => {
  if (isLoginPromptSuppressed()) return false;
  openLogin(nextMode);
  return true;
};

export const guardProtectedNavigation = ({
  targetPath: _targetPath,
  sessionId: _sessionId,
  openLogin: _openLogin,
  onAllowed,
}: GuardNavigationArgs) => {
  onAllowed();
  return true;
};
