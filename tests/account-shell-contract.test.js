import fs from 'node:fs';

const script = fs.readFileSync('shared/account-shell.js', 'utf8');
const css = fs.readFileSync('shared/account-shell.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0006_shared_product_account_foundation.sql', 'utf8');
const browser = `${script}\n${css}`;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

for (const required of [
  "signInWithOAuth",
  "signInWithOtp",
  "from('profiles')",
  "from('product_accounts')",
  "from('product_feedback')",
  "from('entitlements')",
  "hao:account-changed",
  "hao:membership-changed",
  "saveProductData",
  "submitFeedback",
  'function findMount()',
  'function attachTrigger()',
  'function observeMount()',
  'triggerHost.remove()',
  "triggerHost.className = 'hao-account-mount is-embedded'",
]) {
  expect(script.includes(required), `Shared account shell is missing ${required}`);
}

for (const provider of ['google', 'github', 'x']) {
  expect(script.includes(`'${provider}'`), `Shared account shell must include the ${provider} OAuth provider`);
}
expect(script.includes("const OAUTH_PROVIDERS = ['google', 'github', 'x']"), 'OAuth provider list must stay explicit and minimal');
expect(script.includes('async function signInWithProvider(provider)'), 'OAuth sign-in must use one provider function');
expect(script.includes('signInWithProvider,'), 'Shared account API must expose provider sign-in');
expect(script.includes('Continue with GitHub'), 'GitHub sign-in copy must be present');
expect(script.includes('Continue with X'), 'X sign-in copy must be present');
expect(!script.includes("provider: 'twitter'"), 'Legacy Twitter OAuth provider must not be used');
expect(script.includes("flowType: 'pkce'"), 'Browser auth must use PKCE');
expect(script.includes('persistSession: true'), 'Account sessions must persist across Hao Apps on the shared origin');
expect(script.includes("config.billingEnabled"), 'Paid actions must remain controlled by the product config');
expect(script.includes("config.feedbackEnabled"), 'Feedback must remain opt-in per product');
expect(!script.includes("triggerHost.classList.add('is-floating')"), 'Shared account controls must never create a floating fallback');
expect(!css.includes('.hao-account-mount.is-floating'), 'Shared styles must not own a floating account launcher');
expect(css.includes('.hao-account-dialog'), 'Shared account drawer styling must exist');
expect(css.includes('@media (max-width: 640px)'), 'Account shell must include mobile behavior');
expect(css.includes('prefers-reduced-motion'), 'Account shell must respect reduced motion');

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

console.log('Shared account shell supports Google, GitHub and X OAuth, Turnstile-protected email auth, and exposes no privileged secret.');