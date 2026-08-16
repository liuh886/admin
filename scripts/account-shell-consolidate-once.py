from pathlib import Path

shell_path = Path('shared/account-shell.js')
shell = shell_path.read_text(encoding='utf-8')

marker = "  let captchaToken = '';\n"
assert marker in shell
shell = shell.replace(marker, marker + "  const upgradeIntentKey = `hao:upgrade-intent:${config.productCode || 'app'}`;\n", 1)

marker = "  const icon = (name) => {\n"
assert marker in shell
upgrade_helpers = r'''  const upgradeWords = {
    zh: {
      plans: 'Free 与 Pro', free: 'FREE', pro: 'PRO', price: 'US$1 / 月',
      guide: '登录后即可通过 Stripe 开通 Pro。Free 权限不会因为未订阅而减少。',
      step1: '登录账户', step2: 'Stripe 付款', step3: 'Pro 自动生效',
      continue: '选择登录方式继续', signInSection: '登录或创建账户',
      stripe: 'Stripe 安全结账 · 可随时取消', checkout: '开通 {app} Pro',
      proManageBody: 'Pro 权限已激活，当前没有需要续费或取消的付费订阅。',
      trialActive: 'PRO · 免费体验中',
      trialBody: '免费体验有效至 {date}。这是一条可管理的 Stripe 订阅，你可以随时查看订阅、管理付款方式或取消。',
    },
    en: {
      plans: 'Free and Pro', free: 'FREE', pro: 'PRO', price: 'US$1 / month',
      guide: 'Sign in first, then continue to Stripe Checkout. Free access is never reduced because you do not subscribe.',
      step1: 'Sign in', step2: 'Pay with Stripe', step3: 'Pro activates',
      continue: 'Choose a sign-in method', signInSection: 'Sign in or create an account',
      stripe: 'Secure checkout with Stripe · Cancel anytime', checkout: 'Upgrade to {app} Pro',
      proManageBody: 'Pro access is active and no paid subscription currently needs renewal or cancellation.',
      trialActive: 'PRO · FREE TRIAL',
      trialBody: 'Your free trial runs through {date}. This is a manageable Stripe subscription: you can review it, manage payment details, or cancel at any time.',
    },
  };

  const upgradeText = () => upgradeWords[currentLanguage()] || upgradeWords.en;
  const upgradeElement = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value) node.textContent = value;
    return node;
  };

  function upgradeFeatureList(items) {
    const list = upgradeElement('ul', 'hao-upgrade-feature-list');
    (Array.isArray(items) ? items : []).forEach((item) => {
      const row = upgradeElement('li');
      row.append(upgradeElement('span', 'hao-upgrade-check', '✓'), upgradeElement('span', '', localized(item)));
      list.appendChild(row);
    });
    return list;
  }

  function upgradePlan(kind, title, features, isPro = false) {
    const row = upgradeElement('section', `hao-upgrade-plan${isPro ? ' is-pro' : ''}`);
    row.append(upgradeElement('span', 'hao-upgrade-plan-label', kind));
    const copy = upgradeElement('div', 'hao-upgrade-plan-copy');
    copy.append(upgradeElement('strong', '', localized(title)), upgradeFeatureList(features));
    row.appendChild(copy);
    return row;
  }

  function focusUpgradeSignIn(dialog) {
    const provider = dialog.querySelector('.hao-account-provider');
    if (!provider) return;
    provider.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => provider.focus(), 220);
  }

  function enhanceUpgrade(dialog, snapshotValue) {
    const upgrade = config.billingEnabled ? config.proUpgrade : null;
    if (!upgrade) return;
    const t = upgradeText();

    dialog.querySelector('.hao-account-feature-panel')?.remove();
    const intro = dialog.querySelector('.hao-account-intro');
    if (intro && !dialog.querySelector('.hao-upgrade-plans')) {
      const panel = upgradeElement('section', 'hao-upgrade-plans');
      panel.append(
        upgradeElement('strong', 'hao-upgrade-plans-title', localized(upgrade.title, t.plans)),
        upgradePlan(t.free, upgrade.freeTitle, upgrade.freeFeatures),
        upgradePlan(t.pro, upgrade.proTitle, upgrade.proFeatures, true),
      );
      const note = localized(upgrade.note);
      if (note) panel.append(upgradeElement('small', 'hao-upgrade-note', note));
      intro.after(panel);
    }

    const guest = dialog.querySelector('.hao-account-guest');
    if (guest && !dialog.querySelector('.hao-upgrade-guide')) {
      const statusChip = guest.querySelector('.hao-account-status-chip');
      if (statusChip) statusChip.textContent = t.signInSection;
      const guide = upgradeElement('section', 'hao-upgrade-guide');
      const head = upgradeElement('div', 'hao-upgrade-guide-head');
      const copy = upgradeElement('div', 'hao-upgrade-guide-copy');
      copy.append(
        upgradeElement('strong', '', localized(upgrade.ctaTitle, formatText(t.checkout))),
        upgradeElement('p', '', localized(upgrade.checkoutDescription, t.guide)),
      );
      head.append(copy, upgradeElement('span', 'hao-upgrade-price', localized(upgrade.price, t.price)));
      const steps = upgradeElement('ol', 'hao-upgrade-steps');
      [t.step1, t.step2, t.step3].forEach((label, index) => {
        const item = upgradeElement('li');
        item.append(upgradeElement('span', '', String(index + 1)), upgradeElement('strong', '', label));
        steps.appendChild(item);
      });
      const button = upgradeElement('button', 'hao-account-primary hao-upgrade-login-cta', t.continue);
      button.type = 'button';
      button.addEventListener('click', () => {
        sessionStorage.setItem(upgradeIntentKey, '1');
        focusUpgradeSignIn(dialog);
      });
      guide.append(head, steps, button, upgradeElement('small', 'hao-upgrade-stripe', t.stripe));
      guest.before(guide);
    }

    const inactiveCard = dialog.querySelector('.hao-account-pro-card:not(.is-active)');
    if (inactiveCard) {
      const body = inactiveCard.querySelector('.hao-account-pro-copy p');
      const button = inactiveCard.querySelector('.hao-account-pro-action .hao-account-primary');
      const description = localized(upgrade.checkoutDescription);
      if (body && description) body.textContent = description;
      if (button) button.textContent = localized(upgrade.ctaTitle, formatText(t.checkout));
    }

    if (snapshotValue?.isPro && !snapshotValue.subscription) {
      const body = dialog.querySelector('.hao-account-pro-card.is-active .hao-account-pro-copy p');
      if (body) body.textContent = t.proManageBody;
    }

    if (snapshotValue?.subscription?.status === 'trialing') {
      const card = dialog.querySelector('.hao-account-pro-card.is-active');
      const kicker = card?.querySelector('.hao-account-pro-kicker');
      const body = card?.querySelector('.hao-account-pro-copy p');
      if (kicker) kicker.textContent = t.trialActive;
      if (body) body.textContent = t.trialBody.replace('{date}', formatDate(snapshotValue.subscription.current_period_end));
    }
  }

  function resumeUpgradeIntent(snapshotValue) {
    if (!config.proUpgrade || sessionStorage.getItem(upgradeIntentKey) !== '1') return;
    if (!snapshotValue?.user || snapshotValue.isPro) return;
    sessionStorage.removeItem(upgradeIntentKey);
    state.open = true;
    document.documentElement.classList.add('hao-account-open');
    render();
    window.setTimeout(() => {
      const checkout = document.querySelector('#hao-account-overlay .hao-account-pro-card:not(.is-active) .hao-account-primary');
      checkout?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => checkout?.focus(), 220);
    }, 0);
  }

'''
shell = shell.replace(marker, upgrade_helpers + marker, 1)

