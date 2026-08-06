# Hao Apps Membership Operations

The owner-only administration console is hosted at:

```text
https://liuh886.github.io/admin/
```

It manages the shared Supabase and Stripe membership platform used by FlappyK, Ownly, RhythmCoach, NewsFlow and AlphaEngine.

## Security model

The browser contains only the public Supabase URL and publishable key. It never receives:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- a Supabase secret/service-role key
- database credentials

Every request is sent with the signed-in user's Supabase JWT to the `membership-admin` Edge Function. The function then checks `public.membership_admins`. Knowing the URL or signing in as a normal member does not grant access.

The initial owner is resolved from `liuh886@gmail.com` during migration. Additional operators must be inserted or activated explicitly in `membership_admins`.

## Roles

- `owner`: search, grant, extend, revoke, cancel subscriptions and refund payments.
- `operator`: search, grant, extend and revoke complimentary access.
- `viewer`: read-only dashboard access.

## Supported workflows

### Complimentary access

1. Search for an email that has already signed in through Supabase Auth.
2. Select one product or all apps.
3. Select 30 days, 90 days, one year or lifetime.
4. Add a reason and confirm.

The API writes one or more `manual_gift` rows to `entitlement_grants`, then calls `refresh_effective_entitlements`. Stripe subscriptions and other gift sources remain independent.

### Extend or revoke a gift

Extensions update only one `manual_gift` source reference. Revocation deactivates that source and recalculates effective access. A valid Stripe subscription or another gift continues to grant membership.

### Cancel a subscription

The owner must type `CANCEL` and choose:

- cancel at the end of the paid period; or
- cancel immediately and revoke Stripe-backed access.

Stripe remains the subscription source of truth. Its webhook updates Supabase after the change.

### Refund a payment

The owner must type `REFUND`, select an amount, choose a reason, and explicitly decide what happens to the subscription:

- cancel immediately;
- cancel at the end of the period; or
- keep the subscription.

A refund alone does not cancel a Stripe subscription. The API verifies that the PaymentIntent belongs to the selected user's mapped Stripe customer before submitting the refund.

## Audit trail

Every successful or failed write is recorded in `membership_admin_actions`. The table is append-only: update and delete operations are blocked by a database trigger.

Audit records contain identifiers and operational results, not card details, JWTs or secret keys.

## Adding a future product

1. Create the Stripe Product and recurring Price.
2. Add rows to `billing_products`, `billing_prices` and `billing_product_entitlements` through a migration.
3. Add the product's exact OAuth return URL to Supabase Auth.
4. Reuse the shared product client.

The administration console reads the product catalog dynamically, so a correctly registered future product appears automatically in the gift selector without a UI rewrite.

## Required Supabase Auth URL

Add this exact URL to Authentication → URL Configuration → Redirect URLs:

```text
https://liuh886.github.io/admin/
```

The former `https://liuh886.github.io/FlappyK/admin/` entry may remain temporarily while bookmarks transition, but it is no longer the canonical callback.

## Deployment source

- Database: `supabase/migrations/0004_membership_admin_console.sql`
- Edge Function: `supabase/functions/membership-admin/index.ts`
- Static console: repository root
