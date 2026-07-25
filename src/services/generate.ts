import { POLL_INTERVAL_MS, TIMEOUTS } from "../constants.js";
import { BudgetError, FlowError, type CostQuote, type GenerationResult, type LedgerEntry } from "../types.js";
import { assertNoStopSignal, getFlowPage } from "./browser.js";
import { attachMedia, clearAttachments } from "./compose.js";
import { appendLedger, assertAffordable, recordSpend } from "./ledger.js";
import { downloadMedia, listMedia } from "./media.js";
import { readCredits, readSession } from "./session.js";
import { clickByText, pageText } from "./transport.js";

/**
 * GENERATION IS THE ONLY PLACE THIS SERVER SPENDS MONEY.
 *
 * Flow's UI is an agent-chat, not a form: you send a request, Flow's own agent
 * replies with a proposal carrying a quoted credit cost and Approve/Reject
 * controls, and nothing is charged until Approve. Every safeguard here exists to
 * keep that property intact:
 *
 *   - the quote is READ and CHECKED before Approve is ever clicked
 *   - a rejected proposal costs zero, so dry_run is a genuinely free price probe
 *   - the Approve click is text-matched precisely enough to never hit
 *     "Approve, do not ask again", which would disable the gate for the session
 *   - an in-flight generation is never resubmitted; a resubmit is a second charge
 */

export interface GenerateOptions {
  prompt: string;
  /** Refuse and reject the proposal if Flow quotes more than this. */
  expectedMaxCost: number;
  /** Quote the price, reject, charge nothing. */
  dryRun?: boolean;
  /** Approve and return immediately, for parallel submission. Collect later. */
  noWait?: boolean;
  /** Where to save. Relative paths resolve under FLOW_OUTPUT_DIR. */
  outFile?: string;
  /** Stills are free; this skips the budget machinery but not the stop-signal checks. */
  free?: boolean;
  timeoutMs?: number;
  /**
   * Attachments decide the generation MODE — Flow has no mode switch, only what
   * is on the composer when Enter is pressed:
   *   startFrame           -> Frames-to-Video (the composition is preserved)
   *   startFrame+endFrame  -> Frames-to-Video with an interpolation target
   *   referenceMediaIds    -> Ingredients-to-Video (recomposes; <=3 refs)
   *   none                 -> Text-to-Video (least control)
   */
  startFrameMediaId?: string;
  endFrameMediaId?: string;
  referenceMediaIds?: string[];
}

export function describeMode(opts: GenerateOptions): string {
  if (opts.referenceMediaIds?.length)
    return `Ingredients-to-Video (${opts.referenceMediaIds.length} reference image(s))`;
  if (opts.startFrameMediaId && opts.endFrameMediaId) return "Frames-to-Video (start + end frame)";
  if (opts.startFrameMediaId) return "Frames-to-Video (start frame)";
  return "Text-to-Video (no attachment — composition is uncontrolled)";
}

/** Preflight that must pass before any request reaches Flow's chat. */
async function preflight(free: boolean): Promise<number | null> {
  const session = await readSession();

  if (!session.browserConnected) {
    throw new FlowError("No browser session.", session.blockedBy ?? "Run flow_check_session for setup instructions.");
  }
  if (!session.loggedIn) {
    throw new FlowError(
      "The attached browser is not signed into Google Flow.",
      "Sign in at labs.google/fx/tools/flow in that Chrome window. This server never handles credentials.",
    );
  }
  if (session.blockedBy) throw new FlowError(session.blockedBy);

  if (!free && session.confirmGate === "off") {
    throw new BudgetError(
      'Flow\'s "Confirm before generating" setting is OFF, so Flow will charge without showing an approval card.',
      'Open the settings gear and set "Confirm before generating" to Always. Until then this server refuses all paid generation, because the cost gate cannot work.',
    );
  }

  return session.credits;
}

/**
 * Submit text into Flow's composer.
 *
 * The composer is a contenteditable div, not an input: setting `value` or using
 * a generic fill lands the text in a hidden search overlay instead. Real keyboard
 * events into a focused div are the only reliable route, and the Send button
 * frequently does not fire, so Enter is the submit path. We verify the message
 * actually left the box rather than assuming.
 */
async function submitPrompt(prompt: string): Promise<void> {
  const page = await getFlowPage();

  const focused = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>('div[contenteditable="true"]')].filter(
      (d) => d.offsetParent,
    );
    const box = boxes[boxes.length - 1];
    if (!box) return false;
    box.focus();
    box.click();
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return true;
  });

  if (!focused) {
    throw new FlowError(
      "Could not find Flow's prompt composer on the page.",
      "Confirm a Flow project is open (labs.google/fx/tools/flow/project/<id>) and run flow_check_session.",
    );
  }

  await page.keyboard.type(prompt, { delay: 8 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1_500);

  const cleared = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>('div[contenteditable="true"]')].filter(
      (d) => d.offsetParent,
    );
    const box = boxes[boxes.length - 1];
    return !box || (box.innerText ?? "").trim().length === 0;
  });

  if (!cleared) {
    throw new FlowError(
      "The prompt was typed but never sent — Flow's composer still holds the text.",
      "Nothing was charged. This usually means the chat panel lost focus; retry the call.",
    );
  }
}

