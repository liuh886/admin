import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://liuh886.github.io",
  "http://localhost:4173",
  "http://localhost:8000",
]);

const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ANALYTICS_ENDPOINT = "https://analyticsdata.googleapis.com/v1beta";
const CLOUDFLARE_GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const DAY_MS = 86_400_000;

const PRODUCT_NAMES: Record<string, string> = {
  alpha_engine: "AlphaEngine",
  flappyk: "FlappyK",
  newsflow: "NewsFlow",
  notes: "Notes",
  ownly: "Ownly",
  rhythmcoach: "RhythmCoach",
  ccus_policy_hub: "CCUS Policy Hub",
};

const GA4_PRODUCTS = [
  "alpha_engine",
  "flappyk",
  "newsflow",
  "notes",
  "ownly",
  "rhythmcoach",
] as const;

const RUM_PRODUCTS = [
  { product_code: "alpha_engine", name: "AlphaEngine", host: "liuh886.github.io", path_prefix: "/alpha_engine/" },
  { product_code: "flappyk", name: "FlappyK", host: "liuh886.github.io", path_prefix: "/FlappyK/" },
  { product_code: "newsflow", name: "NewsFlow", host: "liuh886.github.io", path_prefix: "/NewsFlow/" },
  { product_code: "ownly", name: "Ownly", host: "liuh886.github.io", path_prefix: "/ownly/" },
  { product_code: "rhythmcoach", name: "RhythmCoach", host: "liuh886.github.io", path_prefix: "/RhythmCoach/" },
  { product_code: "ccus_policy_hub", name: "CCUS Policy Hub", host: "liuh886.github.io", path_prefix: "/ccus-policy-hub/" },
  { product_code: "notes", name: "Notes", host: "zhihaol.eu.org", path_prefix: "/" },
] as const;

interface CachedOverview {
  expiresAt: number;
  payload: Record<string, unknown>;
}

interface AnalyticsWindow {
  active_users: number;
  new_users: number;
  sessions: number;
  page_views: number;
  engagement_rate: number;
  average_session_duration_seconds: number;
}

interface RumProductSummary {
  product_code: string;
  name: string;
  host: string;
  path_prefix: string;
  status: "ok" | "no_data";
  page_views: number;
  visits: number;
  web_vitals_samples: number;
  lcp_good: number;
  lcp_total: number;
  inp_good: number;
  inp_total: number;
  cls_good: number;
  cls_total: number;
  lcp_good_rate: number | null;
  inp_good_rate: number | null;
  cls_good_rate: number | null;
}

interface DailyTraffic {
  date: string;
  visits: number;
  page_views: number;
}

let cachedOverview: CachedOverview | null = null;

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

function base64Url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeBase64Json(value: string): Record<string, string> {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function googleAccessToken(): Promise<string> {
  const encoded = Deno.env.get("GA4_SERVICE_ACCOUNT_JSON_B64") ?? "";
  if (!encoded) throw new Error("GA4_SERVICE_ACCOUNT_JSON_B64 is not configured.");
  const credentials = decodeBase64Json(encoded);
  const clientEmail = credentials.client_email;
  const privateKey = credentials.private_key;
  if (!clientEmail || !privateKey) throw new Error("The GA4 service-account credential is incomplete.");

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: ANALYTICS_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${base64Url(new Uint8Array(signature))}`;

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || !payload.access_token) {
    throw new Error(String((payload.error_description ?? payload.error) || "Google token exchange failed."));
  }
  return String(payload.access_token);
}

const GA_METRICS = [
  "activeUsers",
  "newUsers",
  "sessions",
  "screenPageViews",
  "engagementRate",
  "averageSessionDuration",
] as const;

function emptyAnalyticsWindow(): AnalyticsWindow {
  return {
    active_users: 0,
    new_users: 0,
    sessions: 0,
    page_views: 0,
    engagement_rate: 0,
    average_session_duration_seconds: 0,
  };
}

async function runGaReport(
  accessToken: string,
  propertyId: string,
  startDate: string,
): Promise<AnalyticsWindow> {
  const response = await fetch(
    `${ANALYTICS_ENDPOINT}/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: "today" }],
        metrics: GA_METRICS.map((name) => ({ name })),
        keepEmptyRows: true,
      }),
    },
  );
  const payload = await response.json() as Record<string, any>;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `GA4 report failed (${response.status}).`);
  }
  const values = payload.rows?.[0]?.metricValues ?? [];
  if (!values.length) return emptyAnalyticsWindow();
  const numberAt = (index: number) => Number(values[index]?.value ?? 0) || 0;
  return {
    active_users: numberAt(0),
    new_users: numberAt(1),
    sessions: numberAt(2),
    page_views: numberAt(3),
    engagement_rate: numberAt(4),
    average_session_duration_seconds: numberAt(5),
  };
}

