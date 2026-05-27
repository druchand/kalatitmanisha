# Language Cleanup Handoff

Date: 2026-03-12  
Scope: Backend + Frontend language normalization, TTS reliability, and TMS rollout alignment.

## Step 1 Status (Build Freeze)

- Web build: completed from current code state using `npm run web:build`.
- Android APK build: submitted using `eas build --platform android --profile preview --non-interactive`.
- Build ID: `89454ee7-a6f9-409c-b768-6bb62893bfd2`
- Current status at handoff: `IN_QUEUE` (EAS free tier queue).
- Check status command:

```bash
eas build:view 89454ee7-a6f9-409c-b768-6bb62893bfd2 --json
```

---

## Step 2 (Next Chat): Language Audit (Read-Only)

Goal: Produce a single source-of-truth map of all language handling before refactor.

### 2.1 Backend inventory

- List every endpoint that accepts `lang`/`locale`.
- List all language normalization helpers and where they are used.
- List all language-key patterns in DB (`lang`, `chLang`, `verseLang`, etc.).
- Identify fallback chains currently in use (`requested -> HI -> EN`, etc.).
- Identify inconsistent code paths for:
  - verse translation fetch
  - chapter fetch
  - narration audio fetch
  - app language list

### 2.2 Data model inventory

- Collections to audit:
  - `GitaVerseTranslations`
  - `GitaChapters`
  - `AICacheAudio`
  - `Locales`
  - `CountryLanguage` / `CountryLanguageCache`
  - `GoogleVoiceMap` / `GoogleVoices`
- For each collection, confirm:
  - primary keys used in code
  - uniqueness assumptions vs actual data
  - language code format (`EN` vs `en` vs `en-US`)
  - stale or legacy schema fields

### 2.3 Frontend inventory

- List every screen that sends language to backend.
- Record where language is read from storage/context.
- Record where UI text uses:
  - static strings
  - backend-translated payloads
  - TMS keys (if any)
- Identify mismatches between frontend language codes and backend expectations.

### 2.4 Deliverable for Step 2

- `Docs/LANGUAGE_CONTRACT_DRAFT.md` including:
  - canonical language code format
  - canonical fallback rules
  - endpoint-level behavior matrix
  - collection schema reconciliation notes

---

## Step 3 (Next Chat): Target Architecture + Phased Migration

Goal: Implement a maintainable language system, not endpoint patchwork.

### 3.1 Core design

- Create centralized backend module:
  - `backend/lang-contract.js` (or equivalent)
  - normalize code, infer direction, fallback chain, and voice eligibility.
- Route all endpoints through shared helpers for:
  - language parsing
  - response fallback decisions
  - key creation (`verseLang`, `chLang`)

### 3.2 TTS redesign

- Standardize TTS input pipeline:
  - sanitize text
  - language-aware transliteration/translation selection
  - deterministic voice selection policy
  - explicit fallback voice map
- Enforce queue lifecycle:
  - payload hash/versioning
  - regenerate when source text changes
  - clear stale URLs when payload changes

### 3.3 TMS alignment

- Define ownership boundaries:
  - TMS-managed UI strings vs dynamic translated content.
- Introduce phased rollout:
  - feature flag: `tmsEnabled`
  - per-screen onboarding plan
  - fallback to current strings during migration

### 3.4 Migration and safety

- Add one-time migration scripts for inconsistent language keys.
- Add health checks / dry-run commands before writes.
- Add kill-switch feature flags for rapid rollback.

### 3.5 Deliverables for Step 3

- `Docs/LANGUAGE_CONTRACT_FINAL.md`
- `Docs/TMS_ROLLOUT_PLAN.md`
- migration scripts in `backend/` with runbook entries
- minimal regression checklist for `EN`, `HI`, `TA`, `GU`, `PA`, `MR`

---

## Resume Prompt (Use in New Chat)

Use this exact prompt in a new chat to continue:

> Continue from `Docs/LANGUAGE_CLEANUP_HANDOFF.md`. Execute Step 2 fully (read-only audit), create `Docs/LANGUAGE_CONTRACT_DRAFT.md`, and do not refactor code yet.

