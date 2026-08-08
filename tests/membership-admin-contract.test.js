import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const script = fs.readFileSync('admin.js', 'utf8');
const operationsScript = fs.readFileSync('operations.js', 'utf8');
const operationsCss = fs.readFileSync('operations.css', 'utf8');
const edge = fs.readFileSync('supabase/functions/membership-admin/index.ts', 'utf8');
const overviewEdge = fs.readFileSync('supabase/functions/operations-overview/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0004_membership_admin_console.sql', 'utf8');
const denyMigration = fs.readFileSync('supabase/migrations/0005_membership_admin_explicit_deny.sql', 'utf8');
const combinedBrowser = `${html}\n${script}\n${operationsScript}\n${operationsCss}`;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(html.includes('noindex,nofollow,noarchive'), 'Admin console must remain unindexed');
expect(script.includes("redirectUrl: 'https://liuh886.github.io/admin/'"), 'Canonical OAuth redirect must use /admin/');
expect(!combinedBrowser.includes('https://liuh886.github.io/FlappyK/admin/'), 'Legacy FlappyK URL must not remain in the standalone frontend');
expect(script.includes('/functions/v1/membership-admin'), 'Frontend must call the protected admin function');
expect(operationsScript.includes('/functions/v1/operations-overview'), 'Frontend must call the protected overview function');
expect(html.includes('id="business-overview"'), 'Traffic and revenue overview must be present');
expect(html.includes('id="growth-chart"'), 'Growth trend chart must be present');
expect(html.includes('id="momentum-rows"'), 'Product momentum table must be present');
expect(html.includes('id="platform-users"'), 'Supabase usage summary must be present');
expect(html.includes('id="rum-rows"'), 'Cloudflare RUM product table must be present');
expect(html.includes('id="traffic-rows"'), 'GA4 comparison table must be present');
expect(html.includes('id="revenue-summary"'), 'Stripe revenue summary must be present');
expect(operationsScript.includes("document.createElement('details')"), 'Detailed analytics must use native collapsible disclosures');
expect(operationsScript.includes('applyCompactLayout()'), 'Compact operations hierarchy must be applied on load');
expect(operationsCss.includes('.disclosure-panel') && operationsCss.includes('.metric-disclosure'), 'Collapsible analytics must have dedicated layout styles');
expect(edge.includes('membership_admins'), 'Membership function must verify the admin whitelist');
expect(overviewEdge.includes('membership_admins'), 'Overview function must verify the admin whitelist');
expect(overviewEdge.includes('Administrator access is required.'), 'Unauthorized overview users must be rejected');
expect(overviewEdge.includes('https://api.cloudflare.com/client/v4/graphql'), 'Cloudflare observability must use the GraphQL Analytics API');
expect(overviewEdge.includes('CLOUDFLARE_ACCOUNT_ID'), 'Cloudflare account scope must come from Supabase secrets');
expect(overviewEdge.includes('CLOUDFLARE_ANALYTICS_API_TOKEN'), 'Cloudflare read token must come from Supabase secrets');
expect(overviewEdge.includes('rumPageloadEventsAdaptiveGroups'), 'Cloudflare page-load RUM must be queried');
expect(overviewEdge.includes('rumWebVitalsEventsAdaptiveGroups'), 'Cloudflare Web Vitals RUM must be queried');
expect(overviewEdge.includes('dimensions { date requestHost requestPath siteTag }'), 'Cloudflare RUM must expose daily trend dimensions');
expect(overviewEdge.includes('ccus_policy_hub') && overviewEdge.includes('/ccus-policy-hub/'), 'CCUS Policy Hub must be in the observability product map');
expect(overviewEdge.includes('zhihaol.eu.org'), 'Notes custom hostname must be in the observability product map');
expect(overviewEdge.includes('const GA4_PRODUCTS = [') && overviewEdge.includes('"alpha_engine"') && overviewEdge.includes('"ownly"') && overviewEdge.includes('"rhythmcoach"') && overviewEdge.includes('"ccus_policy_hub"'), 'GA4 comparison must include all seven product properties');
expect(overviewEdge.includes('ccus_policy_hub: "549142391"'), 'CCUS GA4 property ID must be explicitly configured');
expect(overviewEdge.includes('https://www.googleapis.com/auth/analytics.readonly'), 'GA4 access must remain read-only');
expect(overviewEdge.includes('urn:ietf:params:oauth:grant-type:jwt-bearer'), 'Google service-account grant type must remain valid');
expect(overviewEdge.includes('GA4_SERVICE_ACCOUNT_JSON_B64'), 'GA4 credentials must come from Supabase secrets');
expect(overviewEdge.includes('GA4_PROPERTY_IDS'), 'Existing GA4 property mapping must remain available for the other products');
expect(overviewEdge.includes('supabaseUsage(admin)'), 'Operations overview must include Supabase usage');
expect(overviewEdge.includes('.from("product_accounts")'), 'Supabase usage must use product account activity');
expect(overviewEdge.includes('.from("profiles")'), 'Supabase user growth must use shared profiles');
expect(overviewEdge.includes('stripeRequest("balance")'), 'Stripe account balance must be read server-side');
expect(overviewEdge.includes('stripeRequest("payouts?limit=5")'), 'Stripe payouts must be read server-side');
expect(edge.includes('"REFUND"') && edge.includes('Type REFUND to confirm this financial action.'), 'Refunds must require typed confirmation');
expect(edge.includes('"CANCEL"') && edge.includes('Type CANCEL to confirm subscription cancellation.'), 'Cancellations must require typed confirmation');
expect(migration.includes('membership_admin_actions'), 'Audit table migration must be present');
expect(migration.includes('sync_owner_pro_entitlements'), 'Owner role must automatically materialize product Pro access');
expect(migration.includes("'owner'"), 'Owner grants must use an explicit owner source');
expect(migration.includes("valid_until"), 'Owner Pro grants must support permanent access');
expect(migration.includes("entitlement_code like '%.pro'"), 'Owner access must follow product Pro mappings');
expect(denyMigration.includes('using (false)'), 'Browser roles must be explicitly denied');
expect(!combinedBrowser.match(/sk_(?:live|test)_[A-Za-z0-9]/), 'Stripe secret must never be committed to the browser');
expect(!combinedBrowser.includes('service_role'), 'Service-role credentials must never be referenced by the browser');
expect(!combinedBrowser.includes('private_key'), 'Google service-account private key must never enter the browser');
expect(!combinedBrowser.includes('GA4_SERVICE_ACCOUNT_JSON_B64'), 'GA4 server secret name must not be exposed by the browser');
expect(!combinedBrowser.includes('CLOUDFLARE_ANALYTICS_API_TOKEN'), 'Cloudflare API-token secret name must not be exposed by the browser');

console.log('Membership and operations admin contract checks passed');
