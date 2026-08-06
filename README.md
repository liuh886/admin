# Hao Apps Membership Admin

Private operations console for the shared Hao Apps membership platform.

**Production:** https://liuh886.github.io/admin/

## Scope

- Search Supabase Auth users by email.
- Inspect subscriptions, payments, grants, and effective entitlements.
- Grant, extend, and revoke complimentary membership.
- Cancel Stripe subscriptions at period end or immediately.
- Issue full or partial refunds with explicit subscription handling.
- Record append-only administrative audit events.

## Security boundary

The browser contains only the Supabase publishable key. Every privileged request requires a valid Supabase JWT and an active row in `membership_admins`. Stripe secrets and the Supabase service role remain inside the JWT-protected `membership-admin` Edge Function.

The console is intentionally excluded from search indexing and is not linked from public product navigation. Knowing the URL does not grant administrative access.

## Repository ownership

This repository is now the canonical source for:

- the static membership operations console;
- the `membership-admin` Supabase Edge Function;
- admin-specific database migrations;
- operational documentation and acceptance tests.

The shared customer, subscription and entitlement foundation remains in the broader Hao Apps billing platform. FlappyK no longer owns the administration console.

See [`docs/MEMBERSHIP_ADMIN.md`](docs/MEMBERSHIP_ADMIN.md) for the operating runbook.
