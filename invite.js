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

function productNames(codes, productMap) {
  return (Array.isArray(codes) ? codes : [])
    .map((code) => productMap.get(code) || code)
    .join(' · ');
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
      <p class="invite-lead">登录共享 Hao Apps 账户并领取后，邀请中的每个产品都会建立一条真实的 Stripe 免费订阅。免费期从第一天起即可管理或取消。</p>
      ${message ? `<p class="invite-status" data-kind="error">${escapeHtml(message)}</p>` : ''}
      <button id="invite-login" class="button primary" type="button">使用 Google 登录并领取</button>
      <p class="invite-footnote">免费期金额为 0。没有付款方式时，到期自动取消；如果你在“管理订阅”中主动添加付款方式，试用结束后才会按产品正常价格续订。</p>
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

function renderInviteSuccess(root, result) {
  const products = result.redemption?.products || [];
  const duration = result.redemption?.duration_days;
  root.innerHTML = `
    <div class="invite-card">
      <div class="brand-mark" aria-hidden="true">H</div>
      <p class="eyebrow">HAO APPS · PRO ACTIVE</p>
      <h1>Pro 免费体验已激活</h1>
      <p class="invite-lead">${escapeHtml(formatDuration(duration))}免费期已经写入 Stripe 订阅。你可以进入任一产品的账户页查看截止日期，并通过“管理订阅”打开 Stripe Customer Portal。</p>
      <div class="invite-access-list">
        ${products.map((product) => `
          <a href="${escapeHtml(product.app_url)}" class="invite-access-item">
            <span><strong>${escapeHtml(product.name || product.product_code)}</strong><small>${product.already_subscribed ? '已有有效订阅，保持原订阅' : `免费体验至 ${escapeHtml(formatDate(product.trial_end))}`}</small></span>
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
  if (redeeming || !session || !inviteToken) return;
  redeeming = true;
  const root = inviteShell();
  root.innerHTML = `
    <div class="invite-card">
      <div class="brand-mark" aria-hidden="true">H</div>
      <p class="eyebrow">HAO APPS · PRO INVITATION</p>
      <h1>正在激活免费订阅</h1>
      <p class="invite-lead">正在为 ${escapeHtml(session.user.email || '当前账户')} 创建 Stripe 免费体验并同步 Pro 权益…</p>
    </div>`;
  try {
    const result = await callInvite('redeem', { token: inviteToken });
    localStorage.removeItem(STORAGE_KEY);
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
      <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.product_code)}.pro</small></span>
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
          <p>选择一个或多个 Pro 产品与免费时长。领取后每个产品都会创建真实 Stripe 订阅，免费期价格为 0，并从第一天开放订阅管理。</p>
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
      const resultBox = section.querySelector('#invite-result');
      resultBox.className = 'invite-result-ready';
      resultBox.innerHTML = `
        <strong>${escapeHtml((result.products || []).map((product) => product.name).join(' · '))}</strong>
        <span>${escapeHtml(formatDuration(result.duration_days))}免费体验 · Stripe 订阅</span>
        <div class="invite-link-row">
          <input id="invite-generated-link" type="text" readonly value="${escapeHtml(result.invite_url)}">
          <button id="invite-copy-link" class="button ghost compact" type="button">复制链接</button>
        </div>
        <small>领取人登录并确认领取后，会为每个所选产品建立 0 元 trial subscription；账户页从第一天提供“管理订阅”。</small>`;
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
