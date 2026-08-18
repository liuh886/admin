import { test, expect } from '@playwright/test';

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
