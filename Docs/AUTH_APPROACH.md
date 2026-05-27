# Authentication Approach

## Goal
Define a production-ready authentication architecture for this React Native + Expo app with Wix Velo backend, to be implemented incrementally and refined later with actual code references.

## Implementation Status (February 19, 2026)
- Completed:
  - Centralized auth service wiring in `auth/services/authService.ts`.
  - Signup flow now enforces password setup via email before sign-in:
    - `POST /_functions/register` creates member with server-generated temporary password.
    - Backend sends Wix set-password email immediately after registration.
    - Frontend signup no longer sends any password.
  - Forgot-password API integration via `auth/utils/authApi.ts` -> `POST /_functions/forgotPassword`.
  - Wix-managed password recovery returns to `app.kalatitmanisha.com/auth-bridge`.
  - Dedicated forgot route: `app/forgot-password.tsx`.
  - Social auth API added:
    - `POST /_functions/socialAuth` for `google`, `facebook`, `apple`.
    - Frontend signup modal includes social provider actions (token acquisition hook required).
  - Auth modal forgot flow wired through context: `auth/AuthModalContext.tsx`.
  - Backend status/error payloads normalized for key auth responses in `backend/http-functions.js`.
- Current behavior:
  - Signup requires email password setup before user can sign in.
  - Social sign-in/signup works once provider SDK token factory is configured on frontend.
  - Forgot password supports generic success responses and shows backend messages for throttle events.
  - Reset password supports token-based reset and surfaces backend validation failures.
  - Invalid reset-link state routes users to a recoverable forgot-password entry point.

## Current Stack Context
- Frontend: Expo Router + React Native + Context-based auth state.
- Backend: Wix Velo HTTP functions under `/_functions/*`.
- Session model today: backend-issued session/JWT-style token used by app.

## Proposed Architecture

### Frontend (React Native / Expo)
1. Centralized auth API/service layer
- Create `auth/services/authService.ts` for all auth-related requests.
- No screen should call `fetch` directly for auth.
- Normalize errors into a single shape (`code`, `message`, `status`).

2. Token/session storage strategy
- Use SecureStore on native, AsyncStorage fallback where needed.
- Single token store module:
  - `auth/storage/tokenStore.ts`
  - `setToken`, `getToken`, `clearToken`, `setUserId`, `clearUserId`.

3. Auth state management
- Keep a single auth state source (context + hook):
  - Extend existing `auth/AuthModalContext.tsx` or introduce `auth/hooks/useAuth.ts`.
- Include:
  - `hydrating`, `isAuthenticated`, `user`, `sessionId/token`
  - actions: `login`, `signup`, `logout`, `forgotPassword`, `refreshUser`.

4. Screen-level UX flows
- Add dedicated screens:
  - `app/login.tsx`
  - `app/signup.tsx`
  - `app/forgot-password.tsx`
- Form constraints:
  - password fields use `secureTextEntry`
  - client-side validation + backend error surfacing
  - loading and disabled states for submit actions.

5. Deep linking
- Use existing scheme (`kalatitmanisha`) and route:
  - `kalatitmanisha://auth-bridge`
- Wix reset email returns to `app.kalatitmanisha.com/auth-bridge`, which hands the user back to the app after the password change completes.
- Fallback handling:
  - missing/expired token -> clear error state + CTA back to forgot password.

### Backend (Wix Velo)
Implement/standardize endpoints in `backend/http-functions.js` (or delegated backend modules):

1. `POST /register`
- Validate email/password policy.
- Hash password via `bcrypt`.
- Store user record.

2. `POST /login`
- Validate credentials.
- Verify password hash.
- Return signed JWT/session token.

3. `POST /forgotPassword`
- Generate random token (single use).
- Store hashed token + expiry (1 hour).
- Send HTML email with reset link:
  - `kalatitmanisha://auth-bridge` (mobile/web completion redirect)
  - optional HTTPS fallback page URL for web.

4. `POST /resetPassword` (backend compatibility only)
- Validate token and expiry.
- Update password hash.
- Revoke/reset token after use.

5. `POST /auth/social`
- Accept provider + identity token from client.
- Verify provider signature server-side.
- Find/create/sync local user.
- Return local session JWT.

### Social Auth Plan
Native libraries (dev/release builds, not Expo Go):
- Apple: `@invertase/react-native-apple-authentication`
- Google: `@react-native-google-signin/google-signin`
- Facebook: `react-native-fbsdk-next`

Flow:
1. Frontend obtains provider identity token.
2. Frontend sends token to backend `/auth/social`.
3. Backend verifies token directly with provider rules.
4. Backend returns app-native session token.

## API Contract Principles
- Consistent success/error payloads.
- No sensitive leakage:
  - forgot-password returns generic success even for unknown email.
- Include HTTP status + app-level error code.
- Add request throttling/rate-limit for auth endpoints.

## File Placement Plan
- Frontend:
  - `auth/services/authService.ts`
  - `auth/services/socialAuthService.ts`
  - `auth/storage/tokenStore.ts`
  - `app/login.tsx`
  - `app/signup.tsx`
  - `app/forgot-password.tsx`
  - `app/forgot-password.tsx`
- Backend:
  - Keep entrypoints in `backend/http-functions.js`
  - Optionally split logic into `backend/auth/*` modules.

## Rollout Phases
1. Core email/password auth refactor (service + token store).
2. Forgot/reset flows + deep-link route wiring.
3. Dedicated auth screens and route guards.
4. Social providers + `/auth/social`.
5. Hardening pass:
  - rate limits, audit logs, lockout policy, token invalidation, telemetry.

## Validation Checklist
- Login/logout works on web + Android + iOS dev build.
- App restart hydrates auth state correctly.
- Expired session clears auth state gracefully.
- Forgot-password email arrives with valid link.
- Reset token expires at 1 hour and is single-use.
- Social login creates or links correct user.

## Notes
- This is a design/approach document.
- Update this file after implementation with:
  - actual endpoint names,
  - exact files introduced,
  - deviations from this plan,
  - known limitations and next hardening tasks.
