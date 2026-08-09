import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';

const SUPABASE_URL = 'https://blgwlycfcwvsupmqyqwn.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_n1Va-c_alpkQ0zNuJYUaxA_J0u68RVW';
const INVITE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/membership-invite`;
const ADMIN_URL = 'https://liuh886.github.io/admin/';
const TOKEN_STORAGE_KEY = 'hao_membership_invite_token';
const OFFER_STORAGE_KEY = 'hao_membership_invite_offer';
const OAUTH_PROVIDERS = new Set(['google', 'github', 'x']);

const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = './invite.css';
document.head.appendChild(stylesheet);

const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
});

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function formatDuration(days) {
  const value = Number(days);
  if (value === 365) return '1 年';
  return `${value} 天`;
}

function productNames(codes, productMap) {
  return (Array.isArray(codes) ? codes : [])
    .map((code) => productMap.get(code) || code)
    .join(' · ');
}

function normalizeOffer(value) {
  try {
    const raw = typeof value === 'string' ? JSON.parse(value) : value;
    const durationDays = Number(raw?.duration_days);
    const products = Array.isArray(raw?.products)
      ? raw.products.map((product) => ({
          product_code: String(product?.product_code || '').trim(),
          name: String(product?.name || '').trim(),
          app_url: String(product?.app_url || '').trim()
        })).filter((product) => product.product_code && product.name && /^https:\/\//.test(product.app_url))
      : [];
    if (!Number.isFinite(durationDays) || durationDays < 1 || !products.length) return null;
    return { duration_days: durationDays, products };
  } catch {
    return null;
  }
}

function buildInviteShareUrl(result) {
  const url = new URL(result.invite_url);
  const params = new URLSearchParams(url.hash.slice(1));
  const offer = normalizeOffer({
    duration_days: result.duration_days,
    products: result.products
  });
  if (!offer) throw new Error('邀请内容无法生成。');
  params.set('offer', JSON.stringify(offer));
  url.hash = params.toString();
  return url.toString();
}

function readInviteContext() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const tokenFromUrl = params.get('invite')?.trim().toLowerCase() || '';
  const offerFromUrl = params.get('offer') || '';

  if (tokenFromUrl) {
    localStorage.setItem(TOKEN_STORAGE_KEY, tokenFromUrl);
    if (normalizeOffer(offerFromUrl)) localStorage.setItem(OFFER_STORAGE_KEY, offerFromUrl);
    window.history.replaceState({}, '', ADMIN_URL);
  }

  const token = tokenFromUrl || localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  const offerRaw = offerFromUrl || localStorage.getItem(OFFER_STORAGE_KEY) || '';
  return { token, offer: normalizeOffer(offerRaw) };
}

function clearInviteContext() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(OFFER_STORAGE_KEY);
}

const inviteContext = readInviteContext();
const inviteToken = inviteContext.token;
const inviteOffer = inviteContext.offer;
const inviteMode = Boolean(inviteToken);
window.__HAO_INVITE_MODE__ = inviteMode;

async function callInvite(action, payload = {}) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('请先登录后再继续。');
  const response = await fetch(INVITE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action, ...payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `邀请请求失败（${response.status}）`);
  return result;
}

function leaveInviteMode() {
  clearInviteContext();
  window.location.assign(ADMIN_URL);
}

function inviteShell() {
  let root = document.querySelector('#invite-redemption');
  if (root) return root;
  document.documentElement.classList.add('invite-redemption-mode');
  document.querySelector('main.shell')?.setAttribute('aria-hidden', 'true');
  root = document.createElement('section');
  root.id = 'invite-redemption';
  root.className = 'invite-redemption';
  root.setAttribute('aria-live', 'polite');
  document.body.appendChild(root);
  return root;
}

function offerMarkup(offer = inviteOffer) {
  if (!offer) {
    return '<p class="invite-status" data-kind="error">邀请内容缺失，请让邀请人重新生成一次链接。</p>';
  }
  return `
    <section class="invite-offer" aria-label="本次赠予权益">
      <div class="invite-offer-heading">
        <div><span>本次赠予</span><strong>${escapeHtml(formatDuration(offer.duration_days))} Pro 免费体验</strong></div>
        <span>${offer.products.length} 个产品</span>
      </div>
      <div class="invite-offer-list">
        ${offer.products.map((product) => `
          <a class="invite-offer-item" href="${escapeHtml(product.app_url)}" target="_blank" rel="noreferrer">
            <span><strong>${escapeHtml(product.name)}</strong><small>领取后访问 · ${escapeHtml(product.app_url)}</small></span>
            <span aria-hidden="true">↗</span>
          </a>`).join('')}
      </div>
    </section>`;
}

async function signInWithProvider(provider) {
  if (!OAUTH_PROVIDERS.has(provider)) throw new Error('不支持的登录方式。');
  document.querySelectorAll('[data-invite-provider]').forEach((button) => { button.disabled = true; });
  const activeButton = document.querySelector(`[data-invite-provider="${provider}"]`);
  if (activeButton) activeButton.querySelector('span:last-child').textContent = '正在跳转…';
  const { error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: ADMIN_URL }
  });
  if (error) renderInviteLogin(error.message);
}

function renderInviteLogin(message = '') {
  const root = inviteShell();
  root.innerHTML = `
    <div class="invite-card invite-login-card">
      <div class="brand-mark" aria-hidden="true">H</div>
      <p class="eyebrow">HAO APPS · PRO INVITATION</p>
      <h1>你收到了一份 Pro 免费体验</h1>
      <p class="invite-lead">选择一个长期使用的 Hao Apps 账号登录。领取后，下列 Pro 权益会同时进入这个账号。</p>
      ${offerMarkup()}
      ${message ? `<p class="invite-status" data-kind="error">${escapeHtml(message)}</p>` : ''}
      <div class="invite-provider-grid" aria-label="登录方式">
        <button class="invite-provider recommended" type="button" data-invite-provider="google">
          <span class="invite-provider-name">Google <em>推荐</em></span><span>使用 Google 登录</span>
        </button>
        <button class="invite-provider" type="button" data-invite-provider="github">
          <span class="invite-provider-name">GitHub</span><span>使用 GitHub 登录</span>
        </button>
        <button class="invite-provider" type="button" data-invite-provider="x">
          <span class="invite-provider-name">X</span><span>使用 X 登录</span>
        </button>
      </div>
      <p class="invite-footnote">如果你已经使用过 Hao Apps，请选择原来的登录账号。免费期金额为 0；未添加付款方式时，到期自动取消。</p>
    </div>`;
  root.querySelectorAll('[data-invite-provider]').forEach((button) => {
    button.addEventListener('click', () => void signInWithProvider(button.dataset.inviteProvider));
  });
}

function renderInviteReady(session) {
  const root = inviteShell();
  root.innerHTML = `
    <div class="invite-card">
      <div class="brand-mark" aria-hidden="true">H</div>
      <p class="eyebrow">HAO APPS · PRO INVITATION</p>
      <h1>确认领取到这个账号</h1>
      <p class="invite-lead">当前登录：<strong>${escapeHtml(session.user.email || session.user.id)}</strong>。确认后，这个一次性邀请将归属该 Hao Apps 账号。</p>
      ${offerMarkup()}
      <div class="invite-confirm-actions">
        <button id="invite-redeem" class="button primary" type="button">确认领取全部 Pro</button>
        <button id="invite-switch-account" class="button ghost" type="button">换一个账号</button>
      </div>
      <p class="invite-footnote">同一个邀请只能归属一个账号。请在确认前检查当前登录账号。</p>
    </div>`;
  root.querySelector('#invite-redeem')?.addEventListener('click', () => void redeemInvite(session));
  root.querySelector('#invite-switch-account')?.addEventListener('click', async () => {
    await client.auth.signOut();
    renderInviteLogin();
  });
}

function renderInviteSuccess(root, result) {
  const products = result.redemption?.products || [];
  const duration = result.redemption?.duration_days;
  root.innerHTML = `
    <div class="invite-card">
      <div class="brand-mark" aria-hidden="true">H</div>
      <p class="eyebrow">HAO APPS · PRO ACTIVE</p>
      <h1>Pro 免费体验已激活</h1>
      <p class="invite-lead">${escapeHtml(formatDuration(duration))}免费期已经激活。下面列出实际生效的产品、截止时间与访问地址。</p>
      <div class="invite-access-list">
        ${products.map((product) => `
          <a href="${escapeHtml(product.app_url)}" class="invite-access-item" target="_blank" rel="noreferrer">
            <span><strong>${escapeHtml(product.name || product.product_code)}</strong><small>${product.already_subscribed ? '已有有效订阅，保持原订阅' : `免费体验至 ${escapeHtml(formatDate(product.trial_end))}`} · ${escapeHtml(product.app_url)}</small></span>
            <span aria-hidden="true">→</span>
          </a>`).join('')}
      </div>
      <button id="invite-leave" class="button ghost" type="button">返回 Hao Apps</button>
      <p class="invite-footnote">订阅管理、付款方式和取消操作均由 Stripe 提供；Pro 权益由订阅状态自动同步。</p>
    </div>`;
  root.querySelector('#invite-leave')?.addEventListener('click', leaveInviteMode);
}

let redeeming = false;
async function redeemInvite(session) {
  if (redeeming || !session || !inviteToken || !inviteOffer) return;
  redeeming = true;
  const root = inviteShell();
  root.innerHTML = `
    <div class="invite-card">
      <div class="brand-mark" aria-hidden="true">H</div>
      <p class="eyebrow">HAO APPS · PRO INVITATION</p>
      <h1>正在激活免费体验</h1>
      <p class="invite-lead">正在为 ${escapeHtml(session.user.email || '当前账户')} 激活邀请中的全部 Pro 产品…</p>
    </div>`;
  try {
    const result = await callInvite('redeem', { token: inviteToken });
    clearInviteContext();
    renderInviteSuccess(root, result);
  } catch (error) {
    root.innerHTML = `
      <div class="invite-card">
        <div class="brand-mark" aria-hidden="true">H</div>
        <p class="eyebrow">HAO APPS · PRO INVITATION</p>
        <h1>这份邀请暂时无法继续</h1>
        <p class="invite-status" data-kind="error">${escapeHtml(error.message)}</p>
        <button id="invite-leave" class="button ghost" type="button">返回 Hao Apps</button>
        <p class="invite-footnote">一次性邀请被其他账户领取后不能再次使用；如果激活过程被中断，同一账户可以重新打开原邀请链接继续。</p>
      </div>`;
    root.querySelector('#invite-leave')?.addEventListener('click', leaveInviteMode);
  } finally {
    redeeming = false;
  }
}

function renderRecentInvites(catalog) {
  const target = document.querySelector('#invite-recent-list');
  if (!target) return;
  const productMap = new Map((catalog.products || []).map((item) => [item.product_code, item.name]));
  const rows = catalog.recent_invites || [];
  target.innerHTML = rows.length ? rows.map((item) => {
    const state = item.redeemed_at
      ? { label: '已激活', className: 'inactive', date: item.redeemed_at }
      : item.redeemed_by
        ? { label: '激活中', className: 'active', date: item.created_at }
        : { label: '可用', className: 'active', date: item.created_at };
    return `
      <article class="invite-record">
        <div>
          <strong>${escapeHtml(productNames(item.product_codes, productMap))}</strong>
          <span>${escapeHtml(formatDuration(item.duration_days))}免费体验 · Stripe 订阅</span>
        </div>
        <div class="invite-record-status">
          <span class="badge ${state.className}">${state.label}</span>
          <small>${escapeHtml(formatDate(state.date))}</small>
        </div>
      </article>`;
  }).join('') : '<p class="empty-copy">尚未生成邀请。</p>';
}

function productOptions(products) {
  return (products || []).map((product) => `
    <label class="invite-product-option">
      <input type="checkbox" name="invite-product" value="${escapeHtml(product.product_code)}">
      <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.app_url)}</small></span>
    </label>`).join('');
}

function ensureAdminModule(catalog) {
  let section = document.querySelector('#invite-admin-section');
  if (!section) {
    section = document.createElement('section');
    section.id = 'invite-admin-section';
    section.className = 'invite-admin-section';
    section.innerHTML = `
      <div class="section-heading">
        <div>
          <p class="eyebrow">PRO INVITATIONS</p>
          <h2>一次性免费体验邀请</h2>
          <p>选择一个或多个 Pro 产品与免费时长。邀请页会在登录前明确展示全部赠予产品、访问地址与三种登录入口。</p>
        </div>
      </div>
      <div class="invite-admin-grid">
        <article class="panel">
          <div class="panel-heading"><div><p class="eyebrow">CREATE</p><h3>生成邀请链接</h3></div></div>
          <form id="invite-create-form" class="stack-form">
            <fieldset class="full invite-products-fieldset">
              <legend>Pro 产品</legend>
              <div id="invite-products" class="invite-product-options"></div>
            </fieldset>
            <label><span>免费时长</span>
              <select id="invite-duration" required>
                <option value="7">7 天</option>
                <option value="30" selected>30 天</option>
                <option value="90">90 天</option>
                <option value="180">180 天</option>
                <option value="365">1 年</option>
              </select>
            </label>
            <div class="full invite-trial-note">
              <strong>Stripe 订阅规则</strong>
              <span>免费期内金额为 0；用户可随时进入 Customer Portal 管理或取消。未添加付款方式时，到期自动取消；主动添加付款方式后才按正常价格续订。</span>
            </div>
            <button class="button primary full" type="submit">生成一次性邀请</button>
          </form>
          <p id="invite-admin-status" class="status-line" role="status" aria-live="polite"></p>
        </article>
        <article class="panel invite-result-panel">
          <div class="panel-heading"><div><p class="eyebrow">SHARE</p><h3>邀请函</h3></div></div>
          <div id="invite-result" class="invite-result-empty">
            <p>生成后，原始链接只在这里显示一次。链接片段同时携带不具授权能力的邀请内容预览；数据库仍只保存 token 哈希。</p>
          </div>
        </article>
      </div>
      <article class="panel">
        <div class="panel-heading"><div><p class="eyebrow">RECENT</p><h3>最近邀请</h3></div><span class="subtle">只显示状态，不恢复原始链接</span></div>
        <div id="invite-recent-list" class="invite-record-list"></div>
      </article>`;
    document.querySelector('.search-panel')?.before(section);
  }

  const options = section.querySelector('#invite-products');
  options.innerHTML = productOptions(catalog.products);
  renderRecentInvites(catalog);

  const form = section.querySelector('#invite-create-form');
  const status = section.querySelector('#invite-admin-status');
  if (!catalog.can_create) {
    form.querySelectorAll('input, select, button').forEach((element) => { element.disabled = true; });
    status.textContent = '当前管理员角色为只读，不能生成邀请。';
    status.dataset.kind = 'error';
  }

  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!catalog.can_create) return;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = '正在生成一次性链接…';
    delete status.dataset.kind;
    try {
      const selectedProducts = [...section.querySelectorAll('input[name="invite-product"]:checked')]
        .map((input) => input.value);
      if (!selectedProducts.length) throw new Error('请至少选择一个 Pro 产品。');
      const duration = Number(section.querySelector('#invite-duration').value);
      const result = await callInvite('create', {
        product_codes: selectedProducts,
        duration_days: duration
      });
      const shareUrl = buildInviteShareUrl(result);
      const resultBox = section.querySelector('#invite-result');
      resultBox.className = 'invite-result-ready';
      resultBox.innerHTML = `
        <strong>${escapeHtml((result.products || []).map((product) => product.name).join(' · '))}</strong>
        <span>${escapeHtml(formatDuration(result.duration_days))}免费体验 · Stripe 订阅</span>
        <div class="invite-link-row">
          <input id="invite-generated-link" type="text" readonly value="${escapeHtml(shareUrl)}">
          <button id="invite-copy-link" class="button ghost compact" type="button">复制链接</button>
        </div>
        <small>对方打开链接后，会先看到所获 Pro 产品与访问地址，再选择 Google、GitHub 或 X 登录。Google 作为推荐入口。</small>`;
      resultBox.querySelector('#invite-copy-link')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(shareUrl);
        resultBox.querySelector('#invite-copy-link').textContent = '已复制';
      });
      status.textContent = '邀请已生成。';
      status.dataset.kind = 'success';
      const refreshed = await callInvite('catalog');
      renderRecentInvites(refreshed);
    } catch (error) {
      status.textContent = error.message;
      status.dataset.kind = 'error';
    } finally {
      submit.disabled = false;
    }
  };

  section.hidden = false;
}

async function loadAdminModule() {
  if (inviteMode) return;
  try {
    const catalog = await callInvite('catalog');
    ensureAdminModule(catalog);
  } catch {
    document.querySelector('#invite-admin-section')?.setAttribute('hidden', '');
  }
}

async function renderInvitationEntry() {
  if (!inviteOffer) {
    renderInviteLogin('邀请详情缺失，请让邀请人重新生成一次链接。');
    return;
  }
  const { data, error } = await client.auth.getSession();
  if (error) {
    renderInviteLogin(error.message);
    return;
  }
  if (data.session) renderInviteReady(data.session);
  else renderInviteLogin();
}

if (inviteMode) {
  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      if (session) renderInviteReady(session);
      else renderInviteLogin();
    }, 0);
  });
  await renderInvitationEntry();
} else {
  client.auth.onAuthStateChange((_event, session) => {
    if (session) window.setTimeout(() => void loadAdminModule(), 0);
  });
  const { data } = await client.auth.getSession();
  if (data.session) await loadAdminModule();
}
