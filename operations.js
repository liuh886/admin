import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = Object.freeze({
  supabaseUrl: 'https://blgwlycfcwvsupmqyqwn.supabase.co',
  publishableKey: 'sb_publishable_n1Va-c_alpkQ0zNuJYUaxA_J0u68RVW',
  overviewFunctionUrl: 'https://blgwlycfcwvsupmqyqwn.supabase.co/functions/v1/operations-overview'
});

const client = createClient(config.supabaseUrl, config.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
});

const $ = (selector) => document.querySelector(selector);
const els = {
  status: $('#overview-status'),
  refresh: $('#overview-refresh'),
  statSessions: $('#overview-stat-sessions'),
  statViews: $('#overview-stat-views'),
  statProperties: $('#overview-stat-properties'),
  statPayments: $('#overview-stat-payments'),
  trafficRows: $('#traffic-rows'),
  trafficNote: $('#traffic-note'),
  revenueSummary: $('#revenue-summary'),
  subscriptionSummary: $('#subscription-summary'),
  balanceSummary: $('#balance-summary'),
  payoutList: $('#payout-list')
};

let loading = false;

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits }).format(Number(value || 0));
}

function formatPercent(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent', maximumFractionDigits: 1
  }).format(Number(value || 0));
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  if (total < 60) return `${formatNumber(total, 1)} 秒`;
  return `${formatNumber(total / 60, 1)} 分钟`;
}

function formatMoney(amount, currency = 'usd') {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency', currency: String(currency).toUpperCase()
  }).format(Number(amount || 0) / 100);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function setStatus(message = '', kind = '') {
  if (!els.status) return;
  els.status.textContent = message;
  if (kind) els.status.dataset.kind = kind;
  else delete els.status.dataset.kind;
}

function setLoading(value) {
  loading = Boolean(value);
  if (els.refresh) els.refresh.disabled = loading;
}

async function callOverview(forceRefresh = false) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('登录会话不可用，请重新登录。');
  const response = await fetch(config.overviewFunctionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: config.publishableKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ force_refresh: forceRefresh })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `经营总览请求失败（${response.status}）`);
  return result;
}

function renderTraffic(analytics) {
  const aggregate = analytics?.aggregate || {};
  const thirtyDay = aggregate.thirty_day || {};
  els.statSessions.textContent = formatNumber(thirtyDay.sessions);
  els.statViews.textContent = formatNumber(thirtyDay.page_views);
  els.statProperties.textContent = `${formatNumber(aggregate.reporting_properties)}/${formatNumber(aggregate.configured_properties)}`;

  const properties = analytics?.properties || [];
  els.trafficRows.innerHTML = properties.length
    ? properties.map((property) => {
      const seven = property.seven_day || {};
      const thirty = property.thirty_day || {};
      return `
        <tr class="${property.status === 'ok' ? '' : 'is-error'}">
          <td>
            <strong>${escapeHtml(property.name)}</strong>
            <span>${escapeHtml(property.property_id)}</span>
          </td>
          <td>${formatNumber(seven.active_users)}</td>
          <td>${formatNumber(thirty.active_users)}</td>
          <td>${formatNumber(thirty.sessions)}</td>
          <td>${formatNumber(thirty.page_views)}</td>
          <td>${formatPercent(thirty.engagement_rate)}</td>
          <td>${escapeHtml(formatDuration(thirty.average_session_duration_seconds))}</td>
          <td><span class="badge ${property.status === 'ok' ? 'active' : 'failed'}">${property.status === 'ok' ? '正常' : '失败'}</span></td>
        </tr>`;
    }).join('')
    : '<tr><td colspan="8" class="empty-copy">尚无 GA4 数据。</td></tr>';

  const failed = properties.filter((property) => property.status !== 'ok');
  els.trafficNote.textContent = failed.length
    ? `${failed.length} 个 Property 查询失败：${failed.map((item) => `${item.name} · ${item.error}`).join('；')}`
    : `活跃用户为各 Property 独立口径，跨产品相加可能包含同一访客。GA4 当日数据可能存在处理延迟。`;
  els.trafficNote.dataset.kind = failed.length ? 'error' : '';
}

