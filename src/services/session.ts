import { AUTH_SESSION_URL } from "../constants.js";
import { config } from "../config.js";
import type { SessionState } from "../types.js";
import { assertNoStopSignal, browserMode, getFlowPage } from "./browser.js";
import { pageText } from "./transport.js";

/**
 * One call that answers "is it safe to spend credits right now". Every charged
 * tool runs this first, because each field maps to a way a run can go wrong:
 * signed out, no credits, wrong project, or — worst — the confirm gate switched
 * off, which lets Flow's agent generate and charge without ever showing a card.
 */
export async function readSession(): Promise<SessionState> {
  const state: SessionState = {
    browserConnected: false,
    browserMode: "none",
    loggedIn: false,
    account: null,
    credits: null,
    projectId: config.defaultProjectId,
    confirmGate: "unknown",
    blockedBy: null,
  };

  let page;
  try {
    page = await getFlowPage();
    state.browserConnected = true;
    state.browserMode = browserMode();
  } catch (err) {
    state.blockedBy = (err as Error).message;
    return state;
  }

  try {
    await assertNoStopSignal(page);
  } catch (err) {
    state.blockedBy = (err as Error).message;
  }

  // NextAuth session endpoint: cheapest logged-in probe, and it never charges.
  try {
    const session = await page.evaluate(async (url) => {
      const r = await fetch(url, { credentials: "include" });
      return r.ok ? await r.text() : null;
    }, AUTH_SESSION_URL);
    if (session) {
      const parsed = JSON.parse(session) as { user?: { email?: string; name?: string } };
      state.account = parsed?.user?.email ?? parsed?.user?.name ?? null;
      state.loggedIn = Boolean(state.account);
    }
  } catch {
    // Fall through to the URL heuristic below.
  }

  if (!state.loggedIn) state.loggedIn = !/accounts\.google\.com|\/signin/.test(page.url());

  state.projectId = extractProjectId(page.url()) ?? state.projectId;
  state.credits = await readCredits();
  state.confirmGate = await readConfirmGate();

  return state;
}

export function extractProjectId(url: string): string | null {
  return /\/project\/([A-Za-z0-9_-]+)/.exec(url)?.[1] ?? null;
}

/**
 * Credit balance. It lives behind the avatar menu rather than on the main screen,
 * so the DOM sweep is a best-effort scan for a credits-shaped number anywhere in
 * the rendered text. Returns null rather than guessing — callers treat an unknown
 * balance as "cannot verify budget" rather than "budget is fine".
 */
export async function readCredits(): Promise<number | null> {
  try {
    const text = await pageText();
    const patterns = [
      /([\d,]+)\s*credits?\s*(?:remaining|left|available)/i,
      /credits?\s*(?:remaining|left|available)?\s*[:•]?\s*([\d,]+)/i,
    ];
    for (const p of patterns) {
      const m = p.exec(text);
      if (m) {
        const n = Number.parseInt(m[1].replace(/,/g, ""), 10);
        if (Number.isFinite(n)) return n;
      }
    }
  } catch {
    /* unknown */
  }
  return null;
}

/**
 * Flow's "Confirm before generating" setting. If a human ever clicked
 * "Approve, do not ask again", Flow stops showing approval cards and its agent
 * charges autonomously — including on its own silent retries after a failure.
 * Detecting that is the single highest-value safety check in this server.
 */
export async function readConfirmGate(): Promise<"always" | "off" | "unknown"> {
  try {
    const text = (await pageText()).replace(/\s+/g, " ");
    if (/confirm before generating[^.]{0,40}\boff\b/i.test(text)) return "off";
    if (/confirm before generating[^.]{0,40}\balways\b/i.test(text)) return "always";
  } catch {
    /* unknown */
  }
  return "unknown";
}

export function describeSession(s: SessionState): string {
  const lines = [
    `Browser: ${s.browserConnected ? `connected (${s.browserMode})` : "NOT CONNECTED"}`,
    `Signed in: ${s.loggedIn ? `yes${s.account ? ` (${s.account})` : ""}` : "NO"}`,
    `Credits: ${s.credits ?? "unknown"}`,
    `Project: ${s.projectId ?? "none selected"}`,
    `Confirm-before-generating: ${s.confirmGate}`,
  ];
  if (s.blockedBy) lines.push(`BLOCKED: ${s.blockedBy}`);
  if (s.confirmGate !== "always") {
    lines.push(
      `WARNING: the approval gate is not confirmed ON. Flow may generate and charge without showing a cost card. ` +
        `Open Settings -> "Confirm before generating" and set it to Always before any paid generation.`,
    );
  }
  return lines.join("\n");
}
