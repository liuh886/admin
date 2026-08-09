# Single-use Pro invitations

The admin console can create one-time complimentary Pro invitation links that bundle one or more Hao Apps products.

## Admin flow

1. Open `https://liuh886.github.io/admin/` as an `owner` or `operator`.
2. In **一次性 Pro 产品包邀请**, select one or more Pro products.
3. Select one complimentary duration for the whole bundle.
4. Generate the invitation and copy the link immediately.

The product is the configuration unit. Admin users do not choose low-level entitlement codes. Each selected product resolves its current `*.pro` mapping from `billing_product_entitlements`.

The original token is returned only when the invitation is created. The recent-invites list intentionally shows status but cannot reconstruct the link.

## Recipient flow

The invitation URL uses a fragment:

```text
https://liuh886.github.io/admin/#invite=<token>
```

The browser stores the token locally, removes it from the address bar, and uses the existing Supabase OAuth flow. After sign-in, the first authenticated account to redeem the token receives Pro grants for every product in the invitation. The complimentary duration starts at redemption time and is shared by the whole bundle.

On success, the page lists every granted product with its canonical `billing_products.app_url` so the recipient can open each product directly.

## Membership behavior

Invitation access is a complimentary grant, not a Stripe subscription. It does not create Checkout, collect a payment method, auto-renew, or charge after expiry.

The grant reuses the existing membership foundation:

- selected products are stored as `membership_invites.product_codes[]`;
- each product resolves its current `*.pro` entitlement mapping;
- grants are written to `entitlement_grants` with `source = 'invite'`;
- `refresh_effective_entitlements` recalculates effective access immediately.

Existing Stripe subscriptions and other grants remain independent and can overlap with invitation access.

## One-time guarantee

`membership_invites.token_hash` stores only a SHA-256 hash of a 256-bit random token. Redemption is executed by `redeem_membership_invite` inside PostgreSQL and locks the invitation row with `FOR UPDATE` before checking `redeemed_at`. The same link therefore cannot successfully grant two accounts under concurrent redemption.

## Security boundary

- Raw invitation tokens are never stored in PostgreSQL or the admin audit log.
- Browser roles cannot read or mutate `membership_invites` directly.
- Invitation creation requires an active `owner` or `operator` row in `membership_admins`.
- Redemption requires a valid Supabase user JWT, but does not require an admin role.
- Service-role credentials remain inside the `membership-invite` Edge Function.
