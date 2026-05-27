# Backend Module Plan

## Goal
Turn `backend/http-functions.js` into a thin HTTP gateway. Business logic should live in dedicated helper modules with clear ownership and no duplicate behavior.

## Current Status
- `backend/http/auth-session-handlers.js` added and active.
- `http-functions.js` now delegates:
  - `post_login`
  - `options_login`
  - `post_signOut`
  - `post_refreshSession`
  - `options_refreshSession`

## Target Structure
- `backend/http/`
  - `auth-session-handlers.js` (done)
  - `auth-recovery-handlers.js` (forgot/reset password)
  - `auth-social-handlers.js` (social auth)
  - `response-helpers.js` (sendJson/sendConflict/sendBadRequest/sendSuccess)
  - `request-helpers.js` (readJson/extractSessionId/requireValidSession)
- `backend/auth/`
  - `identity.js` (member lookup, identifier normalization)
  - `password-recovery.js` (redirect validation, token lifecycle, rate limiting)
  - `social-providers.js` (Google/Facebook/Apple verification)

## Rules
- One function owner per concern. No duplicate helper implementation in multiple files.
- Endpoint files return consistent JSON string bodies.
- All new handlers should be pure(ish): runtime dependencies passed in from gateway where practical.

## Extraction Order
1. Session auth handlers (done)
2. Password recovery handlers (`forgotPassword`, `resetPassword`)
3. Social auth handler (`socialAuth`)
4. Shared request/response helpers
5. Move provider verification and token utilities into `backend/auth/*`

## Validation Per Step
- `npx tsc --noEmit`
- Manual smoke:
  - login -> refresh -> signOut
  - forgot password
  - reset password
  - social auth (existing member + new member)
