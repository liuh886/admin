from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing expected block in {path}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1))

# Edge aggregator: keep the existing operation overview authoritative and add one modular collector.
edge = 'supabase/functions/operations-overview/index.ts'
replace_once(edge,
'''import { createClient } from "npm:@supabase/supabase-js@2.111.0";\n''',
'''import { createClient } from "npm:@supabase/supabase-js@2.111.0";\nimport { productHealthOverview, type HealthProduct } from "./product-health.ts";\n''')

replacements = {
'  { product_code: "alpha_engine", name: "AlphaEngine", host: "liuh886.github.io", path_prefix: "/alpha_engine/" },': '  { product_code: "alpha_engine", name: "AlphaEngine", host: "liuh886.github.io", path_prefix: "/alpha_engine/", repo: "alpha_engine", branch: "main" },',
'  { product_code: "flappyk", name: "FlappyK", host: "liuh886.github.io", path_prefix: "/FlappyK/" },': '  { product_code: "flappyk", name: "FlappyK", host: "liuh886.github.io", path_prefix: "/FlappyK/", repo: "FlappyK", branch: "master" },',
'  { product_code: "newsflow", name: "NewsFlow", host: "liuh886.github.io", path_prefix: "/NewsFlow/" },': '  { product_code: "newsflow", name: "NewsFlow", host: "liuh886.github.io", path_prefix: "/NewsFlow/", repo: "NewsFlow", branch: "main" },',
'  { product_code: "ownly", name: "Ownly", host: "liuh886.github.io", path_prefix: "/ownly/" },': '  { product_code: "ownly", name: "Ownly", host: "liuh886.github.io", path_prefix: "/ownly/", repo: "ownly", branch: "main" },',
'  { product_code: "rhythmcoach", name: "RhythmCoach", host: "liuh886.github.io", path_prefix: "/RhythmCoach/" },': '  { product_code: "rhythmcoach", name: "RhythmCoach", host: "liuh886.github.io", path_prefix: "/RhythmCoach/", repo: "RhythmCoach", branch: "main" },',
'  { product_code: "ccus_policy_hub", name: "CCUS Policy Hub", host: "liuh886.github.io", path_prefix: "/ccus-policy-hub/" },': '  { product_code: "ccus_policy_hub", name: "CCUS Policy Hub", host: "liuh886.github.io", path_prefix: "/ccus-policy-hub/", repo: "ccus-policy-hub", branch: "main" },',
'  { product_code: "notes", name: "Notes", host: "zhihaol.eu.org", path_prefix: "/" },': '  { product_code: "notes", name: "Notes", host: "zhihaol.eu.org", path_prefix: "/", repo: "notes", branch: "master" },',
}
for old, new in replacements.items():
    replace_once(edge, old, new)
replace_once(edge, '] as const;\n\ninterface CachedOverview', '] as const satisfies readonly HealthProduct[];\n\ninterface CachedOverview')
replace_once(edge,
'''  return {\n    ...product,\n    status: "no_data",''',
'''  return {\n    product_code: product.product_code,\n    name: product.name,\n    host: product.host,\n    path_prefix: product.path_prefix,\n    status: "no_data",''')
replace_once(edge,
'''    const [analytics, cloudflare, platform, stripe] = await Promise.all([\n      analyticsOverview(),\n      cloudflareOverview(),\n      supabaseUsage(admin),\n      stripeOverview(admin),\n    ]);''',
'''    const [analytics, cloudflare, platform, stripe, productHealth] = await Promise.all([\n      analyticsOverview(),\n      cloudflareOverview(),\n      supabaseUsage(admin),\n      stripeOverview(admin),\n      productHealthOverview(RUM_PRODUCTS),\n    ]);''')
replace_once(edge,
'''      platform,\n      stripe,\n    };''',
'''      platform,\n      stripe,\n      product_health: productHealth,\n    };''')

