import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const browser = fs.readFileSync('invite.js', 'utf8');
const css = fs.readFileSync('invite.css', 'utf8');
const edge = fs.readFileSync('supabase/functions/membership-invite/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260809152000_membership_single_use_invites.sql', 'utf8');

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
expect(browser.includes('redemption.app_url'), 'Successful redemption must show the product access URL');
expect(browser.includes("callInvite('create'"), 'Admin UI must create invitations through the protected Edge Function');
expect(browser.includes("callInvite('redeem'"), 'Recipient UI must redeem invitations through the protected Edge Function');
expect(browser.includes('invite-leave'), 'Invalid or used invitations must offer a clean exit from redemption mode');
expect(css.includes('.invite-redemption'), 'Invitation redemption must have a dedicated full-screen surface');
expect(edge.includes('crypto.getRandomValues(new Uint8Array(32))'), 'Invitation tokens must use 256 bits of cryptographic randomness');
expect(edge.includes('crypto.subtle.digest("SHA-256"'), 'Only a hash of the invitation token may be persisted');
expect(edge.includes('membership_admins'), 'Invitation creation must enforce the existing admin whitelist');
expect(edge.includes('billing_product_entitlements'), 'Selectable invitation rights must come from the product entitlement catalog');
expect(edge.includes('redeem_membership_invite'), 'Redemption must delegate the one-time state transition to Postgres');
expect(migration.includes('create table public.membership_invites'), 'Invitation storage must be declared');
expect(migration.includes('for update'), 'Redemption must lock the invitation row to prevent double claims');
expect(migration.includes('security invoker'), 'Redemption RPC must not use SECURITY DEFINER');
expect(migration.includes("source,\n      source_ref") && migration.includes("'invite'"), 'Redeemed rights must reuse entitlement_grants with an invite source');
expect(migration.includes('refresh_effective_entitlements'), 'Redeeming an invitation must refresh effective membership immediately');
expect(migration.includes('membership_invites_deny_browser_access'), 'Raw invitation state must be denied to browser roles');
expect(!browser.includes('service_role'), 'Browser invitation code must never reference service-role credentials');

console.log('Single-use membership invitation contract checks passed');