old_emit = "    window.dispatchEvent(new CustomEvent('hao:account-changed', { detail }));\n    window.dispatchEvent(new CustomEvent('hao:membership-changed', { detail }));\n"
assert old_emit in shell
shell = shell.replace(old_emit, "    window.dispatchEvent(new CustomEvent('hao:account-changed', { detail }));\n    resumeUpgradeIntent(detail);\n", 1)

marker = "    backdrop.appendChild(dialog);\n"
assert marker in shell
shell = shell.replace(marker, "    enhanceUpgrade(dialog, snapshot());\n    backdrop.appendChild(dialog);\n", 1)

old_observer = """  function observeMount() {
    mountObserver?.disconnect();
    mountObserver = new MutationObserver(() => {
      const target = findMount();
      if (!target || triggerHost?.parentElement !== target) attachTrigger();
    });
    mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
"""
assert old_observer in shell
new_observer = """  function observeMount() {
    mountObserver?.disconnect();
    mountObserver = null;
    if (attachTrigger()) return;
    mountObserver = new MutationObserver(() => {
      if (!attachTrigger()) return;
      mountObserver?.disconnect();
      mountObserver = null;
    });
    mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
"""
shell = shell.replace(old_observer, new_observer, 1)
init_old = "    attachTrigger();\n    observeMount();\n"
assert init_old in shell
shell = shell.replace(init_old, "    observeMount();\n", 1)
shell_path.write_text(shell, encoding='utf-8')

