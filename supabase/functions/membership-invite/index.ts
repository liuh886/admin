import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const ALLOWED_ORIGINS = new Set([
  "https://liuh886.github.io",
  "http://localhost:4173",
  "http://localhost:8000",
]);

const ADMIN_URL = "https://liuh886.github.io/admin/";
const MAX_DURATION_DAYS = 3650;

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
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "private, no-store" },
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
    throw new Error(`Complimentary duration must be between 1 and ${MAX_DURATION_DAYS} days.`);
  }
  return days;
}

function productCodes(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("At least one Pro product is required.");
  const codes = [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
  if (!codes.length) throw new Error("At least one Pro product is required.");
  return codes;
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

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json(req, { error: "Invalid JSON payload." }, 400);
  }

  const action = String(body.action ?? "catalog");

  const adminRole = async (): Promise<string | null> => {
    const { data, error } = await admin
      .from("membership_admins")
      .select("role,active")
      .eq("user_id", actor.id)
      .maybeSingle();
    if (error || !data?.active) return null;
    return String(data.role);
  };

  try {
    if (action === "catalog") {
      const role = await adminRole();
      if (!role) return json(req, { error: "Administrator access is required." }, 403);

      const [{ data: products, error: productError }, { data: mappings, error: mappingError }, { data: invites, error: inviteError }] = await Promise.all([
        admin.from("billing_products").select("product_code,name,app_url,active").eq("active", true).order("name"),
        admin.from("billing_product_entitlements").select("product_code,entitlement_code").like("entitlement_code", "%.pro").order("product_code"),
        admin.from("membership_invites").select("id,product_codes,duration_days,created_at,redeemed_at").order("created_at", { ascending: false }).limit(20),
      ]);
      if (productError) throw productError;
      if (mappingError) throw mappingError;
      if (inviteError) throw inviteError;

      const mappedCodes = new Set((mappings ?? []).map((item) => String(item.product_code)));
      const inviteProducts = (products ?? []).filter((product) => mappedCodes.has(String(product.product_code)));

      return json(req, {
        actor: { id: actor.id, email: actor.email, role },
        can_create: ["owner", "operator"].includes(role),
        products: inviteProducts,
        recent_invites: invites ?? [],
      });
    }

    if (action === "create") {
      const role = await adminRole();
      if (!role || !["owner", "operator"].includes(role)) {
        return json(req, { error: "This action requires operator access." }, 403);
      }

      const selectedCodes = productCodes(body.product_codes);
      const days = durationDays(body.duration_days);

      const [{ data: products, error: productError }, { data: mappings, error: mappingError }] = await Promise.all([
        admin.from("billing_products").select("product_code,name,app_url,active").in("product_code", selectedCodes).eq("active", true),
        admin.from("billing_product_entitlements").select("product_code,entitlement_code").in("product_code", selectedCodes).like("entitlement_code", "%.pro"),
      ]);
      if (productError) throw productError;
      if (mappingError) throw mappingError;

      const productByCode = new Map((products ?? []).map((item) => [String(item.product_code), item]));
      const mappedCodes = new Set((mappings ?? []).map((item) => String(item.product_code)));
      const missing = selectedCodes.filter((code) => !productByCode.has(code) || !mappedCodes.has(code));
      if (missing.length) throw new Error(`Unavailable Pro product: ${missing.join(", ")}`);

      const orderedProducts = selectedCodes.map((code) => productByCode.get(code));
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
        reason: "Single-use multi-product complimentary invite",
        status: "completed",
        request_payload: { duration_days: days, product_codes: selectedCodes },
        result_payload: { invite_id: invite.id },
      });
      if (auditError) console.error("membership invite audit write failed", auditError);

      return json(req, {
        ok: true,
        invite_id: invite.id,
        created_at: invite.created_at,
        products: orderedProducts,
        duration_days: days,
        invite_url: `${ADMIN_URL}#invite=${encodeURIComponent(rawToken)}`,
      });
    }

    if (action === "redeem") {
      const rawToken = String(body.token ?? "").trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(rawToken)) throw new Error("Invitation link is invalid.");
      const tokenHash = await sha256Hex(rawToken);
      const { data, error } = await admin.rpc("redeem_membership_invite", {
        p_token_hash: tokenHash,
        p_user_id: actor.id,
      });
      if (error) throw error;

      const redemption = typeof data === "string" ? JSON.parse(data) : data;
      const productCodeList = Array.isArray(redemption?.product_codes) ? redemption.product_codes : [];
      const { error: auditError } = await admin.from("membership_admin_actions").insert({
        actor_user_id: actor.id,
        action_type: "redeem_invite",
        target_user_id: actor.id,
        target_email: actor.email ?? null,
        reason: "Multi-product complimentary invite redeemed",
        status: "completed",
        request_payload: { invite_id: redemption?.invite_id ?? null },
        result_payload: { product_codes: productCodeList, valid_until: redemption?.valid_until ?? null },
      });
      if (auditError) console.error("membership invite redemption audit write failed", auditError);

      return json(req, {
        ok: true,
        redemption,
        user: { id: actor.id, email: actor.email },
      });
    }

    return json(req, { error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(req, { error: message }, 400);
  }
});
