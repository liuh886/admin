import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://liuh886.github.io",
  "http://localhost:4173",
  "http://localhost:8000",
]);

const STATUSES = new Set(["new", "reviewing", "planned", "resolved", "closed"]);
const CATEGORIES = new Set(["general", "idea", "bug", "content", "other"]);
const PRODUCT_CODE = /^[a-z0-9_]{2,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

function cleanFilter(value: unknown, allowed: Set<string>): string | null {
  const normalized = String(value ?? "all").trim().toLowerCase();
  if (!normalized || normalized === "all") return null;
  if (!allowed.has(normalized)) throw new Error(`Unsupported filter value: ${normalized}`);
  return normalized;
}

function cleanProduct(value: unknown): string | null {
  const product = String(value ?? "all").trim().toLowerCase();
  if (!product || product === "all") return null;
  if (!PRODUCT_CODE.test(product)) throw new Error("Invalid product code.");
  return product;
}

function cleanLimit(value: unknown): number {
  const limit = Math.trunc(Number(value ?? 50));
  return Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 50;
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
    .select("role,active")
    .eq("user_id", actor.id)
    .maybeSingle();
  if (adminError || !adminRow?.active) return json(req, { error: "Administrator access is required." }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json(req, { error: "Invalid JSON payload." }, 400);
  }

  const action = String(body.action ?? "list");
  const requireOperator = () => {
    if (!["owner", "operator"].includes(String(adminRow.role))) {
      throw new Error("This action requires operator access.");
    }
  };

  try {
    if (action === "list") {
      const product = cleanProduct(body.product_code);
      const status = cleanFilter(body.status, STATUSES);
      const category = cleanFilter(body.category, CATEGORIES);
      const limit = cleanLimit(body.limit);

      let query = admin
        .from("product_feedback")
        .select("id,user_id,product_code,category,message,page_url,metadata,status,admin_note,created_at,updated_at,reviewed_at,reviewed_by", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(limit);
      if (product) query = query.eq("product_code", product);
      if (status) query = query.eq("status", status);
      if (category) query = query.eq("category", category);
      const before = String(body.before ?? "").trim();
      if (before) {
        const date = new Date(before);
        if (Number.isNaN(date.getTime())) throw new Error("Invalid pagination cursor.");
        query = query.lt("created_at", date.toISOString());
      }

      const [{ data: rows, error, count }, { data: productRows }, ...statusResults] = await Promise.all([
        query,
        admin.from("product_feedback").select("product_code"),
        ...[...STATUSES].map((item) => admin
          .from("product_feedback")
          .select("id", { count: "exact", head: true })
          .eq("status", item)),
      ]);
      if (error) throw error;

      const feedback = rows ?? [];
      const userIds = [...new Set(feedback.map((item) => String(item.user_id)))];
      const profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
      if (userIds.length) {
        const { data: profiles } = await admin
          .from("profiles")
          .select("id,display_name,avatar_url")
          .in("id", userIds);
        for (const profile of profiles ?? []) {
          profileMap.set(String(profile.id), {
            display_name: profile.display_name ?? null,
            avatar_url: profile.avatar_url ?? null,
          });
        }
      }

      const emailEntries = await Promise.all(userIds.map(async (userId) => {
        const { data } = await admin.auth.admin.getUserById(userId);
        return [userId, data.user?.email ?? null] as const;
      }));
      const emailMap = new Map(emailEntries);
      const counts = Object.fromEntries([...STATUSES].map((item, index) => [
        item,
        statusResults[index]?.count ?? 0,
      ]));
      const products = [...new Set((productRows ?? []).map((item) => String(item.product_code)))].sort();

      return json(req, {
        actor: { id: actor.id, email: actor.email, role: adminRow.role },
        feedback: feedback.map((item) => ({
          ...item,
          user_email: emailMap.get(String(item.user_id)) ?? null,
          display_name: profileMap.get(String(item.user_id))?.display_name ?? null,
          avatar_url: profileMap.get(String(item.user_id))?.avatar_url ?? null,
        })),
        products,
        counts,
        total: count ?? 0,
        next_cursor: feedback.length === limit ? feedback.at(-1)?.created_at ?? null : null,
      });
    }

    if (action === "update") {
      requireOperator();
      const feedbackId = String(body.feedback_id ?? "").trim();
      if (!UUID.test(feedbackId)) throw new Error("A valid feedback ID is required.");
      const status = cleanFilter(body.status, STATUSES);
      if (!status) throw new Error("A feedback status is required.");
      const noteRaw = String(body.admin_note ?? "").trim();
      if (noteRaw.length > 2000) throw new Error("Admin note must not exceed 2000 characters.");
      const adminNote = noteRaw || null;

      const { data: existing, error: lookupError } = await admin
        .from("product_feedback")
        .select("id,user_id,product_code,category,status,admin_note")
        .eq("id", feedbackId)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) throw new Error("Feedback was not found.");

      const reviewedAt = new Date().toISOString();
      const { data: updated, error: updateError } = await admin
        .from("product_feedback")
        .update({
          status,
          admin_note: adminNote,
          reviewed_at: reviewedAt,
          reviewed_by: actor.id,
          updated_at: reviewedAt,
        })
        .eq("id", feedbackId)
        .select("id,user_id,product_code,category,message,page_url,metadata,status,admin_note,created_at,updated_at,reviewed_at,reviewed_by")
        .single();
      if (updateError) throw updateError;

      const { error: auditError } = await admin.from("membership_admin_actions").insert({
        actor_user_id: actor.id,
        action_type: "feedback_update",
        target_user_id: existing.user_id,
        product_code: existing.product_code,
        reason: adminNote || `Feedback moved to ${status}`,
        status: "completed",
        request_payload: {
          feedback_id: feedbackId,
          previous_status: existing.status,
          next_status: status,
        },
        result_payload: {
          category: existing.category,
          note_changed: existing.admin_note !== adminNote,
        },
      });
      if (auditError) throw auditError;

      return json(req, { ok: true, feedback: updated });
    }

    return json(req, { error: "Unknown feedback admin action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Feedback administration failed.";
    console.error("feedback-admin", action, actor.id, message);
    return json(req, { error: message }, 400);
  }
});
