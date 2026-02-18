# KalatitManisha Deployment Runbook

## Current Production Targets
- Web app URL: `https://app.kalatitmanisha.com`
- Netlify site: `kalatitmanisha-web.netlify.app`
- API base: `https://eq21.co.in/_functions`

## DNS Configuration (Wix + Netlify)
Add/keep these records in Wix DNS:

1. CNAME for app subdomain
- Host: `app.kalatitmanisha.com`
- Value: `kalatitmanisha-web.netlify.app`
- TTL: `1 Hour`

2. Netlify ownership TXT record (only required when Netlify asks)
- Host: `subdomain-owner-verification`
- Value: `<token shown by Netlify>`
- TTL: `1 Hour`

Notes:
- Do not create an `A` record for `app` if CNAME exists.
- Keep root `kalatitmanisha.com` records managed by Wix unless intentionally moving root hosting.

## Netlify Domain Steps
1. Netlify -> Site -> `Domain management` -> `Add a domain`.
2. Add `app.kalatitmanisha.com`.
3. Complete DNS verification.
4. Wait for SSL certificate issuance.
5. Enable/confirm Force HTTPS.
6. Verify:
   - `https://app.kalatitmanisha.com`

## Web Build + Deploy Commands
Run from repo root:

```bash
npx expo export --platform web
npx serve dist
```

Deploy to Netlify:

```bash
netlify deploy --dir=dist --prod
```

## App Config Baseline
`app.json` should include:
- `web.output = "static"`
- `web.bundler = "metro"`
- `expo-router` plugin option:
  - `origin = "https://kalatitmanisha.com"`
- `ios.buildNumber` and `android.versionCode` increments per release.

`eas.json` should include:
- `cli.appVersionSource = "remote"`
- `preview` profile with Android APK for sideload:
  - `android.buildType = "apk"`

## Android Sideload Build
Build:

```bash
eas build -p android --profile preview
```

Run/install on emulator:

```bash
eas build:run -p android
```

If install error `INSTALL_FAILED_UPDATE_INCOMPATIBLE`:

```bash
adb uninstall com.picfundibkokcucse6.KalatitManisha
eas build:run -p android
```

## iOS Testing on Physical Device (before App Store)
You can test on your own iPhone from Mac without App Store release.

1. Connect iPhone via USB and trust computer.
2. Install pods:
```bash
npx pod-install
```
3. Run to device:
```bash
npx expo run:ios --device
```
4. In Xcode, ensure Signing Team is selected for target `KalatitManisha`.
5. On iPhone: Settings -> General -> VPN & Device Management -> trust developer certificate.

Important:
- Free Apple account provisioning works for local testing but has limits and short-lived signing.
- For EAS internal iOS distribution (`eas build -p ios --profile development`), paid Apple Developer account is typically required.

## Release Checklist (Web + Mobile)
1. Update code.
2. Run typecheck:
```bash
npx tsc --noEmit
```
3. Bump versions (`app.json`):
   - `version`
   - `ios.buildNumber`
   - `android.versionCode`
4. Build web and verify routes.
5. Deploy web (`netlify deploy --dir=dist --prod`).
6. Build Android APK (`eas build -p android --profile preview`).
7. Test on emulator + physical device.
