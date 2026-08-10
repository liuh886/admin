import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';

const SUPABASE_URL = 'https://blgwlycfcwvsupmqyqwn.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_n1Va-c_alpkQ0zNuJYUaxA_J0u68RVW';
const PROMOTION_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/promotion-code`;

const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = './promotion.css';
document.head.appendChild(stylesheet);

const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
});

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function defaultCampaignExpiry() {
  const date = new Date();
  date.setMonth(date.getMonth() + 3);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function productNames(codes, productMap) {
  return (Array.isArray(codes) ? codes : []).map((code) => productMap.get(code) || code).join(' · ');
}

function discountDurationLabel(item) {
  if (item.duration === 'forever') return '永久有效';
  if (item.duration === 'repeating') return `${item.duration_in_months || '—'} 个月`;
  return '—';
}

function payLabel(percentOff) {
  const pay = Math.max(0, 100 - Number(percentOff || 0));
  return `支付 ${Number.isInteger(pay) ? pay : pay.toFixed(2)}%`;
}

async function callPromotion(action, payload = {}) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('请先登录后再继续。');
  const response = await fetch(PROMOTION_FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action, ...payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `促销码请求失败（${response.status}）`);
  return result;
}

function productOptions(products) {
  return (products || []).map((product) => `
    <label class="promotion-product-option">
      <input type="checkbox" name="promotion-product" value="${escapeHtml(product.product_code)}">
      <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.app_url)}</small></span>
    </label>`).join('');
}

function renderPromotions(catalog) {
  const target = document.querySelector('#promotion-list');
  if (!target) return;
  const productMap = new Map((catalog.products || []).map((item) => [item.product_code, item.name]));
  const items = catalog.promotions || [];
  target.innerHTML = items.length ? items.map((item) => `
    <article class="promotion-record">
      <div class="promotion-record-main">
        <div class="promotion-code-line">
          <strong>${escapeHtml(item.code)}</strong>
          <span class="badge ${item.active ? 'active' : 'inactive'}">${item.active ? '可领取' : '已停用'}</span>
        </div>
        <span>${escapeHtml(productNames(item.product_codes, productMap))}</span>
        <small>${escapeHtml(payLabel(item.percent_off))} · ${escapeHtml(discountDurationLabel(item))} · 活动截止 ${escapeHtml(formatDate(item.expires_at))}</small>
      </div>
      <div class="promotion-record-side">
        <span>${escapeHtml(String(item.times_redeemed || 0))}${item.max_redemptions ? ` / ${escapeHtml(String(item.max_redemptions))}` : ''} 次兑换</span>
        ${item.active && catalog.can_manage ? `<button class="button ghost compact" type="button" data-deactivate-promotion="${escapeHtml(item.id)}">停用</button>` : ''}
      </div>
    </article>`).join('') : '<p class="empty-copy">尚未创建公开促销码。</p>';

  target.querySelectorAll('[data-deactivate-promotion]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm('停用后，新用户将不能再使用这个码；已经领取的折扣不会被撤销。继续？')) return;
      button.disabled = true;
      try {
        await callPromotion('deactivate', { promotion_code_id: button.dataset.deactivatePromotion });
        await loadPromotionModule();
      } catch (error) {
        const status = document.querySelector('#promotion-status');
        if (status) {
          status.textContent = error.message;
          status.dataset.kind = 'error';
        }
        button.disabled = false;
      }
    });
  });
}

function ensurePromotionModule(catalog) {
  let section = document.querySelector('#promotion-admin-section');
  if (!section) {
    section = document.createElement('section');
    section.id = 'promotion-admin-section';
    section.className = 'promotion-admin-section';
    section.innerHTML = `
      <div class="section-heading">
        <div>
          <p class="eyebrow">PROMOTION CODES</p>
          <h2>公开会员促销码</h2>
          <p>创建可公开分享的 Stripe 促销码。活动截止时间只决定“什么时候还能领取”；折扣持续期决定“领取后优惠保持多久”。</p>
        </div>
      </div>
      <div class="promotion-grid">
        <article class="panel">
          <div class="panel-heading"><div><p class="eyebrow">CREATE</p><h3>创建促销码</h3></div></div>
          <form id="promotion-form" class="stack-form">
            <label class="full"><span>促销码</span><input id="promotion-code" type="text" maxlength="64" pattern="[A-Za-z0-9-]{3,64}" placeholder="例如 HAO2026" required></label>
            <fieldset class="full promotion-products-fieldset">
              <legend>适用 Pro 产品</legend>
              <div id="promotion-products" class="promotion-product-options"></div>
            </fieldset>
            <label><span>折后支付比例</span><input id="promotion-pay-percent" type="number" min="0" max="99.99" step="0.01" value="80" required><small>80 = 八折；50 = 五折；0 = 免费</small></label>
            <label><span>折扣持续期</span>
              <select id="promotion-duration-type" required>
                <option value="forever">永久</option>
                <option value="months">固定月数</option>
              </select>
            </label>
            <label id="promotion-duration-months-wrap" hidden><span>持续月数</span><input id="promotion-duration-months" type="number" min="1" max="120" value="36"></label>
            <label><span>活动截止时间</span><input id="promotion-expires-at" type="datetime-local" required></label>
            <label><span>最多兑换次数（可选）</span><input id="promotion-max-redemptions" type="number" min="1" step="1" placeholder="留空 = 不限制"></label>
            <div class="full promotion-note">
              <strong>结算规则</strong>
              <span>所有正常新订阅的 Stripe Checkout 都可以输入促销码。活动截止后不能新领；已经领到的永久/限时折扣按原规则继续。</span>
            </div>
            <button class="button primary full" type="submit">创建公开促销码</button>
          </form>
          <p id="promotion-status" class="status-line" role="status" aria-live="polite"></p>
        </article>
        <article class="panel promotion-result-panel">
          <div class="panel-heading"><div><p class="eyebrow">SHARE</p><h3>活动信息</h3></div></div>
          <div id="promotion-result" class="promotion-result-empty">
            <p>创建后可以直接把促销码放到活动页、社交媒体或邮件里。用户在产品的 Stripe Checkout 中输入即可。</p>
          </div>
        </article>
      </div>
      <article class="panel">
        <div class="panel-heading"><div><p class="eyebrow">CAMPAIGNS</p><h3>促销码状态</h3></div><span class="subtle">Stripe 为唯一促销事实源</span></div>
        <div id="promotion-list" class="promotion-list"></div>
      </article>`;
    document.querySelector('.search-panel')?.before(section);
  }

  section.querySelector('#promotion-products').innerHTML = productOptions(catalog.products);
  const expiresInput = section.querySelector('#promotion-expires-at');
  if (!expiresInput.value) expiresInput.value = defaultCampaignExpiry();
  renderPromotions(catalog);

  const durationType = section.querySelector('#promotion-duration-type');
  const monthsWrap = section.querySelector('#promotion-duration-months-wrap');
  const monthsInput = section.querySelector('#promotion-duration-months');
  const syncDuration = () => {
    const usesMonths = durationType.value === 'months';
    monthsWrap.hidden = !usesMonths;
    monthsInput.required = usesMonths;
  };
  durationType.onchange = syncDuration;
  syncDuration();

  const form = section.querySelector('#promotion-form');
  const status = section.querySelector('#promotion-status');
  if (!catalog.can_manage) {
    form.querySelectorAll('input, select, button').forEach((element) => { element.disabled = true; });
    status.textContent = '当前管理员角色为只读，不能管理促销码。';
    status.dataset.kind = 'error';
  }

  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!catalog.can_manage) return;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = '正在创建 Stripe Coupon 与 Promotion Code…';
    delete status.dataset.kind;
    try {
      const selectedProducts = [...section.querySelectorAll('input[name="promotion-product"]:checked')]
        .map((input) => input.value);
      if (!selectedProducts.length) throw new Error('请至少选择一个 Pro 产品。');
      const type = durationType.value;
      const result = await callPromotion('create', {
        code: section.querySelector('#promotion-code').value,
        product_codes: selectedProducts,
        pay_percent: Number(section.querySelector('#promotion-pay-percent').value),
        discount_duration: type === 'forever'
          ? { type: 'forever' }
          : { type: 'months', months: Number(monthsInput.value) },
        campaign_expires_at: new Date(section.querySelector('#promotion-expires-at').value).toISOString(),
        max_redemptions: section.querySelector('#promotion-max-redemptions').value || null
      });
      const promo = result.promotion;
      const resultBox = section.querySelector('#promotion-result');
      resultBox.className = 'promotion-result-ready';
      resultBox.innerHTML = `
        <p class="eyebrow">READY TO SHARE</p>
        <strong>${escapeHtml(promo.code)}</strong>
        <span>${escapeHtml(`支付 ${promo.pay_percent}%`)} · ${promo.discount_duration.stripe === 'forever' ? '永久优惠' : `${escapeHtml(String(promo.discount_duration.months))} 个月优惠`}</span>
        <span>活动截止 ${escapeHtml(formatDate(promo.campaign_expires_at))}</span>
        <button id="promotion-copy-code" class="button ghost compact" type="button">复制促销码</button>
        <small>活动页只需要展示这个码并链接到对应产品；用户在 Stripe Checkout 输入后按此优惠订阅。</small>`;
      resultBox.querySelector('#promotion-copy-code')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(promo.code);
        resultBox.querySelector('#promotion-copy-code').textContent = '已复制';
      });
      status.textContent = '促销码已创建。';
      status.dataset.kind = 'success';
      form.reset();
      expiresInput.value = defaultCampaignExpiry();
      syncDuration();
      const refreshed = await callPromotion('catalog');
      section.querySelector('#promotion-products').innerHTML = productOptions(refreshed.products);
      renderPromotions(refreshed);
    } catch (error) {
      status.textContent = error.message;
      status.dataset.kind = 'error';
    } finally {
      submit.disabled = false;
    }
  };

  section.hidden = false;
}

async function loadPromotionModule() {
  try {
    const catalog = await callPromotion('catalog');
    ensurePromotionModule(catalog);
  } catch {
    document.querySelector('#promotion-admin-section')?.setAttribute('hidden', '');
  }
}

client.auth.onAuthStateChange((_event, session) => {
  if (session) window.setTimeout(() => void loadPromotionModule(), 0);
});
const { data } = await client.auth.getSession();
if (data.session) await loadPromotionModule();
