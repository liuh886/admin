import { createClient } from "npm:@supabase/supabase-js@2.111.0";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function namedEnv(name: string, legacyName: string): string {
  const raw = Deno.env.get(name);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.default) return parsed.default;
      const first = Object.values(parsed)[0];
      if (first) return first;
    } catch {
      if (raw.trim()) return raw.trim();
    }
  }
  return Deno.env.get(legacyName) ?? "";
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyStripeSignature(rawBody: string, header: string, secret: string): Promise<boolean> {
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2) ?? "";
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  const timestampNumber = Number(timestamp);
  if (!timestamp || signatures.length === 0 || !Number.isFinite(timestampNumber)) return false;
  if (Math.abs(Date.now() / 1000 - timestampNumber) > 300) return false;
  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  return signatures.some((signature) => secureEqual(signature, expected));
}

async function stripeGet(path: string): Promise<Record<string, any>> {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const payload = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(payload.error?.message ?? `Stripe request failed (${response.status})`);
  return payload;
}

function idOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) return String((value as { id: unknown }).id ?? "");
  return "";
}

function isoFromUnix(value: unknown): string | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await req.text();
  const signingSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const signature = req.headers.get("stripe-signature") ?? "";
  if (!signingSecret) return json({ error: "STRIPE_WEBHOOK_SECRET is not configured" }, 503);
  if (!await verifyStripeSignature(rawBody, signature, signingSecret)) {
    return json({ error: "Invalid Stripe signature" }, 400);
  }

  let event: Record<string, any>;
  try {
    event = JSON.parse(rawBody) as Record<string, any>;
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? namedEnv("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !adminKey) return json({ error: "Supabase admin key is unavailable" }, 503);

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const eventId = String(event.id ?? "");
  const eventType = String(event.type ?? "unknown");
  if (!eventId) return json({ error: "Stripe event ID is missing" }, 400);

  await admin.from("stripe_webhook_events").upsert({
    event_id: eventId,
    event_type: eventType,
    livemode: Boolean(event.livemode),
    received_at: new Date().toISOString(),
    processed_at: null,
    last_error: null,
  }, { onConflict: "event_id" });

  const syncSubscription = async (subscription: Record<string, any>) => {
    const subscriptionId = String(subscription.id ?? "");
    const customerId = idOf(subscription.customer);
    const price = subscription.items?.data?.[0]?.price ?? {};
    const priceId = idOf(price);
    if (!subscriptionId || !customerId || !priceId) throw new Error("Subscription identifiers are incomplete");

    let userId = String(subscription.metadata?.supabase_user_id ?? "");
    if (!userId) {
      const { data: customerRow } = await admin
        .from("billing_customers")
        .select("user_id")
        .eq("customer_id", customerId)
        .maybeSingle();
      userId = String(customerRow?.user_id ?? "");
    }
    if (!userId) throw new Error(`No Supabase user is mapped to Stripe customer ${customerId}`);

    const { data: priceRow, error: priceError } = await admin
      .from("billing_prices")
      .select("product_code")
      .eq("price_id", priceId)
      .maybeSingle();
    if (priceError || !priceRow) throw new Error(`Stripe price ${priceId} is not registered in billing_prices`);

    const productCode = String(subscription.metadata?.product_code ?? priceRow.product_code);
    const status = String(subscription.status ?? "unknown");
    const currentPeriodEnd = isoFromUnix(subscription.current_period_end);
    const active = ["active", "trialing", "past_due"].includes(status);
    const stripeProductId = idOf(price.product);

    const { error: customerError } = await admin.from("billing_customers").upsert({
      user_id: userId,
      provider: "stripe",
      customer_id: customerId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (customerError) throw customerError;

    const { error: subscriptionError } = await admin.from("subscriptions").upsert({
      id: subscriptionId,
      user_id: userId,
      provider: "stripe",
      product_code: productCode,
      customer_id: customerId,
      price_id: priceId,
      status,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      metadata: subscription.metadata ?? {},
      livemode: Boolean(subscription.livemode),
      stripe_product_id: stripeProductId || null,
      ended_at: isoFromUnix(subscription.ended_at ?? subscription.canceled_at),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (subscriptionError) throw subscriptionError;

    const { data: mappings, error: mappingError } = await admin
      .from("billing_product_entitlements")
      .select("entitlement_code")
      .eq("product_code", productCode);
    if (mappingError) throw mappingError;
    if (!mappings || mappings.length === 0) throw new Error(`No entitlements are mapped to ${productCode}`);

    const { error: deleteError } = await admin
      .from("entitlement_grants")
      .delete()
      .eq("user_id", userId)
      .eq("source", "stripe_subscription")
      .eq("source_ref", subscriptionId);
    if (deleteError) throw deleteError;

    const grants = mappings.map((mapping) => ({
      user_id: userId,
      entitlement_code: mapping.entitlement_code,
      source: "stripe_subscription",
      source_ref: subscriptionId,
      active,
      valid_until: currentPeriodEnd,
      metadata: {
        product_code: productCode,
        price_id: priceId,
        status,
        trial_source: subscription.metadata?.trial_source ?? null,
        membership_invite_id: subscription.metadata?.membership_invite_id ?? null,
      },
      updated_at: new Date().toISOString(),
    }));
    const { error: grantError } = await admin.from("entitlement_grants").insert(grants);
    if (grantError) throw grantError;

    const { error: refreshError } = await admin.rpc("refresh_effective_entitlements", { p_user_id: userId });
    if (refreshError) throw refreshError;
  };

  try {
    const object = event.data?.object ?? {};
    if (eventType === "checkout.session.completed") {
      const userId = String(object.client_reference_id ?? object.metadata?.supabase_user_id ?? "");
      const customerId = idOf(object.customer);
      if (userId && customerId) {
        const { error } = await admin.from("billing_customers").upsert({
          user_id: userId,
          provider: "stripe",
          customer_id: customerId,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (error) throw error;
      }

      const inviteId = String(object.metadata?.membership_invite_id ?? "");
      if (inviteId && userId) {
        const { error: inviteError } = await admin.from("membership_invites").update({
          redeemed_by: userId,
          redeemed_at: new Date().toISOString(),
        }).eq("id", inviteId).eq("redeemed_by", userId).is("redeemed_at", null);
        if (inviteError) throw inviteError;
      }

      const subscriptionId = idOf(object.subscription);
      if (subscriptionId) await syncSubscription(await stripeGet(`subscriptions/${subscriptionId}`));
    } else if ([
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ].includes(eventType)) {
      await syncSubscription(object);
    } else if (["invoice.paid", "invoice.payment_failed"].includes(eventType)) {
      const subscriptionId = idOf(object.subscription)
        || idOf(object.parent?.subscription_details?.subscription);
      if (subscriptionId) await syncSubscription(await stripeGet(`subscriptions/${subscriptionId}`));
    }

    await admin.from("stripe_webhook_events").update({
      processed_at: new Date().toISOString(),
      last_error: null,
    }).eq("event_id", eventId);
    return json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    console.error("stripe-webhook", eventId, message);
    await admin.from("stripe_webhook_events").update({ last_error: message }).eq("event_id", eventId);
    return json({ error: message }, 500);
  }
});
