(() => {
  'use strict';

  const config = window.HaoAccountConfig || {};
  if (!config.enabled || config.referralEnabled !== true) return;

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

  const language = () => {
    if (config.language === 'zh' || config.language === 'en') return config.language;
    const html = String(document.documentElement.lang || '').toLowerCase();
    const app = String(document.documentElement.dataset.language || document.documentElement.dataset.flappykLanguage || '').toLowerCase();
    return html.startsWith('zh') || app.startsWith('zh') ? 'zh' : 'en';
  };

  const copy = {
    zh: {
      invite: '邀请',
      title: '邀请朋友使用 {app}',
      stable: '这是你的长期专属邀请链接。',
      proBenefit: '你当前是 Pro；新用户通过此链接加入，可获得 {days} 天 {app} Pro 免费体验。',
      freeBenefit: '链接长期有效。你成为 Pro 后，新用户领取时会自动获得当时 Admin 配置的 Pro 免费体验。',
      joined: '已加入',
      trials: '已激活体验',
      copyLink: '复制链接',
      copied: '已复制',
      share: '分享邀请',
      refresh: '刷新',
      loading: '正在生成你的专属邀请链接…',
      unavailable: '邀请服务暂时不可用。',
      close: '关闭',
      shareTitle: '我邀请你试试 {app}',
      shareTextPro: '通过我的邀请加入 {app}，你可以获得 {days} 天 Pro 免费体验。',
      shareTextFree: '通过我的专属邀请加入 {app}。',
    },
    en: {
      invite: 'Invite',
      title: 'Invite friends to {app}',
      stable: 'This is your permanent personal referral link.',
      proBenefit: 'You are currently Pro. New users who join through this link can activate {days} days of {app} Pro free.',
      freeBenefit: 'Your link is permanent. If you become Pro, the current Admin-configured Pro benefit is applied when a new user redeems it.',
      joined: 'Joined',
      trials: 'Pro trials',
      copyLink: 'Copy link',
      copied: 'Copied',
      share: 'Share invite',
      refresh: 'Refresh',
      loading: 'Creating your personal referral link…',
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
    const mount = ensureHost();
    if (!mount) return;
    if (!state.account?.user) {
      mount.replaceChildren();
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hao-referral-trigger';
    button.setAttribute('aria-label', format(t().title));
    button.innerHTML = `<span aria-hidden="true">↗</span><span>${t().invite}</span>`;
    button.addEventListener('click', open);
    mount.replaceChildren(button);
  };

  const renderOverlay = () => {
    const root = ensureOverlay();
    if (!state.open) {
      root.hidden = true;
      root.replaceChildren();
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
            <p>HAO APPS · REFERRAL</p>
            <h2 id="hao-referral-title">${format(t().title)}</h2>
          </div>
          <button class="hao-referral-close" type="button" aria-label="${t().close}">×</button>
        </header>
        ${state.loading ? `<p class="hao-referral-status">${t().loading}</p>` : ''}
        ${state.error ? `<p class="hao-referral-status is-error">${state.error}</p>` : ''}
        ${referral ? `
          <div class="hao-referral-benefit ${days > 0 ? 'is-pro' : ''}">
            <strong>${days > 0 ? `${days} days Pro` : t().stable}</strong>
            <span>${format(days > 0 ? t().proBenefit : t().freeBenefit, days)}</span>
          </div>
          <div class="hao-referral-link">
            <span>${t().stable}</span>
            <code>${referral.referral_url}</code>
          </div>
          <div class="hao-referral-stats">
            <div><strong>${joined}</strong><span>${t().joined}</span></div>
            <div><strong>${trials}</strong><span>${t().trials}</span></div>
          </div>
          <div class="hao-referral-actions">
            <button type="button" data-referral-action="copy">${state.copied ? t().copied : t().copyLink}</button>
            <button type="button" class="is-primary" data-referral-action="share">${t().share}</button>
            <button type="button" data-referral-action="refresh">${t().refresh}</button>
          </div>
        ` : ''}
      </section>`;
    root.querySelector('.hao-referral-close')?.addEventListener('click', close);
    root.querySelector('[data-referral-action="copy"]')?.addEventListener('click', () => void copyLink());
    root.querySelector('[data-referral-action="share"]')?.addEventListener('click', () => void shareLink());
    root.querySelector('[data-referral-action="refresh"]')?.addEventListener('click', () => void loadReferral(true));
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
    }
    if (!next) close();
    render();
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
  const observer = new MutationObserver(() => renderTrigger());
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