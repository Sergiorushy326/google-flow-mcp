import { DISCOVERY_HOST_PATTERNS } from "../constants.js";
import type { ApiEndpoint } from "../types.js";
import { getFlowPage } from "./browser.js";
import { loadApiMap, saveApiMap } from "./transport.js";

/**
 * API DISCOVERY
 *
 * Flow's tRPC surface is undocumented and will change. Rather than hard-coding
 * guesses — where a wrong mutation name can cost real credits — this records what
 * Flow's own frontend actually calls while a human drives it, and derives the
 * contract from observed traffic.
 *
 * Only SHAPES are persisted. Request and response values are read to extract key
 * names and then dropped, so the map never contains prompts, media, tokens, or
 * anything account-identifying.
 */

export interface DiscoveryReport {
  durationMs: number;
  requestsSeen: number;
  endpoints: ApiEndpoint[];
  newProcedures: string[];
}

/** @internal exported for unit tests */
export function procedureFromUrl(url: string): string | null {
  const trpc = /\/fx\/api\/trpc\/([^?/]+)/.exec(url);
  if (trpc) return decodeURIComponent(trpc[1]);
  const api = /\/fx\/api\/([^?]+)/.exec(url);
  if (api) return `rest:${api[1]}`;
  const backend = /aisandbox-pa\.googleapis\.com\/([^?]+)/.exec(url);
  if (backend) return `backend:${backend[1]}`;
  return null;
}

/**
 * Key names only, nested paths flattened. Values never leave this function.
 * @internal exported for unit tests
 */
export function shapeOf(value: unknown, prefix = "", depth = 0): string[] {
  if (depth > 3 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.length > 0 ? shapeOf(value[0], `${prefix}[]`, depth + 1) : [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    keys.push(p);
    keys.push(...shapeOf(v, p, depth + 1));
  }
  return keys.slice(0, 60);
}

function safeParse(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Record traffic for `durationMs` while the human (or another tool) exercises Flow.
 * Free by construction: this observes, it never submits anything.
 */
export async function discoverApi(durationMs = 60_000, navigate = true): Promise<DiscoveryReport> {
  const page = await getFlowPage();
  const map = await loadApiMap();
  const before = new Set(Object.keys(map.endpoints));
  const started = Date.now();
  let requestsSeen = 0;

  const pending = new Map<string, { method: string; inputKeys: string[] }>();

  const onRequest = (req: import("playwright-core").Request) => {
    const url = req.url();
    if (!DISCOVERY_HOST_PATTERNS.some((p) => p.test(url))) return;
    const procedure = procedureFromUrl(url);
    if (!procedure) return;
    requestsSeen++;

    const inputKeys = new Set<string>();
    for (const [k] of new URL(url).searchParams) {
      if (k === "input") {
        const parsed = safeParse(new URL(url).searchParams.get("input"));
        for (const key of shapeOf((parsed as { json?: unknown })?.json ?? parsed)) inputKeys.add(key);
      } else {
        inputKeys.add(k);
      }
    }
    const body = safeParse(req.postData());
    for (const key of shapeOf((body as { json?: unknown })?.json ?? body)) inputKeys.add(key);

    pending.set(url, { method: req.method(), inputKeys: [...inputKeys] });
  };

  const onResponse = async (res: import("playwright-core").Response) => {
    const url = res.url();
    const req = pending.get(url);
    if (!req) return;
    pending.delete(url);
    const procedure = procedureFromUrl(url);
    if (!procedure || res.status() >= 400) return;

    let responseKeys: string[] = [];
    try {
      const ct = res.headers()["content-type"] ?? "";
      if (ct.includes("json")) {
        const parsed = safeParse(await res.text());
        const unwrapped = (parsed as { result?: { data?: { json?: unknown } } })?.result?.data?.json ?? parsed;
        responseKeys = shapeOf(unwrapped);
      }
    } catch {
      /* body already consumed or streamed */
    }

    const existing = map.endpoints[procedure];
    const endpoint: ApiEndpoint = {
      procedure,
      method: req.method === "POST" ? "POST" : "GET",
      urlTemplate: url.split("?")[0],
      inputKeys: [...new Set([...(existing?.inputKeys ?? []), ...req.inputKeys])],
      responseKeys: [...new Set([...(existing?.responseKeys ?? []), ...responseKeys])],
      // Only GETs are assumed replayable from Node; POSTs may carry CSRF state,
      // and a wrongly-replayed mutation could charge. flow_verify_http promotes.
      httpSafe: existing?.httpSafe ?? false,
      observedAt: new Date().toISOString(),
      sampleCount: (existing?.sampleCount ?? 0) + 1,
    };
    map.endpoints[procedure] = endpoint;
  };

  page.on("request", onRequest);
  page.on("response", onResponse);

  try {
    if (navigate) {
      // Reloading replays the app's whole bootstrap: session, projects, library.
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    await page.waitForTimeout(durationMs);
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }

  map.discoveredAt = new Date().toISOString();
  await saveApiMap(map);

  const endpoints = Object.values(map.endpoints);
  return {
    durationMs: Date.now() - started,
    requestsSeen,
    endpoints,
    newProcedures: endpoints.map((e) => e.procedure).filter((p) => !before.has(p)),
  };
}

/**
 * Promote read-only GET endpoints from Tier 2 to Tier 1 by proving a Node-side
 * call with cookies returns the same status as the in-page call. Mutations are
 * never auto-promoted: replaying one to test it could generate and charge.
 */
export async function verifyHttpTier(procedures: string[]): Promise<Record<string, boolean>> {
  const map = await loadApiMap();
  const results: Record<string, boolean> = {};

  for (const name of procedures) {
    const endpoint = map.endpoints[name];
    if (!endpoint) {
      results[name] = false;
      continue;
    }
    if (endpoint.method !== "GET") {
      results[name] = false;
      continue;
    }
    try {
      const { callTrpc } = await import("./transport.js");
      const viaHttp = await callTrpc({ procedure: name, forceTier: "http", retryOnAuth: false });
      const ok = viaHttp.status < 400;
      endpoint.httpSafe = ok;
      results[name] = ok;
    } catch {
      endpoint.httpSafe = false;
      results[name] = false;
    }
  }

  await saveApiMap(map);
  return results;
}

export function formatReport(report: DiscoveryReport): string {
  const lines = [
    `Observed ${report.requestsSeen} Flow API requests in ${Math.round(report.durationMs / 1000)}s.`,
    `Endpoints in map: ${report.endpoints.length} (${report.newProcedures.length} new)`,
    "",
  ];
  for (const e of report.endpoints.slice(0, 40)) {
    lines.push(
      `${e.method.padEnd(4)} ${e.procedure}` +
        `${e.httpSafe ? "  [http-safe]" : ""}` +
        `\n     in:  ${e.inputKeys.slice(0, 8).join(", ") || "(none)"}` +
        `\n     out: ${e.responseKeys.slice(0, 8).join(", ") || "(none)"}`,
    );
  }
  if (report.newProcedures.length > 0) {
    lines.push("", `New this run: ${report.newProcedures.join(", ")}`);
  }
  return lines.join("\n");
}