# UI: place Product Health at the top of the existing operating overview.
html = 'index.html'
needle = '''        </section>\n\n        <div class="growth-health-grid">'''
panel = '''        </section>\n\n        <article class="panel product-health-panel" aria-labelledby="product-health-title">\n          <div class="panel-heading">\n            <div><p class="eyebrow">PRODUCT HEALTH</p><h3 id="product-health-title">产品健康</h3></div>\n            <span class="subtle">Public route · GitHub Actions · canonical freshness</span>\n          </div>\n          <div class="table-scroll">\n            <table class="traffic-table health-table">\n              <thead>\n                <tr><th>产品</th><th>服务</th><th>GitHub Actions</th><th>数据新鲜度</th><th>最近检查</th></tr>\n              </thead>\n              <tbody id="product-health-rows"><tr><td colspan="5" class="empty-copy">正在检查产品健康…</td></tr></tbody>\n            </table>\n          </div>\n          <p id="product-health-note" class="overview-note"></p>\n        </article>\n\n        <div class="growth-health-grid">'''
replace_once(html, needle, panel)

# Browser projection.
ops = 'operations.js'
replace_once(ops, "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm")
replace_once(ops,
'''  statPayments: $('#overview-stat-payments'),\n  growthChange: $('#growth-change'),''',
'''  statPayments: $('#overview-stat-payments'),\n  productHealthRows: $('#product-health-rows'),\n  productHealthNote: $('#product-health-note'),\n  growthChange: $('#growth-change'),''')

render_health = r'''function githubStatusLabel(status) {
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

'''
replace_once(ops, 'function renderRevenue(stripe) {', render_health + 'function renderRevenue(stripe) {')
replace_once(ops,
'''  renderTraffic(data.analytics);\n  renderRevenue(data.stripe);''',
'''  renderTraffic(data.analytics);\n  renderProductHealth(data.product_health);\n  renderRevenue(data.stripe);''')
replace_once(ops,
"setStatus(forceRefresh ? '正在强制刷新增长、Cloudflare、GA4、Supabase 与 Stripe…' : '正在载入增长与经营数据…');",
"setStatus(forceRefresh ? '正在强制刷新 Product Health、增长、Cloudflare、GA4、Supabase 与 Stripe…' : '正在载入产品健康与经营数据…');")

# Reuse the existing table visual language; only add status metadata and pending state.
css = Path('operations.css')
css.write_text(css.read_text() + r'''

.health-table { min-width: 900px; }
.health-table td { vertical-align: middle; }
.health-table td:first-child span,
.health-meta { display: block; margin-top: 5px; color: var(--muted); font-size: 10px; }
.badge.pending { background: rgba(245, 195, 107, .1); color: var(--warning); }
''')

# Contract: protect facts and boundary rather than exact historical layout.
test = 'tests/membership-admin-contract.test.js'
replace_once(test,
"const overviewEdge = fs.readFileSync('supabase/functions/operations-overview/index.ts', 'utf8');",
"const overviewEdge = fs.readFileSync('supabase/functions/operations-overview/index.ts', 'utf8');\nconst productHealthEdge = fs.readFileSync('supabase/functions/operations-overview/product-health.ts', 'utf8');")
replace_once(test,
"expect(operationsScript.includes('/functions/v1/operations-overview'), 'Frontend must call the protected overview function');",
"expect(operationsScript.includes('/functions/v1/operations-overview'), 'Frontend must call the protected overview function');\nexpect(operationsScript.includes('@supabase/supabase-js@2.111.0/+esm'), 'Operations browser Supabase client must be pinned to the tested release');")
replace_once(test,
"expect(html.includes('id=\"business-overview\"'), 'Traffic and revenue overview must be present');",
"expect(html.includes('id=\"business-overview\"'), 'Traffic and revenue overview must be present');\nexpect(html.includes('id=\"product-health-rows\"'), 'Product Health table must live inside the existing operations overview');\nexpect(operationsScript.includes('function renderProductHealth(productHealth)'), 'Product Health must have one browser projection renderer');")
replace_once(test,
"expect(overviewEdge.includes('Administrator access is required.'), 'Unauthorized overview users must be rejected');",
"expect(overviewEdge.includes('Administrator access is required.'), 'Unauthorized overview users must be rejected');\nexpect(overviewEdge.includes('productHealthOverview(RUM_PRODUCTS)'), 'Existing operations overview must aggregate Product Health');\nexpect(overviewEdge.includes('product_health: productHealth'), 'Product Health must be returned by the canonical overview payload');\nexpect(overviewEdge.includes('repo: \"FlappyK\", branch: \"master\"') && overviewEdge.includes('repo: \"notes\", branch: \"master\"'), 'Product Health must use real repository default branches');\nexpect(productHealthEdge.includes('/actions/runs?branch=') && productHealthEdge.includes('per_page=1'), 'Product Health must read the latest public GitHub Actions run');\nexpect(productHealthEdge.includes('AbortSignal.timeout(8_000)'), 'External health probes must be bounded');\nexpect(productHealthEdge.includes('NEWSFLOW_FRESHNESS_URL') && productHealthEdge.includes('content/state/governance-sync.json'), 'NewsFlow canonical freshness marker must be used directly');\nexpect(productHealthEdge.includes('该产品') === false, 'Server collector must return facts rather than UI copy');\nexpect(!productHealthEdge.includes('GITHUB_TOKEN'), 'Public repository health must not introduce another secret/configuration layer');")

