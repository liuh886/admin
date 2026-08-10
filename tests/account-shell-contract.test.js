import fs from 'node:fs';

const script = fs.readFileSync('shared/account-shell.js', 'utf8');
const upgrade = fs.readFileSync('shared/account-upgrade.js', 'utf8');
const css = fs.readFileSync('shared/account-shell.css', 'utf8');
const portal = fs.readFileSync('supabase/functions/create-portal-session/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0006_shared_product_account_foundation.sql', 'utf8');
const browser = `${script}\n${upgrade}\n${css}`;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

for (const required of [
  'signInWithOAuth',
  'signInWithOtp',
  "from('profiles')",
  "from('product_accounts')",
  "from('product_feedback')",
  "from('entitlements')",
  'hao:account-changed',
  'hao:membership-changed',
  'saveProductData',
  'submitFeedback',
  'function findMount()',
  'function attachTrigger()',
  'function observeMount()',
  'triggerHost.remove()',
  "triggerHost.className = 'hao-account-mount is-embedded'",
]) {
  expect(script.includes(required), `Shared account shell is missing ${required}`);
}

expect(script.includes("const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm'"), 'Shared browser client must pin Supabase JS exactly');
expect(script.includes("const OAUTH_PROVIDER = 'google'"), 'Shared account shell must expose only the verified Google OAuth provider');
expect(!script.includes("github: 'Continue with GitHub'"), 'Unverified GitHub OAuth must not be rendered');
expect(!script.includes("x: 'Continue with X'"), 'Unverified X OAuth must not be rendered');
expect(script.includes('providerButton.dataset.oauthProvider = OAUTH_PROVIDER'), 'Google OAuth button must use the shared provider path');
expect(script.includes("flowType: 'pkce'"), 'Browser auth must use PKCE');
expect(script.includes('persistSession: true'), 'Account sessions must persist on the shared origin');
expect(script.includes('config.billingEnabled'), 'Paid actions must remain controlled by the product config');
expect(script.includes('config.feedbackEnabled'), 'Feedback must remain opt-in per product');
expect(!script.includes("triggerHost.classList.add('is-floating')"), 'Shared account controls must never create a floating fallback');
expect(!css.includes('.hao-account-mount.is-floating'), 'Shared styles must not own a floating account launcher');
expect(css.includes('.hao-account-dialog'), 'Shared account drawer styling must exist');
expect(css.includes('@media (max-width: 640px)'), 'Account shell must include mobile behavior');
expect(css.includes('prefers-reduced-motion'), 'Account shell must respect reduced motion');

expect(script.includes(".eq('entitlement_code', config.entitlementCode)"), 'Browser entitlement reads must be limited to the current product entitlement');
expect(script.includes("console.warn('Hao Account entitlement refresh failed closed:'"), 'Entitlement failures must fail closed');
for (const optionalRead of [
  "optional('profile refresh', ensureProfile)",
  "optional('product account refresh', touchProductAccount)",
  "optional('subscription refresh', refreshSubscription)",
]) {
  expect(script.includes(optionalRead), `Optional account read must not invalidate the auth session: ${optionalRead}`);
}
expect(script.includes("close: '关闭'"), 'Close control must describe closing the dialog, not closing the account');
expect(script.includes("close: 'Close'"), 'English close control must describe closing the dialog');
expect(script.includes('cancel_at_period_end'), 'Subscription cancellation scheduling must be available to the account UI');
expect(script.includes("accessUntil: '已安排取消 · Pro 有效至'"), 'Scheduled cancellation must be explicit in Chinese');
expect(script.includes("accessUntil: 'Cancellation scheduled · Pro access through'"), 'Scheduled cancellation must be explicit in English');
expect(script.includes('function subscriptionSummary(t)'), 'Account shell must render subscription lifecycle state');

for (const required of [
  'function removeInternalCapabilities(dialog)',
  "dialog.querySelector('.hao-account-feature-panel')?.remove()",
  'function ensureProManagement(dialog, snapshot)',
  'if (!snapshot?.isPro || snapshot.subscription) return',
  'if (!snapshot?.isPro || !snapshot.subscription) return',
  "manage: '管理订阅'",
  "manage: 'Manage subscription'",
  'config.portalFunctionUrl',
]) {
  expect(upgrade.includes(required), `Shared Pro account upgrade is missing ${required}`);
}

for (const required of [
  'billing_customers',
  'metadata[supabase_user_id]',
  'hao-customer-${userData.user.id}',
  'billing_portal/sessions',
]) {
  expect(portal.includes(required), `Stripe portal function is missing ${required}`);
}
expect(!portal.includes('No billing customer exists for this account'), 'Portal must create a Stripe customer when a Pro account does not have one yet');

for (const required of [
  "const TURNSTILE_SITE_KEY = '0x4AAAAAAEKVMnWa2valozxW'",
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  'function loadTurnstile()',
  'async function mountTurnstile',
  'captchaToken: verifiedToken',
  'magicLinkButton.disabled = true',
]) {
  expect(script.includes(required), `Shared account shell is missing Turnstile contract: ${required}`);
}
expect(!/TURNSTILE_SECRET|secretKey|secret_key/i.test(script), 'Turnstile secret material must never enter the browser shell');

for (const required of [
  'create table if not exists public.product_accounts',
  'create table if not exists public.product_feedback',
  'alter table public.product_accounts enable row level security',
  'alter table public.product_feedback enable row level security',
  'Users read own product accounts',
  'Users insert own product feedback',
  '(select auth.uid()) = user_id',
]) {
  expect(migration.includes(required), `Shared account migration is missing ${required}`);
}

for (const forbidden of [
  /sk_(?:live|test)_[A-Za-z0-9]/,
  /whsec_[A-Za-z0-9]/,
  /sb_secret_[A-Za-z0-9]/,
  /service_role\s*[:=]/,
  /private_key\s*[:=]/,
]) {
  expect(!forbidden.test(browser), `Shared browser assets contain forbidden secret material: ${forbidden}`);
}

console.log('Shared account UI keeps auth resilient, entitlement reads product-scoped, billing lifecycle explicit, and secrets server-side.');
