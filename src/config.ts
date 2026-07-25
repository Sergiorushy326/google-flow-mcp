import * as os from "node:os";
import * as path from "node:path";

/**
 * All configuration is env-driven so the same build works for any user's account.
 * Nothing here is secret: this server never handles a credential. It attaches to
 * a browser a human already logged in.
 */
export interface Config {
  /** CDP endpoint of an already-running Chrome, e.g. http://127.0.0.1:9222. */
  cdpUrl: string | null;
  /** Persistent profile dir used when we launch our own browser instead. */
  profileDir: string;
  /** Playwright channel for the self-launch path. */
  channel: string;
  headless: boolean;
  /** Where generated media lands. */
  outputDir: string;
  /** Server state: api-map.json, ledger.jsonl, budget.json. */
  stateDir: string;
  /** Hard credit ceiling for the whole server lifetime; null = only per-call limits apply. */
  budgetCeiling: number | null;
  /** Flow project id to operate in, when the caller does not name one. */
  defaultProjectId: string | null;
}

function envInt(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function loadConfig(): Config {
  const stateDir = process.env.FLOW_STATE_DIR || path.join(os.homedir(), ".google-flow-mcp");
  return {
    cdpUrl: process.env.FLOW_CDP_URL || null,
    profileDir: process.env.FLOW_PROFILE_DIR || path.join(stateDir, "chrome-profile"),
    channel: process.env.FLOW_BROWSER_CHANNEL || "chrome",
    headless: process.env.FLOW_HEADLESS === "1",
    outputDir: process.env.FLOW_OUTPUT_DIR || path.join(os.homedir(), "flow-output"),
    stateDir,
    budgetCeiling: envInt("FLOW_BUDGET_CEILING"),
    defaultProjectId: process.env.FLOW_PROJECT_ID || null,
  };
}

export const config = loadConfig();

export const paths = {
  apiMap: path.join(config.stateDir, "api-map.json"),
  ledger: path.join(config.stateDir, "ledger.jsonl"),
  budget: path.join(config.stateDir, "budget.json"),
};
