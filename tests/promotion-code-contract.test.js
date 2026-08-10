import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const browser = fs.readFileSync('promotion.js', 'utf8');
const css = fs.readFileSync('promotion.css', 'utf8');
const edge = fs.readFileSync('supabase/functions/promotion-code/index.ts', 'utf8');
const checkout = fs.readFileSync('supabase/functions/create-checkout-session/index.ts', 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(html.includes('src="./promotion.js"'), 'Admin shell must load the promotion code module');
expect(browser.includes('公开会员促销码'), 'Admin must expose a clear public promotion-code surface');
expect(browser.includes('name="promotion-product"'), 'Promotion creation must support product-level multi-select');
expect(browser.includes('折后支付比例'), 'Admin must express the discount as the customer pay percentage');
expect(browser.includes('活动截止时间'), 'Admin must separate campaign redemption expiry from discount duration');
expect(browser.includes("value=\"forever\""), 'Admin must support permanent discounts');
expect(browser.includes("value=\"months\""), 'Admin must support fixed-month discounts');
expect(browser.includes("callPromotion('create'"), 'Promotion creation must use the protected Edge Function');
expect(browser.includes("callPromotion('deactivate'"), 'Promotion deactivation must use the protected Edge Function');
expect(browser.includes('Stripe 为唯一促销事实源'), 'Admin must keep Stripe as the promotion source of truth');
expect(css.includes('.promotion-product-options') && css.includes('.promotion-record'), 'Promotion UI must have responsive dedicated styles');

expect(edge.includes('npm:@supabase/supabase-js@2.111.0'), 'Promotion Edge Function must pin the tested Supabase client');
expect(edge.includes('userClient.auth.getUser(token)'), 'Promotion administration must authenticate the admin JWT');
expect(edge.includes('getAuthenticatorAssuranceLevel(token)'), 'Promotion mutations must require AAL2');
expect(edge.includes('membership_admins'), 'Promotion mutations must require the admin whitelist');
expect(edge.includes('billing_products'), 'Promotion product scope must resolve from the billing catalog');
expect(edge.includes('stripe_product_id'), 'Promotion coupons must target canonical Stripe products');
expect(edge.includes('stripePost("coupons"'), 'Promotion creation must create a Stripe Coupon');
expect(edge.includes('stripePost("promotion_codes"'), 'Promotion creation must create a Stripe Promotion Code');
expect(edge.includes('promotion[type]') && edge.includes('promotion[coupon]'), 'Promotion Code must use the current Stripe promotion object contract');
expect(edge.includes('applies_to[products]'), 'Coupon must be limited to the selected Stripe products');
expect(edge.includes('duration_in_months'), 'Fixed-length discounts must map to Stripe repeating coupon duration');
expect(edge.includes('expires_at'), 'Campaign availability must map to Promotion Code expiry');
expect(edge.includes('max_redemptions'), 'Promotion codes must support an optional redemption cap');
expect(edge.includes('active: "false"'), 'Admin must be able to stop future redemptions without deleting history');
expect(edge.includes('membership_admin_actions'), 'Promotion mutations must remain in the existing audit trail');
expect(!edge.includes('.from("promotion'), 'Promotion state must not be duplicated into a new Supabase promotion table');

expect(checkout.includes('params.set("allow_promotion_codes", "true")'), 'Every normal subscription Checkout must accept Stripe promotion codes');
expect(!browser.includes('STRIPE_SECRET_KEY') && !browser.includes('service_role'), 'Browser promotion code assets must not contain privileged secrets');

console.log('Stripe-native promotion code contract checks passed');
