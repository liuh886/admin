(() => {
  'use strict';

  const config = window.HaoAccountConfig || {};
  if (!config.enabled) return;

  const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';
  const TURNSTILE_SITE_KEY = '0x4AAAAAAEKVMnWa2valozxW';
  const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const OAUTH_PROVIDERS = new Set(['google', 'github', 'x']);
  const MANAGEABLE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);

  const state = {
    client: null,
    session: null,
    user: null,
    profile: null,
    productAccount: null,
    entitlements: new Set(),
    subscription: null,
    loading: true,
    error: '',
    open: false,
    notice: '',
    billingReturn: null,
  };

  const listeners = new Set();
  let triggerHost = null;
  let overlayHost = null;
  let mountObserver = null;
  let turnstileLoader = null;
  let turnstileWidgetId = null;
  let captchaToken = '';

  const currentLanguage = () => {
    if (config.language === 'zh' || config.language === 'en') return config.language;
    const htmlLanguage = document.documentElement.lang || '';
    if (htmlLanguage.toLowerCase().startsWith('zh')) return 'zh';
    const appLanguage = document.documentElement.dataset.language || document.documentElement.dataset.flappykLanguage || '';
    return String(appLanguage).toLowerCase().startsWith('zh') ? 'zh' : 'en';
  };

  const words = {
    zh: {
      account: '账户', shared: 'Hao Apps 共享账户', free: 'Free', pro: 'Pro', optional: '可选登录',
      google: '使用 Google 登录', github: '使用 GitHub 登录', x: '使用 X 登录', or: '或',
      email: '邮箱地址', magic: '发送登录链接',
      sent: '登录链接已发送，请检查邮箱。', close: '关闭', signOut: '退出登录', refresh: '刷新账户',
      save: '保存名称', displayName: '显示名称', signedIn: '已登录', loading: '正在加载…',
      unavailable: '账户服务暂时不可用，请稍后重试。',
      billingUnavailable: '暂时无法打开 Stripe 付款或订阅管理页面。你的账户和现有权限不受影响。',
      future: '账户能力', billingOff: '付费功能尚未开放。当前公开功能保持可用。', manage: '管理订阅',
      feedback: '提交反馈', feedbackPrompt: '告诉我哪些内容有帮助、哪里需要改进。', category: '反馈类型',
      general: '一般反馈', idea: '功能建议', bug: '问题报告', content: '内容反馈', other: '其他',
      message: '反馈内容', submit: '发送反馈', feedbackSent: '反馈已收到，谢谢。', profileSaved: '账户名称已保存。',
      privacy: '隐私与数据边界', captchaRequired: '请先完成人机验证。', captchaUnavailable: '人机验证暂时不可用，请稍后重试。',
      proInvite: '成为 Pro', proInviteTitle: '成为 {app} Pro',
      proInviteBody: 'Pro 是可选支持。现有公开功能继续可用；US$1/月会激活 Pro 身份，并支持这个产品持续维护。',
      proPrice: 'US$1 / 月', stripeNote: '通过 Stripe 安全结账 · 可随时取消',
      proAccess: 'Pro 权限已激活', proGranted: '此账户已拥有 Pro 权限，目前没有需要管理的付费订阅。',
      paidActive: 'Pro 订阅有效', trialActive: 'Pro 免费体验中', paymentAttention: '付款状态需要处理',
      renewsOn: '下次续费', accessUntil: '已安排取消 · Pro 有效至', billingOpening: '正在前往 Stripe…',
      billingSuccess: '付款已完成，Pro 权限已更新。',
      billingPending: '付款已完成，正在确认 Pro 权限。你可以稍后刷新账户。',
      billingCancelled: '未完成付款。Free 使用不受影响。', noSubscription: '当前没有需要管理的付费订阅。',
    },
    en: {
      account: 'Account', shared: 'Shared Hao Apps account', free: 'Free', pro: 'Pro', optional: 'OPTIONAL SIGN-IN',
      google: 'Continue with Google', github: 'Continue with GitHub', x: 'Continue with X', or: 'OR',
      email: 'Email address', magic: 'Send sign-in link',
      sent: 'Sign-in link sent. Check your inbox.', close: 'Close', signOut: 'Sign out', refresh: 'Refresh account',
      save: 'Save name', displayName: 'Display name', signedIn: 'Signed in', loading: 'Loading…',
      unavailable: 'Account service is temporarily unavailable. Try again shortly.',
      billingUnavailable: 'Stripe checkout or subscription management is temporarily unavailable. Your account and current access are unaffected.',
      future: 'Account capabilities', billingOff: 'Paid features are not open yet. Current public features remain available.', manage: 'Manage subscription',
      feedback: 'Send feedback', feedbackPrompt: 'Tell us what helped and what should improve.', category: 'Feedback type',
      general: 'General', idea: 'Feature idea', bug: 'Bug report', content: 'Content feedback', other: 'Other',
      message: 'Your feedback', submit: 'Send feedback', feedbackSent: 'Feedback received. Thank you.', profileSaved: 'Account name saved.',
      privacy: 'Privacy and data boundary', captchaRequired: 'Complete the security check first.', captchaUnavailable: 'The security check is temporarily unavailable. Try again shortly.',
      proInvite: 'Become Pro', proInviteTitle: 'Become {app} Pro',
      proInviteBody: 'Pro is optional support. Existing public features stay available; US$1/month activates your Pro identity and supports ongoing maintenance.',
      proPrice: 'US$1 / month', stripeNote: 'Secure checkout with Stripe · Cancel anytime',
      proAccess: 'Pro access active', proGranted: 'This account already has Pro access and has no paid subscription to manage.',
      paidActive: 'Pro subscription active', trialActive: 'Pro free trial active', paymentAttention: 'Payment needs attention',
      renewsOn: 'Renews', accessUntil: 'Cancellation scheduled · Pro access through', billingOpening: 'Opening Stripe…',
      billingSuccess: 'Payment complete. Pro access is up to date.',
      billingPending: 'Payment complete. Pro access is still being confirmed. You can refresh the account shortly.',
      billingCancelled: 'Payment was not completed. Free access is unchanged.', noSubscription: 'There is no paid subscription to manage.',
    },
  };

  const text = () => words[currentLanguage()] || words.en;
  const localized = (value, fallback = '') => {
    if (value && typeof value === 'object') return value[currentLanguage()] || value.en || value.zh || fallback;
    return value || fallback;
  };
  const appName = () => String(config.appName || '').trim() || 'Hao Apps';
  const formatText = (value) => String(value || '').replace('{app}', appName());
  const formatDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(currentLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    }).format(date);
  };

  const icon = (name) => {
    const icons = {
      user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>',
      crown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 4.5 4L12 4l4.5 6L21 6l-2 12H5L3 6Z"/><path d="M5 21h14"/></svg>',
      close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
      google: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"/><path d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.61A10 10 0 0 0 12 22Z"/><path d="M6.39 13.93A6.02 6.02 0 0 1 6.08 12c0-.67.12-1.32.31-1.93V7.46H3.04A10 10 0 0 0 2 12c0 1.61.39 3.13 1.04 4.54l3.35-2.61Z"/><path d="M12 5.94c1.47 0 2.79.5 3.83 1.49l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.46l3.35 2.61C7.18 7.7 9.39 5.94 12 5.94Z"/></svg>',
      github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path style="fill:currentColor;stroke:none" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.69c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.55 9.55 0 0 1 12 7.01c.85 0 1.71.11 2.51.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.57c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>',
      x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path style="fill:currentColor;stroke:none" d="M4.2 3h4.6l4.2 5.6L17.8 3h2l-5.9 7.1L21 21h-4.6l-4.7-6.3L6.2 21h-2l6.6-7.8L4.2 3Zm3.6 1.7H7.5l9.8 14.6h1.2L8.8 4.7Z"/></svg>',
      mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
      refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.4-2L20 9M4 15l2.5 2a7 7 0 0 0 11.4-2"/></svg>',
      logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/></svg>',
      check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
      message: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H8l-4 4V5Z"/><path d="M8 9h8M8 13h5"/></svg>',
    };
    return icons[name] || '';
  };

  function setError(error) {
    state.error = error?.message || String(error || 'Unknown error');
    console.warn('Hao Account:', error);
  }

  async function optional(label, task) {
    try {
      await task();
    } catch (error) {
      console.warn(`Hao Account optional ${label}:`, error);
    }
  }

  function clearTurnstile() {
    if (turnstileWidgetId !== null && window.turnstile?.remove) {
      try { window.turnstile.remove(turnstileWidgetId); } catch { /* already gone */ }
    }
    turnstileWidgetId = null;
    captchaToken = '';
  }

  function loadTurnstile() {
    if (window.turnstile?.render) return Promise.resolve(window.turnstile);
    if (turnstileLoader) return turnstileLoader;
    turnstileLoader = new Promise((resolve, reject) => {
      let script = document.querySelector('script[data-hao-turnstile]');
      const finish = () => window.turnstile?.render
        ? resolve(window.turnstile)
        : reject(new Error('Turnstile API did not initialize.'));
      const fail = () => reject(new Error('Turnstile API failed to load.'));
      if (!script) {
        script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.dataset.haoTurnstile = '';
        document.head.appendChild(script);
      }
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', fail, { once: true });
      if (window.turnstile?.render) finish();
    }).catch((error) => {
      turnstileLoader = null;
      throw error;
    });
    return turnstileLoader;
  }

  async function mountTurnstile(container, submitButton) {
    try {
      const turnstile = await loadTurnstile();
      if (!container.isConnected || !state.open || state.user) return;
      clearTurnstile();
      submitButton.disabled = true;
      turnstileWidgetId = turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'auto',
        callback(token) {
          captchaToken = String(token || '');
          submitButton.disabled = state.loading || !captchaToken;
        },
        'expired-callback'() {
          captchaToken = '';
          submitButton.disabled = true;
        },
        'error-callback'() {
          captchaToken = '';
          submitButton.disabled = true;
        },
      });
    } catch (error) {
      if (!container.isConnected) return;
      submitButton.disabled = true;
      const message = document.createElement('span');
      message.className = 'hao-account-captcha-error';
      message.textContent = text().captchaUnavailable;
      container.replaceChildren(message);
      console.warn('Hao Account Turnstile unavailable:', error);
    }
  }

  function hasPaidSubscription() {
    return Boolean(state.subscription && MANAGEABLE_SUBSCRIPTION_STATUSES.has(state.subscription.status));
  }

  function snapshot() {
    return Object.freeze({
      configured: true,
      loading: state.loading,
      user: state.user,
      profile: state.profile,
      productAccount: state.productAccount,
      entitlements: [...state.entitlements],
      isPro: state.entitlements.has(config.entitlementCode),
      subscription: state.subscription,
      hasPaidSubscription: hasPaidSubscription(),
      error: state.error,
      productCode: config.productCode,
    });
  }

  function emit() {
    const detail = snapshot();
    listeners.forEach((listener) => {
      try { listener(detail); } catch { /* consumer errors do not break auth */ }
    });
    window.dispatchEvent(new CustomEvent('hao:account-changed', { detail }));
    window.dispatchEvent(new CustomEvent('hao:membership-changed', { detail }));
  }

  async function getClient() {
    if (state.client) return state.client;
    if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Account configuration is incomplete.');
    const sdk = await import(SUPABASE_JS_URL);
    state.client = sdk.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: config.detectSessionInUrl !== false,
        flowType: 'pkce',
      },
    });
    return state.client;
  }

  async function ensureProfile() {
    if (!state.user) return;
    const client = await getClient();
    const { data, error } = await client.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
    if (error) throw error;
    if (data) {
      state.profile = data;
      const { error: updateError } = await client.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', state.user.id);
      if (updateError) throw updateError;
      return;
    }
    const metadata = state.user.user_metadata || {};
    const displayName = metadata.full_name || metadata.name || String(state.user.email || '').split('@')[0] || null;
    const avatarUrl = metadata.avatar_url || metadata.picture || null;
    const { data: inserted, error: insertError } = await client.from('profiles').insert({
      id: state.user.id,
      display_name: displayName,
      avatar_url: avatarUrl,
      locale: currentLanguage(),
      last_seen_at: new Date().toISOString(),
    }).select('*').single();
    if (insertError) throw insertError;
    state.profile = inserted;
  }

  async function touchProductAccount() {
    if (!state.user || !config.productCode) return;
    const client = await getClient();
    const { data, error } = await client.from('product_accounts').upsert({
      user_id: state.user.id,
      product_code: config.productCode,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'user_id,product_code' }).select('*').single();
    if (error) throw error;
    state.productAccount = data;
  }

  async function refreshEntitlements() {
    state.entitlements = new Set();
    if (!state.user || !config.entitlementCode) return;
    const client = await getClient();
    const { data, error } = await client.from('entitlements')
      .select('entitlement_code,active,valid_until')
      .eq('user_id', state.user.id)
      .eq('entitlement_code', config.entitlementCode);
    if (error) {
      console.warn('Hao Account entitlement refresh failed closed:', error);
      return;
    }
    const now = Date.now();
    (data || []).forEach((row) => {
      const validUntil = row.valid_until ? new Date(row.valid_until).getTime() : null;
      if (row.active && (!validUntil || validUntil > now)) state.entitlements.add(row.entitlement_code);
    });
  }

  async function refreshSubscription() {
    state.subscription = null;
    if (!state.user || !config.productCode) return;
    const client = await getClient();
    const { data, error } = await client.from('subscriptions')
      .select('id,status,current_period_end,cancel_at_period_end')
      .eq('user_id', state.user.id)
      .eq('product_code', config.productCode);
    if (error) throw error;
    state.subscription = (data || []).find((row) => MANAGEABLE_SUBSCRIPTION_STATUSES.has(row.status)) || null;
  }

  async function handleSession(session) {
    state.session = session || null;
    state.user = session?.user || null;
    state.profile = null;
    state.productAccount = null;
    state.subscription = null;
    state.error = '';
    state.entitlements = new Set();
    if (state.user) {
      await Promise.all([
        optional('profile refresh', ensureProfile),
        optional('product account refresh', touchProductAccount),
        refreshEntitlements(),
        optional('subscription refresh', refreshSubscription),
      ]);
    }
    render();
    emit();
  }

  async function refresh() {
    state.loading = true;
    state.error = '';
    render();
    try {
      const client = await getClient();
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      await handleSession(data.session);
    } catch (error) {
      setError(error);
    } finally {
      state.loading = false;
      render();
      emit();
    }
    return snapshot();
  }

  async function signInWithProvider(provider) {
    if (!OAUTH_PROVIDERS.has(provider)) throw new Error(`Unsupported OAuth provider: ${provider}`);
    state.loading = true;
    state.error = '';
    render();
    try {
      const client = await getClient();
      const { error } = await client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: config.redirectUrl || window.location.href },
      });
      if (error) throw error;
    } catch (error) {
      setError(error);
      state.loading = false;
      render();
    }
  }

  async function sendMagicLink(email, token) {
    const normalized = String(email || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return;
    const verifiedToken = String(token || '').trim();
    if (!verifiedToken) {
      state.error = text().captchaRequired;
      render();
      return;
    }
    state.loading = true;
    state.error = '';
    render();
    try {
      const client = await getClient();
      const { error } = await client.auth.signInWithOtp({
        email: normalized,
        options: {
          emailRedirectTo: config.redirectUrl || window.location.href,
          shouldCreateUser: true,
          captchaToken: verifiedToken,
        },
      });
      if (error) throw error;
      state.notice = text().sent;
    } catch (error) {
      setError(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function signOut() {
    state.loading = true;
    render();
    try {
      const client = await getClient();
      const { error } = await client.auth.signOut();
      if (error) throw error;
      await handleSession(null);
      state.open = false;
    } catch (error) {
      setError(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function saveProfile(displayName) {
    if (!state.user) return;
    const normalized = String(displayName || '').trim().slice(0, 80);
    state.loading = true;
    render();
    try {
      const client = await getClient();
      const { data, error } = await client.from('profiles').update({
        display_name: normalized || null,
        locale: currentLanguage(),
        last_seen_at: new Date().toISOString(),
      }).eq('id', state.user.id).select('*').single();
      if (error) throw error;
      state.profile = data;
      state.notice = text().profileSaved;
    } catch (error) {
      setError(error);
    } finally {
      state.loading = false;
      render();
      emit();
    }
  }

  async function saveProductData({ preferences, productState } = {}) {
    if (!state.user) throw new Error('Sign-in required.');
    const client = await getClient();
    const payload = {
      user_id: state.user.id,
      product_code: config.productCode,
      last_seen_at: new Date().toISOString(),
    };
    if (preferences && typeof preferences === 'object') payload.preferences = preferences;
    if (productState && typeof productState === 'object') payload.state = productState;
    const { data, error } = await client.from('product_accounts').upsert(payload, {
      onConflict: 'user_id,product_code',
    }).select('*').single();
    if (error) throw error;
    state.productAccount = data;
    render();
    emit();
    return data;
  }

  async function submitFeedback(category, message) {
    if (!state.user) throw new Error('Sign-in required.');
    const normalized = String(message || '').trim();
    if (!normalized) return;
    state.loading = true;
    render();
    try {
      const client = await getClient();
      const { error } = await client.from('product_feedback').insert({
        user_id: state.user.id,
        product_code: config.productCode,
        category: category || 'general',
        message: normalized.slice(0, 4000),
        page_url: window.location.href.slice(0, 2000),
        metadata: { language: currentLanguage(), app_version: config.appVersion || null },
      });
      if (error) throw error;
      state.notice = text().feedbackSent;
    } catch (error) {
      setError(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function callBilling(url, mode) {
    if (!config.billingEnabled || !url || !state.user) return;
    const t = text();
    if (mode === 'portal' && !hasPaidSubscription()) {
      state.notice = t.noSubscription;
      state.error = '';
      render();
      return;
    }
    state.loading = true;
    state.error = '';
    state.notice = t.billingOpening;
    render();
    try {
      const client = await getClient();
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Authentication session is unavailable.');
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: config.supabasePublishableKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ product_code: config.productCode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url) throw new Error(payload.error || `Membership request failed (${response.status})`);
      window.location.assign(payload.url);
    } catch (error) {
      console.warn('Hao Account billing:', error);
      state.error = t.billingUnavailable;
      state.notice = '';
      state.loading = false;
      render();
    }
  }

  function open() {
    state.open = true;
    if (!state.billingReturn) state.notice = '';
    render();
    document.documentElement.classList.add('hao-account-open');
    window.setTimeout(() => overlayHost?.querySelector('[data-hao-close]')?.focus(), 0);
  }

  function close() {
    state.open = false;
    state.billingReturn = null;
    clearTurnstile();
    render();
    document.documentElement.classList.remove('hao-account-open');
    triggerHost?.querySelector('button')?.focus();
  }

  function buildFeatureList(container) {
    const items = Array.isArray(config.features) ? config.features : [];
    container.replaceChildren();
    items.forEach((item) => {
      const row = document.createElement('li');
      row.innerHTML = icon('check');
      const span = document.createElement('span');
      span.textContent = localized(item);
      row.appendChild(span);
      container.appendChild(row);
    });
  }

  function subscriptionSummary(t) {
    if (!state.subscription) return '';
    const date = formatDate(state.subscription.current_period_end);
    if (state.subscription.cancel_at_period_end && date) return `${t.accessUntil} ${date}`;
    if (['past_due', 'unpaid'].includes(state.subscription.status)) return t.paymentAttention;
    if (state.subscription.status === 'trialing' && date) return `${t.trialActive} · ${date}`;
    return date ? `${t.renewsOn} ${date}` : t.stripeNote;
  }

  function buildProCard(isPro) {
    if (!config.billingEnabled) return null;
    const t = text();
    const paid = hasPaidSubscription();
    const card = document.createElement('section');
    card.className = `hao-account-pro-card${isPro ? ' is-active' : ''}`;

    const copy = document.createElement('div');
    copy.className = 'hao-account-pro-copy';
    const kicker = document.createElement('span');
    kicker.className = 'hao-account-pro-kicker';
    kicker.textContent = isPro ? (paid ? t.paidActive : t.proAccess) : t.pro;
    const title = document.createElement('strong');
    title.textContent = isPro ? `${appName()} Pro` : formatText(t.proInviteTitle);
    const body = document.createElement('p');
    body.textContent = isPro ? (paid ? subscriptionSummary(t) : t.proGranted) : t.proInviteBody;
    copy.append(kicker, title, body);

    const action = document.createElement('div');
    action.className = 'hao-account-pro-action';
    if (!isPro) {
      const price = document.createElement('span');
      price.className = 'hao-account-pro-price';
      price.textContent = t.proPrice;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hao-account-primary';
      button.textContent = t.proInvite;
      button.addEventListener('click', () => void callBilling(config.checkoutFunctionUrl, 'checkout'));
      const note = document.createElement('small');
      note.className = 'hao-account-pro-note';
      note.textContent = t.stripeNote;
      action.append(price, button, note);
    } else if (paid) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = t.manage;
      button.addEventListener('click', () => void callBilling(config.portalFunctionUrl, 'portal'));
      action.appendChild(button);
    }
    card.append(copy, action);
    return card;
  }

  function renderTrigger() {
    if (!triggerHost) return;
    const t = text();
    const isPro = state.entitlements.has(config.entitlementCode);
    const label = state.user
      ? (state.profile?.display_name || String(state.user.email || '').split('@')[0] || t.account)
      : t.account;
    const avatar = state.profile?.avatar_url || state.user?.user_metadata?.avatar_url || state.user?.user_metadata?.picture || '';
    triggerHost.innerHTML = '';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `hao-account-trigger${state.user ? ' is-signed-in' : ''}${isPro ? ' is-pro' : ''}`;
    button.setAttribute('aria-label', `${appName()} ${t.account}`.trim());
    button.title = `${appName()} ${t.account}`.trim();
    const visual = document.createElement('span');
    visual.className = 'hao-account-trigger-visual';
    if (avatar) {
      const img = document.createElement('img');
      img.src = avatar;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      visual.appendChild(img);
    } else {
      visual.innerHTML = icon(isPro ? 'crown' : 'user');
    }
    button.appendChild(visual);
    if (config.compactTrigger !== true) {
      const textNode = document.createElement('span');
      textNode.className = 'hao-account-trigger-label';
      textNode.textContent = label;
      button.appendChild(textNode);
    }
    button.addEventListener('click', open);
    triggerHost.appendChild(button);
  }

  function renderOverlay() {
    if (!overlayHost) return;
    const t = text();
    const signedIn = Boolean(state.user);
    const isPro = state.entitlements.has(config.entitlementCode);
    clearTurnstile();
    overlayHost.hidden = !state.open;
    overlayHost.innerHTML = '';
    if (!state.open) return;

    let turnstileHost = null;
    let magicLinkButton = null;
    const backdrop = document.createElement('div');
    backdrop.className = 'hao-account-backdrop';
    const dialog = document.createElement('section');
    dialog.className = 'hao-account-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'hao-account-title');

    const header = document.createElement('header');
    header.innerHTML = `<div><span class="hao-account-eyebrow"></span><h2 id="hao-account-title"></h2></div>`;
    header.querySelector('.hao-account-eyebrow').textContent = isPro ? t.pro : t.shared;
    header.querySelector('h2').textContent = localized(config.title, `${appName()} ${t.account}`.trim());
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'hao-account-close';
    closeButton.dataset.haoClose = '';
    closeButton.setAttribute('aria-label', t.close);
    closeButton.innerHTML = icon('close');
    closeButton.addEventListener('click', close);
    header.appendChild(closeButton);
    dialog.appendChild(header);

    const intro = document.createElement('p');
    intro.className = 'hao-account-intro';
    intro.textContent = localized(config.description, localized(config.privacyNote, ''));
    dialog.appendChild(intro);

    const featurePanel = document.createElement('section');
    featurePanel.className = 'hao-account-feature-panel';
    const featureTitle = document.createElement('strong');
    featureTitle.textContent = t.future;
    const featureList = document.createElement('ul');
    buildFeatureList(featureList);
    featurePanel.append(featureTitle, featureList);
    if (featureList.children.length) dialog.appendChild(featurePanel);

    if (!signedIn) {
      const guest = document.createElement('div');
      guest.className = 'hao-account-guest';
      const badge = document.createElement('span');
      badge.className = 'hao-account-status-chip';
      badge.textContent = t.optional;
      guest.appendChild(badge);

      for (const provider of ['google', 'github', 'x']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hao-account-provider';
        button.dataset.oauthProvider = provider;
        button.innerHTML = `${icon(provider)}<span>${state.loading ? t.loading : t[provider]}</span>`;
        button.disabled = state.loading;
        button.addEventListener('click', () => void signInWithProvider(provider));
        guest.appendChild(button);
      }

      const divider = document.createElement('div');
      divider.className = 'hao-account-divider';
      divider.textContent = t.or;
      const form = document.createElement('form');
      form.className = 'hao-account-email';
      form.innerHTML = `${icon('mail')}<input type="email" autocomplete="email" required><button type="submit"></button>`;
      const input = form.querySelector('input');
      input.placeholder = t.email;
      input.setAttribute('aria-label', t.email);
      magicLinkButton = form.querySelector('button');
      magicLinkButton.textContent = t.magic;
      magicLinkButton.disabled = true;
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void sendMagicLink(input.value, captchaToken);
      });
      turnstileHost = document.createElement('div');
      turnstileHost.className = 'hao-account-turnstile';
      turnstileHost.style.minHeight = '65px';
      turnstileHost.style.overflow = 'hidden';
      guest.append(divider, form, turnstileHost);
      dialog.appendChild(guest);
    } else {
      const account = document.createElement('div');
      account.className = 'hao-account-signed-in';
      const identity = document.createElement('section');
      identity.className = 'hao-account-identity';
      const avatar = state.profile?.avatar_url || state.user?.user_metadata?.avatar_url || state.user?.user_metadata?.picture || '';
      const visual = document.createElement('div');
      visual.className = 'hao-account-avatar';
      if (avatar) {
        const img = document.createElement('img');
        img.src = avatar;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        visual.appendChild(img);
      } else visual.innerHTML = icon('user');
      const identityCopy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = state.profile?.display_name || state.user.email || t.signedIn;
      const email = document.createElement('span');
      email.textContent = state.user.email || state.user.id;
      identityCopy.append(name, email);
      const tier = document.createElement('span');
      tier.className = `hao-account-tier${isPro ? ' is-pro' : ''}`;
      tier.textContent = isPro ? `${appName()} Pro` : t.free;
      identity.append(visual, identityCopy, tier);
      account.appendChild(identity);

      const proCard = buildProCard(isPro);
      if (proCard) account.appendChild(proCard);

      const profileForm = document.createElement('form');
      profileForm.className = 'hao-account-profile-form';
      const label = document.createElement('label');
      label.textContent = t.displayName;
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.maxLength = 80;
      nameInput.value = state.profile?.display_name || '';
      const save = document.createElement('button');
      save.type = 'submit';
      save.textContent = t.save;
      label.appendChild(nameInput);
      profileForm.append(label, save);
      profileForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void saveProfile(nameInput.value);
      });
      account.appendChild(profileForm);

      if (config.feedbackEnabled) {
        const feedback = document.createElement('form');
        feedback.className = 'hao-account-feedback';
        const heading = document.createElement('div');
        heading.innerHTML = icon('message');
        const feedbackCopy = document.createElement('div');
        const feedbackTitle = document.createElement('strong');
        feedbackTitle.textContent = localized(config.feedbackTitle, t.feedback);
        const feedbackPrompt = document.createElement('span');
        feedbackPrompt.textContent = localized(config.feedbackPrompt, t.feedbackPrompt);
        feedbackCopy.append(feedbackTitle, feedbackPrompt);
        heading.appendChild(feedbackCopy);
        const select = document.createElement('select');
        select.setAttribute('aria-label', t.category);
        [['general', t.general], ['idea', t.idea], ['bug', t.bug], ['content', t.content], ['other', t.other]].forEach(([value, labelText]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = labelText;
          select.appendChild(option);
        });
        const textarea = document.createElement('textarea');
        textarea.maxLength = 4000;
        textarea.rows = 4;
        textarea.placeholder = t.message;
        textarea.required = true;
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = t.submit;
        feedback.append(heading, select, textarea, submit);
        feedback.addEventListener('submit', async (event) => {
          event.preventDefault();
          await submitFeedback(select.value, textarea.value);
          if (!state.error) textarea.value = '';
        });
        account.appendChild(feedback);
      }

      const actions = document.createElement('div');
      actions.className = 'hao-account-actions';
      const refreshButton = document.createElement('button');
      refreshButton.type = 'button';
      refreshButton.innerHTML = `${icon('refresh')}<span>${t.refresh}</span>`;
      refreshButton.addEventListener('click', () => void refresh());
      const logoutButton = document.createElement('button');
      logoutButton.type = 'button';
      logoutButton.innerHTML = `${icon('logout')}<span>${t.signOut}</span>`;
      logoutButton.addEventListener('click', () => void signOut());
      actions.append(refreshButton, logoutButton);
      account.appendChild(actions);
      dialog.appendChild(account);
    }

    const privacy = document.createElement('footer');
    const privacyTitle = document.createElement('strong');
    privacyTitle.textContent = t.privacy;
    const privacyText = document.createElement('span');
    privacyText.textContent = localized(config.privacyNote, '');
    privacy.append(privacyTitle, privacyText);
    dialog.appendChild(privacy);

    if (!config.billingEnabled) {
      const billingNote = document.createElement('small');
      billingNote.className = 'hao-account-billing-note';
      billingNote.textContent = t.billingOff;
      dialog.appendChild(billingNote);
    }
    if (state.notice) {
      const notice = document.createElement('p');
      notice.className = 'hao-account-notice';
      notice.textContent = state.notice;
      dialog.appendChild(notice);
    }
    if (state.error) {
      const error = document.createElement('p');
      error.className = 'hao-account-error';
      error.textContent = state.error === t.captchaRequired || state.error === t.billingUnavailable ? state.error : t.unavailable;
      dialog.appendChild(error);
    }
    if (state.loading) {
      const busy = document.createElement('div');
      busy.className = 'hao-account-busy';
      busy.textContent = t.loading;
      dialog.appendChild(busy);
    }

    backdrop.appendChild(dialog);
    backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
    overlayHost.appendChild(backdrop);
    if (turnstileHost && magicLinkButton) void mountTurnstile(turnstileHost, magicLinkButton);
  }

  function render() {
    renderTrigger();
    renderOverlay();
  }

  function findMount() {
    const selectors = Array.isArray(config.mountSelectors)
      ? config.mountSelectors
      : [config.mountSelector].filter(Boolean);
    for (const selector of selectors) {
      try {
        const target = document.querySelector(selector);
        if (target) return target;
      } catch { /* invalid optional selector */ }
    }
    return null;
  }

  function attachTrigger() {
    if (!triggerHost) {
      triggerHost = document.createElement('div');
      triggerHost.id = `hao-account-${config.productCode || 'app'}`;
      triggerHost.className = 'hao-account-mount is-embedded';
    }
    const target = findMount();
    if (!target) {
      triggerHost.remove();
      return false;
    }
    if (triggerHost.parentElement !== target) {
      if (config.mountPosition === 'prepend') target.prepend(triggerHost);
      else target.appendChild(triggerHost);
      renderTrigger();
    } else if (!triggerHost.firstChild) {
      renderTrigger();
    }
    return true;
  }

  function observeMount() {
    mountObserver?.disconnect();
    mountObserver = new MutationObserver(() => {
      const target = findMount();
      if (!target || triggerHost?.parentElement !== target) attachTrigger();
    });
    mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function readBillingReturn() {
    const url = new URL(window.location.href);
    const billing = url.searchParams.get('billing');
    if (billing !== 'success' && billing !== 'cancelled') return;
    state.billingReturn = billing;
    url.searchParams.delete('billing');
    url.searchParams.delete('session_id');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  async function confirmBillingReturn() {
    if (!state.user || !state.billingReturn) return;
    const t = text();
    state.open = true;
    document.documentElement.classList.add('hao-account-open');
    if (state.billingReturn === 'cancelled') {
      state.notice = t.billingCancelled;
      render();
      return;
    }
    for (const wait of [0, 700, 1400]) {
      if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
      await Promise.all([
        refreshEntitlements(),
        optional('subscription refresh after billing', refreshSubscription),
      ]);
      if (state.entitlements.has(config.entitlementCode)) break;
    }
    state.notice = state.entitlements.has(config.entitlementCode) ? t.billingSuccess : t.billingPending;
    render();
    emit();
  }

  async function initialise() {
    readBillingReturn();
    overlayHost = document.createElement('div');
    overlayHost.id = 'hao-account-overlay';
    overlayHost.hidden = true;
    document.body.appendChild(overlayHost);
    attachTrigger();
    observeMount();
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.open) close();
    });
    try {
      const client = await getClient();
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      await handleSession(data.session);
      await confirmBillingReturn();
      client.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => void handleSession(session), 0);
      });
    } catch (error) {
      setError(error);
    } finally {
      state.loading = false;
      render();
      emit();
    }
  }

  window.HaoAccount = Object.freeze({
    getState: snapshot,
    open,
    close,
    refresh,
    signInWithProvider,
    can: (code) => code === config.entitlementCode && state.entitlements.has(config.entitlementCode),
    getClient,
    saveProductData,
    submitFeedback,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void initialise(), { once: true });
  else void initialise();
})();
