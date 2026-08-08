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
});
