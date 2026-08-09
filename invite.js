import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.95.0/+esm';

const SUPABASE_URL = 'https://blgwlycfcwvsupmqyqwn.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_n1Va-c_alpkQ0zNuJYUaxA_J0u68RVW';
const INVITE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/membership-invite`;
const ADMIN_URL = 'https://liuh886.github.io/admin/';
const STORAGE_KEY = 'hao_membership_invite_token';

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

function readInviteToken() {
  const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get('invite')?.trim().toLowerCase() || '';
  if (fragmentToken) {
    localStorage.setItem(STORAGE_KEY, fragmentToken);
    window.history.replaceState({}, '', ADMIN_URL);
  }
  return fragmentToken || localStorage.getItem(STORAGE_KEY) || '';
}

const inviteToken = readInviteToken();
const inviteMode = Boolean(inviteToken);
window.__HAO_INVITE_MODE__ = inviteMode;

function leaveInviteMode() {
  localStorage.removeItem(STORAGE_KEY);
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

function renderInviteLogin(message = '') {
  const root = inviteShell();
  root.innerHTML = `
    <div class="invite-card">
      <div class="brand-mark" aria-hidden="true">H</div>
      <p class="eyebrow">HAO APPS · PRO INVITATION</p>
      <h1>你收到了一份 Pro 免费体验</h1>
      <p class="invite-lead">登录共享 Hao Apps 账户后，会进入 Stripe 确认这段 0 元订阅期。免费期内也可以管理或取消订阅。</p>
      ${message ? `<p class="invite-status" data-kind="error">${escapeHtml(message)}</p>` : ''}
      <button id="invite-login" class="button primary" type="button">使用 Google 登录并继续</button>
      <p class="invite-footnote">Stripe 免费期无需立即付款。未添加付款方式时，到期自动取消；主动添加付款方式后才会按正常价格续订。</p>
    </div>`;
  root.querySelector('#invite-login')?.addEventListener('click', async () => {
    const button = root.querySelector('#invite-login');
    button.disabled = true;
    button.textContent = '正在跳转 Google…';
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: ADMIN_URL }
    });
    if (error) renderInviteLogin(error.message);
  });
}

let redeeming = false;
async function redeemInvite(session) {
  if (redeeming || !session || !inviteToken) return;
  redeeming = true;
  const root = inviteShell();
  root.innerHTML = `
    <div class="invite-card">
      <div class="brand-mark" aria-hidden="true">H</div>
      <p class="eyebrow">HAO APPS · PRO INVITATION</p>
      <h1>正在准备免费订阅</h1>
      <p class="invite-lead">正在为 ${escapeHtml(session.user.email || '当前账户')} 创建 Stripe 免费体验…</p>
    </div>`;
  try {
    const result = await callInvite('redeem', { token: inviteToken });
    if (!result.checkout_url) throw new Error('Stripe Checkout 地址未生成。');
    localStorage.removeItem(STORAGE_KEY);
    window.location.assign(result.checkout_url);
  } catch (error) {
    root.innerHTML = `
      <div class="invite-card">
        <div class="brand-mark" aria-hidden="true">H</div>
        <p class="eyebrow">HAO APPS · PRO INVITATION</p>
        <h1>这份邀请暂时无法继续</h1>
        <p class="invite-status" data-kind="error">${escapeHtml(error.message)}</p>
        <button id="invite-leave" class="button ghost" type="button">返回 Hao Apps</button>
        <p class="invite-footnote">一次性邀请被其他账户领取后不能再次使用；同一账户取消 Stripe Checkout 后可以从原链接继续。</p>
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
        ? { label: '结账中', className: 'active', date: item.created_at }
        : { label: '可用', className: 'active', date: item.created_at };
    return `
      <article class="invite-record">
        <div>
          <strong>${escapeHtml(productMap.get(item.product_code) || item.product_code)}</strong>
          <span>${escapeHtml(formatDuration(item.duration_days))}免费体验 · Stripe 订阅</span>
        </div>
        <div class="invite-record-status">
          <span class="badge ${state.className}">${state.label}</span>
          <small>${escapeHtml(formatDate(state.date))}</small>
        </div>
      </article>`;
  }).join('') : '<p class="empty-copy">尚未生成邀请。</p>';
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
          <p>选择产品与免费时长。领取后创建真实 Stripe 订阅，免费期价格为 0，并从第一天开放订阅管理。</p>
        </div>
      </div>
      <div class="invite-admin-grid">
        <article class="panel">
          <div class="panel-heading"><div><p class="eyebrow">CREATE</p><h3>生成邀请链接</h3></div></div>
          <form id="invite-create-form" class="stack-form">
            <label><span>产品</span><select id="invite-product" required></select></label>
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
              <span>免费期内金额为 0；用户可随时进入 Customer Portal 管理或取消。未添加付款方式时，到期自动取消。</span>
            </div>
            <button class="button primary full" type="submit">生成一次性邀请</button>
          </form>
          <p id="invite-admin-status" class="status-line" role="status" aria-live="polite"></p>
        </article>
        <article class="panel invite-result-panel">
          <div class="panel-heading"><div><p class="eyebrow">SHARE</p><h3>邀请函</h3></div></div>
          <div id="invite-result" class="invite-result-empty">
            <p>生成后，原始链接只在这里显示一次。数据库仅保存 token 哈希。</p>
          </div>
        </article>
      </div>
      <article class="panel">
        <div class="panel-heading"><div><p class="eyebrow">RECENT</p><h3>最近邀请</h3></div><span class="subtle">只显示状态，不恢复原始链接</span></div>
        <div id="invite-recent-list" class="invite-record-list"></div>
      </article>`;
    document.querySelector('.search-panel')?.before(section);
  }

  const productSelect = section.querySelector('#invite-product');
  productSelect.innerHTML = (catalog.products || [])
    .map((product) => `<option value="${escapeHtml(product.product_code)}">${escapeHtml(product.name)}</option>`)
    .join('');
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
      const duration = Number(section.querySelector('#invite-duration').value);
      const result = await callInvite('create', {
        product_code: productSelect.value,
        duration_days: duration
      });
      const resultBox = section.querySelector('#invite-result');
      resultBox.className = 'invite-result-ready';
      resultBox.innerHTML = `
        <strong>${escapeHtml(result.product?.name || result.product?.product_code || 'Pro')}</strong>
        <span>${escapeHtml(formatDuration(result.duration_days))}免费体验 · Stripe 订阅</span>
        <div class="invite-link-row">
          <input id="invite-generated-link" type="text" readonly value="${escapeHtml(result.invite_url)}">
          <button id="invite-copy-link" class="button ghost compact" type="button">复制链接</button>
        </div>
        <small>领取人登录后会进入 Stripe 0 元 Checkout。免费期可管理订阅；没有付款方式时，到期自动取消。</small>`;
      resultBox.querySelector('#invite-copy-link')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(result.invite_url);
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

if (inviteMode) {
  renderInviteLogin();
  client.auth.onAuthStateChange((_event, session) => {
    if (session) window.setTimeout(() => void redeemInvite(session), 0);
  });
  const { data, error } = await client.auth.getSession();
  if (error) renderInviteLogin(error.message);
  else if (data.session) await redeemInvite(data.session);
} else {
  client.auth.onAuthStateChange((_event, session) => {
    if (session) window.setTimeout(() => void loadAdminModule(), 0);
  });
  const { data } = await client.auth.getSession();
  if (data.session) await loadAdminModule();
}