function analyticsProperties(): Array<{ product_code: string; name: string; property_id: string }> {
  const raw = Deno.env.get("GA4_PROPERTY_IDS") ?? "";
  if (!raw) throw new Error("GA4_PROPERTY_IDS is not configured.");
  const parsed = JSON.parse(raw) as Record<string, string>;
  const rows = GA4_PRODUCTS
    .filter((productCode) => /^\d+$/.test(String(parsed[productCode] ?? "")))
    .map((productCode) => ({
      product_code: productCode,
      name: PRODUCT_NAMES[productCode],
      property_id: String(parsed[productCode]),
    }));
  if (!rows.length) throw new Error("GA4_PROPERTY_IDS contains no configured product properties.");
  return rows;
}

async function analyticsOverview(): Promise<Record<string, unknown>> {
  const accessToken = await googleAccessToken();
  const properties = analyticsProperties();
  const reports = await Promise.all(properties.map(async (property) => {
    try {
      const [sevenDay, thirtyDay] = await Promise.all([
        runGaReport(accessToken, property.property_id, "6daysAgo"),
        runGaReport(accessToken, property.property_id, "29daysAgo"),
      ]);
      return { ...property, status: "ok", seven_day: sevenDay, thirty_day: thirtyDay };
    } catch (error) {
      return {
        ...property,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        seven_day: emptyAnalyticsWindow(),
        thirty_day: emptyAnalyticsWindow(),
      };
    }
  }));

  const successful = reports.filter((report) => report.status === "ok");
  return {
    properties: reports,
    aggregate: {
      reporting_properties: successful.length,
      configured_properties: reports.length,
    },
  };
}

function normalizeHost(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePath(value: unknown): string {
  const raw = String(value ?? "/").trim();
  return (raw.startsWith("/") ? raw : `/${raw}`).toLowerCase();
}

function rumProduct(host: unknown, path: unknown): typeof RUM_PRODUCTS[number] | null {
  const normalizedHost = normalizeHost(host);
  const normalizedPath = normalizePath(path);
  for (const product of RUM_PRODUCTS) {
    if (normalizedHost !== product.host.toLowerCase()) continue;
    if (product.path_prefix === "/") return product;
    const prefix = product.path_prefix.toLowerCase().replace(/\/+$/g, "");
    if (normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)) return product;
  }
  return null;
}

function ratio(good: number, total: number): number | null {
  return total > 0 ? good / total : null;
}

function emptyRumSummary(product: typeof RUM_PRODUCTS[number]): RumProductSummary {
  return {
    ...product,
    status: "no_data",
    page_views: 0,
    visits: 0,
    web_vitals_samples: 0,
    lcp_good: 0,
    lcp_total: 0,
    inp_good: 0,
    inp_total: 0,
    cls_good: 0,
    cls_total: 0,
    lcp_good_rate: null,
    inp_good_rate: null,
    cls_good_rate: null,
  };
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function trafficDates(end: Date, days = 30): string[] {
  const endDate = new Date(end);
  endDate.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const value = new Date(endDate.getTime() - (days - 1 - index) * DAY_MS);
    return dateKey(value);
  });
}

function growthChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return (current - previous) / previous;
}

function trafficWindow(daily: DailyTraffic[]): { current: number; previous: number; change: number | null } {
  const current = daily.slice(-7).reduce((sum, row) => sum + row.visits, 0);
  const previous = daily.slice(-14, -7).reduce((sum, row) => sum + row.visits, 0);
  return { current, previous, change: growthChange(current, previous) };
}

async function cloudflareGraphql(query: string, variables: Record<string, unknown>): Promise<Record<string, any>> {
  const apiToken = Deno.env.get("CLOUDFLARE_ANALYTICS_API_TOKEN") ?? "";
  if (!apiToken) throw new Error("CLOUDFLARE_ANALYTICS_API_TOKEN is not configured.");
  const response = await fetch(CLOUDFLARE_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`Cloudflare GraphQL failed (${response.status}).`);
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(payload.errors.map((item: Record<string, unknown>) => String(item.message ?? "Cloudflare GraphQL error")).join("; "));
  }
  return payload;
}

