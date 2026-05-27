# TMS Rollout Plan (Current)

Date: 2026-03-16  
Project: `kalatitmanisha`

## Goal
- Keep TMS fast and predictable.
- Use deterministic `_id` + `wixData.get()` on read paths.
- Make publish/repair workflows safe for large locale runs (HI, TA, etc.) without HTTP timeouts.

## Collections Used
- `Projects`
- `Locales`
- `Namespaces`
- `TranslationKeys`
- `Translations`
- `ReleasePointers`
- `Releases`

## Deterministic ID Strategy
- Project: `prj:{projectKey}`
- Locale: `loc:{locale}`
- Namespace: `ns:{projectId}::{namespace}`
- ReleasePointer: `rp:{sha(project|locale|namespace)}`
- Release: `rel:{sha(project|locale|namespace|version)}`

Read paths (`get_i18n`) now resolve records by deterministic `_id` and `wixData.get()`.

## Seed and Publish Flow

### Seed source
- Base seed map: `TMS_APP_PAGE_NAMESPACE_SEED`
- Explicit Hindi overrides: `TMS_APP_PAGE_NAMESPACE_SEED_OVERRIDES.HI`
- For non-EN locales without explicit overrides:
  - tries `translateWithGoogle`
  - on failure, uses base seed text

### Publish
- `tmsSeedAndPublishAdmin`:
  - optional seed
  - publish namespace releases
  - updates release pointers

## Admin Functions

### In `backend/http-functions.js`
- `tmsPublishNamespacesAdmin(options)`
- `tmsSeedAndPublishAdmin(options)`
- `tmsVerifyLocalePublishAdmin(options)`

### In `backend/admin/TMSPublish.js`
- `runTmsSeedAndPublish(params)`
  - batch-oriented seed/publish runner
- `runTmsAutoRepairForLocale(params)`
  - verifies locale vs EN
  - repairs only namespaces needing work
  - supports batch execution for timeout-safe runs

## HTTP Endpoints
- `POST /_functions/tmsResetBootstrap`
- `GET /_functions/tmsContentAudit`
- `GET /_functions/tmsHealth`
- `GET /_functions/tmsDiag`
- `GET /_functions/tmsVerifyLocalePublish`

`tmsVerifyLocalePublish` returns:
- `200` when namespace set is healthy
- `409` when translation/release gaps exist

## Recommended Release Procedure (Per Locale)

1. Ensure project/locale exist.
2. Seed + publish in batches from backend editor:
   - use `runTmsSeedAndPublish`
   - start with `batchSize: 3` and `maxBatches: 1`
3. Repeat until `hasMore = false`.
4. Verify:
   - run `tmsVerifyLocalePublishAdmin`
   - or call `/tmsVerifyLocalePublish`
5. If issues remain:
   - run `runTmsAutoRepairForLocale` with batching.

## Backend Editor Examples

```js
import { runTmsSeedAndPublish, runTmsAutoRepairForLocale } from 'backend/admin/TMSPublish';
import { tmsVerifyLocalePublishAdmin } from 'backend/http-functions';

// 1) publish one batch
const b1 = await runTmsSeedAndPublish({
  projectKey: "kalatitmanisha",
  locale: "HI",
  batchSize: 3,
  startBatch: 1,
  maxBatches: 1,
  seedBeforePublish: true
});

// 2) verify locale health
const verify = await tmsVerifyLocalePublishAdmin({
  projectKey: "kalatitmanisha",
  locale: "HI",
  baseLocale: "EN",
  sampleSize: 10
});

// 3) auto-repair one batch if needed
const repair = await runTmsAutoRepairForLocale({
  projectKey: "kalatitmanisha",
  locale: "HI",
  baseLocale: "EN",
  batchSize: 3,
  startBatch: 1,
  maxBatches: 1,
  dryRun: false
});
```

## Troubleshooting

### `Invalid JSON` from publish endpoint
- Usually malformed curl payload or shell quoting.
- Prefer backend editor functions to avoid token exposure and shell quoting issues.

### `401 Unauthorized`
- Token/signature mismatch for HTTP admin calls.
- Backend editor Admin webMethods avoid this path.

### `504` on locale publish
- Run batched workflow (`maxBatches: 1`).
- Continue with `nextBatch`.

### Locale still shows EN
- Verify release content via `tmsVerifyLocalePublishAdmin`.
- Check namespace status:
  - `needs_translation`
  - `target_release_missing`
- Run `runTmsAutoRepairForLocale`.

### Slow response symptoms
- Avoid large unbatched publish calls.
- Use deterministic release IDs and `get()` lookup only (already aligned on read path).

## Security and Ops Notes
- Do not expose TMS tokens in terminal history.
- Prefer backend editor admin functions for seed/publish/repair.
- Use HTTP admin endpoints only for controlled automation.
