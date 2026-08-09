import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';

const config = Object.freeze({
  supabaseUrl: 'https://blgwlycfcwvsupmqyqwn.supabase.co',
  publishableKey: 'sb_publishable_n1Va-c_alpkQ0zNuJYUaxA_J0u68RVW',
  adminFunctionUrl: 'https://blgwlycfcwvsupmqyqwn.supabase.co/functions/v1/membership-admin',
  redirectUrl: 'https://liuh886.github.io/admin/'
});

const client = createClient(config.supabaseUrl, config.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
});

const state = {
  bootstrap: null,
  member: null,
  pendingPayment: null,
  pendingSubscription: null,
  busy: false,
  mfaMode: null,
  mfaFactorId: null
};

const $ = (selector) => document.querySelector(selector);
const els = {
  authGate: $('#auth-gate'), console: $('#console'), googleLogin: $('#google-login'),
  authStatus: $('#auth-status'), consoleStatus: $('#console-status'), signOut: $('#sign-out'),
  operatorEmail: $('#operator-email'), operatorRole: $('#operator-role'),
  statUsers: $('#stat-users'), statSubscriptions: $('#stat-subscriptions'),
  statGrants: $('#stat-grants'), statActions: $('#stat-actions'),
  searchForm: $('#member-search'), searchEmail: $('#search-email'),
  emptyWorkspace: $('#empty-workspace'), memberWorkspace: $('#member-workspace'),
  memberEmail: $('#member-email'), memberMeta: $('#member-meta'), memberTier: $('#member-tier'),
  giftForm: $('#gift-form'), giftProduct: $('#gift-product'), giftDuration: $('#gift-duration'),
  giftReason: $('#gift-reason'), entitlementList: $('#entitlement-list'), grantList: $('#grant-list'),
  subscriptionList: $('#subscription-list'), paymentList: $('#payment-list'),
  activityList: $('#activity-list'), recentActions: $('#recent-actions'),
  refundDialog: $('#refund-dialog'), refundForm: $('#refund-form'), refundSummary: $('#refund-summary'),
  refundCurrency: $('#refund-currency'), refundAmount: $('#refund-amount'), refundReason: $('#refund-reason'),
  refundSubscriptionAction: $('#refund-subscription-action'), refundSubscription: $('#refund-subscription'),
  refundConfirmation: $('#refund-confirmation'), cancelDialog: $('#cancel-dialog'),
  cancelForm: $('#cancel-form'), cancelSummary: $('#cancel-summary'), cancelMode: $('#cancel-mode'),
  cancelConfirmation: $('#cancel-confirmation')
};

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

function formatMoney(amount, currency = 'usd') {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency', currency: String(currency).toUpperCase()
  }).format(Number(amount || 0) / 100);
}

function setStatus(element, message = '', kind = '') {
  element.textContent = message;
  if (kind) element.dataset.kind = kind;
  else delete element.dataset.kind;
}

function setBusy(value, message = '') {
  state.busy = Boolean(value);
  document.querySelectorAll('button, input, select').forEach((element) => {
    element.disabled = state.busy;
  });
  if (message) setStatus(els.consoleStatus, message);
}

