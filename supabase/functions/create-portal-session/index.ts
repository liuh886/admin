import { createClient } from "npm:@supabase/supabase-js@2";

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

async function stripePost(path: string, params: URLSearchParams, idempotencyKey?: string): Promise<Record<string, unknown>> {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
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
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `Stripe request failed (${response.status})`);
  }
  return payload;
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

    let returnUrl = "https://liuh886.github.io/";
    if (requestedCode) {
      let { data: product } = await admin
        .from("billing_products")
        .select("app_url")
        .eq("product_code", requestedCode)
        .eq("active", true)
        .maybeSingle();
      if (!product) {
        const { data: mapping } = await admin
          .from("billing_product_entitlements")
          .select("product_code")
          .eq("entitlement_code", requestedCode)
          .maybeSingle();
        if (mapping) {
          const result = await admin
            .from("billing_products")
            .select("app_url")
            .eq("product_code", mapping.product_code)
            .eq("active", true)
            .maybeSingle();
          product = result.data;
        }
      }
      if (product?.app_url) returnUrl = product.app_url;
    }

    const { data: customerRow, error: customerError } = await admin
      .from("billing_customers")
      .select("customer_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (customerError) throw customerError;

    let customerId = String(customerRow?.customer_id ?? "");
    if (!customerId) {
      const customerParams = new URLSearchParams();
      if (userData.user.email) customerParams.set("email", userData.user.email);
      customerParams.set("description", `Hao Apps member ${userData.user.id}`);
      customerParams.set("metadata[supabase_user_id]", userData.user.id);
      const customer = await stripePost(
        "customers",
        customerParams,
        `hao-customer-${userData.user.id}`,
      );
      customerId = String(customer.id ?? "");
      if (!customerId) throw new Error("Stripe customer was not created");

      const { error: writeError } = await admin.from("billing_customers").upsert({
        user_id: userData.user.id,
        provider: "stripe",
        customer_id: customerId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (writeError) throw writeError;
    }

    const params = new URLSearchParams();
    params.set("customer", customerId);
    params.set("return_url", returnUrl);
    const portal = await stripePost("billing_portal/sessions", params);
    return json(req, { url: portal.url, mode: "portal" });
  } catch (error) {
    console.error("create-portal-session", error);
    return json(req, { error: error instanceof Error ? error.message : "Portal could not be opened" }, 500);
  }
});
