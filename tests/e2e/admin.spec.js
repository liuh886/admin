import { test, expect } from '@playwright/test';

test('private console starts at the administrator login gate', async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export function createClient() {
        return {
          auth: {
            getSession: async () => ({ data: { session: null }, error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
            signInWithOAuth: async ({ options }) => {
              window.__redirectTo = options.redirectTo;
              window.__oauthOptions = options;
              return { error: null };
            },
            signOut: async () => ({ error: null })
          }
        };
      }
    `
  }));

  await page.goto('/');
  await expect(page).toHaveTitle('Hao Apps · Private Operations');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow,noarchive');
  await expect(page.getByRole('heading', { name: '运营控制台' })).toBeVisible();
  await expect(page.locator('#console')).toBeHidden();
  await expect(page.locator('#business-overview')).toBeHidden();

  await page.getByRole('button', { name: '使用 Google 登录' }).click();
  const redirectTo = await page.evaluate(() => window.__redirectTo ?? '');
  expect(redirectTo).toBe('https://liuh886.github.io/admin/');
  expect(await page.evaluate(() => window.__oauthOptions)).toEqual({ redirectTo });
});


for (const status of [401, 403]) {
  test(`server rejection ${status} keeps the console closed`, async ({ page }) => {
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
      contentType: 'application/javascript',
      body: `export function createClient() { return { auth: {
        getSession: async () => ({ data: { session: { access_token: 'token', user: { id: 'non-admin' } } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      } }; }`
    }));
    await page.route('https://blgwlycfcwvsupmqyqwn.supabase.co/functions/v1/**', route => route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : status,
      headers: {
        'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      contentType: 'application/json',
      body: route.request().method() === 'OPTIONS' ? '' : JSON.stringify({ error: 'Administrator access denied.' }),
    }));
    await page.goto('/');
    await expect(page.locator('#auth-status')).toHaveText('Administrator access denied.');
    await expect(page.locator('#console')).toBeHidden();
    await expect(page.locator('#google-login')).toBeVisible();
  });
}
