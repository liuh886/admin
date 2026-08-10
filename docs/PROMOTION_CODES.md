# Public promotion codes

Hao Apps uses Stripe Coupon + Promotion Code as the single source of truth for public membership discounts.

## Why this is separate from invitations

- **Single-use invitation**: targeted access for one recipient/account.
- **Promotion code**: public campaign mechanic that many customers can redeem while the campaign is active.

Both use the same canonical Hao Apps product catalog and normal Stripe subscription flow, but they solve different distribution problems.

## Two independent time dimensions

A promotion campaign deliberately separates:

1. **Campaign redemption window** — how long new customers may use the code. This maps to Stripe Promotion Code `expires_at`.
2. **Discount duration after redemption** — how long the redeemed subscription keeps the discount. This maps to the underlying Coupon duration:
   - `forever` for a permanent discount;
   - `repeating` + `duration_in_months` for a fixed number of months.

Examples:

- Three-month campaign, permanent 20% off: Promotion Code expires in three months; Coupon is `percent_off=20`, `duration=forever`.
- Three-month campaign, three-year 50% off: Promotion Code expires in three months; Coupon is `percent_off=50`, `duration=repeating`, `duration_in_months=36`.

Once a customer redeems a valid code, later campaign expiry or code deactivation does not remove the discount already attached to that subscription.

## Admin flow

1. Open the private Hao Apps admin console as an owner/operator.
2. Choose one or more Pro products.
3. Enter a customer-facing code.
4. Set the **pay percentage** (for example 80 means the customer pays 80%, i.e. 20% off).
5. Set the discount duration: permanent or a fixed number of months.
6. Set the campaign expiry date/time.
7. Optionally cap total redemptions.
8. Create the promotion.

The protected `promotion-code` Edge Function creates the Coupon and Promotion Code in Stripe and writes the management action to the existing `membership_admin_actions` audit trail. No parallel promotion table is maintained in Supabase.

## Checkout behavior

All normal Hao Apps subscription Checkout Sessions set `allow_promotion_codes=true`. A campaign page therefore only needs to publish the code and link to the relevant product. The customer signs into Hao Apps, starts the normal subscription Checkout, and enters the code in Stripe Checkout.

Promotion applicability is constrained by the Coupon's Stripe `applies_to.products`, which is built from canonical `billing_products.stripe_product_id` values.

## Deactivation

Admin can deactivate a Promotion Code. Deactivation stops future redemptions but does not cancel or modify discounts that were already redeemed.

## Security

- Stripe secret keys remain server-side in Supabase Edge Functions.
- Promotion mutations require a valid Supabase user JWT, owner/operator membership, and AAL2 MFA.
- Browser assets contain only the publishable Supabase key.
- Stripe remains the promotion source of truth; Supabase stores only the existing admin audit log.