css_path = Path('shared/account-shell.css')
css = css_path.read_text(encoding='utf-8').rstrip()
upgrade_css = Path('shared/account-upgrade.css').read_text(encoding='utf-8').strip()
css_path.write_text(css + "\n\n/* Pro upgrade presentation is owned by the account shell. */\n\n" + upgrade_css + "\n", encoding='utf-8')

readme_path = Path('shared/README.md')
readme = readme_path.read_text(encoding='utf-8')
readme = readme.replace('account-shell.css?v=1', 'account-shell.css?v=6')
readme = readme.replace('account-shell.js?v=1', 'account-shell.js?v=7')
readme = readme.replace('The shell emits both `hao:account-changed` and the compatibility event `hao:membership-changed`.', 'The shell emits `hao:account-changed` as the single account-state event.')
readme += '\n\nWhen `billingEnabled` and `proUpgrade` are configured, Free/Pro comparison and checkout guidance are rendered directly by `account-shell`; there is no second upgrade runtime.\n'
readme_path.write_text(readme, encoding='utf-8')

test_path = Path('tests/account-shell-contract.test.js')
test = test_path.read_text(encoding='utf-8')
test = test.replace("const upgrade = fs.readFileSync('shared/account-upgrade.js', 'utf8');\n", '')
test = test.replace('const browser = `${script}\\n${upgrade}\\n${css}`;', 'const browser = `${script}\\n${css}`;')
test = test.replace("  'hao:membership-changed',\n", '')
upgrade_loop_start = "for (const required of [\n  'function removeInternalCapabilities(dialog)',"
start = test.find(upgrade_loop_start)
assert start != -1
end_marker = "}\n\nfor (const required of [\n  'billing_customers',"
end = test.find(end_marker, start)
assert end != -1
replacement = """for (const required of [
  'function enhanceUpgrade(dialog, snapshotValue)',
  "dialog.querySelector('.hao-account-feature-panel')?.remove()",
  'function resumeUpgradeIntent(snapshotValue)',
  "sessionStorage.setItem(upgradeIntentKey, '1')",
  "localized(upgrade.ctaTitle, formatText(t.checkout))",
  "snapshotValue?.subscription?.status === 'trialing'",
]) {
  expect(script.includes(required), `Canonical account shell is missing integrated Pro upgrade behavior: ${required}`);
}
expect(!script.includes('hao:membership-changed'), 'Retired membership compatibility event must not return');
expect((script.match(/new MutationObserver/g) || []).length === 1, 'Account shell may only observe DOM while waiting for its mount');
expect(script.includes('mountObserver?.disconnect();'), 'Mount observer must disconnect after the account slot appears');

for (const required of [
  'billing_customers',"""