function emptyCloudflare(status: "not_configured" | "error", error: string): Record<string, unknown> {
  const dates = trafficDates(new Date());
  return {
    status,
    error,
    window_days: 30,
    products: RUM_PRODUCTS.map(emptyRumSummary),
    momentum: RUM_PRODUCTS.map((product) => ({
      product_code: product.product_code,
      name: product.name,
      current_7d_visits: 0,
      previous_7d_visits: 0,
      change_rate: 0,
    })),
    trend: {
      daily: dates.map((date) => ({ date, visits: 0, page_views: 0 })),
      current_7d_visits: 0,
      previous_7d_visits: 0,
      change_rate: 0,
    },
    aggregate: {
      reporting_products: 0,
      configured_products: RUM_PRODUCTS.length,
      page_views: 0,
      visits: 0,
    },
  };
}

async function cloudflareOverview(): Promise<Record<string, unknown>> {
  const accountTag = (Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "").trim();
  const apiToken = (Deno.env.get("CLOUDFLARE_ANALYTICS_API_TOKEN") ?? "").trim();
  if (!accountTag || !apiToken) {
    return emptyCloudflare("not_configured", "Cloudflare Analytics credentials are not configured.");
  }

  const end = new Date();
  const dates = trafficDates(end);
  const start = new Date(`${dates[0]}T00:00:00.000Z`);
  const query = `
    query OperationsRum($accountTag: string!, $start: Time!, $end: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          pageload: rumPageloadEventsAdaptiveGroups(
            limit: 10000
            orderBy: [date_ASC]
            filter: { datetime_geq: $start, datetime_leq: $end, bot: 0 }
          ) {
            count
            sum { visits }
            dimensions { date requestHost requestPath siteTag }
          }
          vitals: rumWebVitalsEventsAdaptiveGroups(
            limit: 10000
            orderBy: [count_DESC]
            filter: { datetime_geq: $start, datetime_leq: $end, bot: 0 }
          ) {
            count
            sum {
              lcpGood lcpNeedsImprovement lcpPoor lcpTotal
              inpGood inpNeedsImprovement inpPoor inpTotal
              clsGood clsNeedsImprovement clsPoor clsTotal
            }
            dimensions { requestHost requestPath siteTag }
          }
        }
      }
    }
  `;

  try {
    const payload = await cloudflareGraphql(query, {
      accountTag,
      start: start.toISOString(),
      end: end.toISOString(),
    });
    const account = payload.data?.viewer?.accounts?.[0];
    if (!account) throw new Error("Cloudflare account analytics are unavailable.");

    const summaries = new Map<string, RumProductSummary>(
      RUM_PRODUCTS.map((product) => [product.product_code, emptyRumSummary(product)]),
    );
    const overallDaily = new Map<string, DailyTraffic>(
      dates.map((date) => [date, { date, visits: 0, page_views: 0 }]),
    );
    const productDaily = new Map<string, Map<string, DailyTraffic>>(
      RUM_PRODUCTS.map((product) => [
        product.product_code,
        new Map(dates.map((date) => [date, { date, visits: 0, page_views: 0 }])),
      ]),
    );

    for (const row of account.pageload ?? []) {
      const product = rumProduct(row.dimensions?.requestHost, row.dimensions?.requestPath);
      if (!product) continue;
      const summary = summaries.get(product.product_code)!;
      const pageViews = Number(row.count ?? 0) || 0;
      const visits = Number(row.sum?.visits ?? 0) || 0;
      summary.page_views += pageViews;
      summary.visits += visits;

      const date = String(row.dimensions?.date ?? "");
      const overall = overallDaily.get(date);
      const perProduct = productDaily.get(product.product_code)?.get(date);
      if (overall) {
        overall.page_views += pageViews;
        overall.visits += visits;
      }
      if (perProduct) {
        perProduct.page_views += pageViews;
        perProduct.visits += visits;
      }
    }

    for (const row of account.vitals ?? []) {
      const product = rumProduct(row.dimensions?.requestHost, row.dimensions?.requestPath);
      if (!product) continue;
      const summary = summaries.get(product.product_code)!;
      const sum = row.sum ?? {};
      summary.web_vitals_samples += Number(row.count ?? 0) || 0;
      summary.lcp_good += Number(sum.lcpGood ?? 0) || 0;
      summary.lcp_total += Number(sum.lcpTotal ?? 0) || 0;
      summary.inp_good += Number(sum.inpGood ?? 0) || 0;
      summary.inp_total += Number(sum.inpTotal ?? 0) || 0;
      summary.cls_good += Number(sum.clsGood ?? 0) || 0;
      summary.cls_total += Number(sum.clsTotal ?? 0) || 0;
    }

    const products = [...summaries.values()].map((summary) => {
      summary.status = summary.page_views > 0 || summary.web_vitals_samples > 0 ? "ok" : "no_data";
      summary.lcp_good_rate = ratio(summary.lcp_good, summary.lcp_total);
      summary.inp_good_rate = ratio(summary.inp_good, summary.inp_total);
      summary.cls_good_rate = ratio(summary.cls_good, summary.cls_total);
      return summary;
    });

    const daily = dates.map((date) => overallDaily.get(date)!);
    const totalWindow = trafficWindow(daily);
    const momentum = RUM_PRODUCTS.map((product) => {
      const rows = dates.map((date) => productDaily.get(product.product_code)!.get(date)!);
      const window = trafficWindow(rows);
      return {
        product_code: product.product_code,
        name: product.name,
        current_7d_visits: window.current,
        previous_7d_visits: window.previous,
        change_rate: window.change,
      };
    }).sort((a, b) => b.current_7d_visits - a.current_7d_visits);

    return {
      status: "ok",
      window_days: 30,
      products,
      momentum,
      trend: {
        daily,
        current_7d_visits: totalWindow.current,
        previous_7d_visits: totalWindow.previous,
        change_rate: totalWindow.change,
      },
      aggregate: {
        reporting_products: products.filter((product) => product.status === "ok").length,
        configured_products: products.length,
        page_views: products.reduce((total, product) => total + product.page_views, 0),
        visits: products.reduce((total, product) => total + product.visits, 0),
      },
    };
  } catch (error) {
    return emptyCloudflare("error", error instanceof Error ? error.message : String(error));
  }
}

