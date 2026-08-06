import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const script = fs.readFileSync('admin.js', 'utf8');
const edge = fs.readFileSync('supabase/functions/membership-admin/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0004_membership_admin_console.sql', 'utf8');
const denyMigration = fs.readFileSync('supabase/migrations/0005_membership_admin_explicit_deny.sql', 'utf8');
const combinedBrowser = `${html}\n${script}`;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(html.includes('noindex,nofollow,noarchive'), 'Admin console must remain unindexed');
expect(script.includes("redirectUrl: 'https://liuh886.github.io/admin/'"), 'Canonical OAuth redirect must use /admin/');
expect(!combinedBrowser.includes('https://liuh886.github.io/FlappyK/admin/'), 'Legacy FlappyK URL must not remain in the standalone frontend');
expect(script.includes('/functions/v1/membership-admin'), 'Frontend must call the protected admin function');
expect(edge.includes('membership_admins'), 'Edge function must verify the admin whitelist');
expect(edge.includes('Administrator access is required.'), 'Unauthorized users must be rejected');
expect(edge.includes('confirmation !== "REFUND"'), 'Refunds must require typed confirmation');
expect(edge.includes('confirmation !== "CANCEL"'), 'Cancellations must require typed confirmation');
expect(migration.includes('membership_admin_actions'), 'Audit table migration must be present');
expect(denyMigration.includes('using (false)'), 'Browser roles must be explicitly denied');
expect(!combinedBrowser.match(/sk_(?:live|test)_[A-Za-z0-9]/), 'Stripe secret must never be committed to the browser');
expect(!combinedBrowser.includes('service_role'), 'Service-role credentials must never be referenced by the browser');

console.log('Membership admin contract checks passed');
