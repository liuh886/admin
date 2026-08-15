import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

for (const href of ['./feedback-admin.css', './buchikui-feedback-admin.css']) {
  if (!document.querySelector(`link[href="${href}"]`)) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = href;
    document.head.appendChild(stylesheet);
  }
}

const config = Object.freeze({
  supabaseUrl: 'https://blgwlycfcwvsupmqyqwn.supabase.co',
  publishableKey: 'sb_publishable_n1Va-c_alpkQ0zNuJYUaxA_J0u68RVW',
  feedbackFunctionUrl: 'https://blgwlycfcwvsupmqyqwn.supabase.co/functions/v1/feedback-admin'
});

const client = createClient(config.supabaseUrl, config.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' }
});

const STATUS_LABELS = Object.freeze({
  new: '新反馈',
  reviewing: '处理中',
  planned: '已规划',
  resolved: '已解决',
  closed: '已关闭'
});

const BUCHIKUI_STATUS_LABELS = Object.freeze({
  new: '待审',
  reviewing: '评审中',
  planned: '已采纳 · 待改稿',
  resolved: '已吸纳',
  closed: '不采纳'
});

const CATEGORY_LABELS = Object.freeze({
  general: '一般反馈',
  idea: '功能建议',
  bug: '问题报告',
  content: '内容反馈',
  other: '其他'
});

const BUCHIKUI_FEEDBACK_TYPES = Object.freeze({
  experience: '亲身经历',
  correction: '信息纠错',
  process: '流程补充',
  other: '其他'
});

const KNOWN_PRODUCTS = Object.freeze([
  ['alpha_engine', 'AlphaEngine'],
  ['ownly', 'Ownly'],
  ['newsflow', 'NewsFlow'],
  ['rhythmcoach', 'RhythmCoach'],
  ['flappyk', 'FlappyK'],
  ['buchikui', '不吃亏']
]);

