# App Review Resubmission Milestone

Date: April 3, 2026

Submission under review:
- Submission ID: `fdb19b66-a8ea-4f05-9df1-cf07971f22ee`
- Version reviewed by Apple: `1.0`

## Scope

This milestone tracks the first remediation pass for Apple App Review findings:

1. Metadata alignment
- Device display name changed to `Kalatit Manisha` to match the App Store listing more closely.

2. AI Chat account gating
- Guest users can now open AI Chat without signing in.
- Chat now uses a stable guest session key when no authenticated session exists.
- Sign-in is reserved for account-based benefits in a later phase rather than basic access.

3. Apple sign-in hard blocker reduction
- Removed the frontend precondition that warned users Apple sign-in required email before continuing.
- Added clearer user-facing handling for limited Apple payload cases where Apple does not return email.

## Follow-up still required before resubmission confidence is high

1. Validate Apple sign-in on iPad with:
- fresh install
- existing-user Apple sign-in
- first-time Apple sign-in
- repeated Apple sign-in with limited claims

2. Decide guest AI quota policy:
- initial approval path favors access first
- quota/rate-limit controls can be layered in next without blocking review

3. Prepare review response text:
- confirm OpenAI is used behind the AI feature via backend
- explain AI Chat is no longer registration-gated

## Recommended versioning

- Keep marketing version at `1.0.0` unless a product-facing reset to `1.0.1` is preferred in App Store Connect.
- Use the next iOS build number as the resubmission milestone build.
- Suggested next build after this remediation batch: `10`