/**
 * Wait for Flow's agent to propose a generation and quote its cost.
 *
 * We only accept a quote that appears AFTER our own submission, so a stale cost
 * card from a previous turn can never be mistaken for approval of this one.
 */
async function awaitQuote(timeoutMs: number): Promise<CostQuote> {
  const deadline = Date.now() + timeoutMs;
  const page = await getFlowPage();

  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    await assertNoStopSignal(page);

    const text = await pageText();
    const matches = [...text.matchAll(/(\d[\d,]*)\s*credits?/gi)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      const credits = Number.parseInt(last[1].replace(/,/g, ""), 10);
      if (Number.isFinite(credits)) {
        return { credits, rawText: last[0] };
      }
    }

    if (/failed|error|something went wrong/i.test(text.slice(-2_000))) {
      throw new FlowError(
        "Flow reported an error instead of a cost proposal.",
        "Nothing was charged. Check the chat in the browser; if it is the known audio-generation failure on crowd scenes, re-request the clip as a silent video with no audio track.",
      );
    }
  }

  throw new FlowError(
    `No cost quote appeared within ${Math.round(timeoutMs / 1000)}s.`,
    "Nothing was charged. Inspect the Flow chat in the browser before retrying — do NOT resubmit blindly, since a duplicate submission is a second charge.",
  );
}

/**
 * Click Approve, and only Approve.
 *
 * The composer renders the button as an icon ligature plus a label, so its
 * stripped text is "checkApprove". The adjacent "Approve, do not ask again" row
 * contains an inner span whose text is exactly "Approve" — a naive leaf match
 * hits that one and permanently disables the cost gate. Matching the full
 * "checkApprove" string is what keeps them apart.
 */
async function clickApprove(): Promise<void> {
  if (await clickByText("checkApprove", { exact: true, maxDescendants: 4 })) return;
  if (await clickByText("Approve", { exact: true, maxDescendants: 1 })) return;
  throw new FlowError(
    "Found a cost quote but could not locate the Approve control.",
    "Nothing was charged. Flow's UI may have changed — run flow_discover_api and check references/ui-playbook.md.",
  );
}

async function clickReject(): Promise<void> {
  if (await clickByText("closeReject", { exact: true, maxDescendants: 4 })) return;
  await clickByText("Reject", { exact: true, maxDescendants: 2 });
}

/**
 * Poll for media that did not exist before submission. This is how we detect
 * completion without ever touching the composer again — the cardinal rule being
 * that an in-flight generation must never be resubmitted.
 */
async function awaitNewMedia(before: Set<string>, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  const page = await getFlowPage();

  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    await assertNoStopSignal(page);
    const { items } = await listMedia(500, 0);
    const fresh = items.map((i) => i.mediaId).filter((id) => !before.has(id));
    if (fresh.length > 0) return fresh;
  }

  throw new FlowError(
    `Generation was approved but produced no new media within ${Math.round(timeoutMs / 1000)}s.`,
    "It was CHARGED and may still be rendering. Check the project library in the browser and use flow_download once it appears. Do NOT resubmit — that is a second charge.",
  );
}