test = test[:start] + replacement + test[end + len("}\n\nfor (const required of [\n  'billing_customers',"):]
test_path.write_text(test, encoding='utf-8')

workflow_path = Path('.github/workflows/pages.yml')
workflow = workflow_path.read_text(encoding='utf-8')
old = "if grep -Eq '^(index\\.html|admin\\.(js|css)|operations\\.(js|css)|feedback-admin\\.(js|css)|(invite|promotion)\\.(js|css)|tests/e2e/|playwright\\.config\\.js|\\.github/workflows/pages\\.yml)' changed-files.txt; then"
new = "if grep -Eq '^(index\\.html|admin\\.(js|css)|operations\\.(js|css)|feedback-admin\\.(js|css)|(invite|promotion)\\.(js|css)|shared/.*\\.(js|css)|tests/(e2e|fixtures)/|playwright\\.config\\.js|\\.github/workflows/pages\\.yml)' changed-files.txt; then"
assert old in workflow
workflow_path.write_text(workflow.replace(old, new, 1), encoding='utf-8')

fixtures = Path('tests/fixtures')
fixtures.mkdir(parents=True, exist_ok=True)
(fixtures / 'account-shell.html').write_text('''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="/shared/account-shell.css">
</head>
<body>
  <header><div data-account-slot></div></header>
  <main id="app"></main>
  <script>
    window.HaoAccountConfig = Object.freeze({
      enabled: true,
      billingEnabled: true,
      appName: 'Fixture',
      productCode: 'fixture',
      entitlementCode: 'fixture.pro',
      supabaseUrl: 'https://fixture.supabase.co',
      supabasePublishableKey: 'sb_publishable_fixture',
      checkoutFunctionUrl: 'https://fixture.supabase.co/functions/v1/create-checkout-session',
      portalFunctionUrl: 'https://fixture.supabase.co/functions/v1/create-portal-session',
      mountSelectors: ['[data-account-slot]'],
      proUpgrade: {
        title: { en: 'Free and Fixture Pro' },
        freeTitle: { en: 'Core stays free' },
        freeFeatures: [{ en: 'Use the core product' }],
        proTitle: { en: 'Fixture Pro' },
        proFeatures: [{ en: 'Unlock Pro capability' }],
        checkoutDescription: { en: 'Upgrade without reducing Free access.' },
        ctaTitle: { en: 'Upgrade to Fixture Pro' }
      }
    });
  </script>
  <script src="/shared/account-shell.js"></script>
</body>
</html>
''', encoding='utf-8')

(Path('tests/e2e') / 'account-shell.spec.js').write_text('''import { test, expect } from '@playwright/test';

test('shared account shell renders Pro guidance in one stable mount', async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export function createClient() { return { auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signInWithOAuth: async () => ({ error: null }), signInWithOtp: async () => ({ error: null }) } }; }`
  }));
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.turnstile={render(){return 1},remove(){}};`
  }));

  await page.goto('/tests/fixtures/account-shell.html');
  const trigger = page.locator('[data-account-slot] .hao-account-trigger');
  await expect(trigger).toHaveCount(1);
  await trigger.click();
  await expect(page.getByText('Free and Fixture Pro')).toBeVisible();
  await expect(page.getByText('Choose a sign-in method')).toBeVisible();
  await expect(page.locator('.hao-account-feature-panel')).toHaveCount(0);
  await expect(page.locator('.hao-upgrade-plans')).toHaveCount(1);

  await page.evaluate(() => document.querySelector('#app')?.appendChild(document.createElement('div')));
  await expect(page.locator('[data-account-slot] .hao-account-trigger')).toHaveCount(1);
});
''', encoding='utf-8')

Path('shared/account-upgrade.js').unlink()
Path('shared/account-upgrade.css').unlink()
