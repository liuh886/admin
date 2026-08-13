import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';

if (!window.__HAO_REFERRAL_MODE__) {
  const SUPABASE_URL = 'https://blgwlycfcwvsupmqyqwn.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_n1Va-c_alpkQ0zNuJYUaxA_J0u68RVW';
  const REFERRAL_URL = `${SUPABASE_URL}/functions/v1/product-referral`;
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
  });

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  async function call(action, payload = {}) {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.access_token) throw new Error('管理员登录会话不可用。');
    const response = await fetch(REFERRAL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: PUBLISHABLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error(result.error || 'Referral 管理服务不可用。');
    return result;
  }

  function ensureSection() {
    let section = document.querySelector('#product-referral-policy');
    if (section) return section;
    section = document.createElement('section');
    section.id = 'product-referral-policy';
    section.className = 'referral-policy-section';
    section.hidden = true;
    section.innerHTML = `
      <div class="section-heading">
        <div>
          <p class="eyebrow">PRODUCT REFERRAL</p>
          <h2>邀请增长政策</h2>
          <p>每个登录用户拥有稳定的产品专属邀请链接。只有邀请人在领取时具备有效 Pro 权益，受邀新用户才获得这里配置的免费 Pro 时长。</p>
        </div>
      </div>
      <article class="panel">
        <div class="panel-heading">
          <div><p class="eyebrow">SERVER-AUTHORITATIVE POLICY</p><h3>受邀用户 Pro 免费期</h3></div>
          <span class="subtle">0 = 不赠送 · 最长 730 天</span>
        </div>
        <div id="referral-policy-list" class="referral-policy-list"></div>
        <p id="referral-policy-status" class="status-line" role="status" aria-live="polite"></p>
      </article>`;
    document.querySelector('.search-panel')?.before(section);
    return section;
  }

  function render(catalog) {
    const section = ensureSection();
    const list = section.querySelector('#referral-policy-list');
    list.innerHTML = (catalog.products || []).map((product) => `
      <form class="referral-policy-row" data-product-code="${escapeHtml(product.product_code)}">
        <div class="referral-policy-product">
          <strong>${escapeHtml(product.name)}</strong>
          <small>${escapeHtml(product.product_code)}</small>
        </div>
        <label>
          <span>免费 Pro</span>
          <div class="referral-days-input">
            <input type="number" min="0" max="730" step="1" required value="${Number(product.referral_trial_days || 0)}">
            <span>天</span>
          </div>
        </label>
        <div class="referral-policy-metrics">
          <span><strong>${Number(product.referral_links || 0)}</strong> 链接</span>
          <span><strong>${Number(product.joined_count || 0)}</strong> 加入</span>
          <span><strong>${Number(product.trial_count || 0)}</strong> Pro 体验</span>
        </div>
        <button class="button ghost compact" type="submit">保存</button>
      </form>`).join('');
    const status = section.querySelector('#referral-policy-status');
    list.querySelectorAll('.referral-policy-row').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button');
        const input = form.querySelector('input');
        button.disabled = true;
        status.textContent = `正在更新 ${form.dataset.productCode}…`;
        delete status.dataset.kind;
        try {
          await call('set_policy', {
            product_code: form.dataset.productCode,
            referral_trial_days: Number(input.value)
          });
          status.textContent = 'Referral 政策已更新并立即生效。';
          status.dataset.kind = 'success';
          render(await call('admin_catalog'));
        } catch (error) {
          status.textContent = error.message;
          status.dataset.kind = 'error';
        } finally {
          button.disabled = false;
        }
      });
    });
    section.hidden = false;
  }

  async function load() {
    try {
      render(await call('admin_catalog'));
    } catch {
      document.querySelector('#product-referral-policy')?.setAttribute('hidden', '');
    }
  }

  client.auth.onAuthStateChange((_event, session) => {
    if (session) window.setTimeout(() => void load(), 0);
  });
  const { data } = await client.auth.getSession();
  if (data.session) await load();
}
