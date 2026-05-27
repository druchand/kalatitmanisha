# Persistent storage key inventory

This catalog lists every literal (or constant-derived) key used with the app's persistent-storage helpers. Each section groups keys by the area that owns them.

## Auth & session

| Key (literal / pattern) | Storage backend | Reads | Writes | Deletes | Notes |
| --- | --- | --- | --- | --- | --- |
| `sessionId` (`SESSION_KEY`) | SecureStore (native; `USE_SECURE_STORE` guard) / AsyncStorage (web fallback) | `utils/storage.ts:47` (`getSessionToken`) <br> `auth/utils/storage.ts:47` (`getSessionToken`) | `utils/storage.ts:39` (`setSessionToken`) <br> `auth/utils/storage.ts:39` (`setSessionToken`) | `utils/storage.ts:54` (`clearSessionToken`) <br> `auth/utils/storage.ts:54` (`clearSessionToken`) | `SESSION_KEY = "sessionId"` is declared in both helper modules; core auth flows import the form that matches their folder. |
| `userId` (`USER_ID_KEY`) | SecureStore (native; mirror shell) / AsyncStorage (web fallback) | `utils/storage.ts:71` (`getUserId`) <br> `auth/utils/storage.ts:71` (`getUserId`) | `utils/storage.ts:63` (`setUserId`) <br> `auth/utils/storage.ts:63` (`setUserId`) | `utils/storage.ts:78` (`clearUserId`) <br> `auth/utils/storage.ts:78` (`clearUserId`) | `USER_ID_KEY = "userId"` stores the looked-up profile identifier; both helper files keep the same API surface for interchangeability. |

## Locale & preference

| Key (literal / pattern) | Storage backend | Reads | Writes | Deletes | Notes |
| --- | --- | --- | --- | --- | --- |
| `@gita-app/lang` (`LANG_STORAGE_KEY`) | AsyncStorage | `context/LanguageContext.tsx:125` (LanguageProvider initial language load effect) | `context/LanguageContext.tsx:159` (selectLanguage) <br> `context/LanguageContext.tsx:330` (language fall-back effect) | – | Normalized via `normalizeCode`; every successful language pick from the drawer (and the fallback when languages refresh) rewrites this key. |
| `@gita-app/lang-country` (`COUNTRY_STORAGE_KEY`) | AsyncStorage | `context/LanguageContext.tsx:139` (LanguageProvider initial country load effect) | `context/LanguageContext.tsx:234` (fetchLanguages derived `x-app-country` header) <br> `context/LanguageContext.tsx:269` (selectCountry) | `context/LanguageContext.tsx:270` (selectCountry clearing when no code) | Always stored uppercased; either the server suggests it via the `x-app-country` header or the user picks from the country modal. Clearing the selection removes the key. |

## Location / geo session

| Key (literal / pattern) | Storage backend | Reads | Writes | Deletes | Notes |
| --- | --- | --- | --- | --- | --- |
| `@gita-app/geo-session-id` (`LOCATION_SESSION_KEY`) | AsyncStorage | `context/LocationContext.tsx:22` (`ensureGeoSessionId` primer read) | `context/LocationContext.tsx:25` (`ensureGeoSessionId` generates next identifier) | – | `ensureGeoSessionId` writes a value like `geo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` once and reuses it for all geo-context requests. |

## Vivechan last visit

| Key (literal / pattern) | Storage backend | Reads | Writes | Deletes | Notes |
| --- | --- | --- | --- | --- | --- |
| `@gita-app/vivechan/last-visit/v1` | AsyncStorage | – | `screens/HumanDilemma.tsx:490` (`openVivechan`) | – | JSON string of `{ lang, chapter, verse }` saved right before navigating to `/gitaNarration`; no reads or clears yet in the codebase. |

## Boot gating and debug checklist (Sprint 0.5)

To prevent race conditions on cold start (language/country/session hydration vs. screen fetches), the app gates route mounting in `app/_layout.tsx`.

### What is gated
Screens (including `GitaVerse`) are not mounted until:
- LanguageContext is hydrated (no `loading`),
- country list is not loading (`countryListLoading === false`),
- LocationContext is not loading (if it exposes `loading`),
- and a short grace period (300ms) has elapsed to allow AsyncStorage hydration effects to complete.

This avoids firing backend fetches with missing headers / stale cached selection.

### How to debug boot issues
- Cold start reset:
  - `rm -rf .expo`
  - `npx expo start -c`
- Verify stored preferences:
  - Language key: `@gita-app/lang`
  - Country key: `@gita-app/lang-country`
  - Geo session: `@gita-app/geo-session-id`
- If behavior looks inconsistent, temporarily clear keys (dev-only):
  - remove `@gita-app/lang-country` to force server-derived country
  - remove `@gita-app/lang` to revert to default language
- Known navigation edge case:
  - If a route was entered directly (no history stack), use `router.canGoBack()` before `router.back()`.
