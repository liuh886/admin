import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://liuh886.github.io",
  "http://localhost:4173",
  "http://localhost:8000",
]);

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
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function idOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id: unknown }).id ?? "");
  }
  return "";
}

function unixToIso(value: unknown): string | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;
}

function clampDays(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const days = Math.trunc(Number(value));
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    throw new Error("Duration must be between 1 and 3650 days, or lifetime.");
  }
  return days;
}

function sanitiseEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("A valid user email is required.");
  return email;
}

function encodeForm(input: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      value.forEach((item) => form.append(`${key}[]`, String(item)));
    } else if (typeof value === "object") {
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (nestedValue !== undefined && nestedValue !== null) {
          form.append(`${key}[${nestedKey}]`, String(nestedValue));
        }
      }
    } else {
      form.append(key, String(value));
    }
  }
  return form;
}

async function stripeRequest(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: Record<string, unknown>,
): Promise<Record<string, any>> {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? encodeForm(body) : undefined,
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
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { error: "Origin is not allowed." }, 403);

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
  const { data: adminRow, error: adminError } = await admin
    .from("membership_admins")
    .select("role,active,note")
    .eq("user_id", actor.id)
    .maybeSingle();
  if (adminError || !adminRow?.active) return json(req, { error: "Administrator access is required." }, 403);

  let requestBody: Record<string, any>;
  try {
    requestBody = await req.json() as Record<string, any>;
  } catch {
    return json(req, { error: "Invalid JSON payload." }, 400);
  }
  const action = String(requestBody.action ?? "bootstrap");

  const requireOperator = () => {
    if (!["owner", "operator"].includes(String(adminRow.role))) throw new Error("This action requires operator access.");
  };
  const requireOwner = () => {
    if (adminRow.role !== "owner") throw new Error("This action requires owner access.");
  };

  const audit = async (entry: Record<string, unknown>) => {
    const { error } = await admin.from("membership_admin_actions").insert({
      actor_user_id: actor.id,
      action_type: action,
      status: "completed",
      request_payload: {},
      result_payload: {},
      ...entry,
    });
    if (error) throw error;
  };

  const findAuthUser = async (emailValue?: unknown, userIdValue?: unknown) => {
    const userId = String(userIdValue ?? "").trim();
    if (userId) {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error || !data.user) throw new Error("User was not found.");
      return data.user;
    }
    const email = sanitiseEmail(emailValue);
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw error;
      const match = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
      if (match) return match;
      if (data.users.length < 100) break;
    }
    throw new Error("No Supabase user exists for that email. Ask the user to sign in once first.");
  };

  const productMappings = async (productCode: string) => {
    let query = admin
      .from("billing_product_entitlements")
      .select("product_code,entitlement_code");
    if (productCode !== "all") query = query.eq("product_code", productCode);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) throw new Error("No membership entitlements are mapped to that product.");
    return data;
  };

  const refreshUser = async (userId: string) => {
    const { error } = await admin.rpc("refresh_effective_entitlements", { p_user_id: userId });
    if (error) throw error;
  };

  const loadUser = async (user: Record<string, any>) => {
    const [{ data: profile }, { data: customer }, { data: subscriptions }, { data: entitlements }, { data: grants }, { data: actions }] = await Promise.all([
      admin.from("profiles").select("display_name,locale,created_at,updated_at").eq("id", user.id).maybeSingle(),
      admin.from("billing_customers").select("customer_id,provider,created_at,updated_at").eq("user_id", user.id).maybeSingle(),
      admin.from("subscriptions").select("id,product_code,status,current_period_end,cancel_at_period_end,price_id,customer_id,livemode,ended_at,created_at,updated_at").eq("user_id", user.id).order("created_at", { ascending: false }),
      admin.from("entitlements").select("entitlement_code,active,valid_until,updated_at").eq("user_id", user.id).order("entitlement_code"),
      admin.from("entitlement_grants").select("entitlement_code,source,source_ref,active,valid_until,metadata,created_at,updated_at").eq("user_id", user.id).order("created_at", { ascending: false }),
      admin.from("membership_admin_actions").select("id,action_type,product_code,entitlement_code,stripe_subscription_id,stripe_payment_intent_id,amount,currency,reason,status,created_at").eq("target_user_id", user.id).order("created_at", { ascending: false }).limit(30),
    ]);

    let payments: Record<string, any>[] = [];
    if (customer?.customer_id) {
      const chargeList = await stripeRequest(`charges?customer=${encodeURIComponent(customer.customer_id)}&limit=20`);
      payments = (chargeList.data ?? []).map((charge: Record<string, any>) => ({
        id: charge.id,
        payment_intent: idOf(charge.payment_intent),
        invoice: idOf(charge.invoice),
        amount: Number(charge.amount ?? 0),
        amount_refunded: Number(charge.amount_refunded ?? 0),
        currency: String(charge.currency ?? "").toLowerCase(),
        status: String(charge.status ?? "unknown"),
        refunded: Boolean(charge.refunded),
        created_at: unixToIso(charge.created),
        description: charge.description ?? null,
        receipt_url: charge.receipt_url ?? null,
      }));
    }

    return {
      user: {
        id: user.id,
        email: user.email ?? null,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        profile,
      },
      customer,
      subscriptions: subscriptions ?? [],
      entitlements: entitlements ?? [],
      grants: grants ?? [],
      payments,
      actions: actions ?? [],
    };
  };

  try {
    if (action === "bootstrap") {
      const [{ data: products }, { data: mappings }, userCount, subscriptionCount, grantCount, actionCount, { data: recentActions }] = await Promise.all([
        admin.from("billing_products").select("product_code,name,app_url,active").eq("active", true).order("name"),
        admin.from("billing_product_entitlements").select("product_code,entitlement_code").order("product_code"),
        admin.auth.admin.listUsers({ page: 1, perPage: 1 }),
        admin.from("subscriptions").select("id", { count: "exact", head: true }).in("status", ["active", "trialing", "past_due"]),
        admin.from("entitlement_grants").select("source_ref", { count: "exact", head: true }).eq("active", true),
        admin.from("membership_admin_actions").select("id", { count: "exact", head: true }),
        admin.from("membership_admin_actions").select("id,action_type,target_email,product_code,amount,currency,reason,status,created_at").order("created_at", { ascending: false }).limit(20),
      ]);
      return json(req, {
        actor: { id: actor.id, email: actor.email, role: adminRow.role },
        products: products ?? [],
        mappings: mappings ?? [],
        counts: {
          users: userCount.data?.total ?? 0,
          active_subscriptions: subscriptionCount.count ?? 0,
          active_grants: grantCount.count ?? 0,
          admin_actions: actionCount.count ?? 0,
        },
        recent_actions: recentActions ?? [],
      });
    }

    if (action === "search_user") {
      const user = await findAuthUser(requestBody.email, requestBody.user_id);
      return json(req, await loadUser(user));
    }

    if (action === "grant") {
      requireOperator();
      const user = await findAuthUser(requestBody.email, requestBody.user_id);
      const productCode = String(requestBody.product_code ?? "").trim();
      const reason = String(requestBody.reason ?? "Complimentary membership").trim().slice(0, 500);
      const days = clampDays(requestBody.duration_days);
      const mappings = await productMappings(productCode);
      const sourceRef = `manual_gift:${crypto.randomUUID()}`;
      const validUntil = days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
      const rows = mappings.map((mapping) => ({
        user_id: user.id,
        entitlement_code: mapping.entitlement_code,
        source: "manual_gift",
        source_ref: sourceRef,
        active: true,
        valid_until: validUntil,
        metadata: {
          product_code: mapping.product_code,
          reason,
          granted_by: actor.email ?? actor.id,
        },
        updated_at: new Date().toISOString(),
      }));
      const { error } = await admin.from("entitlement_grants").insert(rows);
      if (error) throw error;
      await refreshUser(user.id);
      await audit({
        target_user_id: user.id,
        target_email: user.email,
        product_code: productCode,
        reason,
        request_payload: { duration_days: days, source_ref: sourceRef },
        result_payload: { entitlements: mappings.map((item) => item.entitlement_code), valid_until: validUntil },
      });
      return json(req, { ok: true, source_ref: sourceRef, valid_until: validUntil, member: await loadUser(user) });
    }

    if (action === "extend_grant") {
      requireOperator();
      const user = await findAuthUser(requestBody.email, requestBody.user_id);
      const sourceRef = String(requestBody.source_ref ?? "").trim();
      const days = clampDays(requestBody.duration_days);
      if (!sourceRef || days === null) throw new Error("A grant reference and extension duration are required.");
      const { data: existing, error: lookupError } = await admin
        .from("entitlement_grants")
        .select("valid_until")
        .eq("user_id", user.id)
        .eq("source", "manual_gift")
        .eq("source_ref", sourceRef);
      if (lookupError) throw lookupError;
      if (!existing?.length) throw new Error("The complimentary grant was not found.");
      const latest = existing.reduce((max, row) => Math.max(max, row.valid_until ? new Date(row.valid_until).getTime() : Date.now()), Date.now());
      const validUntil = new Date(latest + days * 86_400_000).toISOString();
      const { error } = await admin
        .from("entitlement_grants")
        .update({ active: true, valid_until: validUntil, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("source", "manual_gift")
        .eq("source_ref", sourceRef);
      if (error) throw error;
      await refreshUser(user.id);
      await audit({ target_user_id: user.id, target_email: user.email, reason: `Extended ${days} days`, request_payload: { source_ref: sourceRef, duration_days: days }, result_payload: { valid_until: validUntil } });
      return json(req, { ok: true, valid_until: validUntil, member: await loadUser(user) });
    }

    if (action === "revoke_grant") {
      requireOperator();
      const user = await findAuthUser(requestBody.email, requestBody.user_id);
      const sourceRef = String(requestBody.source_ref ?? "").trim();
      if (!sourceRef) throw new Error("A grant reference is required.");
      const { error } = await admin
        .from("entitlement_grants")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("source", "manual_gift")
        .eq("source_ref", sourceRef);
      if (error) throw error;
      await refreshUser(user.id);
      await audit({ target_user_id: user.id, target_email: user.email, reason: String(requestBody.reason ?? "Complimentary access revoked"), request_payload: { source_ref: sourceRef } });
      return json(req, { ok: true, member: await loadUser(user) });
    }

    if (action === "cancel_subscription") {
      requireOwner();
      const user = await findAuthUser(requestBody.email, requestBody.user_id);
      const subscriptionId = String(requestBody.subscription_id ?? "").trim();
      const mode = String(requestBody.mode ?? "period_end");
      const confirmation = String(requestBody.confirmation ?? "");
      if (confirmation !== "CANCEL") throw new Error("Type CANCEL to confirm subscription cancellation.");
      const { data: subscriptionRow } = await admin.from("subscriptions").select("id,customer_id,product_code").eq("id", subscriptionId).eq("user_id", user.id).maybeSingle();
      if (!subscriptionRow) throw new Error("Subscription does not belong to this user.");
      const result = mode === "immediate"
        ? await stripeRequest(`subscriptions/${encodeURIComponent(subscriptionId)}`, "DELETE")
        : await stripeRequest(`subscriptions/${encodeURIComponent(subscriptionId)}`, "POST", { cancel_at_period_end: true });
      await audit({ target_user_id: user.id, target_email: user.email, product_code: subscriptionRow.product_code, stripe_customer_id: subscriptionRow.customer_id, stripe_subscription_id: subscriptionId, reason: String(requestBody.reason ?? "Admin cancellation"), request_payload: { mode }, result_payload: { status: result.status, cancel_at_period_end: result.cancel_at_period_end } });
      return json(req, { ok: true, subscription: { id: result.id, status: result.status, cancel_at_period_end: result.cancel_at_period_end, current_period_end: unixToIso(result.current_period_end) } });
    }

    if (action === "refund") {
      requireOwner();
      const user = await findAuthUser(requestBody.email, requestBody.user_id);
      if (String(requestBody.confirmation ?? "") !== "REFUND") throw new Error("Type REFUND to confirm this financial action.");
      const paymentIntent = String(requestBody.payment_intent ?? "").trim();
      if (!paymentIntent) throw new Error("A PaymentIntent is required.");
      const { data: customerRow } = await admin.from("billing_customers").select("customer_id").eq("user_id", user.id).maybeSingle();
      if (!customerRow?.customer_id) throw new Error("No Stripe customer is mapped to this user.");
      const charges = await stripeRequest(`charges?customer=${encodeURIComponent(customerRow.customer_id)}&limit=100`);
      const charge = (charges.data ?? []).find((item: Record<string, any>) => idOf(item.payment_intent) === paymentIntent);
      if (!charge) throw new Error("The payment does not belong to this user's Stripe customer.");
      const remaining = Number(charge.amount ?? 0) - Number(charge.amount_refunded ?? 0);
      const requestedAmount = requestBody.amount === null || requestBody.amount === undefined || requestBody.amount === ""
        ? remaining
        : Math.trunc(Number(requestBody.amount));
      if (!Number.isFinite(requestedAmount) || requestedAmount < 1 || requestedAmount > remaining) {
        throw new Error(`Refund amount must be between 1 and ${remaining} minor currency units.`);
      }
      const refundReason = ["duplicate", "fraudulent", "requested_by_customer"].includes(String(requestBody.refund_reason))
        ? String(requestBody.refund_reason)
        : "requested_by_customer";
      const refund = await stripeRequest("refunds", "POST", {
        payment_intent: paymentIntent,
        amount: requestedAmount,
        reason: refundReason,
        metadata: { actor_user_id: actor.id, target_user_id: user.id, system: "hao_apps_membership_admin" },
      });

      const subscriptionId = String(requestBody.subscription_id ?? "").trim();
      const subscriptionAction = String(requestBody.subscription_action ?? "keep");
      let subscriptionResult: Record<string, any> | null = null;
      if (subscriptionAction !== "keep") {
        if (!subscriptionId) throw new Error("A subscription is required for the selected post-refund action.");
        const { data: subscriptionRow } = await admin.from("subscriptions").select("id,customer_id,product_code").eq("id", subscriptionId).eq("user_id", user.id).maybeSingle();
        if (!subscriptionRow || subscriptionRow.customer_id !== customerRow.customer_id) throw new Error("Subscription does not belong to this user.");
        subscriptionResult = subscriptionAction === "cancel_now"
          ? await stripeRequest(`subscriptions/${encodeURIComponent(subscriptionId)}`, "DELETE")
          : await stripeRequest(`subscriptions/${encodeURIComponent(subscriptionId)}`, "POST", { cancel_at_period_end: true });
      }

      await audit({
        target_user_id: user.id,
        target_email: user.email,
        stripe_customer_id: customerRow.customer_id,
        stripe_subscription_id: subscriptionId || null,
        stripe_payment_intent_id: paymentIntent,
        amount: requestedAmount,
        currency: String(charge.currency ?? "").toLowerCase(),
        reason: String(requestBody.reason ?? refundReason),
        request_payload: { refund_reason: refundReason, subscription_action: subscriptionAction },
        result_payload: { refund_id: refund.id, refund_status: refund.status, subscription_status: subscriptionResult?.status ?? null },
      });
      return json(req, { ok: true, refund: { id: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency }, subscription: subscriptionResult ? { id: subscriptionResult.id, status: subscriptionResult.status, cancel_at_period_end: subscriptionResult.cancel_at_period_end } : null });
    }

    return json(req, { error: "Unknown admin action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Membership administration failed.";
    console.error("membership-admin", action, actor.id, message);
    try {
      await admin.from("membership_admin_actions").insert({
        actor_user_id: actor.id,
        action_type: action,
        target_user_id: requestBody.user_id || null,
        target_email: requestBody.email || null,
        product_code: requestBody.product_code || null,
        stripe_subscription_id: requestBody.subscription_id || null,
        stripe_payment_intent_id: requestBody.payment_intent || null,
        reason: requestBody.reason || null,
        status: "failed",
        request_payload: { action },
        result_payload: { error: message },
      });
    } catch {
      // Preserve the original error even if audit insertion fails.
    }
    return json(req, { error: message }, 400);
  }
});
