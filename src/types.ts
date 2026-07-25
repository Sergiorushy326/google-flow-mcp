/** Which rung of the transport ladder served a call. Surfaced in results so the
 *  caller can see when we have degraded from API to clicking. */
export type Tier = "http" | "page-fetch" | "dom";

export interface SessionState {
  browserConnected: boolean;
  /** How we got the browser: attached to the user's Chrome, or launched our own. */
  browserMode: "cdp-attach" | "launched" | "none";
  loggedIn: boolean;
  account: string | null;
  credits: number | null;
  projectId: string | null;
  /** Flow's "Confirm before generating" setting. Anything but "always" means an
   *  approval card may never appear and generations can auto-charge. */
  confirmGate: "always" | "off" | "unknown";
  blockedBy: string | null;
}

export interface CostQuote {
  credits: number;
  /** Raw text the quote was parsed from, so a bad parse is auditable. */
  rawText: string;
}

export type GenerationVerdict = "downloaded" | "in_flight" | "rejected" | "failed";

export interface GenerationResult {
  verdict: GenerationVerdict;
  quotedCost: number;
  charged: number;
  mediaIds: string[];
  files: string[];
  balanceAfter: number | null;
  tier: Tier;
  notes: string[];
}

export interface LedgerEntry {
  ts: string;
  kind: "still" | "video" | "scene" | "adjustment";
  prompt: string | null;
  model: string | null;
  quotedCost: number;
  charged: number;
  balanceAfter: number | null;
  verdict: GenerationVerdict;
  files: string[];
  note: string | null;
}

export interface BudgetState {
  ceiling: number | null;
  spent: number;
  startedAt: string;
}

/** One learned endpoint. Written by flow_discover_api, read by the transport. */
export interface ApiEndpoint {
  procedure: string;
  method: "GET" | "POST";
  urlTemplate: string;
  /** Request body/query keys only — values are never persisted. */
  inputKeys: string[];
  responseKeys: string[];
  /** Confirmed to work from Node with cookies alone (no page needed). */
  httpSafe: boolean;
  observedAt: string;
  sampleCount: number;
}

export interface ApiMap {
  version: 1;
  discoveredAt: string;
  endpoints: Record<string, ApiEndpoint>;
}

export interface MediaItem {
  mediaId: string;
  kind: "image" | "video" | "unknown";
  /** Best-effort label from the library grid. */
  name: string | null;
  thumbnailUrl: string | null;
}

export class FlowError extends Error {
  constructor(
    message: string,
    /** Appended to the message so the agent gets a next step, not just a failure. */
    readonly remedy?: string,
  ) {
    super(remedy ? `${message}\n\nNext step: ${remedy}` : message);
    this.name = "FlowError";
  }
}

/** Thrown when something would spend credits that policy forbids. Never retried. */
export class BudgetError extends FlowError {
  constructor(message: string, remedy?: string) {
    super(message, remedy);
    this.name = "BudgetError";
  }
}

/** Thrown on a re-auth wall, paywall, or bot challenge. Always hands back to a human. */
export class StopSignalError extends FlowError {
  constructor(reason: string) {
    super(
      `Flow surfaced a ${reason}. Stopping without spending credits.`,
      "A human must resolve this in the browser window. This server never handles credentials, passkeys, or payment.",
    );
    this.name = "StopSignalError";
  }
}
