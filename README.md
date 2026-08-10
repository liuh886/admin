# Hao Apps Membership Admin

Private operations console and canonical identity / membership control plane for Hao Apps.

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
- Own the shared checkout, billing portal, Stripe webhook, customer-account shell, and entitlement synchronization path.
- Record append-only administrative audit events.

## Security boundary

The browser contains only the Supabase publishable key. A user must first be present and active in `membership_admins`; the private console then requires TOTP multi-factor authentication and an `aal2` session before it opens.

Privileged mutations are enforced again inside the Supabase Edge Functions. `membership-admin` requires `aal2` for complimentary grants, grant changes, subscription cancellation, and refunds. `membership-invite` requires `aal2` for invitation creation; recipient redemption remains a normal authenticated customer action and does not require administrator MFA.

Stripe secrets, the Google Analytics service-account credential, and the Supabase service role remain inside server-side Edge Functions. Browser and membership/billing Edge Functions pin the Supabase JavaScript client to a tested exact release rather than a floating major version.

Customer account surfaces currently expose the verified Google OAuth path plus Turnstile-protected email magic links. Product pages query only their own configured entitlement. Entitlement refreshes fail closed, while profile, product-account, and subscription-read failures are isolated so a valid login session is not discarded because an optional account read is unavailable.

The console is intentionally excluded from search indexing and is not linked from public product navigation. Knowing the URL does not grant administrative access.

## Server functions

- `create-checkout-session`: authenticated shared Pro checkout; resolves the product and active default Stripe price server-side.
- `create-portal-session`: authenticated Stripe Customer Portal entry for subscription management.
- `stripe-webhook`: signature-verified Stripe event receiver; synchronizes subscription state and effective entitlements. This is intentionally the only public Edge Function in this group and does not use JWT verification because Stripe authenticates with the webhook signature.
- `membership-admin`: member lookup plus AAL2-protected complimentary grants, cancellations, and refunds.
- `membership-invite`: administrator invitation catalog/create and recipient trial redemption; creation is AAL2-protected.
- `feedback-admin`: read-only administrator feedback access plus AAL2-protected workflow mutations.
- `operations-overview`: read-only GA4, Cloudflare, Supabase, and Stripe operating summary with a short server-side cache.

## Repository ownership

This repository is the canonical source for:

- the static membership and operations console;
- the shared customer account shell used by Hao Apps;
- shared checkout, Customer Portal and Stripe webhook Edge Functions;
- membership, invitation, feedback and operations Edge Functions;
- admin-specific database migrations;
- operational documentation and acceptance tests.

Product repositories configure their own product code, entitlement code, account placement and product-specific Pro copy. They do **not** own or duplicate the shared billing backend. FlappyK's obsolete copies of the shared checkout, portal and webhook functions were removed when this boundary was established.

See [`docs/MEMBERSHIP_ADMIN.md`](docs/MEMBERSHIP_ADMIN.md) for the operating runbook.
