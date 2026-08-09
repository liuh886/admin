# Hao Apps Membership Admin

Private operations console for the shared Hao Apps membership platform.

**Production:** https://liuh886.github.io/admin/

## Scope

- Summarize 7-day and 30-day GA4 traffic across Hao Apps properties.
- Summarize Stripe charges, refunds, subscription state, balances, and payouts.
- Search Supabase Auth users by email.
- Inspect subscriptions, payments, grants, and effective entitlements.
- Grant, extend, and revoke complimentary membership.
- Cancel Stripe subscriptions at period end or immediately.
- Issue full or partial refunds with explicit subscription handling.
- Create single-use multi-product Pro trial invitations.
- Record append-only administrative audit events.

## Security boundary

The browser contains only the Supabase publishable key. A user must first be present and active in `membership_admins`; the private console then requires TOTP multi-factor authentication and an `aal2` session before it opens.

Privileged mutations are enforced again inside the Supabase Edge Functions. `membership-admin` requires `aal2` for complimentary grants, grant changes, subscription cancellation, and refunds. `membership-invite` requires `aal2` for invitation creation; recipient redemption remains a normal authenticated customer action and does not require administrator MFA.

Stripe secrets, the Google Analytics service-account credential, and the Supabase service role remain inside JWT-protected Edge Functions. Browser and membership administration code pin the Supabase JavaScript client to a tested exact release rather than a floating major version.

The console is intentionally excluded from search indexing and is not linked from public product navigation. Knowing the URL does not grant administrative access.

## Server functions

- `membership-admin`: member lookup plus AAL2-protected complimentary grants, cancellations, and refunds.
- `membership-invite`: administrator invitation catalog/create and recipient trial redemption; creation is AAL2-protected.
- `operations-overview`: read-only GA4, Cloudflare, Supabase, and Stripe operating summary with a short server-side cache.

## Repository ownership

This repository is the canonical source for:

- the static membership and operations console;
- the shared customer account shell used by static Hao Apps;
- the `membership-admin`, `membership-invite`, and `operations-overview` Supabase Edge Functions;
- admin-specific database migrations;
- operational documentation and acceptance tests.

The shared customer, subscription and entitlement foundation remains in the broader Hao Apps billing platform. FlappyK no longer owns the administration console.

See [`docs/MEMBERSHIP_ADMIN.md`](docs/MEMBERSHIP_ADMIN.md) for the operating runbook.
