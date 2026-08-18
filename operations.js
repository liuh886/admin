import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';

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
  productHealthRows: $('#product-health-rows'),
  productHealthNote: $('#product-health-note'),
  growthChange: $('#growth-change'),
  growthCurrent: $('#growth-current'),
  growthPrevious: $('#growth-previous'),
  growthChart: $('#growth-chart'),
  growthStart: $('#growth-start'),
  growthEnd: $('#growth-end'),
  growthNote: $('#growth-note'),
  momentumRows: $('#momentum-rows'),
  platformUsers: $('#platform-users'),
  platformNewUsers: $('#platform-new-users'),
  platformActiveUsers: $('#platform-active-users'),
  platformAccounts: $('#platform-accounts'),
  platformProducts: $('#platform-products'),
  platformNote: $('#platform-note'),
  rumRows: $('#rum-rows'),
  rumNote: $('#rum-note'),
  trafficRows: $('#traffic-rows'),
  trafficNote: $('#traffic-note'),
  ga4Scope: $('#ga4-scope'),
  revenueSummary: $('#revenue-summary'),
  subscriptionSummary: $('#subscription-summary'),
  balanceSummary: $('#balance-summary'),
  payoutList: $('#payout-list')
};

function disclosureSummary(title, subtitle) {
  const summary = document.createElement('summary');
  summary.innerHTML = `
    <span class="disclosure-title"><strong>${title}</strong><span>${subtitle}</span></span>
    <span class="disclosure-icon" aria-hidden="true">+</span>`;
  return summary;
}

function collapsePanel(panel, title, subtitle) {
  if (!panel || panel.tagName === 'DETAILS') return panel;
  const details = document.createElement('details');
  details.className = `${panel.className} disclosure-panel`;
  const heading = panel.querySelector(':scope > .panel-heading');
  if (heading) heading.remove();
  details.appendChild(disclosureSummary(title, subtitle));
  while (panel.firstChild) details.appendChild(panel.firstChild);
  panel.replaceWith(details);
  return details;
}

function applyCompactLayout() {
  const overviewCopy = $('#business-overview .overview-heading > div > p:last-child');
  if (overviewCopy) {
    overviewCopy.textContent = '七个产品的 Cloudflare RUM、七个 GA4 Property 的一致对照、Supabase 用户使用与 Stripe Live Mode 只读汇总。';
  }
  if (els.ga4Scope) els.ga4Scope.textContent = '7 Properties';

  const growthPanel = $('.growth-panel');
  if (growthPanel && !growthPanel.querySelector('.metric-disclosure')) {
    const chartWrap = growthPanel.querySelector('.growth-chart-wrap');
    const axis = growthPanel.querySelector('.growth-axis');
    const note = growthPanel.querySelector('#growth-note');
    if (chartWrap && axis && note) {
      const details = document.createElement('details');
      details.className = 'metric-disclosure';
      details.appendChild(disclosureSummary('30 日折线', '按需展开每日 Visits 趋势'));
      chartWrap.before(details);
      details.append(chartWrap, axis, note);
    }
  }

  collapsePanel($('.momentum-panel'), '产品动量', '本 7 日 vs 前 7 日 · Cloudflare Visits');
  const trafficPanels = [...document.querySelectorAll('.traffic-panel')];
  const cloudflarePanel = trafficPanels.find((panel) => panel.querySelector('.eyebrow')?.textContent.includes('CLOUDFLARE WEB ANALYTICS'));
  const ga4Panel = trafficPanels.find((panel) => panel.querySelector('.eyebrow')?.textContent.includes('GA4 · CROSS-PRODUCT'));
  collapsePanel(cloudflarePanel, 'Cloudflare 流量与体验明细', '7 个产品 · 30 日 RUM');
  collapsePanel(ga4Panel, 'GA4 统一站点分析对照', '7 个 Property · 用户、会话与互动');
}

applyCompactLayout();

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

