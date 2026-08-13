import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { corsHeaders as sdkCorsHeaders } from "npm:@supabase/supabase-js@2.111.0/cors";

const ALLOWED_ORIGINS = new Set([
  "https://liuh886.github.io",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:8000",
]);
const ADMIN_URL = "https://liuh886.github.io/admin/";
const MAX_TRIAL_DAYS = 730;

type ProductRow = {
  product_code: string;
  name: string;
  app_url: string;
  active: boolean;
  metadata: Record<string, unknown> | null;
};

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
  return {
    ...sdkCorsHeaders,
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://liuh886.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "private, no-store",
    Vary: "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

function referralCode(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase();
  if (!/^R-[A-Z0-9]{12}$/.test(code)) throw new Error("Referral link is invalid.");
  return code;
}

function productCode(value: unknown): string {
  const code = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_]{2,64}$/.test(code)) throw new Error("Product is invalid.");
  return code;
}

function trialDays(value: unknown): number {
  const days = Math.trunc(Number(value));
  if (!Number.isFinite(days) || days < 0 || days > MAX_TRIAL_DAYS) {
    throw new Error(`Referral trial must be between 0 and ${MAX_TRIAL_DAYS} days.`);
  }
  return days;
}

function policyDays(product: ProductRow): number {
  const raw = Number(product.metadata?.referral_trial_days ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.min(MAX_TRIAL_DAYS, Math.max(0, Math.trunc(raw)));
}

function randomReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `R-${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
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
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return json(req, { error: "Referral service is unavailable." }, 503);
  }

  const requestApiKey = req.headers.get("apikey") ?? "";
  if (requestApiKey !== publishableKey) return json(req, { error: "API key is invalid." }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json(req, { error: "Invalid JSON payload." }, 400);
  }
  const action = String(body.action ?? "preview");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const loadProduct = async (code: string): Promise<ProductRow> => {
    const { data, error } = await admin
      .from("billing_products")
      .select("product_code,name,app_url,active,metadata")
      .eq("product_code", code)
      .eq("active", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Referral product is unavailable.");
    return data as ProductRow;
  };

  const proEntitlement = async (code: string): Promise<string> => {
    const { data, error } = await admin
      .from("billing_product_entitlements")
      .select("entitlement_code")
      .eq("product_code", code)
      .like("entitlement_code", "%.pro")
      .order("entitlement_code")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data?.entitlement_code) throw new Error("Referral product has no Pro entitlement.");
    return String(data.entitlement_code);
  };

  const hasCurrentPro = async (userId: string, entitlementCode: string): Promise<boolean> => {
    const { data, error } = await admin
      .from("entitlements")
      .select("active,valid_until")
      .eq("user_id", userId)
      .eq("entitlement_code", entitlementCode)
      .maybeSingle();
    if (error) throw error;
    if (data?.active !== true) return false;
    if (!data.valid_until) return true;
    const until = new Date(String(data.valid_until)).getTime();
    return Number.isFinite(until) && until > Date.now();
  };

  const authenticate = async () => {
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) throw new Error("Authentication is required.");
    const token = authHeader.slice("Bearer ".length);
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.auth.getUser(token);
    if (error || !data.user) throw new Error("Authentication failed.");
    return { user: data.user, userClient, token };
  };

  const adminRole = async (userId: string): Promise<string | null> => {
    const { data, error } = await admin
      .from("membership_admins")
      .select("role,active")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data?.active) return null;
    return String(data.role);
  };

  const requireAal2 = async (userClient: ReturnType<typeof createClient>, token: string) => {
    const { data, error } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel(token);
    if (error || data.currentLevel !== "aal2") {
      throw new Error("AAL2 multi-factor authentication is required.");
    }
  };

  const previewByCode = async (code: string) => {
    const { data: referral, error } = await admin
      .from("product_referral_codes")
      .select("user_id,product_code,referral_code")
      .eq("referral_code", code)
      .maybeSingle();
    if (error || !referral) throw new Error("Referral link is invalid.");

    const product = await loadProduct(String(referral.product_code));
    const entitlement = await proEntitlement(product.product_code);
    const inviterIsPro = await hasCurrentPro(String(referral.user_id), entitlement);
    const configuredDays = policyDays(product);
    return {
      referral_code: code,
      product: {
        product_code: product.product_code,
        name: product.name,
        app_url: product.app_url,
      },
      inviter_is_pro: inviterIsPro,
      trial_days: inviterIsPro ? configuredDays : 0,
    };
  };

  try {
    if (action === "preview") {
      return json(req, { ok: true, ...(await previewByCode(referralCode(body.referral_code))) });
    }

    if (action === "get_or_create") {
      const { user } = await authenticate();
      const requestedProduct = productCode(body.product_code);
      const product = await loadProduct(requestedProduct);
      const entitlement = await proEntitlement(product.product_code);

      let { data: row, error: readError } = await admin
        .from("product_referral_codes")
        .select("referral_code")
        .eq("user_id", user.id)
        .eq("product_code", product.product_code)
        .maybeSingle();
      if (readError) throw readError;

      if (!row) {
        for (let attempt = 0; attempt < 5 && !row; attempt += 1) {
          const code = randomReferralCode();
          const { data, error } = await admin
            .from("product_referral_codes")
            .insert({
              user_id: user.id,
              product_code: product.product_code,
              referral_code: code,
            })
            .select("referral_code")
            .maybeSingle();
          if (!error && data) {
            row = data;
            break;
          }
          const { data: existing } = await admin
            .from("product_referral_codes")
            .select("referral_code")
            .eq("user_id", user.id)
            .eq("product_code", product.product_code)
            .maybeSingle();
          if (existing) {
            row = existing;
            break;
          }
        }
      }
      if (!row?.referral_code) throw new Error("Could not create a stable referral link.");

      const [joined, rewarded, inviterIsPro] = await Promise.all([
        admin.from("product_referral_attributions")
          .select("id", { count: "exact", head: true })
          .eq("inviter_user_id", user.id)
          .eq("product_code", product.product_code),
        admin.from("product_referral_attributions")
          .select("id", { count: "exact", head: true })
          .eq("inviter_user_id", user.id)
          .eq("product_code", product.product_code)
          .eq("benefit_granted", true),
        hasCurrentPro(user.id, entitlement),
      ]);
      if (joined.error) throw joined.error;
      if (rewarded.error) throw rewarded.error;

      const configuredDays = policyDays(product);
      return json(req, {
        ok: true,
        referral_code: row.referral_code,
        referral_url: `${ADMIN_URL}#ref=${encodeURIComponent(String(row.referral_code))}`,
        product: {
          product_code: product.product_code,
          name: product.name,
          app_url: product.app_url,
        },
        inviter_is_pro: inviterIsPro,
        policy_days: configuredDays,
        trial_days: inviterIsPro ? configuredDays : 0,
        joined_count: joined.count ?? 0,
        trial_count: rewarded.count ?? 0,
      });
    }

    if (action === "redeem") {
      const { user } = await authenticate();
      const code = referralCode(body.referral_code);
      const preview = await previewByCode(code);
      const { data, error } = await admin.rpc("redeem_product_referral", {
        p_invitee_user_id: user.id,
        p_referral_code: code,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result) throw new Error("Referral could not be redeemed.");
      return json(req, {
        ok: true,
        product: preview.product,
        benefit_granted: result.benefit_granted === true,
        trial_days: Number(result.trial_days ?? 0),
        valid_until: result.valid_until ?? null,
        attribution_id: result.attribution_id,
      });
    }

    if (action === "admin_catalog") {
      const { user } = await authenticate();
      const role = await adminRole(user.id);
      if (!role) return json(req, { error: "Administrator access is required." }, 403);

      const { data: products, error } = await admin
        .from("billing_products")
        .select("product_code,name,app_url,active,metadata")
        .eq("active", true)
        .order("name");
      if (error) throw error;

      const rows = await Promise.all((products ?? []).map(async (item) => {
        const [links, joined, rewarded] = await Promise.all([
          admin.from("product_referral_codes").select("referral_code", { count: "exact", head: true }).eq("product_code", item.product_code),
          admin.from("product_referral_attributions").select("id", { count: "exact", head: true }).eq("product_code", item.product_code),
          admin.from("product_referral_attributions").select("id", { count: "exact", head: true }).eq("product_code", item.product_code).eq("benefit_granted", true),
        ]);
        if (links.error) throw links.error;
        if (joined.error) throw joined.error;
        if (rewarded.error) throw rewarded.error;
        return {
          product_code: item.product_code,
          name: item.name,
          app_url: item.app_url,
          referral_trial_days: policyDays(item as ProductRow),
          referral_links: links.count ?? 0,
          joined_count: joined.count ?? 0,
          trial_count: rewarded.count ?? 0,
        };
      }));

      return json(req, {
        ok: true,
        actor: { id: user.id, email: user.email, role },
        products: rows,
      });
    }

    if (action === "set_policy") {
      const { user, userClient, token } = await authenticate();
      const role = await adminRole(user.id);
      if (!role || !["owner", "operator"].includes(role)) {
        return json(req, { error: "Operator access is required." }, 403);
      }
      await requireAal2(userClient, token);

      const requestedProduct = productCode(body.product_code);
      const days = trialDays(body.referral_trial_days);
      const product = await loadProduct(requestedProduct);
      const metadata = { ...(product.metadata ?? {}), referral_trial_days: days };
      const { error } = await admin
        .from("billing_products")
        .update({ metadata, updated_at: new Date().toISOString() })
        .eq("product_code", requestedProduct);
      if (error) throw error;

      const { error: auditError } = await admin.from("membership_admin_actions").insert({
        actor_user_id: user.id,
        action_type: "set_referral_policy",
        product_code: requestedProduct,
        reason: "Update product referral complimentary Pro duration",
        status: "completed",
        request_payload: { referral_trial_days: days },
        result_payload: { product_code: requestedProduct, referral_trial_days: days },
      });
      if (auditError) console.error("referral policy audit failed", auditError);

      return json(req, {
        ok: true,
        product_code: requestedProduct,
        referral_trial_days: days,
      });
    }

    return json(req, { error: "Unknown referral action." }, 400);
  } catch (error) {
    console.warn("product-referral:", error);
    const message = error instanceof Error ? error.message : String(error);
    const status = /Authentication/.test(message) ? 401 : 400;
    return json(req, { error: message }, status);
  }
});