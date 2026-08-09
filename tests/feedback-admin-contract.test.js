import fs from 'node:fs';

const operations = fs.readFileSync('operations.js', 'utf8');
const frontend = fs.readFileSync('feedback-admin.js', 'utf8');
const styles = fs.readFileSync('feedback-admin.css', 'utf8');
const edge = fs.readFileSync('supabase/functions/feedback-admin/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/0008_product_feedback_operations.sql', 'utf8');
const browser = `${operations}\n${frontend}\n${styles}`;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(operations.includes("void import('./feedback-admin.js')"), 'Operations console must load the feedback inbox');
expect(frontend.includes('/functions/v1/feedback-admin'), 'Feedback frontend must call the protected Edge Function');
expect(frontend.includes("section.id = 'feedback-inbox'"), 'Feedback inbox must create a dedicated operations section');
expect(frontend.includes('feedback-filter-product'), 'Product filtering must be available');
expect(frontend.includes('feedback-filter-status'), 'Status filtering must be available');
expect(frontend.includes('feedback-filter-category'), 'Category filtering must be available');
expect(frontend.includes('data-feedback-note'), 'Private operator notes must be editable');
expect(frontend.includes("['owner', 'operator']"), 'Viewer roles must not receive write controls');
expect(frontend.includes("['http:', 'https:']"), 'Feedback source links must reject unsafe protocols');
expect(styles.includes('@media (max-width: 620px)'), 'Feedback inbox must include mobile layout rules');
expect(styles.includes('.feedback-operations'), 'Feedback workflow controls must have a dedicated layout');

expect(edge.includes('npm:@supabase/supabase-js@2.111.0'), 'Feedback Edge Function Supabase client must be pinned to the tested release');
expect(edge.includes('membership_admins'), 'Feedback API must verify the admin whitelist');
expect(edge.includes('Administrator access is required.'), 'Unauthorized feedback access must be rejected');
expect(edge.includes('userClient.auth.getUser(token)'), 'Feedback API must validate the caller JWT');
expect(edge.includes('getAuthenticatorAssuranceLevel(token)'), 'Feedback writes must independently verify AAL2');
expect(edge.includes('data.currentLevel !== "aal2"'), 'Feedback writes must fail closed below AAL2');
expect(edge.includes('requireOperator()'), 'Feedback updates must require operator access');
expect(edge.includes('action === "list"'), 'Feedback API must support listing');
expect(edge.includes('action === "update"'), 'Feedback API must support workflow updates');
expect(edge.includes('await requireAal2();'), 'Feedback workflow updates must require AAL2');
expect(edge.includes('membership_admin_actions'), 'Feedback updates must write to the append-only admin audit table');
expect(edge.includes('feedback_update'), 'Feedback audit entries must use a stable action type');
expect(edge.includes('Cache-Control'), 'Private feedback responses must disable shared caching');
expect(edge.includes('noteRaw.length > 2000'), 'Operator notes must have a server-side size limit');

expect(migration.includes('admin_note text'), 'Feedback operations migration must add private notes');
expect(migration.includes('reviewed_by uuid references auth.users'), 'Feedback reviews must record the administrator');
expect(migration.includes('product_feedback_product_status_created_idx'), 'Feedback inbox filters must have a composite index');
expect(migration.includes('product_feedback_reviewed_by_idx'), 'Feedback reviewer foreign key must be indexed');
expect(migration.includes('product_feedback_set_updated_at'), 'Feedback updates must maintain updated_at');

expect(!browser.match(/sk_(?:live|test)_[A-Za-z0-9]/), 'Stripe secret must not enter feedback browser code');
expect(!browser.includes('service_role'), 'Supabase service-role credentials must remain server-side');
expect(!browser.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Service-role secret names must not be referenced by the browser');

console.log('Protected product feedback inbox, workflow, audit, privacy, filtering, and responsive UI contracts passed');
