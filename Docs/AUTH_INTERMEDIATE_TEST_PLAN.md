# Auth Intermediate Test Plan

## Scope (Current Coding Slice)
- Introduce centralized frontend `authService`.
- Enforce signup password-setup-by-email flow (`register` creates account + sends set-password email).
- Add standalone `forgot-password` screen route.
- Add social auth endpoint + frontend social provider wiring.

## Pre-Checks
1. Typecheck
```bash
npx tsc --noEmit
```
2. Ensure app starts on web/native dev build.
3. Backend syntax check
```bash
node --check backend/http-functions.js
```
4. Wix setup for this slice:
- Add member fields in `Members/PrivateMembersData`:
  - `passwordResetTokenHash` (text)
  - `passwordResetExpiresAt` (datetime/text)
  - `passwordResetRequestedAt` (datetime/text)
- Keep `APP_WEB_BASE_URL` pointed at `https://app.kalatitmanisha.com` if you want backend SEO/canonical URLs to use the app domain.

## Functional Tests

### A. Route and Deep Link
1. Open browser route: `/auth-bridge`.
2. Verify page renders and redirects cleanly.
3. Open route with a success redirect:
   - `/auth-bridge?success=1&email=user@example.com`
4. Expected:
   - User lands back in the app without seeing a custom reset form.

### B. Client Validation
1. Enter password shorter than 8 chars.
2. Confirm warning appears.
3. Enter mismatched confirm password.
4. Confirm mismatch warning appears.
5. Enter valid matching passwords >= 8.
6. Confirm submit button enables.

### C. API Integration (Reset Password)
1. Complete a Wix reset email flow with a valid account email.
2. Expected:
   - Password is changed in Wix.
   - After OK/continue, control returns to `app.kalatitmanisha.com/auth-bridge`.
   - App lands on home or the expected post-login target.
3. Try an expired or invalid Wix reset link.
4. Expected:
   - Wix shows its own error handling.

### E. Backend Endpoint Tests (HTTP Functions)
Social auth tests:
1. `POST /_functions/socialAuth` with `provider=google` + valid `idToken`.
2. `POST /_functions/socialAuth` with `provider=facebook` + valid `accessToken`.
3. `POST /_functions/socialAuth` with `provider=apple` + valid `idToken`.
Expected:
- Success returns `sessionId`.
- Invalid token/audience returns 400 + `SOCIAL_AUTH_FAILED`.

0. `POST /_functions/register` with new email:
```json
{ "email": "new.user@example.com", "firstName": "New", "lastName": "User", "phone": "9999999999" }
```
Expected:
- Success payload with `requiresPasswordSetup: true`.
- User is not auto-logged in.
- Set-password email is sent; user must set password before sign-in.

1. `POST /_functions/forgotPassword` with valid identifier:
```json
{ "identifier": "user@example.com" }
```
2. Expected:
   - Response always generic success.
   - For existing user, token hash + expiry fields are updated in member data.
3. `POST /_functions/resetPassword` with invalid token:
```json
{ "token": "invalid", "password": "NewPassword123" }
```
4. Expected:
   - `INVALID_OR_EXPIRED_TOKEN`.
5. `POST /_functions/resetPassword` with valid token:
6. Expected:
   - If backend password update API is available: success.
   - If not available in current Wix runtime: `PASSWORD_UPDATE_UNAVAILABLE` (needs final backend provider wiring).

### D. Regression Check
1. Existing login flow via auth modal.
2. Existing forgot-password flow in auth modal.
3. Ensure no crash/regression after introducing service layer.

## Platform Checks
- Web (`expo start --web`)
- Android dev build
- iOS dev build

## Exit Criteria
- Typecheck passes.
- Wix reset flow returns to `app.kalatitmanisha.com/auth-bridge` and the app resumes cleanly.
- Validation UX behaves correctly.
- Existing auth flows remain functional.

## Latest Execution Snapshot (February 19, 2026)
1. Frontend type check
```bash
npm run type-check
```
- Result: Pass

2. Backend syntax check
```bash
node --check backend/http-functions.js
```
- Result: Pass

3. Live backend behavior check (manual curl)
- `POST /_functions/forgotPassword` under repeated attempts returns `429 RATE_LIMITED` with JSON body.
- `POST /_functions/cleanupPasswordResetTokens`:
  - placeholder token returns `401 Unauthorized` with JSON body.
  - valid token returns success payload:
```json
{"success":true,"retentionDays":30,"batchSize":200,"removedExpired":0,"removedUsed":0,"removedTotal":0}
```
4. Signup enforcement (code verification)
- `post_register` now ignores client password and generates server-side temporary password.
- `post_register` sends set-password email and returns messaging requiring password setup before sign-in.
5. Social auth implementation snapshot
- Backend endpoint `post_socialAuth` verifies Google/Facebook/Apple tokens.
- Frontend auth context exposes social sign-in and provider buttons in signup flow.
- Provider key/secret setup documented in `Docs/SOCIAL_AUTH_SETUP.md`.