# E2E: real admin boot, one operations payload, and one visible health row.
e2e = Path('tests/e2e/product-health.spec.js')
e2e.write_text(r'''import { test, expect } from '@playwright/test';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders, body: JSON.stringify(body) });
}

test('Product Health renders actionable service, Actions, and freshness facts', async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export function createClient() { return { auth: {
      getSession: async () => ({ data: { session: { access_token: 'token', user: { id: 'admin-1', email: 'owner@example.com' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async () => ({ error: null }), signOut: async () => ({ error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }), listFactors: async () => ({ data: { all: [], totp: [] }, error: null }) }
    } }; }`
  }));

  await page.route('https://blgwlycfcwvsupmqyqwn.supabase.co/functions/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    const url = route.request().url();
    const body = JSON.parse(route.request().postData() || '{}');
    if (url.endsWith('/membership-admin') && body.action === 'bootstrap') {
      return json(route, { actor: { id: 'admin-1', email: 'owner@example.com', role: 'owner' }, products: [], mappings: [], counts: { users: 0, active_subscriptions: 0, active_grants: 0, admin_actions: 0 }, recent_actions: [], users: [] });
    }
    if (url.endsWith('/operations-overview')) {
      return json(route, {
        generated_at: '2026-08-18T03:00:00Z', cache_minutes: 30, cached: false,
        cloudflare: { status: 'ok', aggregate: { visits: 12, page_views: 20, reporting_products: 1, configured_products: 7 }, trend: { daily: [], current_7d_visits: 5, previous_7d_visits: 4, change_rate: 0.25 }, momentum: [], products: [] },
        analytics: { properties: [], aggregate: { reporting_properties: 0, configured_properties: 7 } },
        platform: { status: 'ok', users: { total: 0, new_7d: 0, active_7d: 0 }, product_accounts: { total: 0, by_product: [], latest_activity_at: null } },
        stripe: { successful_payments: 0, last_30_days: [], subscriptions: { active: 0, past_due: 0, cancel_at_period_end: 0, by_product: [] }, balance: { available: [], pending: [] }, payouts: [] },
        product_health: { status: 'ok', aggregate: { products: 1, services_up: 1, actions_success: 1, freshness_reporting: 1 }, products: [{
          product_code: 'newsflow', name: 'NewsFlow', repository: 'liuh886/NewsFlow', branch: 'main',
          service: { status: 'up', http_status: 200, latency_ms: 84, checked_at: '2026-08-18T03:00:00Z' },
          github: { status: 'success', workflow: 'NewsFlow Frontend', updated_at: '2026-08-18T02:55:00Z' },
          freshness: { status: 'reported', source: 'content/state/governance-sync.json', observed_at: '2026-08-18T02:00:00Z', age_hours: 1 }
        }] }
      });
    }
    return route.fulfill({ status: 503, contentType: 'application/json', headers: corsHeaders, body: JSON.stringify({ error: 'not used in this acceptance path' }) });
  });

  await page.goto('/');
  await expect(page.locator('#console')).toBeVisible();
  const row = page.locator('#product-health-rows tr[data-product-code="newsflow"]');
  await expect(row).toContainText('NewsFlow');
  await expect(row).toContainText('正常 · 84 ms');
  await expect(row).toContainText('NewsFlow Frontend');
  await expect(row).toContainText('1 小时前');
  await expect(page.locator('#product-health-note')).toContainText('1/1 个公开产品入口正常');
});
''')

print('Product Health implementation staged')