function renderRevenue(stripe) {
  els.statPayments.textContent = formatNumber(stripe?.successful_payments);

  const currencies = stripe?.last_30_days || [];
  els.revenueSummary.innerHTML = currencies.length
    ? currencies.map((bucket) => `
      <div class="money-row">
        <div><strong>${escapeHtml(String(bucket.currency).toUpperCase())}</strong><span>${formatNumber(bucket.payments)} 笔成功付款</span></div>
        <dl>
          <div><dt>收款</dt><dd>${escapeHtml(formatMoney(bucket.gross, bucket.currency))}</dd></div>
          <div><dt>退款</dt><dd>${escapeHtml(formatMoney(bucket.refunded, bucket.currency))}</dd></div>
          <div><dt>扣退款后</dt><dd>${escapeHtml(formatMoney(bucket.net_before_fees, bucket.currency))}</dd></div>
        </dl>
      </div>`).join('')
    : '<p class="empty-copy">过去 30 日暂无成功付款。</p>';

  const subscriptions = stripe?.subscriptions || {};
  const byProduct = subscriptions.by_product || [];
  els.subscriptionSummary.innerHTML = `
    <div class="compact-stat"><span>有效订阅</span><strong>${formatNumber(subscriptions.active)}</strong></div>
    <div class="compact-stat"><span>Past due</span><strong>${formatNumber(subscriptions.past_due)}</strong></div>
    <div class="compact-stat"><span>期末取消</span><strong>${formatNumber(subscriptions.cancel_at_period_end)}</strong></div>
    <div class="product-counts">${byProduct.length
      ? byProduct.map((item) => `<span>${escapeHtml(item.product_code)} <strong>${formatNumber(item.count)}</strong></span>`).join('')
      : '<span>暂无按产品订阅</span>'}</div>`;

  const available = stripe?.balance?.available || [];
  const pending = stripe?.balance?.pending || [];
  const renderBalances = (label, rows) => rows.length
    ? rows.map((row) => `<span><em>${label}</em><strong>${escapeHtml(formatMoney(row.amount, row.currency))}</strong></span>`).join('')
    : `<span><em>${label}</em><strong>—</strong></span>`;
  els.balanceSummary.innerHTML = `${renderBalances('可用', available)}${renderBalances('待结算', pending)}`;

  const payouts = stripe?.payouts || [];
  els.payoutList.innerHTML = payouts.length
    ? payouts.map((payout) => `
      <article class="payout-row">
        <div><strong>${escapeHtml(formatMoney(payout.amount, payout.currency))}</strong><span>${escapeHtml(payout.id)}</span></div>
        <div><span class="badge ${payout.status === 'paid' ? 'active' : ''}">${escapeHtml(payout.status)}</span><span>预计 ${escapeHtml(formatDate(payout.arrival_date))}</span></div>
      </article>`).join('')
    : '<p class="empty-copy">尚无 Stripe Payout 记录。</p>';
}

function renderOverview(data) {
  renderTraffic(data.analytics);
  renderRevenue(data.stripe);
  const generated = formatDate(data.generated_at);
  const source = data.cached ? '缓存' : '实时刷新';
  setStatus(`数据生成于 ${generated} · ${source} · 缓存 ${formatNumber(data.cache_minutes)} 分钟`, 'success');
}

async function refreshOverview(forceRefresh = false) {
  if (loading) return;
  setLoading(true);
  setStatus(forceRefresh ? '正在强制刷新 GA4 与 Stripe…' : '正在载入 GA4 与 Stripe 经营数据…');
  try {
    renderOverview(await callOverview(forceRefresh));
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

els.refresh?.addEventListener('click', () => void refreshOverview(true));

client.auth.onAuthStateChange((_event, session) => {
  if (session) window.setTimeout(() => void refreshOverview(false), 0);
});

const { data, error } = await client.auth.getSession();
if (!error && data.session) await refreshOverview(false);