async function supabaseUsage(admin: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  try {
    const [profilesResult, accountsResult] = await Promise.all([
      admin.from("profiles").select("id,created_at,last_seen_at"),
      admin.from("product_accounts").select("user_id,product_code,last_seen_at"),
    ]);
    if (profilesResult.error) throw profilesResult.error;
    if (accountsResult.error) throw accountsResult.error;

    const now = Date.now();
    const sevenAgo = now - 7 * DAY_MS;
    const thirtyAgo = now - 30 * DAY_MS;
    const profiles = profilesResult.data ?? [];
    const accounts = accountsResult.data ?? [];
    const time = (value: unknown) => {
      const parsed = Date.parse(String(value ?? ""));
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const activeUsers = new Set<string>();
    const byProduct = new Map<string, { users: Set<string>; latest: number }>();
    let latestActivity = 0;
    for (const row of accounts) {
      const productCode = String(row.product_code ?? "unknown");
      const userId = String(row.user_id ?? "");
      const lastSeen = time(row.last_seen_at);
      if (userId && lastSeen >= sevenAgo) activeUsers.add(userId);
      latestActivity = Math.max(latestActivity, lastSeen);
      const bucket = byProduct.get(productCode) ?? { users: new Set<string>(), latest: 0 };
      if (userId) bucket.users.add(userId);
      bucket.latest = Math.max(bucket.latest, lastSeen);
      byProduct.set(productCode, bucket);
    }

    const latestSignup = profiles.reduce((latest, row) => Math.max(latest, time(row.created_at)), 0);
    return {
      status: "ok",
      users: {
        total: profiles.length,
        new_7d: profiles.filter((row) => time(row.created_at) >= sevenAgo).length,
        new_30d: profiles.filter((row) => time(row.created_at) >= thirtyAgo).length,
        active_7d: activeUsers.size,
        latest_signup_at: latestSignup ? new Date(latestSignup).toISOString() : null,
      },
      product_accounts: {
        total: accounts.length,
        products_with_accounts: byProduct.size,
        latest_activity_at: latestActivity ? new Date(latestActivity).toISOString() : null,
        by_product: [...byProduct.entries()]
          .map(([product_code, bucket]) => ({
            product_code,
            name: PRODUCT_NAMES[product_code] ?? product_code,
            users: bucket.users.size,
            last_seen_at: bucket.latest ? new Date(bucket.latest).toISOString() : null,
          }))
          .sort((a, b) => b.users - a.users || a.name.localeCompare(b.name)),
      },
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function stripeRequest(path: string): Promise<Record<string, any>> {
  const secret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not configured.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const payload = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(payload.error?.message ?? `Stripe request failed (${response.status}).`);
  return payload;
}

async function listStripeCharges(createdGte: number): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  let startingAfter = "";
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ limit: "100", "created[gte]": String(createdGte) });
    if (startingAfter) query.set("starting_after", startingAfter);
    const payload = await stripeRequest(`charges?${query}`);
    const data = Array.isArray(payload.data) ? payload.data : [];
    rows.push(...data);
    if (!payload.has_more || !data.length) break;
    startingAfter = String(data[data.length - 1].id ?? "");
    if (!startingAfter) break;
  }
  return rows;
}

