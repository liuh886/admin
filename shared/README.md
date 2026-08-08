# Hao Apps shared account shell

Public browser assets:

```html
<link rel="stylesheet" href="https://liuh886.github.io/admin/shared/account-shell.css?v=1">
<script src="./account-config.js"></script>
<script src="https://liuh886.github.io/admin/shared/account-shell.js?v=1"></script>
```

Deploy the shared `admin` assets before merging a product integration. The version query is part of the rollout contract and should be incremented only when a browser-incompatible shell change requires a coordinated product update.

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

Do not upload content through `product_accounts`. Product content that genuinely needs cloud sync must use an app-specific RLS table with an explicit product contract. RhythmCoach follows this rule: only Personal Library **text materials** may sync through `rhythmcoach_personal_materials`; RhythmCoach audio recordings are always local-only and are never uploaded or stored online. Ownly Markdown and AlphaEngine local research bundles remain local-first unless their products explicitly define a separate RLS-backed cloud feature.

Never place Stripe secrets, webhook secrets, Supabase secret/service-role keys, database passwords or Google service-account credentials in product configuration or browser assets.
