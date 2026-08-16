import { test, expect } from '@playwright/test';

test('shared account shell renders Pro guidance in one stable mount', async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export function createClient() { return { auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signInWithOAuth: async () => ({ error: null }), signInWithOtp: async () => ({ error: null }) } }; }`
  }));
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.turnstile={render(){return 1},remove(){}};`
  }));

  await page.goto('/tests/fixtures/account-shell.html');
  const trigger = page.locator('[data-account-slot] .hao-account-trigger');
  await expect(trigger).toHaveCount(1);
  await trigger.click();
  await expect(page.getByText('Free and Fixture Pro')).toBeVisible();
  await expect(page.getByText('Choose a sign-in method')).toBeVisible();
  await expect(page.locator('.hao-account-feature-panel')).toHaveCount(0);
  await expect(page.locator('.hao-upgrade-plans')).toHaveCount(1);

  await page.evaluate(() => document.querySelector('#app')?.appendChild(document.createElement('div')));
  await expect(page.locator('[data-account-slot] .hao-account-trigger')).toHaveCount(1);
});
