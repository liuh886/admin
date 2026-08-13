(() => {
  'use strict';

  const config = window.HaoAccountConfig || {};
  if (!config.enabled || config.referralEnabled !== true) return;

  const PENDING_OPEN_KEY = `hao_product_referral_pending_open:${config.productCode || 'app'}`;
  const state = {
    account: null,
    referral: null,
    loading: false,
    error: '',
    open: false,
    copied: false,
  };

  let host = null;
  let overlay = null;
  let unsubscribe = null;
  let resetCopiedTimer = 0;
  let triggerUserId = '';

  const language = () => {
    if (config.language === 'zh' || config.language === 'en') return config.language;
    const html = String(document.documentElement.lang || '').toLowerCase();
    const app = String(document.documentElement.dataset.language || document.documentElement.dataset.flappykLanguage || '').toLowerCase();
    return html.startsWith('zh') || app.startsWith('zh') ? 'zh' : 'en';
  };

  const copy = {
    zh: {
      invite: '邀请朋友',
      title: '邀请朋友使用 {app}',
      stable: '你的专属邀请链接长期有效。',
      linkLabel: '专属邀请链接',
      proHeadline: '送朋友 {days} 天 Pro',
      proBenefit: '你当前是 Pro。新用户通过这个链接加入 {app}，可获得 {days} 天 Pro 免费体验。',
      freeHeadline: '分享你的专属邀请链接',
      freeBenefit: '链接不会变化。你成为 Pro 后，符合条件的新用户会按 Admin 当时设置的时长获得 Pro 体验。',
      joined: '已加入',
      trials: '已领取 Pro',
      copyLink: '复制链接',
      copied: '已复制',
      share: '分享邀请',
      retry: '重试',
      loading: '正在准备你的邀请链接…',
      unavailable: '邀请服务暂时不可用。',
      close: '关闭',
      shareTitle: '我邀请你试试 {app}',
      shareTextPro: '通过我的邀请加入 {app}，可获得 {days} 天 Pro 免费体验。',
      shareTextFree: '通过我的专属邀请加入 {app}。',
    },
    en: {
      invite: 'Invite friends',
      title: 'Invite a friend to {app}',
      stable: 'Your personal invite link stays the same.',
      linkLabel: 'Personal invite link',
      proHeadline: 'Give a friend {days} days of Pro',
      proBenefit: 'You are currently Pro. Eligible new users who join {app} with this link get {days} days of Pro free.',
      freeHeadline: 'Share your personal invite link',
      freeBenefit: 'Your link is permanent. If you become Pro, eligible new users receive the Admin-configured Pro trial at redemption time.',
      joined: 'Joined',
      trials: 'Pro activated',
      copyLink: 'Copy link',
      copied: 'Copied',
      share: 'Share invite',
      retry: 'Try again',
      loading: 'Preparing your invite link…',
      unavailable: 'Referral service is temporarily unavailable.',
      close: 'Close',
      shareTitle: 'I invited you to try {app}',
      shareTextPro: 'Join {app} with my invite and get {days} days of Pro free.',
      shareTextFree: 'Join {app} with my personal invite.',
    },
  };

  const t = () => copy[language()] || copy.en;
  const appName = () => String(config.appName || 'Hao Apps');
  const format = (value, days = 0) => String(value || '')
    .replaceAll('{app}', appName())
    .replaceAll('{days}', String(days));

  const track = (eventName, extra = {}) => {
    try {
      window.gtag?.('event', eventName, {
        product_code: config.productCode,
        ...extra,
      });
    } catch { /* analytics is non-blocking */ }
  };

  const rememberPendingOpen = () => {
    try { window.sessionStorage.setItem(PENDING_OPEN_KEY, '1'); } catch { /* session storage is optional */ }
  };

  const consumePendingOpen = () => {
    try {
      const pending = window.sessionStorage.getItem(PENDING_OPEN_KEY) === '1';
      if (pending) window.sessionStorage.removeItem(PENDING_OPEN_KEY);
      return pending;
    } catch {
      return false;
    }
  };

  const findMount = () => {
    const selectors = Array.isArray(config.mountSelectors)
      ? config.mountSelectors
      : [config.mountSelector].filter(Boolean);
    for (const selector of selectors) {
      try {
        const node = document.querySelector(selector);
        if (node) return node;
      } catch { /* optional selector */ }
    }
    return null;
  };

  const ensureHost = () => {
    const mount = findMount();
    if (!mount) return null;
    if (!host) {
      host = document.createElement('div');
      host.className = 'hao-referral-mount';
      host.id = `hao-referral-${config.productCode || 'app'}`;
    }
    if (host.parentElement !== mount) mount.appendChild(host);
    return host;
  };

  const ensureOverlay = () => {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'hao-referral-overlay';
    overlay.hidden = true;
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close();
    });
    return overlay;
  };

  const api = async (action, payload = {}) => {
    const client = await window.HaoAccount?.getClient?.();
    if (!client) throw new Error(t().unavailable);
    const { data, error } = await client.functions.invoke('product-referral', {
      body: { action, product_code: config.productCode, ...payload },
    });
    if (error) throw new Error(error.message || t().unavailable);
    if (!data?.ok) throw new Error(data?.error || t().unavailable);
    return data;
  };

  const loadReferral = async (force = false) => {
    if (!state.account?.user || state.loading || (state.referral && !force)) return;
    state.loading = true;
    state.error = '';
    render();
    try {
      state.referral = await api('get_or_create');
    } catch (error) {
      state.error = error?.message || t().unavailable;
    } finally {
      state.loading = false;
      render();
    }
  };

  const copyLink = async () => {
    const url = state.referral?.referral_url;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    state.copied = true;
    track('referral_link_copy');
    render();
    window.clearTimeout(resetCopiedTimer);
    resetCopiedTimer = window.setTimeout(() => {
      state.copied = false;
      render();
    }, 1800);
  };

  const shareLink = async () => {
    const referral = state.referral;
    if (!referral?.referral_url) return;
    const days = Number(referral.trial_days || 0);
    const payload = {
      title: format(t().shareTitle, days),
      text: format(days > 0 ? t().shareTextPro : t().shareTextFree, days),
      url: referral.referral_url,
    };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(payload);
        track('referral_link_share', { method: 'native' });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    await navigator.clipboard.writeText(referral.referral_url);
    state.copied = true;
    track('referral_link_share', { method: 'clipboard' });
    render();
  };

  const open = () => {
    if (!state.account?.user) {
      rememberPendingOpen();
      window.HaoAccount?.open?.();
      return;
    }
    state.open = true;
    document.documentElement.classList.add('hao-referral-open');
    ensureOverlay().hidden = false;
    track('referral_panel_open');
    render();
    void loadReferral();
  };

  const close = () => {
    state.open = false;
    document.documentElement.classList.remove('hao-referral-open');
    if (overlay) overlay.hidden = true;
    render();
  };

  const renderTrigger = () => {
    if (config.standaloneReferralTrigger === false) {
      if (host?.childElementCount) host.replaceChildren();
      triggerUserId = '';
      return;
    }

    const mount = ensureHost();
    if (!mount) return;
    const userId = String(state.account?.user?.id || '');
    const existing = mount.querySelector('.hao-referral-trigger');

    if (!userId) {
      if (mount.childElementCount) mount.replaceChildren();
      triggerUserId = '';
      return;
    }

    if (existing && triggerUserId === userId) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hao-referral-trigger';
    button.setAttribute('aria-label', format(t().title));
    button.innerHTML = `<span aria-hidden="true">↗</span><span>${t().invite}</span>`;
    button.addEventListener('click', open);
    mount.replaceChildren(button);
    triggerUserId = userId;
  };

  const renderOverlay = () => {
    const root = ensureOverlay();
    if (!state.open) {
      root.hidden = true;
      if (root.childElementCount) root.replaceChildren();
      return;
    }
    root.hidden = false;
    const referral = state.referral;
    const days = Number(referral?.trial_days || 0);
    const joined = Number(referral?.joined_count || 0);
    const trials = Number(referral?.trial_count || 0);
    root.innerHTML = `
      <section class="hao-referral-dialog" role="dialog" aria-modal="true" aria-labelledby="hao-referral-title">
        <header>
          <div>
            <h2 id="hao-referral-title">${format(t().title)}</h2>
            <p class="hao-referral-intro">${t().stable}</p>
          </div>
          <button class="hao-referral-close" type="button" aria-label="${t().close}">×</button>
        </header>
        ${state.loading ? `<div class="hao-referral-loading"><span></span><p>${t().loading}</p></div>` : ''}
        ${state.error ? `<div class="hao-referral-status is-error"><p>${state.error}</p><button type="button" data-referral-action="retry">${t().retry}</button></div>` : ''}
        ${referral ? `
          <div class="hao-referral-benefit ${days > 0 ? 'is-pro' : ''}">
            <strong>${format(days > 0 ? t().proHeadline : t().freeHeadline, days)}</strong>
            <span>${format(days > 0 ? t().proBenefit : t().freeBenefit, days)}</span>
          </div>
          <div class="hao-referral-link">
            <span>${t().linkLabel}</span>
            <div>
              <code>${referral.referral_url}</code>
              <button type="button" data-referral-action="copy">${state.copied ? t().copied : t().copyLink}</button>
            </div>
          </div>
          <div class="hao-referral-footer">
            <div class="hao-referral-stats" aria-label="Referral activity">
              <span><strong>${joined}</strong> ${t().joined}</span>
              <span><strong>${trials}</strong> ${t().trials}</span>
            </div>
            <button type="button" class="hao-referral-share" data-referral-action="share">${t().share}</button>
          </div>
        ` : ''}
      </section>`;
    root.querySelector('.hao-referral-close')?.addEventListener('click', close);
    root.querySelector('[data-referral-action="copy"]')?.addEventListener('click', () => void copyLink());
    root.querySelector('[data-referral-action="share"]')?.addEventListener('click', () => void shareLink());
    root.querySelector('[data-referral-action="retry"]')?.addEventListener('click', () => void loadReferral(true));
  };

  const render = () => {
    renderTrigger();
    renderOverlay();
  };

  const hydrate = (snapshot) => {
    const previous = state.account?.user?.id || '';
    const next = snapshot?.user?.id || '';
    state.account = snapshot || null;
    if (previous !== next) {
      state.referral = null;
      state.error = '';
      state.copied = false;
      triggerUserId = '';
    }
    if (!next) close();
    render();
    if (next && consumePendingOpen()) window.setTimeout(open, 0);
  };

  const start = () => {
    if (!window.HaoAccount?.subscribe) return false;
    unsubscribe?.();
    unsubscribe = window.HaoAccount.subscribe(hydrate);
    render();
    return true;
  };

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) close();
  });
  window.addEventListener('hao:account-changed', (event) => hydrate(event.detail));
  const observer = new MutationObserver(() => {
    if (config.standaloneReferralTrigger === false) return;
    const mount = findMount();
    if (!mount) return;
    if (!host || !host.isConnected || host.parentElement !== mount) renderTrigger();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (!start()) {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (start() || attempts > 100) window.clearInterval(timer);
    }, 50);
  }

  window.HaoReferral = Object.freeze({
    open,
    refresh: () => loadReferral(true),
    getState: () => ({ ...state }),
  });
})();