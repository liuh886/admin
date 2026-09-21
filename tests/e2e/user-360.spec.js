import { test, expect } from '@playwright/test';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

test('restored session opens User 360 without MFA and signs out', async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export function createClient() {
        return {
          auth: {
            getSession: async () => ({ data: { session: { access_token: 'token', user: { id: 'admin-1', email: 'owner@example.com' } } }, error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
            signInWithOAuth: async () => ({ error: null }),
            signOut: async () => ({ error: null })
          }
        };
      }
    `
  }));

  await page.route('https://blgwlycfcwvsupmqyqwn.supabase.co/functions/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders });
    }

    const url = route.request().url();
    const body = JSON.parse(route.request().postData() || '{}');

    if (url.endsWith('/membership-admin') && body.action === 'bootstrap') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          actor: { id: 'admin-1', email: 'owner@example.com', role: 'owner' },
          products: [],
          mappings: [],
          counts: { users: 1, active_subscriptions: 0, active_grants: 1, admin_actions: 0 },
          recent_actions: [],
          users: [{
            id: 'user-1',
            email: 'user@example.com',
            display_name: 'Example User',
            created_at: '2026-08-01T00:00:00Z',
            last_sign_in_at: '2026-08-17T00:00:00Z',
            last_activity_at: '2026-08-18T00:00:00Z',
            products: ['ownly'],
            active_entitlements: 1,
            active_subscriptions: 0
          }]
        })
      });
    }

    if (url.endsWith('/membership-admin') && body.action === 'search_user') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          user: {
            id: 'user-1',
            email: 'user@example.com',
            created_at: '2026-08-01T00:00:00Z',
            last_sign_in_at: '2026-08-17T00:00:00Z',
            profile: { display_name: 'Example User' }
          },
          customer: null,
          subscriptions: [],
          entitlements: [{ entitlement_code: 'ownly.pro', active: true, valid_until: null }],
          grants: [],
          payments: [],
          actions: []
        })
      });
    }

    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ error: 'not used in this acceptance path' })
    });
  });

  await page.goto('/');
  await expect(page.locator('#console')).toBeVisible();
  await expect(page.locator('#auth-gate')).toBeHidden();
  await expect(page.locator('#admin-mfa-panel')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#console')).toBeVisible();
  const row = page.locator('#user-360-list button[data-user-id="user-1"]');
  await expect(row).toContainText('Example User');
  await expect(row).toContainText('ownly');
  await row.click();
  await expect(page.locator('#member-workspace')).toBeVisible();
  await expect(page.locator('#member-email')).toHaveText('user@example.com');
  await expect(page.locator('#entitlement-list')).toContainText('ownly.pro');
  await page.locator('#sign-out').click();
  await expect(page.locator('#console')).toBeHidden();
  await expect(page.locator('#google-login')).toBeVisible();
});
