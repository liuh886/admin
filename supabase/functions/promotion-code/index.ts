import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const ALLOWED_ORIGINS = new Set([
  "https://liuh886.github.io",
  "http://localhost:4173",
  "http://localhost:8000",
]);
const MAX_DURATION_MONTHS = 120;

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
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://liuh886.github.io",
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

function stripeKey(): string {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  return key;
}

async function stripePost(path: string, params: URLSearchParams): Promise<Record<string, any>> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const payload = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(payload.error?.message ?? `Stripe request failed (${response.status}).`);
  return payload;
}

async function stripeGet(path: string, params = new URLSearchParams()): Promise<Record<string, any>> {
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await fetch(`https://api.stripe.com/v1/${path}${suffix}`, {
    headers: { Authorization: `Bearer ${stripeKey()}` },
  });
  const payload = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(payload.error?.message ?? `Stripe request failed (${response.status}).`);
  return payload;
}

async function stripeDeleteCoupon(couponId: string): Promise<void> {
  const response = await fetch(`https://api.stripe.com/v1/coupons/${encodeURIComponent(couponId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${stripeKey()}` },
  });
  if (!response.ok) console.error("promotion coupon cleanup failed", couponId, response.status);
}

function productCodes(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("At least one Pro product is required.");
  const codes = [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
  if (!codes.length) throw new Error("At least one Pro product is required.");
  return codes;
}

function promotionCode(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,64}$/.test(code)) {
    throw new Error("Promotion code must be 3-64 characters using letters, numbers, or dashes.");
  }
  return code;
}

function payPercent(value: unknown): number {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent >= 100) {
    throw new Error("Pay percentage must be between 0 and 99.99.");
  }
  return Math.round(percent * 100) / 100;
}

function duration(value: unknown): { stripe: "forever" | "repeating"; months: number | null } {
  const type = String((value as Record<string, unknown> | null)?.type ?? "");
  if (type === "forever") return { stripe: "forever", months: null };
  if (type !== "months") throw new Error("Discount duration must be forever or a fixed number of months.");
  const months = Math.trunc(Number((value as Record<string, unknown>)?.months));
  if (!Number.isFinite(months) || months < 1 || months > MAX_DURATION_MONTHS) {
    throw new Error(`Discount duration must be between 1 and ${MAX_DURATION_MONTHS} months.`);
  }
  return { stripe: "repeating", months };
}

function expiresAt(value: unknown): number {
  const iso = String(value ?? "").trim();
  const millis = Date.parse(iso);
  if (!Number.isFinite(millis) || millis <= Date.now()) throw new Error("Campaign expiry must be in the future.");
  return Math.floor(millis / 1000);
}

function maxRedemptions(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const count = Math.trunc(Number(value));
  if (!Number.isFinite(count) || count < 1) throw new Error("Maximum redemptions must be a positive integer.");
  return count;
}

