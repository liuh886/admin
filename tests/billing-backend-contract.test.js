import fs from 'node:fs';

const checkout = fs.readFileSync('supabase/functions/create-checkout-session/index.ts', 'utf8');
const portal = fs.readFileSync('supabase/functions/create-portal-session/index.ts', 'utf8');
const webhook = fs.readFileSync('supabase/functions/stripe-webhook/index.ts', 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [name, source] of [['checkout', checkout], ['portal', portal], ['webhook', webhook]]) {
  expect(source.includes('npm:@supabase/supabase-js@2.111.0'), `${name} must pin the tested Supabase client`);
  expect(!source.includes('npm:@supabase/supabase-js@2"'), `${name} must not float on the Supabase v2 major`);
  expect(source.includes('SUPABASE_SERVICE_ROLE_KEY'), `${name} must keep privileged database access server-side`);
}

expect(checkout.includes('userClient.auth.getUser(token)'), 'Checkout must authenticate the customer JWT');
expect(checkout.includes('.from("billing_prices")'), 'Checkout must resolve price IDs from the server-side catalog');
expect(checkout.includes('.eq("is_default", true)'), 'Checkout must use the active default price');
expect(checkout.includes('mode", "subscription"'), 'Checkout must create Stripe subscriptions');
expect(checkout.includes('client_reference_id'), 'Checkout must bind the Stripe session to the Supabase user');
expect(checkout.includes('subscription_data[metadata][product_code]'), 'Checkout must preserve product ownership in subscription metadata');
expect(checkout.includes('allow_promotion_codes'), 'Normal subscription Checkout must accept Stripe Promotion Codes');

expect(portal.includes('userClient.auth.getUser(token)'), 'Customer Portal creation must authenticate the customer JWT');
expect(portal.includes('billing_customers'), 'Customer Portal must resolve the canonical Stripe customer mapping');
expect(portal.includes('Idempotency-Key'), 'Customer creation from the portal path must be idempotent');
expect(portal.includes('billing_portal/sessions'), 'Subscription management must use Stripe Customer Portal');

expect(webhook.includes('STRIPE_WEBHOOK_SECRET'), 'Webhook must require the Stripe signing secret');
expect(webhook.includes('verifyStripeSignature'), 'Webhook must verify Stripe signatures before processing events');
expect(webhook.includes('customer.subscription.updated'), 'Webhook must process subscription updates');
expect(webhook.includes('customer.subscription.deleted'), 'Webhook must process subscription deletion');
expect(webhook.includes('invoice.payment_failed'), 'Webhook must reconcile failed invoice payment state');
expect(webhook.includes('status === "trialing"') && webhook.includes('subscription.trial_end ?? subscription.current_period_end'), 'Trial subscriptions must persist the Stripe trial end instead of losing expiry');
expect(webhook.includes('refresh_effective_entitlements'), 'Webhook must refresh effective entitlements after subscription changes');
expect(webhook.includes('stripe_webhook_events'), 'Webhook events must remain auditable and idempotently recorded');
expect(webhook.includes('cancel_at_period_end'), 'Subscription cancellation scheduling must be persisted');

console.log('Canonical shared billing backend contract checks passed');
