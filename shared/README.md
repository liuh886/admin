# Hao Apps shared account shell

Public browser assets:

```html
<link rel="stylesheet" href="https://liuh886.github.io/admin/shared/account-shell.css">
<script src="./account-config.js"></script>
<script src="https://liuh886.github.io/admin/shared/account-shell.js"></script>
```

Each product owns only its public configuration:

```js
window.HaoAccountConfig = Object.freeze({
  enabled: true,
  billingEnabled: false,
  appName: 'Example',
  productCode: 'example',
  entitlementCode: 'example.pro',
  supabaseUrl: 'https://PROJECT.supabase.co',
  supabasePublishableKey: 'sb_publishable_...',
  redirectUrl: 'https://liuh886.github.io/example/',
  mountSelectors: ['[data-account-slot]', 'header nav', 'header'],
  title: { zh: 'Example 账户', en: 'Example account' },
  description: { zh: '...', en: '...' },
  privacyNote: { zh: '...', en: '...' },
  features: [
    { zh: '...', en: '...' }
  ],
  feedbackEnabled: false
});
```

## Runtime API

`window.HaoAccount` exposes:

- `getState()`
- `open()` / `close()`
- `refresh()`
- `can(entitlementCode)`
- `getClient()`
- `saveProductData({ preferences, productState })`
- `submitFeedback(category, message)`
- `subscribe(listener)`

The shell emits both `hao:account-changed` and the compatibility event `hao:membership-changed`.

## Data boundary

The shared browser client may write only:

- the signed-in user's shared profile;
- small per-product preferences and account state;
- authenticated product feedback;
- app-specific tables protected by their own RLS policies.

Do not upload local-first content through `product_accounts`. Ownly Markdown, RhythmCoach recordings and scripts, and AlphaEngine local research bundles remain outside the shared account store.

Never place Stripe secrets, webhook secrets, Supabase secret/service-role keys, database passwords or Google service-account credentials in product configuration or browser assets.
