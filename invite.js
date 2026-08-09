import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

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
  if (days === null || days === undefined || days === '') return '永久';
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
  const queryToken = new URLSearchParams(window.location.search).get('invite')?.trim().toLowerCase() || '';
  if (queryToken) localStorage.setItem(STORAGE_KEY, queryToken);
  return queryToken || localStorage.getItem(STORAGE_KEY) || '';
}

const inviteToken = readInviteToken();
const inviteMode = Boolean(inviteToken);
window.__HAO_INVITE_MODE__ = inviteMode;

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
      <h1>你收到了一份 Pro 邀请</h1>
      <p class="invite-lead">登录共享 Hao Apps 账户即可领取。这个链接只能成功使用一次，免费时长从领取时开始计算。</p>
      ${message ? `<p class="invite-status" data-kind="error">${escapeHtml(message)}</p>` : ''}
      <button id="invite-login" class="button primary" type="button">使用 Google 登录并领取</button>
      <p class="invite-footnote">登录完成后会自动领取，并显示产品访问地址。</p>
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
      <h1>正在领取邀请</h1>
      <p class="invite-lead">正在为 ${escapeHtml(session.user.email || '当前账户')} 开通权益…</p>
    </div>`;
  try {
    const result = await callInvite('redeem', { token: inviteToken });
    const redemption = typeof result.redemption === 'string'
      ? JSON.parse(result.redemption)
      : (result.redemption || {});
    localStorage.removeItem(STORAGE_KEY);
    window.history.replaceState({}, '', ADMIN_URL);
    const entitlements = Array.isArray(redemption.entitlement_codes) ? redemption.entitlement_codes : [];
    const validity = redemption.valid_until ? `有效至 ${formatDate(redemption.valid_until)}` : '永久有效';
    root.innerHTML = `
      <div class="invite-card invite-success-card">
        <div class="invite-success-mark" aria-hidden="true">✓</div>
        <p class="eyebrow">INVITATION ACCEPTED</p>
        <h1>${escapeHtml(redemption.product_name || 'Pro')} 已开通</h1>
        <p class="invite-lead">${escapeHtml(result.user?.email || session.user.email || '')} · ${escapeHtml(validity)}</p>
        <div class="invite-entitlements">
          ${entitlements.map((code) => `<span>${escapeHtml(code)}</span>`).join('')}
        </div>
        <div class="invite-destination">
          <span>访问地址</span>
          <a href="${escapeHtml(redemption.app_url || '#')}" target="_blank" rel="noreferrer">${escapeHtml(redemption.app_url || '—')}</a>
        </div>
        <a class="button primary invite-open-button" href="${escapeHtml(redemption.app_url || '#')}" target="_blank" rel="noreferrer">打开产品</a>
      </div>`;
  } catch (error) {
    root.innerHTML = `
      <div class="invite-card">
        <div class="brand-mark" aria-hidden="true">H</div>
        <p class="eyebrow">HAO APPS · PRO INVITATION</p>
        <h1>这份邀请无法领取</h1>
        <p class="invite-status" data-kind="error">${escapeHtml(error.message)}</p>
        <p class="invite-footnote">一次性邀请被领取后不能再次使用。</p>
      </div>`;
  } finally {
    redeeming = false;
  }
}

function entitlementRows(catalog, productCode) {
  return (catalog.mappings || []).filter((item) => item.product_code === productCode);
}

function renderEntitlementOptions(catalog) {
  const product = document.querySelector('#invite-product');
  const target = document.querySelector('#invite-entitlements');
  if (!product || !target) return;
  const rows = entitlementRows(catalog, product.value);
  target.innerHTML = rows.length
    ? rows.map((item) => `
      <label class="invite-check">
        <input type="checkbox" name="invite-entitlement" value="${escapeHtml(item.entitlement_code)}" checked>
        <span>${escapeHtml(item.entitlement_code)}</span>
      </label>`).join('')
    : '<p class="empty-copy">这个产品还没有可邀请的权益映射。</p>';
}

function renderRecentInvites(catalog) {
  const target = document.querySelector('#invite-recent-list');
  if (!target) return;
  const productMap = new Map((catalog.products || []).map((item) => [item.product_code, item.name]));
  const rows = catalog.recent_invites || [];
  target.innerHTML = rows.length ? rows.map((item) => `
    <article class="invite-record">
      <div>
        <strong>${escapeHtml(productMap.get(item.product_code) || item.product_code)}</strong>
        <span>${escapeHtml((item.entitlement_codes || []).join(' · '))} · ${escapeHtml(formatDuration(item.duration_days))}</span>
      </div>
      <div class="invite-record-status">
        <span class="badge ${item.redeemed_at ? 'inactive' : 'active'}">${item.redeemed_at ? '已领取' : '可用'}</span>
        <small>${escapeHtml(item.redeemed_at ? formatDate(item.redeemed_at) : formatDate(item.created_at))}</small>
      </div>
    </article>`).join('') : '<p class="empty-copy">尚未生成邀请。</p>';
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
          <h2>一次性邀请</h2>
          <p>选择产品、权益与免费时长，生成一条只能成功领取一次的注册链接。</p>
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
                <option value="365">1 年</option>
                <option value="">永久</option>
              </select>
            </label>
            <fieldset class="invite-entitlement-fieldset full">
              <legend>权益</legend>
              <div id="invite-entitlements" class="invite-check-list"></div>
            </fieldset>
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
  renderEntitlementOptions(catalog);
  renderRecentInvites(catalog);
  productSelect.onchange = () => renderEntitlementOptions(catalog);

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
    const selected = [...section.querySelectorAll('input[name="invite-entitlement"]:checked')].map((item) => item.value);
    if (!selected.length) {
      status.textContent = '至少选择一项权益。';
      status.dataset.kind = 'error';
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = '正在生成一次性链接…';
    delete status.dataset.kind;
    try {
      const result = await callInvite('create', {
        product_code: productSelect.value,
        entitlement_codes: selected,
        duration_days: section.querySelector('#invite-duration').value === ''
          ? null
          : Number(section.querySelector('#invite-duration').value)
      });
      const resultBox = section.querySelector('#invite-result');
      resultBox.className = 'invite-result-ready';
      resultBox.innerHTML = `
        <strong>${escapeHtml(result.product?.name || result.product?.product_code || 'Pro')}</strong>
        <span>${escapeHtml(selected.join(' · '))} · ${escapeHtml(formatDuration(result.duration_days))}</span>
        <div class="invite-link-row">
          <input id="invite-generated-link" type="text" readonly value="${escapeHtml(result.invite_url)}">
          <button id="invite-copy-link" class="button ghost compact" type="button">复制链接</button>
        </div>
        <small>请现在复制并发送；刷新页面后无法恢复这条原始链接。</small>`;
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
