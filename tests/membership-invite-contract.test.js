import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const browser = fs.readFileSync('invite.js', 'utf8');
const css = fs.readFileSync('invite.css', 'utf8');
const edge = fs.readFileSync('supabase/functions/membership-invite/index.ts', 'utf8');
const schema = fs.readFileSync('supabase/migrations/20260809152000_membership_single_use_invites.sql', 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(html.includes('src="./invite.js"'), 'Admin shell must load the invitation module');
expect(browser.includes('@supabase/supabase-js@2.111.0/+esm'), 'Invitation browser Supabase client must be pinned to the tested release');
expect(edge.includes('npm:@supabase/supabase-js@2.111.0'), 'Invitation Edge Function Supabase client must be pinned to the tested release');
expect(edge.includes('getAuthenticatorAssuranceLevel(token)'), 'Invitation creation must independently verify AAL2');
expect(edge.includes('data.currentLevel !== "aal2"'), 'Invitation creation must fail closed below AAL2');
expect(edge.includes('if (action === "create")') && edge.includes('await requireAal2();'), 'Only privileged invitation creation must require AAL2');
expect(edge.includes('if (action === "redeem")'), 'Recipient redemption must remain a separate customer action');
expect(edge.includes('#invite='), 'Generated invitation URLs must keep the raw token in the URL fragment');
expect(browser.includes('window.location.hash.slice(1)'), 'Invitation redemption must read the token from the URL fragment');
expect(!edge.includes('?invite='), 'Raw invitation tokens must not be generated as query parameters');
expect(browser.includes('hao_membership_invite_token'), 'OAuth redirect must preserve the invitation token locally');
expect(browser.includes('hao_membership_invite_offer'), 'OAuth redirect must preserve the non-authoritative invite offer preview locally');
expect(browser.includes("params.set('offer', JSON.stringify(offer))"), 'Generated share links must include a visible offer preview in the URL fragment');
expect(browser.includes("const OAUTH_PROVIDERS = new Set(['google', 'github', 'x'])"), 'Invitation page must support Google, GitHub, and X OAuth');
for (const provider of ['google', 'github', 'x']) {
  expect(browser.includes(`data-invite-provider=\"${provider}\"`), `Invitation page must render the ${provider} login entry`);
}
expect(browser.includes('Google <em>推荐</em>'), 'Google must be visually recommended on the invitation page');
expect(browser.includes('signInWithProvider(provider)'), 'Invitation OAuth entry points must share one provider-aware sign-in path');
expect(browser.includes('确认领取到这个账号'), 'Signed-in recipients must confirm the target account before consuming the one-time invite');
expect(browser.includes('换一个账号'), 'Recipients must be able to switch accounts before redemption');
expect(browser.includes('offerMarkup()'), 'Invitation page must render the promised products before login');
expect(browser.includes('领取后访问'), 'Invitation offer preview must show each product access URL');
expect(browser.includes('name="invite-product"'), 'Admin invitation form must expose product-level multi-select choices');
expect(browser.includes('product_codes: selectedProducts'), 'Admin invitation create request must send multiple product codes');
expect(!browser.includes('invite-entitlements'), 'Admin must not expose entitlement-level invitation selection');
expect(browser.includes('result.redemption?.products'), 'Successful redemption must render all invited products');
expect(browser.includes('product.app_url'), 'Successful redemption must show every product access URL');
expect(browser.includes('管理订阅'), 'Invitation UX must explain subscription management during the free period');
expect(browser.includes("callInvite('create'"), 'Admin UI must create invitations through the protected Edge Function');
expect(browser.includes("callInvite('redeem'"), 'Recipient UI must redeem invitations through the protected Edge Function');
expect(browser.includes('链接已失效') && browser.includes('item.redeemed_email'), 'Recent invitations must show the claimant email and consumed-link state');
expect(browser.includes('会员页最终有效期会按所有授权来源聚合'), 'Admin must explain why another permanent grant can outlive an invite trial');
expect(edge.includes('admin.auth.admin.getUserById'), 'Admin invite catalog must resolve redeemed user IDs to emails server-side');
expect(edge.includes('redeemed_email'), 'Admin invite catalog must return the redemption email');
expect(css.includes('.invite-product-options') && css.includes('.invite-product-option'), 'Multi-product selection must have dedicated responsive styles');
expect(css.includes('.invite-provider-grid') && css.includes('.invite-provider.recommended'), 'Invitation social-login choices must have dedicated styling');
expect(css.includes('.invite-offer') && css.includes('.invite-offer-item'), 'Invitation benefits preview must have dedicated styling');
expect(edge.includes('crypto.getRandomValues(new Uint8Array(32))'), 'Invitation tokens must use 256 bits of cryptographic randomness');
expect(edge.includes('crypto.subtle.digest("SHA-256"'), 'Only a hash of the invitation token may be persisted');
expect(edge.includes('membership_admins'), 'Invitation creation must enforce the existing admin whitelist');
expect(edge.includes('productCodes(body.product_codes)'), 'Edge Function must accept a product bundle instead of one product');
expect(edge.includes('billing_product_entitlements'), 'Pro rights must resolve through the existing entitlement catalog');
expect(edge.includes('billing_prices'), 'Every invited product must resolve its registered Stripe price');
expect(edge.includes('stripePost(') && edge.includes('"subscriptions"'), 'Free invitations must create real Stripe subscriptions');
expect(edge.includes('trial_period_days'), 'Invitations must configure a fixed Stripe trial duration');
expect(edge.includes('trial_settings[end_behavior][missing_payment_method]'), 'Trials must define missing-payment-method end behavior');
expect(edge.includes('"cancel"'), 'Trials without a payment method must cancel at trial end');
expect(edge.includes('stripe_subscription'), 'Trial access must use the normal Stripe subscription entitlement source');
expect(edge.includes('refresh_effective_entitlements'), 'Redeeming an invitation must refresh effective membership immediately');
expect(edge.includes('Idempotency-Key'), 'Stripe subscription creation must be idempotent');
expect(!edge.includes('redeem_membership_invite'), 'The obsolete direct entitlement redemption RPC must not return');
expect(schema.includes('product_codes text[] not null'), 'Invitation schema must be multi-product directly');
expect(schema.includes('duration_days integer not null'), 'Every invitation must have a finite free-trial duration');
expect(schema.includes('duration_days <= 730'), 'Invitation duration must stay within the supported bound');
expect(schema.includes('(redeemed_by is not null)'), 'Schema must allow the claimed/in-progress retry state');
expect(!schema.includes('create or replace function public.redeem_membership_invite'), 'Schema must not create a parallel direct-grant redemption path');
expect(!browser.includes('service_role'), 'Browser invitation code must never reference service-role credentials');

console.log('Stripe-managed multi-product Pro invitation contract checks passed');