const state = {
  loading: false,
  actor: null,
  feedback: [],
  nextCursor: null,
  products: [],
  counts: {},
  filters: { product_code: 'all', status: 'all', category: 'all' }
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function safeUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function initials(item) {
  const source = item.display_name || item.user_email || item.user_id || '?';
  return String(source).trim().slice(0, 1).toUpperCase();
}

function productLabel(code) {
  return KNOWN_PRODUCTS.find(([value]) => value === code)?.[1] || code;
}

function isBuchikuiAnchored(item) {
  return item?.product_code === 'buchikui'
    && item?.metadata?.kind === 'anchored_consumer_experience';
}

function statusLabelsFor(item) {
  return isBuchikuiAnchored(item) ? BUCHIKUI_STATUS_LABELS : STATUS_LABELS;
}

function categoryLabelFor(item) {
  if (!isBuchikuiAnchored(item)) return CATEGORY_LABELS[item.category] || item.category;
  return BUCHIKUI_FEEDBACK_TYPES[item.metadata?.feedback_type] || '消费者经验';
}

function renderAnchoredContext(item) {
  if (!isBuchikuiAnchored(item)) return '';
  const metadata = item.metadata || {};
  const exact = metadata.target?.quote?.exact || '';
  const anchor = metadata.anchor_label || metadata.anchor_key || '';
  const caseId = metadata.case_id ? `CASE ${metadata.case_id}` : 'CASE';
  const caseName = metadata.case_name || metadata.case_slug || '';
  const caseUpdated = metadata.case_updated || '';
  const type = BUCHIKUI_FEEDBACK_TYPES[metadata.feedback_type] || '消费者经验';
  return `
    <section class="feedback-context-card" aria-label="不吃亏段落上下文">
      <div class="feedback-context-meta">
        <strong>${escapeHtml(caseId)}${caseName ? ` · ${escapeHtml(caseName)}` : ''}</strong>
        ${caseUpdated ? `<span>正文版本 ${escapeHtml(caseUpdated)}</span>` : ''}
        <span class="feedback-context-kind">${escapeHtml(type)}</span>
      </div>
      ${anchor ? `<code class="feedback-context-anchor">${escapeHtml(metadata.anchor_key || anchor)}${metadata.anchor_label && metadata.anchor_label !== metadata.anchor_key ? ` · ${escapeHtml(metadata.anchor_label)}` : ''}</code>` : ''}
      ${exact ? `<blockquote>“${escapeHtml(exact)}”</blockquote>` : ''}
    </section>`;
}

function injectSection() {
  if (document.getElementById('feedback-inbox')) return;
  const consoleElement = document.getElementById('console');
  if (!consoleElement) return;

  const section = document.createElement('section');
  section.id = 'feedback-inbox';
  section.className = 'feedback-section';
  section.setAttribute('aria-labelledby', 'feedback-inbox-title');
  section.innerHTML = `
    <div class="feedback-heading">
      <div>
        <p class="eyebrow">PRODUCT FEEDBACK</p>
        <h2 id="feedback-inbox-title">用户反馈收件箱</h2>
        <p>集中查看已登录用户提交的反馈。处理状态和内部备注只对管理员可见，不会返回到产品端。</p>
      </div>
      <button id="feedback-refresh" class="button ghost compact" type="button">刷新反馈</button>
    </div>

    <section class="feedback-kpis" aria-label="反馈状态概览">
      <article><span>新反馈</span><strong id="feedback-count-new">—</strong></article>
      <article><span>处理中</span><strong id="feedback-count-reviewing">—</strong></article>
      <article><span>已规划</span><strong id="feedback-count-planned">—</strong></article>
      <article><span>已解决</span><strong id="feedback-count-resolved">—</strong></article>
      <article><span>已关闭</span><strong id="feedback-count-closed">—</strong></article>
    </section>

    <div class="feedback-controls">
      <label><span>产品</span><select id="feedback-filter-product"><option value="all">全部产品</option></select></label>
      <label><span>状态</span>
        <select id="feedback-filter-status">
          <option value="all">全部状态</option>
          <option value="new">新反馈</option>
          <option value="reviewing">处理中</option>
          <option value="planned">已规划</option>
          <option value="resolved">已解决</option>
          <option value="closed">已关闭</option>
        </select>
      </label>
      <label><span>类别</span>
        <select id="feedback-filter-category">
          <option value="all">全部类别</option>
          <option value="general">一般反馈</option>
          <option value="idea">功能建议</option>
          <option value="bug">问题报告</option>
          <option value="content">内容反馈</option>
          <option value="other">其他</option>
        </select>
      </label>
      <button id="feedback-apply-filters" class="button primary" type="button">应用筛选</button>
    </div>

    <p id="feedback-status" class="status-line" role="status" aria-live="polite"></p>
    <div id="feedback-list" class="feedback-list"></div>
    <div class="feedback-load-more"><button id="feedback-load-more" class="button ghost compact" type="button" hidden>加载更多</button></div>
  `;

  const recentSection = consoleElement.querySelector('.recent-section');
  consoleElement.insertBefore(section, recentSection || null);
}

injectSection();

const $ = (selector) => document.querySelector(selector);
const els = {
  section: $('#feedback-inbox'),
  refresh: $('#feedback-refresh'),
  status: $('#feedback-status'),
  list: $('#feedback-list'),
  loadMore: $('#feedback-load-more'),
  applyFilters: $('#feedback-apply-filters'),
  productFilter: $('#feedback-filter-product'),
  statusFilter: $('#feedback-filter-status'),
  categoryFilter: $('#feedback-filter-category'),
  counts: {
    new: $('#feedback-count-new'),
    reviewing: $('#feedback-count-reviewing'),
    planned: $('#feedback-count-planned'),
    resolved: $('#feedback-count-resolved'),
    closed: $('#feedback-count-closed')
  }
};

function setStatus(message = '', kind = '') {
  if (!els.status) return;
  els.status.textContent = message;
  if (kind) els.status.dataset.kind = kind;
  else delete els.status.dataset.kind;
}

function setLoading(value) {
  state.loading = Boolean(value);
  for (const element of [els.refresh, els.loadMore, els.applyFilters]) {
    if (element) element.disabled = state.loading;
  }
}

async function callFeedback(action, payload = {}) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('登录会话不可用，请重新登录。');
  const response = await fetch(config.feedbackFunctionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: config.publishableKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action, ...payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `反馈管理请求失败（${response.status}）`);
  return result;
}

function renderCounts() {
  for (const [status, element] of Object.entries(els.counts)) {
    if (element) element.textContent = new Intl.NumberFormat('zh-CN').format(Number(state.counts[status] || 0));
  }
}

