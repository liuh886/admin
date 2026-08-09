(() => {
  'use strict';

  const config = window.HaoAccountConfig || {};
  const upgrade = config.proUpgrade;
  if (!config.enabled || !config.billingEnabled || !upgrade) return;

  const intentKey = `hao:upgrade-intent:${config.productCode || 'app'}`;
  let latestSnapshot = window.HaoAccount?.getState?.() || null;

  const words = {
    zh: {
      plans: 'Free 与 Pro',
      free: 'FREE',
      pro: 'PRO',
      price: 'US$1 / 月',
      guide: '登录后即可通过 Stripe 开通 Pro。Free 权限不会因为未订阅而减少。',
      step1: '登录账户',
      step2: 'Stripe 付款',
      step3: 'Pro 自动生效',
      continue: '选择登录方式继续',
      signInSection: '登录或创建账户',
      stripe: 'Stripe 安全结账 · 可随时取消',
      checkout: '开通 {app} Pro',
      trialActive: 'PRO · 免费体验中',
      trialBody: '免费体验有效至 {date}。这是一个可管理的 Stripe 订阅，你可以随时查看订阅、管理付款方式或取消。',
    },
    en: {
      plans: 'Free and Pro',
      free: 'FREE',
      pro: 'PRO',
      price: 'US$1 / month',
      guide: 'Sign in first, then continue to Stripe Checkout. Free access is never reduced because you do not subscribe.',
      step1: 'Sign in',
      step2: 'Pay with Stripe',
      step3: 'Pro activates',
      continue: 'Choose a sign-in method',
      signInSection: 'Sign in or create an account',
      stripe: 'Secure checkout with Stripe · Cancel anytime',
      checkout: 'Upgrade to {app} Pro',
      trialActive: 'PRO · FREE TRIAL',
      trialBody: 'Your free trial runs through {date}. This is a manageable Stripe subscription: you can review it, manage payment details, or cancel at any time.',
    },
  };

  function language() {
    if (config.language === 'zh' || config.language === 'en') return config.language;
    return document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  function localized(value, fallback = '') {
    if (value && typeof value === 'object') return value[language()] || value.en || value.zh || fallback;
    return value || fallback;
  }

  function text() {
    return words[language()] || words.en;
  }

  function appName() {
    return String(config.appName || '').trim() || 'Hao Apps';
  }

  function format(value) {
    return String(value || '').replace('{app}', appName());
  }

  function formatDate(value) {
    if (!value) return language() === 'zh' ? '体验期结束日' : 'the trial end date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return language() === 'zh' ? '体验期结束日' : 'the trial end date';
    return new Intl.DateTimeFormat(language() === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    }).format(date);
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value) node.textContent = value;
    return node;
  }

  function featureList(items) {
    const list = element('ul', 'hao-upgrade-feature-list');
    (Array.isArray(items) ? items : []).forEach((item) => {
      const row = element('li', '');
      row.append(element('span', 'hao-upgrade-check', '✓'), element('span', '', localized(item)));
      list.appendChild(row);
    });
    return list;
  }

  function plan(kind, title, features, isPro = false) {
    const row = element('section', `hao-upgrade-plan${isPro ? ' is-pro' : ''}`);
    row.append(element('span', 'hao-upgrade-plan-label', kind));
    const copy = element('div', 'hao-upgrade-plan-copy');
    copy.append(element('strong', '', localized(title)), featureList(features));
    row.appendChild(copy);
    return row;
  }

  function buildPlanPanel(dialog) {
    if (dialog.querySelector('.hao-upgrade-plans')) return;
    const intro = dialog.querySelector('.hao-account-intro');
    if (!intro) return;

    const t = text();
    const panel = element('section', 'hao-upgrade-plans');
    panel.append(
      element('strong', 'hao-upgrade-plans-title', localized(upgrade.title, t.plans)),
      plan(t.free, upgrade.freeTitle, upgrade.freeFeatures),
      plan(t.pro, upgrade.proTitle, upgrade.proFeatures, true),
    );
    const note = localized(upgrade.note);
    if (note) panel.append(element('small', 'hao-upgrade-note', note));
    intro.after(panel);
  }

  function focusSignIn() {
    const provider = document.querySelector('#hao-account-overlay .hao-account-provider');
    if (!provider) return;
    provider.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => provider.focus(), 220);
  }

  function buildGuestGuide(dialog) {
    const guest = dialog.querySelector('.hao-account-guest');
    if (!guest || dialog.querySelector('.hao-upgrade-guide')) return;

    const t = text();
    const statusChip = guest.querySelector('.hao-account-status-chip');
    if (statusChip) statusChip.textContent = t.signInSection;

    const guide = element('section', 'hao-upgrade-guide');
    const head = element('div', 'hao-upgrade-guide-head');
    const copy = element('div', 'hao-upgrade-guide-copy');
    copy.append(
      element('strong', '', localized(upgrade.ctaTitle, format(t.checkout))),
      element('p', '', localized(upgrade.checkoutDescription, t.guide)),
    );
    head.append(copy, element('span', 'hao-upgrade-price', localized(upgrade.price, t.price)));

    const steps = element('ol', 'hao-upgrade-steps');
    [t.step1, t.step2, t.step3].forEach((label, index) => {
      const item = element('li', '');
      item.append(element('span', '', String(index + 1)), element('strong', '', label));
      steps.appendChild(item);
    });

    const button = element('button', 'hao-account-primary hao-upgrade-login-cta', t.continue);
    button.type = 'button';
    button.addEventListener('click', () => {
      sessionStorage.setItem(intentKey, '1');
      focusSignIn();
    });

    guide.append(head, steps, button, element('small', 'hao-upgrade-stripe', t.stripe));
    guest.before(guide);
  }

  function enhanceSignedInCard(dialog) {
    const card = dialog.querySelector('.hao-account-pro-card:not(.is-active)');
    if (!card || card.dataset.haoUpgradeEnhanced === 'true') return;

    card.dataset.haoUpgradeEnhanced = 'true';
    const body = card.querySelector('.hao-account-pro-copy p');
    const button = card.querySelector('.hao-account-pro-action .hao-account-primary');
    const description = localized(upgrade.checkoutDescription);
    if (body && description) body.textContent = description;
    if (button) button.textContent = localized(upgrade.ctaTitle, format(text().checkout));
  }

  function enhanceTrialCard(dialog, snapshot) {
    if (snapshot?.subscription?.status !== 'trialing') return;
    const card = dialog.querySelector('.hao-account-pro-card.is-active');
    if (!card) return;
    const kicker = card.querySelector('.hao-account-pro-kicker');
    const body = card.querySelector('.hao-account-pro-copy p');
    const t = text();
    if (kicker) kicker.textContent = t.trialActive;
    if (body) body.textContent = t.trialBody.replace('{date}', formatDate(snapshot.subscription.current_period_end));
  }

  function enhance(snapshot = latestSnapshot) {
    const dialog = document.querySelector('#hao-account-overlay .hao-account-dialog');
    if (!dialog) return;
    buildPlanPanel(dialog);
    buildGuestGuide(dialog);
    enhanceSignedInCard(dialog);
    enhanceTrialCard(dialog, snapshot);
  }

  function resumeIntent(snapshot) {
    if (sessionStorage.getItem(intentKey) !== '1') return;
    if (!snapshot?.user || snapshot.isPro) return;

    sessionStorage.removeItem(intentKey);
    window.HaoAccount?.open?.();
    window.setTimeout(() => {
      enhance(snapshot);
      const checkout = document.querySelector('#hao-account-overlay .hao-account-pro-card:not(.is-active) .hao-account-primary');
      checkout?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => checkout?.focus(), 220);
    }, 0);
  }

  const observer = new MutationObserver(() => enhance(latestSnapshot));
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('hao:account-changed', (event) => {
    latestSnapshot = event.detail || null;
    enhance(latestSnapshot);
    resumeIntent(latestSnapshot);
  });

  enhance(latestSnapshot);
})();
