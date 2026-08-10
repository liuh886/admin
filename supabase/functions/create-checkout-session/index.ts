import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const allowedOrigins = new Set([
  "https://liuh886.github.io",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://localhost:8000",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://liuh886.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

async function stripePost(path: string, params: URLSearchParams): Promise<Record<string, unknown>> {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `Stripe request failed (${response.status})`);
  }
  return payload;
}

function billingUrl(appUrl: string, state: "success" | "cancelled"): string {
  const separator = appUrl.includes("?") ? "&" : "?";
  return state === "success"
    ? `${appUrl}${separator}billing=success&session_id={CHECKOUT_SESSION_ID}`
    : `${appUrl}${separator}billing=cancelled`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const publishableKey = namedEnv("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      ?? namedEnv("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !publishableKey || !adminKey) throw new Error("Supabase function keys are unavailable");

    const authorization = req.headers.get("authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json(req, { error: "Authentication required" }, 401);

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json(req, { error: "Invalid authentication session" }, 401);

    const admin = createClient(supabaseUrl, adminKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const input = await req.json().catch(() => ({})) as { product_code?: string };
    const requestedCode = String(input.product_code ?? "").trim();
    if (!requestedCode) return json(req, { error: "product_code is required" }, 400);

    const { data: product, error: productError } = await admin
      .from("billing_products")
      .select("product_code,name,app_url,active")
      .eq("product_code", requestedCode)
      .eq("active", true)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) return json(req, { error: "Unknown or inactive product" }, 404);

    const { data: price, error: priceError } = await admin
      .from("billing_prices")
      .select("price_id")
      .eq("product_code", product.product_code)
      .eq("active", true)
      .eq("is_default", true)
      .single();
    if (priceError || !price) throw new Error("Active default price is unavailable");

    const userId = userData.user.id;
    const { data: customerRow } = await admin
      .from("billing_customers")
      .select("customer_id")
      .eq("user_id", userId)
      .maybeSingle();

    let customerId = customerRow?.customer_id as string | undefined;
    if (!customerId) {
      const params = new URLSearchParams();
      if (userData.user.email) params.set("email", userData.user.email);
      params.set("description", `Hao Apps member ${userId}`);
      params.set("metadata[supabase_user_id]", userId);
      const customer = await stripePost("customers", params);
      customerId = String(customer.id ?? "");
      if (!customerId) throw new Error("Stripe customer was not created");
      const { error: customerError } = await admin.from("billing_customers").upsert({
        user_id: userId,
        provider: "stripe",
        customer_id: customerId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (customerError) throw customerError;
    }

    const { data: existing } = await admin
      .from("subscriptions")
      .select("id,status")
      .eq("user_id", userId)
      .eq("product_code", product.product_code)
      .in("status", ["active", "trialing", "past_due", "unpaid"])
      .limit(1);

    if (existing && existing.length > 0) {
      const portalParams = new URLSearchParams();
      portalParams.set("customer", customerId);
      portalParams.set("return_url", product.app_url);
      const portal = await stripePost("billing_portal/sessions", portalParams);
      return json(req, { url: portal.url, mode: "portal", already_subscribed: true });
    }

    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("customer", customerId);
    params.set("line_items[0][price]", price.price_id);
    params.set("line_items[0][quantity]", "1");
    params.set("success_url", billingUrl(product.app_url, "success"));
    params.set("cancel_url", billingUrl(product.app_url, "cancelled"));
    params.set("client_reference_id", userId);
    params.set("billing_address_collection", "auto");
    params.set("allow_promotion_codes", "true");
    params.set("metadata[supabase_user_id]", userId);
    params.set("metadata[product_code]", product.product_code);
    params.set("subscription_data[metadata][supabase_user_id]", userId);
    params.set("subscription_data[metadata][product_code]", product.product_code);

    const session = await stripePost("checkout/sessions", params);
    return json(req, { url: session.url, mode: "checkout" });
  } catch (error) {
    console.error("create-checkout-session", error);
    return json(req, { error: error instanceof Error ? error.message : "Checkout could not be created" }, 500);
  }
});