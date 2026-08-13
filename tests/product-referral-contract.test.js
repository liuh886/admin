import fs from 'node:fs';

const schema = fs.readFileSync('supabase/product-referral.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/product-referral/index.ts', 'utf8');
const shared = fs.readFileSync('shared/product-referral.js', 'utf8');
const landing = fs.readFileSync('referral.js', 'utf8');
const admin = fs.readFileSync('referral-admin.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const inviteEdge = fs.readFileSync('supabase/functions/membership-invite/index.ts', 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(schema.includes('create table if not exists public.product_referral_codes'), 'Stable product referral identities must have one canonical table');
expect(schema.includes('primary key (user_id, product_code)'), 'Referral identity must be stable per user and product');
expect(schema.includes('create table if not exists public.product_referral_attributions'), 'Referral acceptance must have a canonical attribution ledger');
expect(schema.includes('unique (product_code, invitee_user_id)'), 'An account may accept only one referral attribution per product');
expect(schema.includes('on conflict on constraint product_referral_attributions_invitee_unique do nothing'), 'Referral redemption must target the named attribution uniqueness constraint without PL/pgSQL output-variable ambiguity');
expect(!schema.includes('on conflict (product_code, invitee_user_id) do nothing'), 'Ambiguous column-list conflict syntax must not return');
expect(schema.includes('invitee_user_id <> inviter_user_id'), 'Self-referral must fail at the database boundary');
expect(schema.includes('alter table public.product_referral_codes enable row level security'), 'Referral code table must enable RLS');
expect(schema.includes('alter table public.product_referral_attributions enable row level security'), 'Referral attribution table must enable RLS');
expect(schema.includes("'product_referral'"), 'Referral Pro grants must use their own canonical entitlement source');
expect(schema.includes('refresh_effective_entitlements'), 'Referral grant redemption must refresh effective access immediately');
expect(schema.includes('grant execute on function public.redeem_product_referral(uuid, text) to service_role'), 'Referral redemption RPC must stay service-role only');
expect(!schema.includes('grant execute on function public.redeem_product_referral(uuid, text) to authenticated'), 'Browser users must not call the privileged referral redemption RPC directly');

for (const action of ['preview', 'get_or_create', 'redeem', 'admin_catalog', 'set_policy']) {
  expect(edge.includes(`action === "${action}"`), `Product referral Edge Function must implement ${action}`);
}
expect(edge.includes('metadata?.referral_trial_days'), 'Referral trial policy must come from billing_products metadata');
expect(edge.includes('auth.getUser(token)'), 'Authenticated referral actions must validate the JWT against Supabase Auth');
expect(edge.includes('getAuthenticatorAssuranceLevel(token)'), 'Referral policy mutations must require AAL2');
expect(edge.includes('product_referral_codes'), 'Stable referral links must be resolved server-side');
expect(edge.includes('product_referral_attributions'), 'Referral conversion counts must come from the attribution ledger');
expect(!edge.includes('ALPHA_REFERRAL_DAYS'), 'Shared referral policy must not contain product-specific trial constants');

expect(shared.includes("config.referralEnabled !== true"), 'Products must opt into the shared referral UI explicitly');
expect(shared.includes("api('get_or_create')"), 'Signed-in users must receive their stable server-owned referral link');
expect(shared.includes('joined_count') && shared.includes('trial_count'), 'Inviters must see joined and Pro-trial conversion counts');
expect(shared.includes('navigator.share') && shared.includes('navigator.clipboard.writeText'), 'Referral sharing must support native share with clipboard fallback');
expect(shared.includes("if (existing && triggerUserId === userId) return;"), 'Referral trigger rendering must be idempotent for the current signed-in user');
expect(shared.includes("if (!host || !host.isConnected || host.parentElement !== mount) renderTrigger();"), 'Mutation observation must only remount a missing or displaced referral host');
expect(!shared.includes('new MutationObserver(() => renderTrigger())'), 'Mutation observation must never blindly rerender the trigger on its own DOM writes');
expect(!shared.includes('duration_days:'), 'Product clients must never choose a referral trial duration');
expect(!shared.includes('trial_days:'), 'Product clients must never send a referral trial duration');

expect(landing.includes("callReferral('preview')"), 'Referral onboarding must preview the server-authoritative offer before sign-in');
expect(landing.includes("callReferral('redeem', {}, true)"), 'Referral onboarding must redeem only after authenticated confirmation');
expect(landing.includes("const OAUTH_PROVIDERS = new Set(['google', 'github', 'x'])"), 'Referral onboarding must support Google, GitHub, and X');
expect(landing.includes('signInWithOtp'), 'Referral onboarding must retain email magic-link sign-in');
expect(landing.includes('确认并激活邀请'), 'Referral redemption must require explicit account confirmation');
expect(landing.includes('换一个账号'), 'Referral onboarding must allow account switching before redemption');
expect(landing.includes('referral_landing_view') && landing.includes('referral_pro_activated'), 'Referral funnel telemetry must use the existing analytics path');

expect(admin.includes("call('admin_catalog')"), 'Admin must load referral policy and conversion state from the shared backend');
expect(admin.includes("call('set_policy'"), 'Admin must own the referral Pro-duration mutation');
expect(html.includes('src="./referral.js"'), 'Admin must load the referral onboarding surface');
expect(html.includes('src="./referral-admin.js"'), 'Admin must load referral policy controls');
expect(!inviteEdge.includes('create_referral'), 'The retired Alpha-specific one-time referral path must be deleted');
expect(!inviteEdge.includes('ALPHA_REFERRAL_DAYS'), 'The retired Alpha referral duration constant must be deleted');

console.log('Shared Hao Apps product referral contract checks passed');
