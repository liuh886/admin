export interface HealthProduct {
  product_code: string;
  name: string;
  host: string;
  path_prefix: string;
  repo: string;
  branch: string;
}

const GITHUB_API = "https://api.github.com";
const GITHUB_OWNER = "liuh886";
const NEWSFLOW_FRESHNESS_URL = "https://raw.githubusercontent.com/liuh886/NewsFlow/main/content/state/governance-sync.json";

function productUrl(product: HealthProduct): string {
  const path = product.path_prefix.startsWith("/") ? product.path_prefix : `/${product.path_prefix}`;
  return `https://${product.host}${path}`;
}

async function githubActionsHealth(product: HealthProduct): Promise<Record<string, unknown>> {
  const url = `${GITHUB_API}/repos/${GITHUB_OWNER}/${encodeURIComponent(product.repo)}/actions/runs?branch=${encodeURIComponent(product.branch)}&per_page=1`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "hao-apps-operations",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return { status: "error", http_status: response.status, error: `GitHub Actions returned ${response.status}.` };
    }
    const payload = await response.json() as Record<string, any>;
    const run = Array.isArray(payload.workflow_runs) ? payload.workflow_runs[0] : null;
    if (!run) return { status: "no_runs", workflow: null, updated_at: null, url: null };
    const status = run.status === "completed" ? String(run.conclusion ?? "unknown") : String(run.status ?? "unknown");
    return {
      status,
      workflow: String(run.name ?? "GitHub Actions"),
      event: String(run.event ?? ""),
      run_number: Number(run.run_number ?? 0),
      updated_at: run.updated_at ?? run.created_at ?? null,
      url: run.html_url ?? null,
    };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

async function serviceHealth(product: HealthProduct): Promise<Record<string, unknown>> {
  const url = productUrl(product);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    try { await response.body?.cancel(); } catch { /* response status is already authoritative */ }
    return {
      status: response.ok ? "up" : "down",
      http_status: response.status,
      latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      checked_at: new Date().toISOString(),
      url,
    };
  } catch (error) {
    return {
      status: "error",
      http_status: null,
      latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      checked_at: new Date().toISOString(),
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function dataFreshness(product: HealthProduct): Promise<Record<string, unknown> | null> {
  if (product.product_code !== "newsflow") return null;
  try {
    const response = await fetch(NEWSFLOW_FRESHNESS_URL, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      return { status: "error", source: "content/state/governance-sync.json", observed_at: null, age_hours: null, error: `Freshness marker returned ${response.status}.` };
    }
    const payload = await response.json() as Record<string, unknown>;
    const observedAt = String(payload.generated_at ?? "");
    const observedMs = Date.parse(observedAt);
    if (!observedAt || !Number.isFinite(observedMs)) {
      return { status: "error", source: "content/state/governance-sync.json", observed_at: null, age_hours: null, error: "Freshness marker has no valid generated_at." };
    }
    return {
      status: "reported",
      source: "content/state/governance-sync.json",
      observed_at: new Date(observedMs).toISOString(),
      age_hours: Math.max(0, Math.round(((Date.now() - observedMs) / 3_600_000) * 10) / 10),
    };
  } catch (error) {
    return {
      status: "error",
      source: "content/state/governance-sync.json",
      observed_at: null,
      age_hours: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function productHealthOverview(products: readonly HealthProduct[]): Promise<Record<string, unknown>> {
  const rows = await Promise.all(products.map(async (product) => {
    const [github, service, freshness] = await Promise.all([
      githubActionsHealth(product),
      serviceHealth(product),
      dataFreshness(product),
    ]);
    return {
      product_code: product.product_code,
      name: product.name,
      repository: `${GITHUB_OWNER}/${product.repo}`,
      branch: product.branch,
      github,
      service,
      freshness,
    };
  }));

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    aggregate: {
      products: rows.length,
      services_up: rows.filter((row) => row.service.status === "up").length,
      actions_success: rows.filter((row) => row.github.status === "success").length,
      freshness_reporting: rows.filter((row) => row.freshness?.status === "reported").length,
    },
    products: rows,
  };
}