function ensureMfaPanel() {
  let panel = document.getElementById('admin-mfa-panel');
  if (panel) return panel;
  panel = document.createElement('section');
  panel.id = 'admin-mfa-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="mfa-copy">
      <p class="eyebrow">ADMIN · AAL2</p>
      <h2 id="admin-mfa-title">管理员二次验证</h2>
      <p id="admin-mfa-copy">管理操作需要验证器提供的一次性验证码。</p>
    </div>
    <div id="admin-mfa-enrollment" hidden>
      <img id="admin-mfa-qr" alt="扫描二维码绑定验证器" style="width:min(196px,100%);height:auto;border-radius:12px;background:white;padding:8px">
      <p class="status-line">使用 Google Authenticator、1Password、Microsoft Authenticator 等扫描二维码。</p>
    </div>
    <form id="admin-mfa-form">
      <label>
        <span>6 位验证码</span>
        <input id="admin-mfa-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
      </label>
      <button id="admin-mfa-submit" class="button primary" type="submit">验证并进入</button>
    </form>
    <div class="dialog-actions">
      <button id="admin-mfa-setup" class="button ghost" type="button">设置验证器</button>
      <button id="admin-mfa-signout" class="button ghost" type="button">退出此账户</button>
    </div>
  `;
  els.authGate.appendChild(panel);

  $('#admin-mfa-setup').addEventListener('click', () => void startMfaEnrollment());
  $('#admin-mfa-signout').addEventListener('click', async () => {
    await client.auth.signOut();
    resetMfaGate();
    showGate('已退出管理员账户。', 'success');
  });
  $('#admin-mfa-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void verifyMfa($('#admin-mfa-code').value.trim());
  });
  return panel;
}

function resetMfaGate() {
  state.mfaMode = null;
  state.mfaFactorId = null;
  const panel = ensureMfaPanel();
  panel.hidden = true;
  els.googleLogin.hidden = false;
  const qr = $('#admin-mfa-qr');
  if (qr) qr.removeAttribute('src');
  const enrollment = $('#admin-mfa-enrollment');
  if (enrollment) enrollment.hidden = true;
  const form = $('#admin-mfa-form');
  if (form) form.hidden = false;
  const setup = $('#admin-mfa-setup');
  if (setup) setup.hidden = false;
  const code = $('#admin-mfa-code');
  if (code) code.value = '';
}

async function startMfaEnrollment() {
  setStatus(els.authStatus, '正在创建验证器绑定…');
  const { data: factors, error: listError } = await client.auth.mfa.listFactors();
  if (listError) {
    setStatus(els.authStatus, listError.message, 'error');
    return;
  }
  for (const factor of factors.all || []) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      try { await client.auth.mfa.unenroll({ factorId: factor.id }); } catch { /* stale enrollment */ }
    }
  }
  const { data, error } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Hao Apps Admin'
  });
  if (error) {
    setStatus(els.authStatus, error.message, 'error');
    return;
  }
  state.mfaMode = 'enroll';
  state.mfaFactorId = data.id;
  ensureMfaPanel().hidden = false;
  $('#admin-mfa-title').textContent = '绑定管理员验证器';
  $('#admin-mfa-copy').textContent = '扫描二维码后输入验证器生成的 6 位验证码。绑定成功后本次会话升级为 AAL2。';
  $('#admin-mfa-enrollment').hidden = false;
  $('#admin-mfa-qr').src = data.totp.qr_code;
  $('#admin-mfa-form').hidden = false;
  $('#admin-mfa-setup').hidden = true;
  $('#admin-mfa-code').focus();
  setStatus(els.authStatus, '二维码已生成。完成绑定后才能进入运营控制台。');
}

async function verifyMfa(code) {
  if (!state.mfaFactorId || !/^\d{6}$/.test(code)) {
    setStatus(els.authStatus, '请输入验证器中的 6 位验证码。', 'error');
    return;
  }
  setStatus(els.authStatus, '正在验证 AAL2…');
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
    factorId: state.mfaFactorId
  });
  if (challengeError) {
    setStatus(els.authStatus, challengeError.message, 'error');
    return;
  }
  const { error } = await client.auth.mfa.verify({
    factorId: state.mfaFactorId,
    challengeId: challenge.id,
    code
  });
  if (error) {
    setStatus(els.authStatus, error.message, 'error');
    return;
  }
  await secureBootstrap();
}

async function requireAal2Gate() {
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (data.currentLevel === 'aal2') {
    resetMfaGate();
    return true;
  }

  const panel = ensureMfaPanel();
  panel.hidden = false;
  els.googleLogin.hidden = true;
  const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
  if (factorsError) throw factorsError;
  const verifiedTotp = (factors.totp || []).find((factor) => factor.status === 'verified') || factors.totp?.[0];
  if (verifiedTotp) {
    state.mfaMode = 'challenge';
    state.mfaFactorId = verifiedTotp.id;
    $('#admin-mfa-title').textContent = '管理员二次验证';
    $('#admin-mfa-copy').textContent = '输入验证器生成的 6 位验证码后进入运营控制台。';
    $('#admin-mfa-enrollment').hidden = true;
    $('#admin-mfa-form').hidden = false;
    $('#admin-mfa-setup').hidden = true;
    $('#admin-mfa-code').focus();
    setStatus(els.authStatus, '此管理员账户已启用 MFA，需要完成二次验证。');
  } else {
    state.mfaMode = 'setup';
    state.mfaFactorId = null;
    $('#admin-mfa-title').textContent = '先启用管理员二次验证';
    $('#admin-mfa-copy').textContent = '此控制台可以赠送会员、取消订阅和退款。首次进入需要绑定一个 TOTP 验证器。';
    $('#admin-mfa-enrollment').hidden = true;
    $('#admin-mfa-form').hidden = true;
    $('#admin-mfa-setup').hidden = false;
    setStatus(els.authStatus, '管理员控制台要求 AAL2。请先绑定验证器。');
  }
  return false;
}

async function callAdmin(action, payload = {}) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('登录会话不可用，请重新登录。');
  const response = await fetch(config.adminFunctionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: config.publishableKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action, ...payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `管理请求失败（${response.status}）`);
  return result;
}

async function secureBootstrap() {
  try {
    showGate('正在验证管理员权限…');
    const bootstrapData = await callAdmin('bootstrap');
    const ready = await requireAal2Gate();
    if (!ready) return;
    state.bootstrap = bootstrapData;
    renderBootstrap();
    showConsole();
    setStatus(els.consoleStatus, '运营台已连接 Live Mode · AAL2。', 'success');
  } catch (error) {
    resetMfaGate();
    showGate(error.message || '管理员身份验证失败。', 'error');
  }
}

function showGate(message = '', kind = '') {
  els.authGate.hidden = false;
  els.console.hidden = true;
  setStatus(els.authStatus, message, kind);
}

function showConsole() {
  els.authGate.hidden = true;
  els.console.hidden = false;
}

function renderBootstrap() {
  const data = state.bootstrap;
  if (!data) return;
  els.operatorEmail.textContent = data.actor.email || data.actor.id;
  els.operatorRole.textContent = `${data.actor.role} · AAL2`;
  els.statUsers.textContent = data.counts.users;
  els.statSubscriptions.textContent = data.counts.active_subscriptions;
  els.statGrants.textContent = data.counts.active_grants;
  els.statActions.textContent = data.counts.admin_actions;
  els.giftProduct.innerHTML = [
    '<option value="all">全部产品 · Hao Apps</option>',
    ...(data.products || []).map((product) => `<option value="${escapeHtml(product.product_code)}">${escapeHtml(product.name)}</option>`)
  ].join('');
  const recent = data.recent_actions || [];
  els.recentActions.innerHTML = recent.length
    ? recent.map((item) => `
      <article class="recent-item">
        <span>${escapeHtml(formatDate(item.created_at))}</span>
        <strong>${escapeHtml(item.action_type)} · ${escapeHtml(item.target_email || 'system')}</strong>
        <span>${escapeHtml(item.product_code || item.reason || item.status)}</span>
      </article>`).join('')
    : '<p class="empty-copy">尚无管理操作。</p>';
}

function groupGrants(grants) {
  const groups = new Map();
  for (const grant of grants || []) {
    const key = `${grant.source}:${grant.source_ref}`;
    if (!groups.has(key)) groups.set(key, { ...grant, entitlements: [] });
    groups.get(key).entitlements.push(grant.entitlement_code);
    if (!grant.active) groups.get(key).active = false;
  }
  return [...groups.values()];
}

function renderEntitlements(member) {
  const active = (member.entitlements || []).filter((item) => item.active);
  els.entitlementList.innerHTML = active.length
    ? active.map((item) => `<span class="chip" title="${escapeHtml(item.valid_until ? `有效至 ${formatDate(item.valid_until)}` : '永久有效')}">${escapeHtml(item.entitlement_code)}</span>`).join('')
    : '<p class="empty-copy">当前没有有效的 Pro 权益。</p>';
  els.memberTier.textContent = active.length ? 'PRO' : 'FREE';
  els.memberTier.classList.toggle('is-pro', active.length > 0);
}

function renderGrants(member) {
  const groups = groupGrants(member.grants);
  els.grantList.innerHTML = groups.length ? groups.map((grant) => {
    const isManual = grant.source === 'manual_gift';
    return `
      <article class="record">
        <div class="record-main">
          <div class="record-title">
            <span>${escapeHtml(grant.entitlements.join(' · '))}</span>
            <span class="badge ${escapeHtml(grant.source)}">${escapeHtml(grant.source)}</span>
            <span class="badge ${grant.active ? 'active' : 'inactive'}">${grant.active ? '有效' : '已撤销'}</span>
          </div>
          <div class="record-meta">
            <span>${grant.valid_until ? `有效至 ${escapeHtml(formatDate(grant.valid_until))}` : '永久有效'}</span>
            <span>${escapeHtml(grant.source_ref)}</span>
            ${grant.metadata?.reason ? `<span>${escapeHtml(grant.metadata.reason)}</span>` : ''}
          </div>
        </div>
        <div class="record-actions">
          ${isManual && grant.active ? `
            <button class="mini-button" type="button" data-action="extend" data-source-ref="${escapeHtml(grant.source_ref)}" data-days="30">+30 天</button>
            <button class="mini-button" type="button" data-action="extend" data-source-ref="${escapeHtml(grant.source_ref)}" data-days="365">+1 年</button>
            <button class="mini-button danger" type="button" data-action="revoke" data-source-ref="${escapeHtml(grant.source_ref)}">撤销</button>` : ''}
        </div>
      </article>`;
  }).join('') : '<p class="empty-copy">没有授权来源记录。</p>';
}

function renderSubscriptions(member) {
  const subscriptions = member.subscriptions || [];
  els.subscriptionList.innerHTML = subscriptions.length ? subscriptions.map((subscription) => `
    <article class="record">
      <div class="record-main">
        <div class="record-title">
          <span>${escapeHtml(subscription.product_code)}</span>
          <span class="badge ${escapeHtml(subscription.status)}">${escapeHtml(subscription.status)}</span>
          ${subscription.cancel_at_period_end ? '<span class="badge canceled">期末取消</span>' : ''}
        </div>
        <div class="record-meta">
          <span>${escapeHtml(subscription.id)}</span>
          <span>周期结束 ${escapeHtml(formatDate(subscription.current_period_end))}</span>
        </div>
      </div>
      <div class="record-actions">
        ${['active', 'trialing', 'past_due'].includes(subscription.status) ? `<button class="mini-button danger" type="button" data-action="cancel" data-subscription-id="${escapeHtml(subscription.id)}">取消订阅</button>` : ''}
      </div>
    </article>`).join('') : '<p class="empty-copy">没有 Stripe 订阅。</p>';
}

function renderPayments(member) {
  const payments = member.payments || [];
  els.paymentList.innerHTML = payments.length ? payments.map((payment) => {
    const remaining = Math.max(0, payment.amount - payment.amount_refunded);
    return `
      <article class="record">
        <div class="record-main">
          <div class="record-title">
            <span>${escapeHtml(formatMoney(payment.amount, payment.currency))}</span>
            <span class="badge ${escapeHtml(payment.status)}">${escapeHtml(payment.status)}</span>
            ${payment.amount_refunded ? `<span class="badge">已退 ${escapeHtml(formatMoney(payment.amount_refunded, payment.currency))}</span>` : ''}
          </div>
          <div class="record-meta">
            <span>${escapeHtml(formatDate(payment.created_at))}</span>
            <span>${escapeHtml(payment.payment_intent)}</span>
            ${payment.receipt_url ? `<a href="${escapeHtml(payment.receipt_url)}" target="_blank" rel="noreferrer">收据</a>` : ''}
          </div>
        </div>
        <div class="record-actions">
          ${remaining > 0 && payment.payment_intent ? `<button class="mini-button danger" type="button" data-action="refund" data-payment-intent="${escapeHtml(payment.payment_intent)}">退款</button>` : ''}
        </div>
      </article>`;
  }).join('') : '<p class="empty-copy">没有可显示的 Stripe 付款。</p>';
}

function renderActivity(member) {
  const actions = member.actions || [];
  els.activityList.innerHTML = actions.length ? actions.map((item) => `
    <article class="record">
      <div class="record-main">
        <div class="record-title"><span>${escapeHtml(item.action_type)}</span><span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></div>
        <div class="record-meta">
          <span>${escapeHtml(formatDate(item.created_at))}</span>
          <span>${escapeHtml(item.product_code || item.reason || '')}</span>
          ${item.amount ? `<span>${escapeHtml(formatMoney(item.amount, item.currency))}</span>` : ''}
        </div>
      </div>
    </article>`).join('') : '<p class="empty-copy">该用户尚无管理操作。</p>';
}

function renderMember() {
  const member = state.member;
  if (!member) {
    els.memberWorkspace.hidden = true;
    els.emptyWorkspace.hidden = false;
    return;
  }
  els.emptyWorkspace.hidden = true;
  els.memberWorkspace.hidden = false;
  els.memberEmail.textContent = member.user.email || member.user.id;
  els.memberMeta.textContent = `注册 ${formatDate(member.user.created_at)} · 最近登录 ${formatDate(member.user.last_sign_in_at)} · Stripe ${member.customer?.customer_id || '未建立'}`;
  renderEntitlements(member);
  renderGrants(member);
  renderSubscriptions(member);
  renderPayments(member);
  renderActivity(member);
}

async function refreshMember() {
  if (!state.member?.user?.id) return;
  state.member = await callAdmin('search_user', { user_id: state.member.user.id });
  renderMember();
}

async function refreshBootstrap() {
  state.bootstrap = await callAdmin('bootstrap');
  renderBootstrap();
}

els.googleLogin.addEventListener('click', async () => {
  setStatus(els.authStatus, '正在跳转 Google…');
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo: config.redirectUrl }
  });
  if (error) setStatus(els.authStatus, error.message, 'error');
});

els.signOut.addEventListener('click', async () => {
  await client.auth.signOut();
  state.member = null;
  state.bootstrap = null;
  resetMfaGate();
  showGate('已退出管理员账户。', 'success');
});

els.searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setBusy(true, '正在检索用户与 Stripe 记录…');
  try {
    state.member = await callAdmin('search_user', { email: els.searchEmail.value.trim() });
    renderMember();
    setStatus(els.consoleStatus, `已打开 ${state.member.user.email}。`, 'success');
  } catch (error) {
    setStatus(els.consoleStatus, error.message, 'error');
  } finally {
    setBusy(false);
  }
});

els.giftForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.member) return;
  const productName = els.giftProduct.options[els.giftProduct.selectedIndex]?.textContent || els.giftProduct.value;
  if (!window.confirm(`确认向 ${state.member.user.email} 赠送 ${productName}？`)) return;
  setBusy(true, '正在写入人工授权…');
  try {
    const result = await callAdmin('grant', {
      user_id: state.member.user.id,
      product_code: els.giftProduct.value,
      duration_days: els.giftDuration.value === '' ? null : Number(els.giftDuration.value),
      reason: els.giftReason.value.trim()
    });
    state.member = result.member;
    renderMember();
    await refreshBootstrap();
    setStatus(els.consoleStatus, '会员赠送已生效。', 'success');
  } catch (error) {
    setStatus(els.consoleStatus, error.message, 'error');
  } finally {
    setBusy(false);
  }
});

els.grantList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || !state.member) return;
  const sourceRef = button.dataset.sourceRef;
  const action = button.dataset.action;
  const days = Number(button.dataset.days || 0);
  if (action === 'extend' && !window.confirm(`确认延长 ${days} 天？`)) return;
  if (action === 'revoke' && !window.confirm('确认撤销这份人工赠送？其他 Stripe 或赠送来源不会受影响。')) return;
  setBusy(true, action === 'extend' ? '正在延长赠送权益…' : '正在撤销赠送权益…');
  try {
    const result = action === 'extend'
      ? await callAdmin('extend_grant', { user_id: state.member.user.id, source_ref: sourceRef, duration_days: days })
      : await callAdmin('revoke_grant', { user_id: state.member.user.id, source_ref: sourceRef, reason: 'Revoked from membership operations console' });
    state.member = result.member;
    renderMember();
    await refreshBootstrap();
    setStatus(els.consoleStatus, action === 'extend' ? `已延长 ${days} 天。` : '人工赠送已撤销。', 'success');
  } catch (error) {
    setStatus(els.consoleStatus, error.message, 'error');
  } finally {
    setBusy(false);
  }
});

els.subscriptionList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="cancel"]');
  if (!button || !state.member) return;
  state.pendingSubscription = state.member.subscriptions.find((item) => item.id === button.dataset.subscriptionId);
  if (!state.pendingSubscription) return;
  els.cancelSummary.textContent = `${state.member.user.email} · ${state.pendingSubscription.product_code} · ${state.pendingSubscription.id}`;
  els.cancelMode.value = 'period_end';
  els.cancelConfirmation.value = '';
  els.cancelDialog.showModal();
});

els.paymentList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="refund"]');
  if (!button || !state.member) return;
  state.pendingPayment = state.member.payments.find((item) => item.payment_intent === button.dataset.paymentIntent);
  if (!state.pendingPayment) return;
  const remaining = Math.max(0, state.pendingPayment.amount - state.pendingPayment.amount_refunded);
  els.refundSummary.textContent = `${state.member.user.email} · ${state.pendingPayment.payment_intent} · 可退 ${formatMoney(remaining, state.pendingPayment.currency)}`;
  els.refundCurrency.textContent = state.pendingPayment.currency.toUpperCase();
  els.refundAmount.value = (remaining / 100).toFixed(2);
  els.refundAmount.max = (remaining / 100).toFixed(2);
  els.refundConfirmation.value = '';
  els.refundSubscription.innerHTML = [
    '<option value="">不关联订阅</option>',
    ...(state.member.subscriptions || []).map((subscription) => `<option value="${escapeHtml(subscription.id)}">${escapeHtml(subscription.product_code)} · ${escapeHtml(subscription.status)}</option>`)
  ].join('');
  const active = state.member.subscriptions.find((subscription) => ['active', 'trialing', 'past_due'].includes(subscription.status));
  els.refundSubscription.value = active?.id || '';
  els.refundSubscriptionAction.value = active ? 'cancel_now' : 'keep';
  els.refundDialog.showModal();
});

els.refundForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    els.refundDialog.close();
    return;
  }
  if (!state.member || !state.pendingPayment) return;
  if (els.refundConfirmation.value !== 'REFUND') {
    setStatus(els.consoleStatus, '请输入 REFUND 确认退款。', 'error');
    return;
  }
  setBusy(true, '正在向 Stripe 提交退款…');
  try {
    await callAdmin('refund', {
      user_id: state.member.user.id,
      payment_intent: state.pendingPayment.payment_intent,
      amount: Math.round(Number(els.refundAmount.value) * 100),
      refund_reason: els.refundReason.value,
      subscription_id: els.refundSubscription.value || null,
      subscription_action: els.refundSubscriptionAction.value,
      confirmation: els.refundConfirmation.value,
      reason: 'Refund from membership operations console'
    });
    els.refundDialog.close();
    await refreshMember();
    await refreshBootstrap();
    setStatus(els.consoleStatus, '退款请求已提交，Stripe 状态已刷新。', 'success');
  } catch (error) {
    setStatus(els.consoleStatus, error.message, 'error');
  } finally {
    setBusy(false);
  }
});

els.cancelForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    els.cancelDialog.close();
    return;
  }
  if (!state.member || !state.pendingSubscription) return;
  if (els.cancelConfirmation.value !== 'CANCEL') {
    setStatus(els.consoleStatus, '请输入 CANCEL 确认取消。', 'error');
    return;
  }
  setBusy(true, '正在更新 Stripe 订阅…');
  try {
    await callAdmin('cancel_subscription', {
      user_id: state.member.user.id,
      subscription_id: state.pendingSubscription.id,
      mode: els.cancelMode.value,
      confirmation: els.cancelConfirmation.value,
      reason: 'Cancellation from membership operations console'
    });
    els.cancelDialog.close();
    await refreshMember();
    await refreshBootstrap();
    setStatus(els.consoleStatus, '订阅取消设置已提交。', 'success');
  } catch (error) {
    setStatus(els.consoleStatus, error.message, 'error');
  } finally {
    setBusy(false);
  }
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('is-active', item === tab));
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.panel === tab.dataset.tab);
    });
  });
});

for (const dialog of [els.refundDialog, els.cancelDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

ensureMfaPanel();

client.auth.onAuthStateChange((_event, session) => {
  if (session) window.setTimeout(() => void secureBootstrap(), 0);
  else {
    resetMfaGate();
    showGate();
  }
});

const { data, error } = await client.auth.getSession();
if (error) showGate(error.message, 'error');
else if (data.session) await secureBootstrap();
else showGate();
