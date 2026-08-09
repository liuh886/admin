import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const browser = fs.readFileSync('invite.js', 'utf8');
const css = fs.readFileSync('invite.css', 'utf8');
const edge = fs.readFileSync('supabase/functions/membership-invite/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260809161000_membership_multi_product_invites.sql', 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(html.includes('src="./invite.js"'), 'Admin shell must load the invitation module');
expect(edge.includes('#invite='), 'Generated invitation URLs must keep the raw token in the URL fragment');
expect(browser.includes('window.location.hash.slice(1)'), 'Invitation redemption must read the token from the URL fragment');
expect(!edge.includes('?invite='), 'Raw invitation tokens must not be generated as query parameters');
expect(browser.includes('hao_membership_invite_token'), 'OAuth redirect must preserve the invitation token locally');
expect(browser.includes("window.history.replaceState({}, '', ADMIN_URL)"), 'The token fragment must be removed from the address bar after capture');
expect(browser.includes("provider: 'google'"), 'Invitation redemption must use the existing Google account flow');
expect(browser.includes('name="invite-product"'), 'Admin invitation form must expose product-level multi-select choices');
expect(browser.includes('product_codes: selectedCodes'), 'Admin invitation create request must send multiple product codes');
expect(!browser.includes('invite-entitlements'), 'Admin must not expose entitlement-level invitation selection');
expect(browser.includes('redemption.products'), 'Successful redemption must render all invited products');
expect(browser.includes('product.app_url'), 'Successful redemption must show each product access URL');
expect(browser.includes("callInvite('create'"), 'Admin UI must create invitations through the protected Edge Function');
expect(browser.includes("callInvite('redeem'"), 'Recipient UI must redeem invitations through the protected Edge Function');
expect(browser.includes('invite-leave'), 'Invalid or used invitations must offer a clean exit from redemption mode');
expect(css.includes('.invite-product-grid') && css.includes('.invite-product-choice'), 'Multi-product selection must have dedicated responsive styles');
expect(edge.includes('crypto.getRandomValues(new Uint8Array(32))'), 'Invitation tokens must use 256 bits of cryptographic randomness');
expect(edge.includes('crypto.subtle.digest("SHA-256"'), 'Only a hash of the invitation token may be persisted');
expect(edge.includes('membership_admins'), 'Invitation creation must enforce the existing admin whitelist');
expect(edge.includes('productCodes(body.product_codes)'), 'Edge Function must accept a product bundle instead of one product');
expect(edge.includes('billing_product_entitlements'), 'Pro access must still resolve through the existing entitlement catalog');
expect(edge.includes('redeem_membership_invite'), 'Redemption must delegate the one-time state transition to Postgres');
expect(!edge.includes('checkout/sessions'), 'Complimentary multi-product invitations must not create Stripe subscriptions');
expect(migration.includes('drop column if exists product_code'), 'Obsolete single-product invitation storage must be removed');
expect(migration.includes('add column product_codes text[]'), 'Invitation storage must hold multiple product codes');
expect(migration.includes('for update'), 'Redemption must lock the invitation row to prevent double claims');
expect(migration.includes('security invoker'), 'Redemption RPC must not use SECURITY DEFINER');
expect(migration.includes("'invite'"), 'Redeemed rights must reuse entitlement_grants with an invite source');
expect(migration.includes('refresh_effective_entitlements'), 'Redeeming an invitation must refresh effective membership immediately');
expect(!browser.includes('service_role'), 'Browser invitation code must never reference service-role credentials');

console.log('Multi-product membership invitation contract checks passed');
