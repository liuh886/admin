import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

if (!document.querySelector('link[href="./operations.css"]')) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = './operations.css';
  document.head.appendChild(stylesheet);
}

const config = Object.freeze({
  supabaseUrl: 'https://blgwlycfcwvsupmqyqwn.supabase.co',
  publishableKey: 'sb_publishable_n1Va-c_alpkQ0zNuJYUaxA_J0u68RVW',
  overviewFunctionUrl: 'https://blgwlycfcwvsupmqyqwn.supabase.co/functions/v1/operations-overview'
});

const client = createClient(config.supabaseUrl, config.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' }
});

const $ = (selector) => document.querySelector(selector);
const els = {
  status: $('#overview-status'),
  refresh: $('#overview-refresh'),
  statSessions: $('#overview-stat-sessions'),
  statViews: $('#overview-stat-views'),
  statProperties: $('#overview-stat-properties'),
  statPayments: $('#overview-stat-payments'),
  rumRows: $('#rum-rows'),
  rumNote: $('#rum-note'),
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
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent', maximumFractionDigits: 1
  }).format(Number(value));
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

function rumHealth(product) {
  if (product.status !== 'ok') return { label: '无数据', className: '' };
  const rates = [product.lcp_good_rate, product.inp_good_rate, product.cls_good_rate]
    .filter((value) => value !== null && value !== undefined)
    .map(Number);
  if (!rates.length) return { label: '采样中', className: '' };
  if (rates.every((value) => value >= 0.75)) return { label: '良好', className: 'active' };
  if (rates.some((value) => value < 0.5)) return { label: '需关注', className: 'failed' };
  return { label: '观察', className: '' };
}

function renderRum(cloudflare) {
  const aggregate = cloudflare?.aggregate || {};
  els.statSessions.textContent = cloudflare?.status === 'ok' ? formatNumber(aggregate.visits) : '—';
  els.statViews.textContent = cloudflare?.status === 'ok' ? formatNumber(aggregate.page_views) : '—';
  els.statProperties.textContent = `${formatNumber(aggregate.reporting_products)}/${formatNumber(aggregate.configured_products)}`;

  const products = cloudflare?.products || [];
  els.rumRows.innerHTML = products.length
    ? products.map((product) => {
      const health = rumHealth(product);
      return `
        <tr class="${product.status === 'ok' ? '' : 'is-error'}">
          <td>
            <strong>${escapeHtml(product.name)}</strong>
            <span>${escapeHtml(product.host)}${escapeHtml(product.path_prefix)}</span>
          </td>
          <td>${formatNumber(product.page_views)}</td>
          <td>${formatNumber(product.visits)}</td>
          <td>${formatPercent(product.lcp_good_rate)}</td>
          <td>${formatPercent(product.inp_good_rate)}</td>
          <td>${formatPercent(product.cls_good_rate)}</td>
          <td><span class="badge ${health.className}">${health.label}</span></td>
        </tr>`;
    }).join('')
    : '<tr><td colspan="7" class="empty-copy">尚无 Cloudflare RUM 数据。</td></tr>';

  if (cloudflare?.status === 'not_configured') {
    els.rumNote.textContent = 'Cloudflare GraphQL 尚未配置：需要在 Supabase Edge Function Secrets 中配置 Cloudflare Account ID 与只读 Analytics API Token。';
    els.rumNote.dataset.kind = 'error';
    return;
  }
  if (cloudflare?.status === 'error') {
    els.rumNote.textContent = `Cloudflare 查询失败：${cloudflare.error || '未知错误'}`;
    els.rumNote.dataset.kind = 'error';
    return;
  }
  els.rumNote.textContent = 'Cloudflare 是七个产品的统一流量与真实用户体验口径；LCP / INP / CLS 显示 30 日 Good 事件占比，CCUS Policy Hub 只进入可观测层，不进入会员或 Stripe。';
  els.rumNote.dataset.kind = '';
}

function renderTraffic(analytics) {
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
    : '<tr><td colspan="8" class="empty-copy">尚无 GA4 行为分析数据。</td></tr>';

  const failed = properties.filter((property) => property.status !== 'ok');
  els.trafficNote.textContent = failed.length
    ? `${failed.length} 个 GA4 Property 查询失败：${failed.map((item) => `${item.name} · ${item.error}`).join('；')}`
    : 'GA4 仅保留在需要行为、漏斗或来源分析的 FlappyK、NewsFlow 与 Notes；不再作为全产品统一流量口径。';
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
  renderRum(data.cloudflare);
  renderTraffic(data.analytics);
  renderRevenue(data.stripe);
  const generated = formatDate(data.generated_at);
  const source = data.cached ? '缓存' : '实时刷新';
  setStatus(`数据生成于 ${generated} · ${source} · 缓存 ${formatNumber(data.cache_minutes)} 分钟`, 'success');
}

async function refreshOverview(forceRefresh = false) {
  if (loading) return;
  setLoading(true);
  setStatus(forceRefresh ? '正在强制刷新 Cloudflare、GA4 与 Stripe…' : '正在载入 Cloudflare、GA4 与 Stripe 经营数据…');
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

void import('./feedback-admin.js');