function formatRate(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '新数据';
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero'
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

function formatDay(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
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

function growthClass(changeRate) {
  const value = Number(changeRate);
  if (!Number.isFinite(value) || value === 0) return '';
  return value > 0 ? 'positive' : 'negative';
}

function renderGrowthChart(points) {
  if (!els.growthChart) return;
  const values = points.map((point) => Number(point.visits || 0));
  const max = Math.max(...values, 1);
  const width = 720;
  const height = 220;
  const left = 18;
  const right = 18;
  const top = 18;
  const bottom = 26;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index) => left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value) => top + plotHeight - (Number(value || 0) / max) * plotHeight;
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(point.visits).toFixed(1)}`).join(' ');
  const area = points.length
    ? `${line} L ${x(points.length - 1).toFixed(1)} ${(top + plotHeight).toFixed(1)} L ${x(0).toFixed(1)} ${(top + plotHeight).toFixed(1)} Z`
    : '';
  const grids = [0, 0.5, 1].map((ratio) => {
    const gridY = top + plotHeight * ratio;
    return `<line class="growth-grid-line" x1="${left}" y1="${gridY}" x2="${width - right}" y2="${gridY}"></line>`;
  }).join('');
  const last = points.at(-1);
  const lastMark = last
    ? `<circle class="growth-chart-dot" cx="${x(points.length - 1).toFixed(1)}" cy="${y(last.visits).toFixed(1)}" r="4"></circle>`
    : '';
  els.growthChart.innerHTML = `${grids}<path class="growth-chart-area" d="${area}"></path><path class="growth-chart-line" d="${line}"></path>${lastMark}`;
  els.growthChart.setAttribute('aria-label', points.length
    ? `过去 ${points.length} 日每日访问趋势，最高 ${formatNumber(max)}，最新 ${formatNumber(last?.visits)}。`
    : '暂无访问趋势数据。');
}

function renderGrowth(cloudflare) {
  const trend = cloudflare?.trend || {};
  const daily = trend.daily || [];
  const changeRate = trend.change_rate;
  els.growthCurrent.textContent = formatNumber(trend.current_7d_visits);
  els.growthPrevious.textContent = formatNumber(trend.previous_7d_visits);
  els.growthChange.textContent = formatRate(changeRate);
  els.growthChange.className = `trend-badge ${growthClass(changeRate)}`.trim();
  els.growthStart.textContent = formatDay(daily[0]?.date);
  els.growthEnd.textContent = formatDay(daily.at(-1)?.date);
  renderGrowthChart(daily);

  const momentum = cloudflare?.momentum || [];
  els.momentumRows.innerHTML = momentum.length
    ? momentum.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td>${formatNumber(item.current_7d_visits)}</td>
        <td>${formatNumber(item.previous_7d_visits)}</td>
        <td><span class="trend-value ${growthClass(item.change_rate)}">${escapeHtml(formatRate(item.change_rate))}</span></td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="empty-copy">尚无足够的产品趋势数据。</td></tr>';

  els.growthNote.textContent = cloudflare?.status === 'ok'
    ? '统一采用 Cloudflare Visits 口径；“本 7 日”与紧邻的前 7 日比较。新接入站点在基期为 0 时显示“新数据”，不伪造增长率。'
    : 'Cloudflare 趋势暂不可用。';
}

function renderPlatform(platform) {
  if (platform?.status !== 'ok') {
    els.platformUsers.textContent = '—';
    els.platformNewUsers.textContent = '—';
    els.platformActiveUsers.textContent = '—';
    els.platformAccounts.textContent = '—';
    els.platformProducts.innerHTML = '<span>Supabase 使用数据暂不可用</span>';
    els.platformNote.textContent = platform?.error || '无法读取 Supabase 使用数据。';
    els.platformNote.dataset.kind = 'error';
    return;
  }

  const users = platform.users || {};
  const accounts = platform.product_accounts || {};
  els.platformUsers.textContent = formatNumber(users.total);
  els.platformNewUsers.textContent = `+${formatNumber(users.new_7d)}`;
  els.platformActiveUsers.textContent = formatNumber(users.active_7d);
  els.platformAccounts.textContent = formatNumber(accounts.total);
  els.platformProducts.innerHTML = (accounts.by_product || []).length
    ? accounts.by_product.map((item) => `<span>${escapeHtml(item.name)} <strong>${formatNumber(item.users)}</strong></span>`).join('')
    : '<span>尚无产品账户活动</span>';
  els.platformNote.textContent = `最近账户活动 ${formatDate(accounts.latest_activity_at)} · 这里统计的是 Supabase 已登录用户与产品账户，不把匿名访问误算成注册转化。`;
  els.platformNote.dataset.kind = '';
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
    els.rumNote.textContent = 'Cloudflare GraphQL 尚未配置：请检查服务端 Analytics 读取配置。';
    els.rumNote.dataset.kind = 'error';
    return;
  }
  if (cloudflare?.status === 'error') {
    els.rumNote.textContent = `Cloudflare 查询失败：${cloudflare.error || '未知错误'}`;
    els.rumNote.dataset.kind = 'error';
    return;
  }
  els.rumNote.textContent = 'Cloudflare 是七个产品的统一流量与真实用户体验口径；LCP / INP / CLS 显示 30 日 Good 事件占比。';
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
    : '<tr><td colspan="8" class="empty-copy">尚无 GA4 对照数据。</td></tr>';

  const aggregate = analytics?.aggregate || {};
  if (els.ga4Scope) {
    els.ga4Scope.textContent = `${formatNumber(aggregate.reporting_properties)}/${formatNumber(aggregate.configured_properties)} Properties`;
  }
  const failed = properties.filter((property) => property.status !== 'ok');
  els.trafficNote.textContent = failed.length
    ? `${failed.length} 个 GA4 Property 查询失败：${failed.map((item) => `${item.name} · ${item.error}`).join('；')}`
    : 'GA4 与 Cloudflare 保持两套互补口径：Cloudflare 负责统一流量/RUM baseline，GA4 负责站点行为、来源与跨产品一致对照。';
  els.trafficNote.dataset.kind = failed.length ? 'error' : '';
}

function githubStatusLabel(status) {
  const labels = {
    success: '正常', failure: '失败', cancelled: '取消', timed_out: '超时',
    action_required: '需处理', in_progress: '运行中', queued: '排队',
    no_runs: '无记录', error: '不可用', unknown: '未知'
  };
  return labels[status] || String(status || '未知');
}

function githubStatusClass(status) {
  if (status === 'success') return 'active';
  if (['failure', 'timed_out', 'action_required', 'error'].includes(status)) return 'failed';
  if (['in_progress', 'queued'].includes(status)) return 'pending';
  return '';
}

function renderProductHealth(productHealth) {
  const products = productHealth?.products || [];
  if (!els.productHealthRows) return;
  els.productHealthRows.innerHTML = products.length
    ? products.map((product) => {
      const service = product.service || {};
      const github = product.github || {};
      const freshness = product.freshness;
      const serviceOk = service.status === 'up';
      const serviceLabel = serviceOk ? `正常 · ${formatNumber(service.latency_ms)} ms` : service.status === 'down' ? `HTTP ${formatNumber(service.http_status)}` : '不可用';
      const freshnessMain = freshness?.status === 'reported' ? `${formatNumber(freshness.age_hours, 1)} 小时前` : freshness ? '读取失败' : '未提供';
      const freshnessMeta = freshness?.source || '该产品暂无 canonical marker';
      const rowNeedsAttention = !serviceOk || ['failure', 'timed_out', 'action_required', 'error'].includes(github.status);
      return `
        <tr class="${rowNeedsAttention ? 'is-error' : ''}" data-product-code="${escapeHtml(product.product_code)}">
          <td><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.repository)} · ${escapeHtml(product.branch)}</span></td>
          <td><span class="badge ${serviceOk ? 'active' : 'failed'}">${escapeHtml(serviceLabel)}</span><span class="health-meta">${escapeHtml(String(service.http_status || '—'))}</span></td>
          <td><span class="badge ${githubStatusClass(github.status)}">${escapeHtml(githubStatusLabel(github.status))}</span><span class="health-meta">${escapeHtml(github.workflow || '—')} · ${escapeHtml(formatDate(github.updated_at))}</span></td>
          <td><strong>${escapeHtml(freshnessMain)}</strong><span class="health-meta">${escapeHtml(freshnessMeta)}</span></td>
          <td>${escapeHtml(formatDate(service.checked_at))}</td>
        </tr>`;
    }).join('')
    : '<tr><td colspan="5" class="empty-copy">暂无产品健康数据。</td></tr>';

  const aggregate = productHealth?.aggregate || {};
  const attention = products.filter((product) => product.service?.status !== 'up' || ['failure', 'timed_out', 'action_required', 'error'].includes(product.github?.status)).length;
  els.productHealthNote.textContent = products.length
    ? `${formatNumber(aggregate.services_up)}/${formatNumber(aggregate.products)} 个公开产品入口正常 · ${formatNumber(aggregate.actions_success)} 个产品最新 GitHub Actions 成功 · ${formatNumber(aggregate.freshness_reporting)} 个产品提供 canonical freshness marker${attention ? ` · ${attention} 个需关注` : ''}。`
    : 'Product Health 暂无可用数据。';
  els.productHealthNote.dataset.kind = attention ? 'error' : '';
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
  renderGrowth(data.cloudflare);
  renderPlatform(data.platform);
  renderRum(data.cloudflare);
  renderTraffic(data.analytics);
  renderProductHealth(data.product_health);
  renderRevenue(data.stripe);
  const generated = formatDate(data.generated_at);
  const source = data.cached ? '缓存' : '实时刷新';
  setStatus(`数据生成于 ${generated} · ${source} · 缓存 ${formatNumber(data.cache_minutes)} 分钟`, 'success');
}

async function refreshOverview(forceRefresh = false) {
  if (loading) return;
  setLoading(true);
  setStatus(forceRefresh ? '正在强制刷新 Product Health、增长、Cloudflare、GA4、Supabase 与 Stripe…' : '正在载入产品健康与经营数据…');
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
