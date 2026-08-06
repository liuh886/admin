# Hao Apps Membership Operations

The owner-only administration console is hosted at:

```text
https://liuh886.github.io/admin/
```

It manages the shared Supabase and Stripe membership platform used by FlappyK, Ownly, RhythmCoach, NewsFlow and AlphaEngine, and provides a read-only operating summary for GA4 and Stripe.

## Security model

The browser contains only the public Supabase URL and publishable key. It never receives:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `GA4_SERVICE_ACCOUNT_JSON_B64`
- a Supabase secret/service-role key
- database credentials

Every request is sent with the signed-in user's Supabase JWT. Both `membership-admin` and `operations-overview` then check `public.membership_admins`. Knowing the URL or signing in as a normal member does not grant access.

The initial owner is resolved from `liuh886@gmail.com` during migration. Additional operators must be inserted or activated explicitly in `membership_admins`.

## Roles

- `owner`: read operating data; search, grant, extend, revoke, cancel subscriptions and refund payments; force-refresh cached operating data.
- `operator`: read operating data; search, grant, extend and revoke complimentary access.
- `viewer`: read-only dashboard access.

## Operations overview

The console reads six GA4 properties through Google Analytics Data API and reads Stripe Live Mode through a protected Edge Function.

Configured properties are supplied through the `GA4_PROPERTY_IDS` secret. The service-account credential is supplied through `GA4_SERVICE_ACCOUNT_JSON_B64`. The service account only needs Analytics Viewer access at account or property level.

Displayed GA4 fields:

- 7-day and 30-day active users;
- 30-day sessions and page views;
- engagement rate;
- average session duration;
- per-property query status.

Displayed Stripe fields:

- successful payments during the last 30 days;
- gross charges, refunds and charge amount after refunds, before Stripe fees;
- active, past-due and cancel-at-period-end subscription counts;
- available and pending balances;
- recent payouts.

`operations-overview` caches the combined response in the Edge Function isolate for `GA4_CACHE_MINUTES` (30 minutes by default). Only an `owner` can request a forced refresh. The browser response is marked `private, no-store`.

Active users are reported independently by each GA4 property. Adding them across products can count the same visitor more than once.

## Complimentary access

1. Search for an email that has already signed in through Supabase Auth.
2. Select one product or all apps.
3. Select 30 days, 90 days, one year or lifetime.
4. Add a reason and confirm.

The API writes one or more `manual_gift` rows to `entitlement_grants`, then calls `refresh_effective_entitlements`. Stripe subscriptions and other gift sources remain independent.

## Extend or revoke a gift

Extensions update only one `manual_gift` source reference. Revocation deactivates that source and recalculates effective access. A valid Stripe subscription or another gift continues to grant membership.

## Cancel a subscription

The owner must type `CANCEL` and choose:

- cancel at the end of the paid period; or
- cancel immediately and revoke Stripe-backed access.

Stripe remains the subscription source of truth. Its webhook updates Supabase after the change.

## Refund a payment

The owner must type `REFUND`, select an amount, choose a reason, and explicitly decide what happens to the subscription:

- cancel immediately;
- cancel at the end of the period; or
- keep the subscription.

A refund alone does not cancel a Stripe subscription. The API verifies that the PaymentIntent belongs to the selected user's mapped Stripe customer before submitting the refund.

## Audit trail

Every successful or failed membership write is recorded in `membership_admin_actions`. The table is append-only: update and delete operations are blocked by a database trigger.

Audit records contain identifiers and operational results, not card details, JWTs or secret keys. GA4 and Stripe overview reads are not added to the write-action audit table.

## Adding a future product

1. Create the Stripe Product and recurring Price.
2. Add rows to `billing_products`, `billing_prices` and `billing_product_entitlements` through a migration.
3. Add the product's exact OAuth return URL to Supabase Auth.
4. Reuse the shared product client.
5. Add the GA4 Property ID to `GA4_PROPERTY_IDS` when traffic reporting is required.

The administration console reads the membership product catalog dynamically. GA4 properties are read from the server secret, so the browser does not need a code change when the mapping is extended.

## Required Supabase Auth URL

Add this exact URL to Authentication → URL Configuration → Redirect URLs:

```text
https://liuh886.github.io/admin/
```

## Required Supabase secrets

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
GA4_SERVICE_ACCOUNT_JSON_B64
GA4_PROPERTY_IDS
GA4_CACHE_MINUTES
```

## Deployment source

- Database: `supabase/migrations/0004_membership_admin_console.sql`
- Membership Edge Function: `supabase/functions/membership-admin/index.ts`
- Overview Edge Function: `supabase/functions/operations-overview/index.ts`
- Static console: repository root
