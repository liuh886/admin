import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';

const SUPABASE_URL = 'https://blgwlycfcwvsupmqyqwn.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_n1Va-c_alpkQ0zNuJYUaxA_J0u68RVW';
const REFERRAL_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/product-referral`;
const ADMIN_URL = 'https://liuh886.github.io/admin/';
const REFERRAL_STORAGE_KEY = 'hao_product_referral_code';
const TURNSTILE_SITE_KEY = '0x4AAAAAAEKVMnWa2valozxW';
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const OAUTH_PROVIDERS = new Set(['google', 'github', 'x']);

const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
});

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function referralFromLocation() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const fromUrl = String(params.get('ref') || '').trim().toUpperCase();
  if (fromUrl) {
    localStorage.setItem(REFERRAL_STORAGE_KEY, fromUrl);
    window.history.replaceState({}, '', ADMIN_URL);
  }
  return fromUrl || String(localStorage.getItem(REFERRAL_STORAGE_KEY) || '').trim().toUpperCase();
}

const referralCode = referralFromLocation();
const referralMode = /^R-[A-Z0-9]{12}$/.test(referralCode);
window.__HAO_REFERRAL_MODE__ = referralMode;

if (!referralMode) {
  // The normal Admin and one-time invitation surfaces own the page.
} else {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = './referral.css';
  document.head.appendChild(stylesheet);

  let preview = null;
  let turnstileLoader = null;
  let turnstileWidgetId = null;
  let captchaToken = '';

  const track = (eventName, extra = {}) => {
    try {
      window.gtag?.('event', eventName, {
        product_code: preview?.product?.product_code || '',
        ...extra
      });
    } catch { /* analytics is non-blocking */ }
  };

  const callReferral = async (action, payload = {}, authenticated = false) => {
    const headers = {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json'
    };
    if (authenticated) {
      const { data, error } = await client.auth.getSession();
      if (error || !data.session?.access_token) throw new Error('请先登录后继续。');
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
    const response = await fetch(REFERRAL_FUNCTION_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, referral_code: referralCode, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error(result.error || '邀请服务暂时不可用。');
    return result;
  };

  const shell = () => {
    let root = document.querySelector('#product-referral-redemption');
    if (root) return root;
    document.documentElement.classList.add('product-referral-mode');
    document.querySelector('main.shell')?.setAttribute('aria-hidden', 'true');
    root = document.createElement('section');
    root.id = 'product-referral-redemption';
    root.className = 'product-referral-redemption';
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
    return root;
  };

  const productName = () => String(preview?.product?.name || 'Hao Apps').replace(/\s+Pro$/i, '');

  const offerMarkup = () => {
    const days = Number(preview?.trial_days || 0);
    return `
      <section class="referral-offer">
        <div class="referral-product">
          <span>PRODUCT</span>
          <strong>${escapeHtml(productName())}</strong>
          <small>${escapeHtml(preview?.product?.app_url || '')}</small>
        </div>
        <div class="referral-benefit ${days > 0 ? 'is-pro' : ''}">
          <span>YOUR INVITE</span>
          <strong>${days > 0 ? `${days} 天 Pro 免费体验` : '专属加入邀请'}</strong>
          <small>${days > 0 ? '邀请人在你领取时具有有效 Pro 权益；免费时长由 Hao Apps Admin 统一配置。' : '你仍可通过邀请加入产品；当前链接没有附带 Pro 免费期。'}</small>
        </div>
      </section>`;
  };

  const ensureTurnstile = async () => {
    if (window.turnstile) return window.turnstile;
    if (!turnstileLoader) {
      turnstileLoader = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-hao-referral-turnstile]');
        const script = existing || document.createElement('script');
        if (!existing) {
          script.src = TURNSTILE_SCRIPT_URL;
          script.async = true;
          script.defer = true;
          script.dataset.haoReferralTurnstile = 'true';
          document.head.appendChild(script);
        }
        const started = Date.now();
        const timer = window.setInterval(() => {
          if (window.turnstile) {
            window.clearInterval(timer);
            resolve(window.turnstile);
          } else if (Date.now() - started > 10000) {
            window.clearInterval(timer);
            reject(new Error('人机验证暂时不可用，请稍后重试。'));
          }
        }, 80);
      });
    }
    return turnstileLoader;
  };

  const mountTurnstile = async () => {
    const target = document.querySelector('#referral-turnstile');
    if (!target) return;
    captchaToken = '';
    const turnstile = await ensureTurnstile();
    if (turnstileWidgetId !== null) {
      try { turnstile.remove(turnstileWidgetId); } catch { /* stale widget */ }
      turnstileWidgetId = null;
    }
    turnstileWidgetId = turnstile.render(target, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: 'auto',
      callback: (token) => { captchaToken = token; },
      'expired-callback': () => { captchaToken = ''; },
      'error-callback': () => { captchaToken = ''; }
    });
  };

  const signInWithProvider = async (provider) => {
    if (!OAUTH_PROVIDERS.has(provider)) return;
    document.querySelectorAll('[data-referral-provider]').forEach((button) => { button.disabled = true; });
    track('referral_sign_in_start', { method: provider });
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: ADMIN_URL }
    });
    if (error) renderLogin(error.message);
  };

  const sendMagicLink = async (event) => {
    event.preventDefault();
    const email = String(document.querySelector('#referral-email')?.value || '').trim();
    const status = document.querySelector('#referral-login-status');
    if (!email) return;
    if (!captchaToken) {
      status.textContent = '请先完成人机验证。';
      status.dataset.kind = 'error';
      return;
    }
    status.textContent = '正在发送登录链接…';
    delete status.dataset.kind;
    track('referral_sign_in_start', { method: 'email' });
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: ADMIN_URL,
        shouldCreateUser: true,
        captchaToken
      }
    });
    if (error) {
      status.textContent = error.message;
      status.dataset.kind = 'error';
      return;
    }
    status.textContent = '登录链接已发送，请检查邮箱。';
    status.dataset.kind = 'success';
  };

  function renderLogin(message = '') {
    const root = shell();
    root.innerHTML = `
      <div class="referral-card">
        <div class="referral-brand">H</div>
        <p class="referral-eyebrow">HAO APPS · PRODUCT REFERRAL</p>
        <h1>你收到了一份 ${escapeHtml(productName())} 邀请</h1>
        <p class="referral-lead">选择你长期使用的 Hao Apps 账号登录。我们会在确认页再次显示当前账号，只有你明确确认后才会记录邀请归因并激活符合条件的 Pro 免费体验。</p>
        ${offerMarkup()}
        ${message ? `<p class="referral-status" data-kind="error">${escapeHtml(message)}</p>` : ''}
        <div class="referral-provider-grid">
          <button type="button" data-referral-provider="google"><strong>Google</strong><span>继续使用 Google</span></button>
          <button type="button" data-referral-provider="github"><strong>GitHub</strong><span>继续使用 GitHub</span></button>
          <button type="button" data-referral-provider="x"><strong>X</strong><span>继续使用 X</span></button>
        </div>
        <div class="referral-divider"><span>或</span></div>
        <form id="referral-email-form" class="referral-email-form">
          <label><span>邮箱地址</span><input id="referral-email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
          <div id="referral-turnstile"></div>
          <button class="referral-primary" type="submit">发送邮箱登录链接</button>
        </form>
        <p id="referral-login-status" class="referral-status" role="status"></p>
        <p class="referral-footnote">邀请链接只用于产品归因。免费 Pro 时长由服务端读取当前产品政策，浏览器不能修改。</p>
      </div>`;
    root.querySelectorAll('[data-referral-provider]').forEach((button) => {
      button.addEventListener('click', () => void signInWithProvider(button.dataset.referralProvider));
    });
    root.querySelector('#referral-email-form')?.addEventListener('submit', (event) => void sendMagicLink(event));
    void mountTurnstile().catch((error) => {
      const status = root.querySelector('#referral-login-status');
      if (status) {
        status.textContent = error.message;
        status.dataset.kind = 'error';
      }
    });
  }

  function renderReady(session) {
    const root = shell();
    root.innerHTML = `
      <div class="referral-card">
        <div class="referral-brand">H</div>
        <p class="referral-eyebrow">HAO APPS · CONFIRM ACCOUNT</p>
        <h1>确认加入 ${escapeHtml(productName())}</h1>
        <p class="referral-lead">当前登录：<strong>${escapeHtml(session.user.email || session.user.id)}</strong>。确认后，这个账号会记录本次邀请关系；符合条件时同时激活 Pro 免费体验。</p>
        ${offerMarkup()}
        <div class="referral-confirm-actions">
          <button id="referral-redeem" class="referral-primary" type="button">确认并激活邀请</button>
          <button id="referral-switch" type="button">换一个账号</button>
        </div>
        <p class="referral-footnote">每个账号在同一产品只能接受一次 referral 归因；已有或曾有该产品 Pro 的账号不会重复获得免费期。</p>
      </div>`;
    root.querySelector('#referral-redeem')?.addEventListener('click', () => void redeem(session));
    root.querySelector('#referral-switch')?.addEventListener('click', async () => {
      await client.auth.signOut();
      renderLogin();
    });
  }

  async function redeem(session) {
    const root = shell();
    root.innerHTML = `
      <div class="referral-card referral-processing">
        <div class="referral-brand">H</div>
        <p class="referral-eyebrow">HAO APPS · ACTIVATING</p>
        <h1>正在确认邀请</h1>
        <p class="referral-lead">正在为 ${escapeHtml(session.user.email || '当前账号')} 记录产品归因并检查 Pro 免费体验资格…</p>
      </div>`;
    try {
      const result = await callReferral('redeem', {}, true);
      localStorage.removeItem(REFERRAL_STORAGE_KEY);
      track('referral_redeem', { benefit_granted: result.benefit_granted ? 1 : 0 });
      if (result.benefit_granted) track('referral_pro_activated', { trial_days: result.trial_days });
      root.innerHTML = `
        <div class="referral-card">
          <div class="referral-brand">H</div>
          <p class="referral-eyebrow">HAO APPS · READY</p>
          <h1>${escapeHtml(productName())} 已就绪</h1>
          <p class="referral-lead">${result.benefit_granted
            ? `${escapeHtml(String(result.trial_days))} 天 Pro 免费体验已经激活，有效至 ${escapeHtml(new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(result.valid_until)))}。`
            : '邀请关系已经确认。当前账号没有新增免费 Pro 时长；已有权益不会被覆盖。'}</p>
          <a class="referral-open-product" href="${escapeHtml(result.product.app_url)}">打开 ${escapeHtml(productName())} →</a>
          <p class="referral-footnote">账号、订阅与权益继续由 Hao Apps / Stripe 统一管理。</p>
        </div>`;
    } catch (error) {
      root.innerHTML = `
        <div class="referral-card">
          <div class="referral-brand">H</div>
          <p class="referral-eyebrow">HAO APPS · REFERRAL</p>
          <h1>这份邀请暂时无法继续</h1>
          <p class="referral-status" data-kind="error">${escapeHtml(error.message)}</p>
          <a class="referral-open-product" href="${escapeHtml(preview?.product?.app_url || ADMIN_URL)}">返回产品</a>
        </div>`;
    }
  }

  async function start() {
    try {
      preview = await callReferral('preview');
      track('referral_landing_view');
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session) renderReady(data.session);
      else renderLogin();
    } catch (error) {
      const root = shell();
      root.innerHTML = `
        <div class="referral-card">
          <div class="referral-brand">H</div>
          <p class="referral-eyebrow">HAO APPS · REFERRAL</p>
          <h1>邀请链接不可用</h1>
          <p class="referral-status" data-kind="error">${escapeHtml(error.message)}</p>
          <a class="referral-open-product" href="${ADMIN_URL}">返回 Hao Apps</a>
        </div>`;
    }
  }

  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      if (!preview) return;
      if (session) renderReady(session);
      else renderLogin();
    }, 0);
  });

  await start();
}