function couponIdFromPromotion(promotion: Record<string, any>): string {
  const coupon = promotion?.promotion?.coupon;
  if (typeof coupon === "string") return coupon;
  return String(coupon?.id ?? "");
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

  const token = authHeader.slice("Bearer ".length);
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json(req, { error: "Authentication failed." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const actor = authData.user;

  async function adminRole(): Promise<string | null> {
    const { data, error } = await admin
      .from("membership_admins")
      .select("role,active")
      .eq("user_id", actor.id)
      .maybeSingle();
    if (error || !data?.active) return null;
    return String(data.role);
  }

  async function requireAal2(): Promise<void> {
    const { data, error } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel(token);
    if (error || data.currentLevel !== "aal2") {
      throw new Error("AAL2 multi-factor authentication is required to manage promotion codes.");
    }
  }

  async function productsCatalog(): Promise<Record<string, any>[]> {
    const { data, error } = await admin
      .from("billing_products")
      .select("product_code,name,stripe_product_id,app_url,active")
      .eq("active", true)
      .order("name");
    if (error) throw error;
    return data ?? [];
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "catalog");
    const role = await adminRole();
    if (!role) return json(req, { error: "Administrator access is required." }, 403);

    if (action === "catalog") {
      const products = await productsCatalog();
      const listParams = new URLSearchParams({ limit: "50" });
      const list = await stripeGet("promotion_codes", listParams);
      const rawPromotions = (list.data ?? []) as Record<string, any>[];
      const owned = rawPromotions.filter((item) => item.metadata?.hao_apps_source === "admin_promotion");
      const promotions = await Promise.all(owned.map(async (item) => {
        const couponId = couponIdFromPromotion(item);
        let coupon: Record<string, any> | null = null;
        if (couponId) {
          try { coupon = await stripeGet(`coupons/${encodeURIComponent(couponId)}`); } catch { coupon = null; }
        }
        const productCodes = String(item.metadata?.product_codes ?? "").split(",").filter(Boolean);
        return {
          id: item.id,
          code: item.code,
          active: Boolean(item.active),
          expires_at: item.expires_at ? new Date(Number(item.expires_at) * 1000).toISOString() : null,
          max_redemptions: item.max_redemptions ?? null,
          times_redeemed: item.times_redeemed ?? 0,
          product_codes: productCodes,
          coupon_id: couponId || null,
          percent_off: coupon?.percent_off ?? null,
          duration: coupon?.duration ?? null,
          duration_in_months: coupon?.duration_in_months ?? null,
          created: item.created ? new Date(Number(item.created) * 1000).toISOString() : null,
        };
      }));
      return json(req, {
        actor: { id: actor.id, email: actor.email, role },
        can_manage: ["owner", "operator"].includes(role),
        products,
        promotions,
      });
    }

    if (action === "create") {
      await requireAal2();
      if (!["owner", "operator"].includes(role)) return json(req, { error: "Operator access is required." }, 403);

      const code = promotionCode(body.code);
      const selectedCodes = productCodes(body.product_codes);
      const pay = payPercent(body.pay_percent);
      const discount = 100 - pay;
      const discountDuration = duration(body.discount_duration);
      const campaignExpiresAt = expiresAt(body.campaign_expires_at);
      const redemptionLimit = maxRedemptions(body.max_redemptions);

      const products = await productsCatalog();
      const productByCode = new Map(products.map((item) => [String(item.product_code), item]));
      const selectedProducts = selectedCodes.map((codeValue) => productByCode.get(codeValue));
      if (selectedProducts.some((item) => !item?.stripe_product_id)) {
        throw new Error("One or more selected products are unavailable for Stripe promotions.");
      }

      const couponParams = new URLSearchParams();
      couponParams.set("percent_off", String(discount));
      couponParams.set("duration", discountDuration.stripe);
      if (discountDuration.months) couponParams.set("duration_in_months", String(discountDuration.months));
      couponParams.set("name", `${code} · ${pay}% pay`);
      couponParams.set("metadata[hao_apps_source]", "admin_promotion");
      couponParams.set("metadata[product_codes]", selectedCodes.join(","));
      couponParams.set("metadata[created_by]", actor.id);
      selectedProducts.forEach((item, index) => {
        couponParams.set(`applies_to[products][${index}]`, String(item!.stripe_product_id));
      });

      const coupon = await stripePost("coupons", couponParams);
      try {
        const promoParams = new URLSearchParams();
        promoParams.set("promotion[type]", "coupon");
        promoParams.set("promotion[coupon]", String(coupon.id));
        promoParams.set("code", code);
        promoParams.set("expires_at", String(campaignExpiresAt));
        if (redemptionLimit) promoParams.set("max_redemptions", String(redemptionLimit));
        promoParams.set("metadata[hao_apps_source]", "admin_promotion");
        promoParams.set("metadata[product_codes]", selectedCodes.join(","));
        promoParams.set("metadata[created_by]", actor.id);
        promoParams.set("metadata[pay_percent]", String(pay));

        const promotion = await stripePost("promotion_codes", promoParams);
        const { error: auditError } = await admin.from("membership_admin_actions").insert({
          actor_user_id: actor.id,
          action_type: "create_promotion_code",
          reason: "Create Stripe promotion code",
          status: "completed",
          request_payload: {
            code,
            product_codes: selectedCodes,
            pay_percent: pay,
            discount_duration: discountDuration,
            campaign_expires_at: new Date(campaignExpiresAt * 1000).toISOString(),
            max_redemptions: redemptionLimit,
          },
          result_payload: { promotion_code_id: promotion.id, coupon_id: coupon.id },
        });
        if (auditError) console.error("promotion audit write failed", auditError);

        return json(req, {
          ok: true,
          promotion: {
            id: promotion.id,
            code: promotion.code,
            coupon_id: coupon.id,
            product_codes: selectedCodes,
            pay_percent: pay,
            percent_off: discount,
            discount_duration: discountDuration,
            campaign_expires_at: new Date(campaignExpiresAt * 1000).toISOString(),
            max_redemptions: redemptionLimit,
          },
        });
      } catch (error) {
        await stripeDeleteCoupon(String(coupon.id));
        throw error;
      }
    }

    if (action === "deactivate") {
      await requireAal2();
      if (!["owner", "operator"].includes(role)) return json(req, { error: "Operator access is required." }, 403);
      const promotionCodeId = String(body.promotion_code_id ?? "").trim();
      if (!/^promo_[A-Za-z0-9]+$/.test(promotionCodeId)) throw new Error("Invalid promotion code identifier.");

      const params = new URLSearchParams({ active: "false" });
      const promotion = await stripePost(`promotion_codes/${encodeURIComponent(promotionCodeId)}`, params);
      const { error: auditError } = await admin.from("membership_admin_actions").insert({
        actor_user_id: actor.id,
        action_type: "deactivate_promotion_code",
        reason: "Deactivate Stripe promotion code",
        status: "completed",
        request_payload: { promotion_code_id: promotionCodeId },
        result_payload: { code: promotion.code, active: promotion.active },
      });
      if (auditError) console.error("promotion audit write failed", auditError);
      return json(req, { ok: true, promotion: { id: promotion.id, code: promotion.code, active: promotion.active } });
    }

    return json(req, { error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(req, { error: message }, 400);
  }
});
