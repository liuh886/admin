import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const ALLOWED_ORIGINS = new Set([
  "https://liuh886.github.io",
  "http://localhost:4173",
  "http://localhost:8000",
]);
const ADMIN_URL = "https://liuh886.github.io/admin/";
const MAX_DURATION_DAYS = 730;
const MANAGEABLE_STATUSES = ["active", "trialing", "past_due", "unpaid"];

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

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://liuh886.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function durationDays(value: unknown): number {
  const days = Math.trunc(Number(value));
  if (!Number.isFinite(days) || days < 1 || days > MAX_DURATION_DAYS) {
    throw new Error(`Free trial duration must be between 1 and ${MAX_DURATION_DAYS} days.`);
  }
  return days;
}

function productCodes(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("At least one Pro product is required.");
  const codes = [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
  if (!codes.length) throw new Error("At least one Pro product is required.");
  return codes;
}

function idOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id: unknown }).id ?? "");
  }
  return "";
}

function isoFromUnix(value: unknown): string | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;
}

async function stripePost(
  path: string,
  params: URLSearchParams,
  idempotencyKey?: string,
): Promise<Record<string, any>> {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers,
    body: params,
  });
  const payload = await response.json() as Record<string, any>;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Stripe request failed (${response.status}).`);
  }
  return payload;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);

  const origin = req.headers.get("origin") ?? "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(req, { error: "Origin is not allowed." }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = namedEnv("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? namedEnv("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("authorization") ?? "";
  if (!supabaseUrl || !publishableKey || !serviceKey || !authHeader.startsWith("Bearer ")) {
    return json(req, { error: "Authentication is unavailable." }, 401);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.slice("Bearer ".length);
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json(req, { error: "Authentication failed." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const actor = authData.user;

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json(req, { error: "Invalid JSON payload." }, 400);
  }
  const action = String(body.action ?? "catalog");

  async function requireAal2(): Promise<void> {
    const { data, error } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel(token);
    if (error || data.currentLevel !== "aal2") {
      throw new Error("AAL2 multi-factor authentication is required to create membership invitations.");
    }
  }

  async function adminRole(): Promise<string | null> {
    const { data, error } = await admin
      .from("membership_admins")
      .select("role,active")
      .eq("user_id", actor.id)
      .maybeSingle();
    if (error || !data?.active) return null;
    return String(data.role);
  }

  async function ensureCustomer(): Promise<string> {
    const { data: existing, error: readError } = await admin
      .from("billing_customers")
      .select("customer_id")
      .eq("user_id", actor.id)
      .maybeSingle();
    if (readError) throw readError;
    if (existing?.customer_id) return String(existing.customer_id);

    const params = new URLSearchParams();
    if (actor.email) params.set("email", actor.email);
    params.set("description", `Hao Apps member ${actor.id}`);
    params.set("metadata[supabase_user_id]", actor.id);
    const customer = await stripePost("customers", params, `hao-customer-${actor.id}`);
    const customerId = String(customer.id ?? "");
    if (!customerId) throw new Error("Stripe customer was not created.");

    const { error: writeError } = await admin.from("billing_customers").upsert({
      user_id: actor.id,
      provider: "stripe",
      customer_id: customerId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (writeError) throw writeError;
    return customerId;
  }

  async function syncCreatedSubscription(
    subscription: Record<string, any>,
    productCode: string,
    priceId: string,
    entitlementCodes: string[],
    inviteId: string,
  ): Promise<void> {
    const subscriptionId = String(subscription.id ?? "");
    const customerId = idOf(subscription.customer);
    if (!subscriptionId || !customerId) {
      throw new Error("Stripe subscription identifiers are incomplete.");
    }

    const status = String(subscription.status ?? "trialing");
    const periodEnd = isoFromUnix(subscription.trial_end ?? subscription.current_period_end);
    const price = subscription.items?.data?.[0]?.price ?? {};
    const stripeProductId = idOf(price.product);

    const { error: subscriptionError } = await admin.from("subscriptions").upsert({
      id: subscriptionId,
      user_id: actor.id,
      provider: "stripe",
      product_code: productCode,
      customer_id: customerId,
      price_id: priceId,
      status,
      current_period_end: periodEnd,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      metadata: subscription.metadata ?? {},
      livemode: Boolean(subscription.livemode),
      stripe_product_id: stripeProductId || null,
      ended_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (subscriptionError) throw subscriptionError;

    const { error: deleteError } = await admin
      .from("entitlement_grants")
      .delete()
      .eq("user_id", actor.id)
      .eq("source", "stripe_subscription")
      .eq("source_ref", subscriptionId);
    if (deleteError) throw deleteError;

    const grants = entitlementCodes.map((entitlementCode) => ({
      user_id: actor.id,
      entitlement_code: entitlementCode,
      source: "stripe_subscription",
      source_ref: subscriptionId,
      active: ["active", "trialing", "past_due"].includes(status),
      valid_until: periodEnd,
      metadata: {
        product_code: productCode,
        price_id: priceId,
        status,
        trial_source: "membership_invite",
        membership_invite_id: inviteId,
      },
      updated_at: new Date().toISOString(),
    }));
    const { error: grantError } = await admin.from("entitlement_grants").insert(grants);
    if (grantError) throw grantError;
  }

  try {
    if (action === "catalog") {
      const role = await adminRole();
      if (!role) return json(req, { error: "Administrator access is required." }, 403);

      const [productsResult, mappingsResult, invitesResult] = await Promise.all([
        admin.from("billing_products")
          .select("product_code,name,app_url,active")
          .eq("active", true)
          .order("name"),
        admin.from("billing_product_entitlements")
          .select("product_code,entitlement_code")
          .like("entitlement_code", "%.pro")
          .order("product_code"),
        admin.from("membership_invites")
          .select("id,product_codes,duration_days,created_at,redeemed_by,redeemed_at")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (productsResult.error) throw productsResult.error;
      if (mappingsResult.error) throw mappingsResult.error;
      if (invitesResult.error) throw invitesResult.error;

      const mappedCodes = new Set((mappingsResult.data ?? []).map((row) => String(row.product_code)));
      const products = (productsResult.data ?? []).filter((product) => mappedCodes.has(String(product.product_code)));
      return json(req, {
        actor: { id: actor.id, email: actor.email, role },
        can_create: ["owner", "operator"].includes(role),
        products,
        recent_invites: invitesResult.data ?? [],
      });
    }

    if (action === "create") {
      await requireAal2();
      const role = await adminRole();
      if (!role || !["owner", "operator"].includes(role)) {
        return json(req, { error: "This action requires operator access." }, 403);
      }

      const selectedCodes = productCodes(body.product_codes);
      const days = durationDays(body.duration_days);
      const [productsResult, mappingsResult] = await Promise.all([
        admin.from("billing_products")
          .select("product_code,name,app_url,active")
          .in("product_code", selectedCodes)
          .eq("active", true),
        admin.from("billing_product_entitlements")
          .select("product_code,entitlement_code")
          .in("product_code", selectedCodes)
          .like("entitlement_code", "%.pro"),
      ]);
      if (productsResult.error) throw productsResult.error;
      if (mappingsResult.error) throw mappingsResult.error;

      const productByCode = new Map((productsResult.data ?? []).map((row) => [String(row.product_code), row]));
      const mappedCodes = new Set((mappingsResult.data ?? []).map((row) => String(row.product_code)));
      const missing = selectedCodes.filter((code) => !productByCode.has(code) || !mappedCodes.has(code));
      if (missing.length) throw new Error(`Unavailable Pro product: ${missing.join(", ")}`);

      const rawToken = randomToken();
      const tokenHash = await sha256Hex(rawToken);
      const { data: invite, error: insertError } = await admin
        .from("membership_invites")
        .insert({
          token_hash: tokenHash,
          product_codes: selectedCodes,
          duration_days: days,
          created_by: actor.id,
        })
        .select("id,created_at")
        .single();
      if (insertError || !invite) throw insertError ?? new Error("Invitation could not be created.");

      const { error: auditError } = await admin.from("membership_admin_actions").insert({
        actor_user_id: actor.id,
        action_type: "create_invite",
        reason: "Single-use multi-product Stripe free trial invite",
        status: "completed",
        request_payload: { duration_days: days, product_codes: selectedCodes },
        result_payload: { invite_id: invite.id },
      });
      if (auditError) console.error("membership invite audit write failed", auditError);

      return json(req, {
        ok: true,
        invite_id: invite.id,
        created_at: invite.created_at,
        products: selectedCodes.map((code) => productByCode.get(code)),
        duration_days: days,
        invite_url: `${ADMIN_URL}#invite=${encodeURIComponent(rawToken)}`,
      });
    }

    if (action === "redeem") {
      const rawToken = String(body.token ?? "").trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(rawToken)) throw new Error("Invitation link is invalid.");
      const tokenHash = await sha256Hex(rawToken);

      const { data: invite, error: inviteError } = await admin
        .from("membership_invites")
        .select("id,product_codes,duration_days,created_by,redeemed_by,redeemed_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (inviteError || !invite) throw new Error("Invitation link is invalid.");
      if (invite.redeemed_at) throw new Error("Invitation link has already been used.");
      if (invite.redeemed_by && invite.redeemed_by !== actor.id) {
        throw new Error("Invitation link has already been claimed.");
      }

      if (!invite.redeemed_by) {
        const { data: claimed, error: claimError } = await admin
          .from("membership_invites")
          .update({ redeemed_by: actor.id })
          .eq("id", invite.id)
          .is("redeemed_by", null)
          .is("redeemed_at", null)
          .select("id")
          .maybeSingle();
        if (claimError) throw claimError;
        if (!claimed) throw new Error("Invitation link has already been claimed.");
      }

      const selectedCodes = productCodes(invite.product_codes);
      const days = durationDays(invite.duration_days);
      const [productsResult, pricesResult, mappingsResult, subscriptionsResult] = await Promise.all([
        admin.from("billing_products")
          .select("product_code,name,app_url,active")
          .in("product_code", selectedCodes)
          .eq("active", true),
        admin.from("billing_prices")
          .select("product_code,price_id")
          .in("product_code", selectedCodes)
          .eq("active", true)
          .eq("is_default", true),
        admin.from("billing_product_entitlements")
          .select("product_code,entitlement_code")
          .in("product_code", selectedCodes)
          .like("entitlement_code", "%.pro"),
        admin.from("subscriptions")
          .select("id,product_code,status,current_period_end")
          .eq("user_id", actor.id)
          .in("product_code", selectedCodes)
          .in("status", MANAGEABLE_STATUSES),
      ]);
      if (productsResult.error) throw productsResult.error;
      if (pricesResult.error) throw pricesResult.error;
      if (mappingsResult.error) throw mappingsResult.error;
      if (subscriptionsResult.error) throw subscriptionsResult.error;

      const productByCode = new Map((productsResult.data ?? []).map((row) => [String(row.product_code), row]));
      const priceByCode = new Map((pricesResult.data ?? []).map((row) => [String(row.product_code), String(row.price_id)]));
      const entitlementsByCode = new Map<string, string[]>();
      for (const row of mappingsResult.data ?? []) {
        const code = String(row.product_code);
        const values = entitlementsByCode.get(code) ?? [];
        values.push(String(row.entitlement_code));
        entitlementsByCode.set(code, values);
      }
      for (const code of selectedCodes) {
        if (!productByCode.has(code) || !priceByCode.has(code) || !(entitlementsByCode.get(code)?.length)) {
          throw new Error(`Invitation product ${code} is not fully configured for billing.`);
        }
      }

      const customerId = await ensureCustomer();
      const existingByProduct = new Map(
        (subscriptionsResult.data ?? []).map((row) => [String(row.product_code), row]),
      );
      const results: Record<string, unknown>[] = [];

      for (const code of selectedCodes) {
        const product = productByCode.get(code)!;
        const existing = existingByProduct.get(code);
        if (existing) {
          results.push({
            product_code: code,
            name: product.name,
            app_url: product.app_url,
            subscription_id: existing.id,
            subscription_status: existing.status,
            trial_end: existing.current_period_end,
            already_subscribed: true,
          });
          continue;
        }

        const priceId = priceByCode.get(code)!;
        const params = new URLSearchParams();
        params.set("customer", customerId);
        params.set("items[0][price]", priceId);
        params.set("trial_period_days", String(days));
        params.set("trial_settings[end_behavior][missing_payment_method]", "cancel");
        params.set("metadata[supabase_user_id]", actor.id);
        params.set("metadata[product_code]", code);
        params.set("metadata[membership_invite_id]", invite.id);
        params.set("metadata[trial_source]", "membership_invite");
        params.set("metadata[trial_duration_days]", String(days));

        const subscription = await stripePost(
          "subscriptions",
          params,
          `membership-invite-${invite.id}-${code}`,
        );
        await syncCreatedSubscription(
          subscription,
          code,
          priceId,
          entitlementsByCode.get(code)!,
          invite.id,
        );
        results.push({
          product_code: code,
          name: product.name,
          app_url: product.app_url,
          subscription_id: subscription.id,
          subscription_status: subscription.status,
          trial_end: isoFromUnix(subscription.trial_end ?? subscription.current_period_end),
          already_subscribed: false,
        });
      }

      const { error: refreshError } = await admin.rpc("refresh_effective_entitlements", {
        p_user_id: actor.id,
      });
      if (refreshError) throw refreshError;

      const { error: finishError } = await admin
        .from("membership_invites")
        .update({ redeemed_at: new Date().toISOString() })
        .eq("id", invite.id)
        .eq("redeemed_by", actor.id)
        .is("redeemed_at", null);
      if (finishError) throw finishError;

      const { error: auditError } = await admin.from("membership_admin_actions").insert({
        actor_user_id: actor.id,
        action_type: "redeem_invite_trial",
        target_user_id: actor.id,
        target_email: actor.email ?? null,
        reason: "Multi-product Stripe free trial activated",
        status: "completed",
        request_payload: {
          invite_id: invite.id,
          product_codes: selectedCodes,
          duration_days: days,
        },
        result_payload: {
          subscriptions: results.map((item) => ({
            product_code: item.product_code,
            subscription_id: item.subscription_id,
            status: item.subscription_status,
          })),
        },
      });
      if (auditError) console.error("membership invite redemption audit write failed", auditError);

      return json(req, {
        ok: true,
        redemption: {
          invite_id: invite.id,
          duration_days: days,
          products: results,
        },
        user: { id: actor.id, email: actor.email },
      });
    }

    return json(req, { error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(req, { error: message }, 400);
  }
});
