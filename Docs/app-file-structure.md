# KalatitManisha — File Structure

## Root-level entry points & configs
- `App.tsx` / `App.web.tsx`: shared entry for the Expo/React Native + web experience.
- `app.json`, `babel.config.js`, `tsconfig.json`, `package.json` / `package-lock.json`: tooling + dependency manifests.
- `http-functions.js`, `global.css`, `tailwind.css`, `web.css`, `polyfills/`, `nativewind-env.d.ts`, `global.d.ts`: polyfills, global styles, and utilities that back both mobile and web targets.

## Next/Expo app directory (`app/`)
- `_layout.tsx`: root layout that wraps all pages (panels + navigation).  
- `index.tsx`, `home.tsx`, `explore.tsx`, `dilemma.tsx`, `about.tsx`, `contact.tsx`, `profile.tsx`: platform-agnostic page modules rendered inside the layout.  
- `types/ai-chat.ts`: shared TypeScript definitions for the AI chat experience.

## Screens / platform-agnostic UI (`screens/`)
- React components that drive the Central Panel on mobile / web—`Home`, `Explore`, `AIChat`, `GitaVerse`, `Contact`, `About`. These mostly compose the more atomic components from `components/`.

## Reusable components (`components/`)
- UI atoms & molecules:
  - `AIChatComposer.tsx`, `MessageList.tsx`, `MessageBubble.tsx`: chat composer + message rendering.
  - `AppIcon.tsx`, `ChapterNavigator.tsx`, `ChapterPicker.tsx`, `CountryModal.tsx`, `LanguageModal.tsx`: selectors and navigation helpers.
- Layout helpers in `components/layout/`: `Header`, `Footer`, `SidebarLeft`, `SidebarRight`, `MobileDrawer`.
- `components/auth/`: placeholder directory reserved for auth-specific widgets (currently empty).

## Authentication + context state
- `auth/AuthModalContext.tsx`: modal state used by sign-in/up flows.
- `auth/utils/`: `authApi.ts`, `sessionCache.ts`, `storage.ts` provide helpers tied to the auth stack.
- `context/`: providers for language, locale, and verse selections.

## Utility helpers
- `utils/`: `gitaAISectionHelpers.ts` (AI chat helpers) and `sessionSplit.ts` (session-scoped logic).
- `third_party/`: any vendor code that cannot live in other directories.

## Assets & platform resources
- `assets/`: icons + images (adaptive/app icons, favicon, splash). Sub-folders such as `assets/images/` hold media for marketing or in-app graphics.
- `android/`, `ios/`: native configuration for Expo (Gradle, Xcode) and platform-specific assets.
- `web/`: any web-specific scaffolding outside the shared `app/` scope.

## Documentation & support
- `Docs/`: living documentation. `app-structure.md` already discusses navigation; `app-file-structure.md` (this file) summarizes directories/files for contributors.