export async function generate(opts: GenerateOptions): Promise<GenerationResult> {
  const notes: string[] = [];
  const balanceBefore = await preflight(opts.free ?? false);
  await assertNoStopSignal();

  const { items: beforeItems } = await listMedia(500, 0);
  const before = new Set(beforeItems.map((i) => i.mediaId));

  // Attachments must land BEFORE submission — they are what selects the mode.
  // A stale chip from a previous turn would silently animate the wrong frame,
  // so the composer is cleared first regardless of what this call attaches.
  const wanted = [opts.startFrameMediaId, opts.endFrameMediaId, ...(opts.referenceMediaIds ?? [])].filter(
    (id): id is string => Boolean(id),
  );
  await clearAttachments().catch(() => 0);
  if (wanted.length > 0) {
    const { attached, missing } = await attachMedia(wanted);
    if (missing.length > 0) {
      throw new FlowError(
        `Could not attach ${missing.length} of ${wanted.length} frame(s): ${missing.join(", ")}`,
        "Nothing was charged. Confirm the ids with flow_list_media — a still batch returns two outputs sharing one name, so the id is the only reliable handle.",
      );
    }
    notes.push(`Mode: ${describeMode(opts)}; attached ${attached.length} frame(s).`);
  } else {
    notes.push(`Mode: ${describeMode(opts)}.`);
  }

  await submitPrompt(opts.prompt);

  // Free stills produce no proposal card, so there is no quote to gate on.
  if (opts.free) {
    const mediaIds = await awaitNewMedia(before, opts.timeoutMs ?? TIMEOUTS.stillMs);
    const files = await saveAll(mediaIds, opts.outFile, "jpg");
    await log({ kind: "still", opts, quoted: 0, charged: 0, balance: balanceBefore, verdict: "downloaded", files });
    return {
      verdict: "downloaded",
      quotedCost: 0,
      charged: 0,
      mediaIds,
      files,
      balanceAfter: balanceBefore,
      tier: "dom",
      notes: ["Stills are free; no approval gate applies."],
    };
  }

  const quote = await awaitQuote(TIMEOUTS.quoteMs);

  try {
    await assertAffordable(quote.credits, opts.expectedMaxCost, balanceBefore);
  } catch (err) {
    await clickReject();
    notes.push("Proposal was rejected; nothing was charged.");
    await log({
      kind: "video",
      opts,
      quoted: quote.credits,
      charged: 0,
      balance: balanceBefore,
      verdict: "rejected",
      files: [],
    });
    throw err;
  }

  if (opts.dryRun) {
    await clickReject();
    await log({
      kind: "video",
      opts,
      quoted: quote.credits,
      charged: 0,
      balance: balanceBefore,
      verdict: "rejected",
      files: [],
      note: "dry run",
    });
    return {
      verdict: "rejected",
      quotedCost: quote.credits,
      charged: 0,
      mediaIds: [],
      files: [],
      balanceAfter: balanceBefore,
      tier: "dom",
      notes: [`Dry run: Flow quoted ${quote.credits} credits. Proposal rejected, nothing charged.`],
    };
  }

  await clickApprove();
  await recordSpend(quote.credits);
  notes.push(`Approved at ${quote.credits} credits.`);

  if (opts.noWait) {
    await log({
      kind: "video",
      opts,
      quoted: quote.credits,
      charged: quote.credits,
      balance: balanceBefore,
      verdict: "in_flight",
      files: [],
    });
    return {
      verdict: "in_flight",
      quotedCost: quote.credits,
      charged: quote.credits,
      mediaIds: [],
      files: [],
      balanceAfter: null,
      tier: "dom",
      notes: [...notes, "Returned without waiting. Use flow_collect to download once rendering finishes."],
    };
  }

  const mediaIds = await awaitNewMedia(before, opts.timeoutMs ?? TIMEOUTS.renderMs);
  const files = await saveAll(mediaIds, opts.outFile, "mp4");
  const balanceAfter = await readCredits();

  await log({
    kind: "video",
    opts,
    quoted: quote.credits,
    charged: quote.credits,
    balance: balanceAfter,
    verdict: "downloaded",
    files,
  });

  return {
    verdict: "downloaded",
    quotedCost: quote.credits,
    charged: quote.credits,
    mediaIds,
    files,
    balanceAfter,
    tier: "dom",
    notes,
  };
}

async function saveAll(mediaIds: string[], outFile: string | undefined, ext: string): Promise<string[]> {
  const files: string[] = [];
  for (const [i, id] of mediaIds.entries()) {
    const name = outFile
      ? mediaIds.length > 1
        ? outFile.replace(/(\.[^.]+)?$/, `-${i + 1}$1`)
        : outFile
      : `flow-${Date.now()}-${i + 1}.${ext}`;
    const saved = await downloadMedia(id, name);
    files.push(saved.file);
  }
  return files;
}

async function log(args: {
  kind: LedgerEntry["kind"];
  opts: GenerateOptions;
  quoted: number;
  charged: number;
  balance: number | null;
  verdict: LedgerEntry["verdict"];
  files: string[];
  note?: string;
}): Promise<void> {
  await appendLedger({
    ts: new Date().toISOString(),
    kind: args.kind,
    prompt: args.opts.prompt.slice(0, 500),
    model: null,
    quotedCost: args.quoted,
    charged: args.charged,
    balanceAfter: args.balance,
    verdict: args.verdict,
    files: args.files,
    note: args.note ?? null,
  });
}

/** Download everything that appeared since a known set of ids — the `--no-wait` collector. */
export async function collect(knownIds: string[], outDir?: string): Promise<{ mediaIds: string[]; files: string[] }> {
  const before = new Set(knownIds);
  const mediaIds = await awaitNewMedia(before, TIMEOUTS.renderMs);
  const files: string[] = [];
  for (const id of mediaIds) {
    const saved = await downloadMedia(id, `${outDir ? outDir + "/" : ""}flow-${id.slice(-12)}.mp4`);
    files.push(saved.file);
  }
  return { mediaIds, files };
}