function moneyRows(input: unknown): Array<{ amount: number; currency: string; source_types?: unknown }> {
  if (!Array.isArray(input)) return [];
  return input.map((row: Record<string, any>) => ({
    amount: Number(row.amount ?? 0),
    currency: String(row.currency ?? "").toLowerCase(),
    source_types: row.source_types ?? null,
  }));
}

async function stripeOverview(admin: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  const createdGte = Math.floor((Date.now() - 30 * DAY_MS) / 1000);
  const [charges, balance, payouts, subscriptionResult] = await Promise.all([
    listStripeCharges(createdGte),
    stripeRequest("balance"),
    stripeRequest("payouts?limit=5"),
    admin
      .from("subscriptions")
      .select("product_code,status,cancel_at_period_end")
      .order("created_at", { ascending: false }),
  ]);

  if (subscriptionResult.error) throw subscriptionResult.error;
  const successfulCharges = charges.filter((charge) => charge.paid && charge.status === "succeeded");
  const currencyBuckets = new Map<string, { currency: string; gross: number; refunded: number; net_before_fees: number; payments: number }>();
  for (const charge of successfulCharges) {
    const currency = String(charge.currency ?? "usd").toLowerCase();
    const bucket = currencyBuckets.get(currency) ?? {
      currency,
      gross: 0,
      refunded: 0,
      net_before_fees: 0,
      payments: 0,
    };
    const amount = Number(charge.amount ?? 0);
    const refunded = Number(charge.amount_refunded ?? 0);
    bucket.gross += amount;
    bucket.refunded += refunded;
    bucket.net_before_fees += amount - refunded;
    bucket.payments += 1;
    currencyBuckets.set(currency, bucket);
  }

  const subscriptions = subscriptionResult.data ?? [];
  const activeStatuses = new Set(["active", "trialing", "past_due"]);
  const active = subscriptions.filter((row) => activeStatuses.has(String(row.status)));
  const byProduct = new Map<string, number>();
  for (const row of active) {
    const code = String(row.product_code ?? "unknown");
    byProduct.set(code, (byProduct.get(code) ?? 0) + 1);
  }

  return {
    last_30_days: [...currencyBuckets.values()],
    successful_payments: successfulCharges.length,
    subscriptions: {
      active: active.length,
      past_due: subscriptions.filter((row) => row.status === "past_due").length,
      cancel_at_period_end: subscriptions.filter((row) => row.cancel_at_period_end).length,
      by_product: [...byProduct.entries()].map(([product_code, count]) => ({ product_code, count })),
    },
    balance: {
      available: moneyRows(balance.available),
      pending: moneyRows(balance.pending),
    },
    payouts: (Array.isArray(payouts.data) ? payouts.data : []).map((payout: Record<string, any>) => ({
      id: payout.id,
      amount: Number(payout.amount ?? 0),
      currency: String(payout.currency ?? "").toLowerCase(),
      status: String(payout.status ?? "unknown"),
      arrival_date: payout.arrival_date
        ? new Date(Number(payout.arrival_date) * 1000).toISOString()
        : null,
      created_at: payout.created
        ? new Date(Number(payout.created) * 1000).toISOString()
        : null,
    })),
  };
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
  const { data: adminRow, error: adminError } = await admin
    .from("membership_admins")
    .select("role,active")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (adminError || !adminRow?.active) return json(req, { error: "Administrator access is required." }, 403);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    body = {};
  }
  const forceRefresh = body.force_refresh === true && adminRow.role === "owner";
  const cacheMinutes = Math.min(1440, Math.max(5, Number(Deno.env.get("OPERATIONS_CACHE_MINUTES") ?? 30) || 30));

  if (!forceRefresh && cachedOverview && cachedOverview.expiresAt > Date.now()) {
    return json(req, { ...cachedOverview.payload, cached: true });
  }

  try {
    const [analytics, cloudflare, platform, stripe] = await Promise.all([
      analyticsOverview(),
      cloudflareOverview(),
      supabaseUsage(admin),
      stripeOverview(admin),
    ]);
    const payload = {
      generated_at: new Date().toISOString(),
      cache_minutes: cacheMinutes,
      cached: false,
      cloudflare,
      analytics,
      platform,
      stripe,
    };
    cachedOverview = {
      expiresAt: Date.now() + cacheMinutes * 60_000,
      payload,
    };
    return json(req, payload);
  } catch (error) {
    return json(req, {
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
