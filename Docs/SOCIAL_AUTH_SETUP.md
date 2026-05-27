# Social Auth Setup (Google, Facebook, Apple)

## What is implemented in code
1. Backend endpoint: `POST /_functions/socialAuth`
2. Supported providers: `google`, `facebook`, `apple`
3. Backend verifies provider token, upserts member by email, creates app session in `ServerSessionCache`, and returns:
```json
{
  "success": true,
  "sessionId": "...",
  "result": { "memberData": { ... }, "provider": "google" }
}
```
4. Frontend wiring:
- `auth/utils/authApi.ts`: `socialAuth(...)`
- `auth/AuthModalContext.tsx`: `socialSignIn(...)`
- Signup modal now shows Google/Facebook/Apple buttons.

## Important current integration point
Frontend expects a token factory function to be provided by platform code:
```ts
globalThis.__socialAuthTokenFactory = async (provider) => {
  // return provider token payload
  // google/apple: { idToken, email?, firstName?, lastName?, name? }
  // facebook: { accessToken, email?, firstName?, lastName?, name? }
  return { idToken: "..." };
};
```
Without this hook, social buttons show a clear configuration error.

Alternative (already auto-wired in app startup): provide provider-specific hooks and let the default factory call them:
```ts
globalThis.__getGoogleIdToken = async () => ({ idToken: "GOOGLE_ID_TOKEN", email: "user@example.com" });
globalThis.__getFacebookAccessToken = async () => ({ accessToken: "FACEBOOK_ACCESS_TOKEN", email: "user@example.com" });
globalThis.__getAppleIdToken = async () => ({ idToken: "APPLE_ID_TOKEN", email: "user@example.com" });
```
The app now registers a default factory in `app/_layout.tsx` via `setupDefaultSocialTokenFactory()`.

## Backend secrets required
Set these in Wix Secrets Manager.

### Google
1. `GOOGLE_CLIENT_ID` (single audience) or
2. `GOOGLE_CLIENT_IDS` (comma-separated audiences)

Used to validate `aud` of Google ID token.

### Facebook
1. `FACEBOOK_APP_ID`
2. `FACEBOOK_APP_SECRET`

Used for Graph API `debug_token` verification.

### Apple
1. `APPLE_CLIENT_ID` (single audience) or
2. `APPLE_CLIENT_IDS` (comma-separated audiences)

Used to validate `aud` in Apple identity token.

## Provider console setup checklist

### Google Cloud Console
Links:
- Console: https://console.cloud.google.com/
- OAuth consent screen: https://console.cloud.google.com/apis/credentials/consent
- Credentials (OAuth clients): https://console.cloud.google.com/apis/credentials

1. Create OAuth Client IDs for each surface:
- Web client
- iOS bundle
- Android package + SHA1
2. Enable Google Identity / OAuth consent screen.
3. Add all client IDs into `GOOGLE_CLIENT_IDS`.

### Facebook Developers
Links:
- Meta app dashboard: https://developers.facebook.com/apps/
- Facebook Login docs: https://developers.facebook.com/docs/facebook-login/

1. Create app, enable Facebook Login.
2. Configure iOS bundle + Android package/key hash + web domain.
3. Add `email` permission.
4. Save `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`.

### Apple Developer
Links:
- Apple Developer portal: https://developer.apple.com/account/
- Sign in with Apple setup: https://developer.apple.com/sign-in-with-apple/get-started/
- Token verification guide: https://developer.apple.com/documentation/signinwithapplerestapi/verifying-a-user

1. Enable Sign in with Apple for app ID / services ID.
2. Register web return URLs if using web flow.
3. Put expected audience values into `APPLE_CLIENT_IDS`:
- iOS bundle ID
- Services ID (web), as applicable.

## Manual backend tests

### Google
```bash
curl -i -sS -X POST "https://kalatitmanisha.com/_functions/socialAuth" \
  -H "Content-Type: application/json" \
  -d '{"provider":"google","idToken":"GOOGLE_ID_TOKEN"}'
```

### Facebook
```bash
curl -i -sS -X POST "https://kalatitmanisha.com/_functions/socialAuth" \
  -H "Content-Type: application/json" \
  -d '{"provider":"facebook","accessToken":"FACEBOOK_USER_ACCESS_TOKEN"}'
```

### Apple
```bash
curl -i -sS -X POST "https://kalatitmanisha.com/_functions/socialAuth" \
  -H "Content-Type: application/json" \
  -d '{"provider":"apple","idToken":"APPLE_ID_TOKEN","email":"fallback@example.com"}'
```

## Expected behavior
1. New social email:
- Member gets created.
- App session (`sessionId`) is returned.
2. Existing social email:
- Existing member reused.
- New app session returned.
3. Invalid token / audience mismatch:
- `400` with `SOCIAL_AUTH_FAILED` and reason message.

## Wix Secrets you should keep
1. `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_IDS` (comma-separated)
2. `FACEBOOK_APP_ID`
3. `FACEBOOK_APP_SECRET`
4. `APPLE_CLIENT_ID` or `APPLE_CLIENT_IDS` (comma-separated)
5. `APP_WEB_BASE_URL` if you want backend SEO/canonical URLs to use the app domain

## Wix Secrets you can delete for password recovery
These were only needed for the removed custom-email password reset path:
- `APP_RESET_PASSWORD_BASE_URL`
- `APP_PASSWORD_SUCCESS_BASE_URL`
- `RESEND_API_KEY`
- `RESET_EMAIL_FROM`
- `RESET_EMAIL_REPLY_TO`
- `RESET_EMAIL_LOGO_URL`
- `RESET_EMAIL_SETUP_SUBJECT`
- `RESET_EMAIL_RESET_SUBJECT`
- `RESET_EMAIL_DISABLE_WIX_FALLBACK`
- `RESET_EMAIL_FORCE_CUSTOM_ONLY`
- `RESET_EMAIL_DELIVERY_MODE`
