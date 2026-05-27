# TTS Voice Installation Guide

Last updated: 2026-03-12

This guide explains how to install additional system voices so Text-to-Speech (TTS) works for non-English languages in the app.

## Important concept

Our app uses device/browser speech engines:
- iOS app build: iOS system voices (AVSpeech / expo-speech)
- Android app build: Android Text-to-Speech engine + installed voice data
- Browser (web): browser `speechSynthesis` + OS voices

If a language voice is not installed at OS/browser level, TTS may fail or use a fallback accent.

## iPhone / iPad (iOS)

1. Open `Settings`.
2. Go to `Accessibility` -> `Spoken Content`.
3. Tap `Voices`.
4. Choose a language (for example Hindi, Tamil, Bengali, etc.).
5. Select a voice and tap the download/cloud icon.
6. Keep device on Wi-Fi and power until download finishes.
7. Optional: In `Spoken Content`, set speaking rate and test with `Speak Selection`.
8. Restart the app and test TTS again.

If TTS still fails:
- Force-close and reopen app.
- Reboot device once.
- Confirm the downloaded voice still shows as installed (no cloud icon).

## Mac (for browser testing on Safari/Chrome)

1. Open `System Settings`.
2. Go to `Accessibility` -> `Spoken Content`.
3. Under `System Voice`, click the voice selector.
4. Click `Manage Voices...`.
5. Enable/download required languages.
6. Wait for downloads to complete.
7. Quit and reopen browser (Safari/Chrome).
8. Test TTS on the web app.

Extra check on Mac browsers:
- In browser console, run:
  `speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang }))`
- Confirm your target language appears.

## Android phones/tablets

Path names vary by vendor (Samsung/Pixel/etc.), but flow is usually:

1. Open `Settings`.
2. Search for `Text-to-speech output`.
3. Open `Text-to-speech` settings.
4. Pick engine (prefer `Speech Services by Google`).
5. Open `Install voice data` (or equivalent).
6. Select language and download voice pack.
7. Use the built-in `Listen to an example` test if available.
8. Restart app and test TTS.

If missing options:
- Update `Speech Services by Google` from Play Store.
- Also update `Google` app and system WebView.

## Browser-specific notes

### Safari (iPhone/Mac)
- Uses Apple system voices.
- Voices must be installed in OS settings.
- First playback may require a user tap/gesture.

### Chrome (Mac/Windows/Android)
- Uses system voices and/or bundled voices depending on platform.
- Installed OS voices are usually detected after browser restart.

### Common browser troubleshooting

1. Ensure page has had user interaction (tap/click).
2. Refresh page once after voice installation.
3. Fully close and reopen browser.
4. Confirm voices exist via `speechSynthesis.getVoices()`.

## For this app specifically (current known behavior)

If you see popup:
`Text To Speech Unavailable - TTS is unavailable in this app build. Rebuild the dev client to include expo-speech.`

This means iOS dev client build does not include native `expo-speech` module.

Fix:
1. Rebuild dev client with native modules.
2. Reinstall new build on device.
3. Retest after installing required language voices.

## Support script for helping users quickly

Use this template:

1. Confirm platform: iOS app / Android app / Browser.
2. Ask user to install target language voice at OS level (steps above).
3. Ask user to restart app/browser.
4. If iOS app shows `Text To Speech Unavailable` popup, instruct app rebuild.
5. Re-test with English first, then target language.
6. If still failing, collect:
   - Device model
   - OS version
   - App build version
   - Target language
   - Screenshot/video of issue

## Quick checklist

- Voice installed on OS/device
- Browser/app restarted
- User has tapped screen before TTS
- Dev client includes `expo-speech` (for native iOS/Android builds)
- Target language available in `speechSynthesis.getVoices()` (web)
