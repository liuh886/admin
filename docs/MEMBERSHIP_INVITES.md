# Single-use Pro invitations

The admin console can create one-time complimentary Pro invitation links for an existing Hao Apps product.

## Admin flow

1. Open `https://liuh886.github.io/admin/` as an `owner` or `operator`.
2. In **一次性邀请**, select the product.
3. Select one or more entitlements mapped to that product.
4. Select the complimentary duration: 7, 30, 90, 365 days, or lifetime.
5. Generate the invitation and copy the link immediately.

The original token is returned only when the invitation is created. The recent-invites list intentionally shows status but cannot reconstruct the link.

## Recipient flow

The invitation URL uses a fragment:

```text
https://liuh886.github.io/admin/#invite=<token>
```

The browser stores the token locally, removes it from the address bar, and uses the existing Supabase OAuth flow. After sign-in, the first authenticated account to redeem the token receives the selected entitlement grants. The complimentary duration starts at redemption time.

On success, the page shows the product name, entitlement validity and the canonical `billing_products.app_url`, with a direct button to open the product.

## One-time guarantee

`membership_invites.token_hash` stores only a SHA-256 hash of a 256-bit random token. Redemption is executed by `redeem_membership_invite` inside PostgreSQL and locks the invitation row with `FOR UPDATE` before checking `redeemed_at`. The same link therefore cannot successfully create two grants under concurrent redemption.

The redeemed access is not a separate membership system. It is written to the existing `entitlement_grants` table with `source = 'invite'`, then `refresh_effective_entitlements` recalculates the user's effective Pro access.

## Security boundary

- Raw invitation tokens are never stored in PostgreSQL or the admin audit log.
- Browser roles cannot read or mutate `membership_invites` directly.
- Invitation creation requires an active `owner` or `operator` row in `membership_admins`.
- Redemption requires a valid Supabase user JWT, but does not require an admin role.
- Service-role credentials remain inside the `membership-invite` Edge Function.
