# KalatitManisha Deployment Runbook

## Current Production Targets
- Web app URL: `https://app.kalatitmanisha.com`
- Netlify site: `kalatitmanisha-web.netlify.app`
- API base: `https://kalatitmanisha.com/_functions`

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

Low-cost local validation loop (no Netlify credits):

```bash
npm run web:test:prod
```

This serves your static export on `http://localhost:4173` so you can verify:
- route rendering (`/home`, `/gitaVerse`, `/dilemma`, etc.)
- shared web URLs open directly
- deep-link fallback behavior before any real deploy

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

## Basic Smoke Test Steps (Every Build)
Run these checks for every release candidate before sharing broadly:

1. App launch and navigation
- Launch the app/site cleanly from a fresh install or fresh browser session.
- Confirm the home screen loads without a blank screen, crash, or stuck spinner.
- Open `Home`, `Explore`, `GitaVerse`, `Dilemma`, and `Profile`.
- Navigate back and forward between screens and confirm no broken routes or frozen views.

2. Authentication
- Open login/signup popup.
- Verify email signup submits without `Bad Request`.
- Verify email/password login works for an existing member.
- Verify forgot-password flow opens and submits without validation errors.
- Verify at least one social sign-in returns to the app and creates a session.

3. Core reading flows
- Open one chapter and at least one verse in `GitaVerse`.
- Verify Sanskrit, translation, and narration content render together.
- On a dilemma page, open the dropdown selector and switch to another dilemma.
- Open teleprompter and confirm font and speed controls are visible and working.
- Play at least one narration audio track and verify male/female switching if available.

4. Session and profile
- Close and reopen the app/web tab.
- Verify the session still resolves correctly or refreshes cleanly.
- Open profile-dependent actions and confirm no missing-member or invalid-session errors appear.

5. Platform-specific pass
- Web: refresh a deep link directly (`/home`, `/gitaVerse`, `/dilemma`) and confirm route render.
- Android: confirm popup/browser auth returns control back to the app.
- iOS: confirm popup/sheet auth returns control back to the app.
- Mobile: background the app and resume it during reading/audio flows.

6. Release note template
- Build number:
- Platforms tested:
- Tester:
- Passed flows:
- Known issues:

## Build 14 Focused QA
Run these tests in addition to the generic checklist above.

1. Google sign-in regression checks
- Android new user: tap `Google` from login/signup and confirm Google opens without `Access blocked` / `Authorization Error`.
- Android new user: finish Google sign-in and confirm the app returns with a valid session instead of `No google token received`.
- iOS new user: tap `Google`, complete account selection, and confirm the app accepts the callback without `No google token received`.

2. Apple sign-in checks
- iOS new user: tap `Apple` and confirm successful return to the app.
- If Apple does not share email, confirm the error copy is understandable and does not trap the user in a broken state.

3. Email or slug login checks
- Android and iOS existing user: log in with email/password.
- Existing user with slug-style user id: log in using mixed-case input and confirm authentication succeeds.

4. Teleprompter regression checks
- Open teleprompter from a verse or dilemma-related flow.
- Confirm both `Font` and `Speed` controls are visible.
- Increase and decrease both values and confirm the UI responds immediately.

5. Dilemma selector regression checks
- Open a dilemma page and confirm the old horizontal scrolling list is gone.
- Open the dropdown, choose a different dilemma, and confirm the selection updates and closes the menu.

6. Build 14 signoff template
- Build: `14`
- Android Google sign-in:
- iOS Google sign-in:
- iOS Apple sign-in:
- Email or slug login:
- Teleprompter controls:
- Dilemma dropdown:
- Final go/no-go:

## QA Report Template
Copy, fill, and send back after testing.

```text
Build Number:
App Version:
Platform:
Device:
Tester:
Date:

Generic Smoke Test
- App launch and navigation:
- Email signup:
- Email/password login:
- Forgot password:
- Social sign-in:
- GitaVerse load:
- Dilemma load:
- Teleprompter:
- Narration playback:
- Session restore:
- Deep link / route refresh:

Build-Specific Checks
- Android Google sign-in:
- iOS Google sign-in:
- iOS Apple sign-in:
- Slug login:
- Teleprompter font/speed controls:
- Dilemma dropdown selector:

Bugs Found
1.
2.
3.

Screenshots / Videos:

Overall Status:
- Go
- Go with issues
- No-go

Notes:
```

## WhatsApp Tester Templates

### Web + iOS
```text
Build 14 test request

Please test on:
1. Web: https://app.kalatitmanisha.com
2. iPhone / iOS app: Build 14

Please check:
- App/site opens correctly
- Login popup opens correctly
- Email signup works
- Email/password login works
- Google sign-in works on iPhone
- Apple sign-in works on iPhone
- GitaVerse opens and narration plays
- Dilemma page opens and dropdown works
- Teleprompter opens and Font/Speed controls work

Please reply in this format:
Web:
- OK / Issue:

iPhone:
- OK / Issue:

Google sign-in:
- OK / Issue:

Apple sign-in:
- OK / Issue:

Teleprompter:
- OK / Issue:

Dilemma dropdown:
- OK / Issue:

Overall:
- Go / Go with issues / No-go

Screenshots:
```

### Web + Android
```text
Build 14 test request

Please test on:
1. Web: https://app.kalatitmanisha.com
2. Android app: Build 14

Please check:
- App/site opens correctly
- Login popup opens correctly
- Email signup works
- Email/password login works
- Google sign-in works on Android
- GitaVerse opens and narration plays
- Dilemma page opens and dropdown works
- Teleprompter opens and Font/Speed controls work

Please reply in this format:
Web:
- OK / Issue:

Android:
- OK / Issue:

Google sign-in:
- OK / Issue:

Email/slug login:
- OK / Issue:

Teleprompter:
- OK / Issue:

Dilemma dropdown:
- OK / Issue:

Overall:
- Go / Go with issues / No-go

Screenshots:
```

## TMS Checklist (Locale Releases)
Before validating localized UI on web/mobile, complete TMS release checks:

1. Run batched seed+publish from Wix backend editor (`runTmsSeedAndPublish`).
2. Verify locale release health (`tmsVerifyLocalePublishAdmin` or `GET /_functions/tmsVerifyLocalePublish`).
3. If gaps remain, run batched auto-repair (`runTmsAutoRepairForLocale`).
4. Re-verify before app QA.

Reference: [`Docs/TMS_ROLLOUT_PLAN.md`](/Users/deepakruchandani/Projects/KalatitManisha/Docs/TMS_ROLLOUT_PLAN.md)
