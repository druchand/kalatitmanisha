# Social Auth Values Template

Use this sheet to collect all cross-platform values before configuring Google, Facebook, Apple, and Wix secrets.

## Project Identity
- App name: Kalatit Manisha
- Environment: `dev` / `prod`
- Expo project ID: e48c2b3b-c75c-4a91-8e37-13d0ecf7dc3a
- Backend base URL: `https://kalatitmanisha.com/_functions`
- Web app URL: `https://app.kalatitmanisha.com`
- Auth bridge URL: `https://app.kalatitmanisha.com/auth-bridge`

## App IDs
- Android package name: com.picfundibkokcucse6.KalatitManisha
- iOS bundle identifier: com.kalatitmanisha.kalatitmanisha

- Web origin(s):
1. `https://app.kalatitmanisha.com`
2. `https://kalatitmanisha.com`

## Android Signing
- Android keystore alias (EAS): db726848ac806ee39c405ebfd60a23da
- Android keystore ID (EAS): VA2k3ZX5Q1
- Debug SHA-1: (pending local debug.keystore)
- Debug SHA-256:
- Release SHA-1: 35:D9:3C:07:05:4D:32:9D:4D:68:A7:A7:56:D6:C0:19:1F:A6:A5:5E
- Release SHA-256: 07:09:14:BF:80:E2:A7:33:45:6E:39:18:AB:26:A7:D8:B0:3D:31:25:F4:A9:AE:31:71:3A:26:27:E8:DE:E4:5E
- Facebook Android key hash (debug):
- Facebook Android key hash (release): Ndk8BwVNMp1NaKenVtbAGR+mpV4=
- Preview build profile uses same keystore as production: yes

## Google OAuth
- Google Cloud project ID: 
- OAuth consent screen published? `yes/no`
- Web client ID:
- Android client ID:
- iOS client ID:
- Authorized JS origins:
1.
2.
- Authorized redirect URIs (if used):
1.
2.

### Wix Secrets (Google)
- `GOOGLE_CLIENT_ID` = (usually Web client ID)
- `GOOGLE_CLIENT_IDS` = `web,android,ios` client IDs (comma-separated)

## Facebook Login
- Meta app ID:
- Meta app secret:
- App mode: `development/live`
- Facebook Login product added? `yes/no`
- Valid OAuth redirect URIs:
1.
2.
- Android platform configured? `yes/no`
- iOS platform configured? `yes/no`

### Wix Secrets (Facebook)
- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`

## Apple Sign In
- Apple Team ID:
- App ID (Identifier):
- Services ID (if used):
- Primary client/audience used by app:
- Additional allowed audiences:
- Return URL(s):
1.
2.
- Domain(s):
1.
2.

### Wix Secrets (Apple)
- `APPLE_CLIENT_ID` = primary audience
- `APPLE_CLIENT_IDS` = all allowed audiences (comma-separated)

## Redirect & Deep Link Targets
- Password recovery return route: `/auth-bridge`
- Deep link scheme: `kalatitmanisha://`
- Success redirect URL after password set: `https://app.kalatitmanisha.com/auth-bridge`
- Fallback URL if app not installed: `https://app.kalatitmanisha.com/auth-bridge`

## Final Preflight
- Google web/android/ios tokens validated in backend? `yes/no`
- Facebook token + email validated? `yes/no`
- Apple token signature + audience validated? `yes/no`
- Social login returns backend `sessionId` on all platforms? `yes/no`
