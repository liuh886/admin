# Single-use Pro invitations

The admin console creates one-time free-trial invitation links for one or more Hao Apps Pro products.

## Admin flow

1. Open `https://liuh886.github.io/admin/` as an `owner` or `operator`.
2. Select one or more Pro products.
3. Select one free-trial duration for the invitation.
4. Generate the link and copy it immediately.

Products are the configuration unit. The admin never selects low-level entitlement codes; each selected product resolves its current `*.pro` mapping from `billing_product_entitlements` and its default Stripe price from `billing_prices`.

The raw invitation token is returned only once. PostgreSQL stores only its SHA-256 hash.

## Recipient flow

The invitation URL uses a fragment:

```text
https://liuh886.github.io/admin/#invite=<token>
```

The browser stores the token locally, removes it from the address bar, and uses the existing Supabase OAuth flow. After sign-in, the first account to claim the invitation receives a real Stripe `trialing` subscription for each invited product that does not already have a manageable subscription.

On success, the page lists each product, its trial end date, and the canonical `billing_products.app_url`.

## Membership behavior

A free invitation is a Stripe-managed subscription trial, not a detached temporary entitlement.

For every selected product:

- the existing default Stripe price is used;
- `trial_period_days` is set from the invitation duration;
- `trial_settings.end_behavior.missing_payment_method` is `cancel`;
- the Stripe subscription is synchronized into `subscriptions`;
- Pro grants use `source = 'stripe_subscription'` and the subscription ID as `source_ref`;
- `refresh_effective_entitlements` updates effective access immediately;
- the normal Stripe webhook remains the ongoing source of subscription-status reconciliation.

Because `trialing` is a manageable subscription state, the product account page exposes **Manage subscription** from the first day of the free trial. The account UI also shows the free-trial end date.

If the user never adds a payment method, Stripe cancels the subscription at the end of the trial. If the user adds a payment method through the Stripe Customer Portal, the subscription can continue on the product's normal price after the trial.

## Multi-product invitations

One invitation may include several products. Each product receives its own Stripe subscription rather than a synthetic bundle subscription. This keeps product-level billing, account pages, entitlement mapping, and cancellation behavior independent.

An existing manageable subscription for a selected product is preserved rather than duplicated.

## One-time guarantee and retry behavior

`membership_invites.token_hash` stores only a SHA-256 hash of a 256-bit random token.

Redemption has three states:

- unclaimed: `redeemed_by` and `redeemed_at` are null;
- claimed / activation in progress: `redeemed_by` is set while `redeemed_at` remains null;
- complete: both are set.

The first authenticated account atomically claims the invitation. The same account may retry if activation is interrupted. Stripe idempotency keys are scoped by invitation and product, so retrying does not create duplicate subscriptions. A different account cannot take over a claimed invitation.

## Security boundary

- Raw invitation tokens are never stored in PostgreSQL or audit logs.
- Browser roles cannot read or mutate `membership_invites` directly.
- Invitation creation requires an active `owner` or `operator` row in `membership_admins`.
- Redemption requires a valid Supabase user JWT but no admin role.
- Stripe and service-role secrets stay inside the `membership-invite` Edge Function.