function renderProductOptions() {
  if (!els.productFilter) return;
  const selected = state.filters.product_code;
  const codes = [...new Set([
    ...KNOWN_PRODUCTS.map(([code]) => code),
    ...state.products
  ])].sort((a, b) => productLabel(a).localeCompare(productLabel(b)));
  els.productFilter.innerHTML = [
    '<option value="all">全部产品</option>',
    ...codes.map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(productLabel(code))}</option>`)
  ].join('');
  els.productFilter.value = codes.includes(selected) ? selected : 'all';
}

function renderFeedback() {
  if (!els.list) return;
  const canUpdate = ['owner', 'operator'].includes(String(state.actor?.role));
  if (!state.feedback.length) {
    els.list.innerHTML = '<div class="feedback-empty">当前筛选条件下没有反馈。</div>';
    return;
  }

  els.list.innerHTML = state.feedback.map((item) => {
    const source = safeUrl(item.page_url);
    const avatar = safeUrl(item.avatar_url);
    const identity = item.display_name || item.user_email || item.user_id;
    const secondary = item.user_email && item.display_name ? item.user_email : item.user_id;
    const statusLabels = statusLabelsFor(item);
    const notePlaceholder = isBuchikuiAnchored(item)
      ? '记录判断；吸纳后可写对应 PR / commit 或关闭原因'
      : '记录判断、后续动作或关闭原因';
    return `
      <article class="feedback-card" data-feedback-id="${escapeHtml(item.id)}">
        <header class="feedback-card-header">
          <div class="feedback-identity">
            <div class="feedback-avatar">${avatar
              ? `<img src="${escapeHtml(avatar)}" alt="">`
              : escapeHtml(initials(item))}</div>
            <div>
              <strong>${escapeHtml(identity)}</strong>
              <span>${escapeHtml(secondary)}</span>
              <span class="feedback-time">提交于 ${escapeHtml(formatDate(item.created_at))}${item.reviewed_at ? ` · 最近处理 ${escapeHtml(formatDate(item.reviewed_at))}` : ''}</span>
            </div>
          </div>
          <div class="feedback-badges">
            <span class="feedback-badge">${escapeHtml(productLabel(item.product_code))}</span>
            <span class="feedback-badge">${escapeHtml(categoryLabelFor(item))}</span>
            <span class="feedback-badge" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</span>
          </div>
        </header>
        <div class="feedback-card-body">
          ${renderAnchoredContext(item)}
          ${isBuchikuiAnchored(item) ? '<span class="feedback-message-label">消费者补充</span>' : ''}
          <p class="feedback-message">${escapeHtml(item.message)}</p>
          ${source ? `<a class="feedback-source" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">来源页面：${escapeHtml(source)}</a>` : ''}
        </div>
        <div class="feedback-operations">
          <label><span>处理状态</span>
            <select data-feedback-status ${canUpdate ? '' : 'disabled'}>
              ${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${item.status === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <label><span>内部备注</span><textarea data-feedback-note maxlength="2000" ${canUpdate ? '' : 'disabled'} placeholder="${escapeHtml(notePlaceholder)}">${escapeHtml(item.admin_note || '')}</textarea></label>
          <button class="button primary compact" type="button" data-feedback-save ${canUpdate ? '' : 'disabled'}>保存处理</button>
        </div>
      </article>`;
  }).join('');
}

async function loadFeedback({ append = false } = {}) {
  if (state.loading) return;
  setLoading(true);
  setStatus(append ? '正在加载更多反馈…' : '正在载入反馈收件箱…');
  try {
    const result = await callFeedback('list', {
      ...state.filters,
      before: append ? state.nextCursor : null,
      limit: 50
    });
    state.actor = result.actor || state.actor;
    state.feedback = append
      ? [...state.feedback, ...(result.feedback || [])]
      : (result.feedback || []);
    state.nextCursor = result.next_cursor || null;
    state.products = result.products || state.products;
    state.counts = result.counts || {};
    renderCounts();
    renderProductOptions();
    renderFeedback();
    if (els.loadMore) els.loadMore.hidden = !state.nextCursor;
    setStatus(`已载入 ${state.feedback.length} 条反馈${result.total !== undefined ? ` · 当前筛选共 ${result.total} 条` : ''}。`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

async function saveFeedback(card, button) {
  if (state.loading) return;
  const feedbackId = card.dataset.feedbackId;
  const status = card.querySelector('[data-feedback-status]')?.value;
  const adminNote = card.querySelector('[data-feedback-note]')?.value || '';
  if (!feedbackId || !status) return;

  let saved = false;
  setLoading(true);
  button.textContent = '保存中…';
  setStatus('正在保存反馈处理状态…');
  try {
    const result = await callFeedback('update', {
      feedback_id: feedbackId,
      status,
      admin_note: adminNote
    });
    const index = state.feedback.findIndex((item) => item.id === feedbackId);
    if (index >= 0) state.feedback[index] = { ...state.feedback[index], ...result.feedback };
    renderFeedback();
    saved = true;
    setStatus('反馈处理状态已保存，并写入管理审计记录。', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    button.textContent = '保存处理';
    setLoading(false);
  }

  if (saved) await loadFeedback({ append: false });
}

els.applyFilters?.addEventListener('click', () => {
  state.filters = {
    product_code: els.productFilter?.value || 'all',
    status: els.statusFilter?.value || 'all',
    category: els.categoryFilter?.value || 'all'
  };
  state.nextCursor = null;
  void loadFeedback();
});

els.refresh?.addEventListener('click', () => {
  state.nextCursor = null;
  void loadFeedback();
});

els.loadMore?.addEventListener('click', () => void loadFeedback({ append: true }));

els.list?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-feedback-save]');
  const card = button?.closest('[data-feedback-id]');
  if (button && card) void saveFeedback(card, button);
});

client.auth.onAuthStateChange((_event, session) => {
  if (session) window.setTimeout(() => void loadFeedback(), 0);
  else {
    state.feedback = [];
    state.actor = null;
    renderFeedback();
  }
});

const { data, error } = await client.auth.getSession();
if (!error && data.session) await loadFeedback();
