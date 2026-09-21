import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

const cases = [
  ['membership-admin', 'grant', /valid user email/i],
  ['membership-invite', 'create', /product/i],
  ['feedback-admin', 'update', /valid feedback ID/i],
  ['promotion-code', 'create', /code/i],
  ['promotion-code', 'deactivate', /Invalid promotion code identifier/i],
  ['product-referral', 'set_policy', /product/i],
];

// Execute the real Edge handlers with Auth/database boundaries stubbed. No MFA
// API exists in the client: ordinary authenticated sessions must be sufficient.
function handler(name, { role = 'owner', active = true, validToken = true, listed = true } = {}) {
  let serve;
  const source = fs.readFileSync(`supabase/functions/${name}/index.ts`, 'utf8')
    .replace(/^import .*;\n/gm, '');
  const context = {
    Request, Response, URL, URLSearchParams, crypto, console, sdkCorsHeaders: {},
    Deno: {
      env: { get: key => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] },
      serve: callback => { serve = callback; },
    },
    createClient: (_url, key) => key === 'public' ? {
      auth: { getUser: async token => {
        assert.equal(token, 'session');
        return { data: { user: validToken ? { id: 'admin-user' } : null }, error: validToken ? null : new Error('Invalid JWT') };
      } },
    } : {
      from: table => {
        assert.equal(table, 'membership_admins', 'Unauthorized requests must stop before reading or writing business data');
        const query = {
          select: () => query,
          eq: (column, value) => {
            assert.equal(column, 'user_id');
            assert.equal(value, 'admin-user');
            return query;
          },
          maybeSingle: async () => ({ data: listed ? { role, active } : null, error: null }),
        };
        return query;
      },
    },
    fetch: () => { throw new Error('Unexpected external request'); },
  };
  vm.runInNewContext(stripTypeScriptTypes(source), context, { filename: `${name}/index.ts` });
  return async (action, authenticated = true) => {
    const response = await serve(new Request('https://example.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: 'public', ...(authenticated ? { Authorization: 'Bearer session' } : {}) },
      body: JSON.stringify({ action }),
    }));
    return { status: response.status, body: await response.json() };
  };
}

for (const [name, action, validationError] of cases) {
  for (const role of ['owner', 'operator']) {
    test(`${name}/${action}: ${role} without MFA reaches input validation`, async () => {
      const result = await handler(name, { role })(action);
      assert.equal(result.status, 400);
      assert.match(result.body.error, validationError);
    });
  }
  for (const [label, options] of [['non-admin', { listed: false }], ['inactive admin', { active: false }], ['viewer', { role: 'viewer' }]]) {
    test(`${name}/${action}: rejects ${label}`, async () => {
      const result = await handler(name, options)(action);
      assert.ok(result.status >= 400);
      assert.match(result.body.error, /access is required|requires operator access/i);
    });
  }
  test(`${name}/${action}: rejects missing and invalid sessions`, async () => {
    for (const authenticated of [false, true]) {
      const result = await handler(name, { validToken: false })(action, authenticated);
      assert.ok(result.status >= 400);
      assert.match(result.body.error, /authentication/i);
    }
  });
}

for (const action of ['refund', 'cancel_subscription']) {
  test(`${action}: operator still cannot perform owner-only financial actions`, async () => {
    const result = await handler('membership-admin', { role: 'operator' })(action);
    assert.match(result.body.error, /requires owner access/i);
  });
}
