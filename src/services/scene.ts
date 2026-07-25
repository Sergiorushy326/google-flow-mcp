import { promises as fs } from "node:fs";
import * as path from "node:path";
import { config } from "../config.js";
import { KNOWN_PROCEDURES, MIN_MEDIA_BYTES, TIMEOUTS } from "../constants.js";
import { FlowError } from "../types.js";
import { assertNoStopSignal, getFlowPage } from "./browser.js";
import { clickByText } from "./transport.js";

/**
 * SCENEBUILDER EXPORT
 *
 * Stitching clips in Scenebuilder is free — there is no approval card, because
 * nothing is generated. Only "Extend" costs credits, and this module never
 * touches it.
 *
 * The hard part is retrieval. Flow's export runs a `runVideoFxConcatenation`
 * job and returns the finished MP4 as base64 inside the poll response; Chromium
 * never writes a file. The previous shell-based driver had to monkey-patch
 * window.fetch to intercept it. Playwright can simply read the response body off
 * the wire, which is both simpler and immune to the app changing its fetch usage.
 */

export async function exportScene(
  outFile: string,
  timeoutMs = TIMEOUTS.exportMs,
): Promise<{ file: string; bytes: number }> {
  const page = await getFlowPage();
  await assertNoStopSignal(page);

  if (!/\/scene\//.test(page.url())) {
    throw new FlowError(
      "The active tab is not a Scenebuilder scene.",
      "Open the scene in the browser (top bar + -> Create Scene, or an existing /scene/<id>) and retry.",
    );
  }

  // Arm the listener BEFORE clicking, or a fast job finishes unobserved.
  const responsePromise = page
    .waitForResponse(
      (res) =>
        new RegExp(`${KNOWN_PROCEDURES.concatenateStatus}|${KNOWN_PROCEDURES.concatenate}`, "i").test(res.url()) &&
        res.status() < 400,
      { timeout: timeoutMs },
    )
    .catch(() => null);

  const clicked =
    (await clickByText("Download", { exact: true, maxDescendants: 4 })) ||
    (await clickByText("downloadDownload", { exact: true, maxDescendants: 4 }));
  if (!clicked) {
    throw new FlowError(
      "Could not find the scene's Download control.",
      "Flow's Scenebuilder UI may have changed — check references/ui-playbook.md and re-run flow_discover_api.",
    );
  }

  const encoded = await pollForEncodedVideo(responsePromise, timeoutMs);
  const buffer = Buffer.from(encoded, "base64");

  if (buffer.length < MIN_MEDIA_BYTES || buffer.subarray(4, 8).toString() !== "ftyp") {
    throw new FlowError(
      `Scene export returned ${buffer.length} bytes that are not a valid MP4.`,
      "Nothing was written. The export job may still be running — wait and retry, or download the scene manually in the browser.",
    );
  }

  const target = path.isAbsolute(outFile) ? outFile : path.join(config.outputDir, outFile);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return { file: target, bytes: buffer.length };
}

/**
 * The concat job reports SUCCESSFUL on a later poll than the one that starts it,
 * so we keep reading matching responses until one carries the payload.
 */
async function pollForEncodedVideo(
  first: Promise<import("playwright-core").Response | null>,
  timeoutMs: number,
): Promise<string> {
  const page = await getFlowPage();
  const deadline = Date.now() + timeoutMs;

  let response = await first;
  while (Date.now() < deadline) {
    if (response) {
      const encoded = await extractEncoded(response);
      if (encoded) return encoded;
    }
    response = await page
      .waitForResponse(
        (res) => new RegExp(KNOWN_PROCEDURES.concatenateStatus, "i").test(res.url()) && res.status() < 400,
        { timeout: Math.max(5_000, deadline - Date.now()) },
      )
      .catch(() => null);
    if (!response) break;
  }

  throw new FlowError(
    `Scene export did not return finished video data within ${Math.round(timeoutMs / 1000)}s.`,
    "The stitch itself is free, so nothing was charged. Check the scene in the browser and retry.",
  );
}

async function extractEncoded(response: import("playwright-core").Response): Promise<string | null> {
  try {
    const body = await response.json();
    return findEncodedVideo(body);
  } catch {
    return null;
  }
}

/**
 * SCENE ASSEMBLY (free)
 *
 * Flow's chat agent CANNOT create scenes — this is a UI-only surface. The path is
 * top bar "+" -> Create Scene -> an editor at /scene/<id>. Stitching there is
 * free; only "Extend" charges, and it lives behind its own gated tool below.
 */
export async function createScene(): Promise<{ sceneId: string; url: string }> {
  const page = await getFlowPage();
  await assertNoStopSignal(page);

  const clicked =
    (await clickByText("Create Scene", { exact: false, maxDescendants: 4 })) ||
    (await clickByText("New Scene", { exact: false, maxDescendants: 4 }));

  if (!clicked) {
    throw new FlowError(
      "Could not find a Create Scene control.",
      'It lives behind the top-bar "+" menu. Open that menu in the browser first, or create the scene manually and work in it directly.',
    );
  }

  await page.waitForTimeout(4_000);
  const sceneId = /\/scene\/([A-Za-z0-9_-]+)/.exec(page.url())?.[1];
  if (!sceneId) {
    throw new FlowError(
      "Clicked Create Scene but the URL never became a /scene/<id>.",
      "Check the browser — Flow may be showing a chooser that needs a manual selection.",
    );
  }
  return { sceneId, url: page.url() };
}

/**
 * Add library clips to the open scene, in order. Free.
 *
 * Two quirks are load-bearing here. The FIRST clip goes in via an "Add Clip"
 * button; later clips go through the timeline "+" popover, whose items resist
 * ordinary clicks — keyboard navigation is what actually works. And Escape exits
 * the whole editor rather than closing the popover, so it is never used to dismiss.
 */
export async function addClipsToScene(mediaIds: string[]): Promise<{ added: string[]; failed: string[] }> {
  const page = await getFlowPage();
  await assertNoStopSignal(page);

  if (!/\/scene\//.test(page.url())) {
    throw new FlowError(
      "The active tab is not a Scenebuilder scene.",
      "Create one with flow_create_scene, or open an existing /scene/<id> in the browser.",
    );
  }

  const added: string[] = [];
  const failed: string[] = [];

  for (const [index, mediaId] of mediaIds.entries()) {
    const opened =
      index === 0 ? await clickByText("Add Clip", { exact: false, maxDescendants: 4 }) : await openTimelinePopover();

    if (!opened) {
      failed.push(mediaId);
      continue;
    }
    await page.waitForTimeout(1_500);

    const picked = await page.evaluate((id) => {
      const option = [...document.querySelectorAll<HTMLElement>("[role=option],[role=listitem],li")].find((o) => {
        const img = o.querySelector("img");
        return img ? img.src.includes(id) || img.src.includes(encodeURIComponent(id)) : false;
      });
      if (!option) return false;
      option.click();
      return true;
    }, mediaId);

    if (!picked) {
      failed.push(mediaId);
      continue;
    }

    await clickByText("Add to Scene", { exact: false, maxDescendants: 4 });
    await page.waitForTimeout(1_500);
    added.push(mediaId);
  }

  return { added, failed };
}

/** The timeline "+" popover ignores synthetic clicks; arrow-key navigation works. */
async function openTimelinePopover(): Promise<boolean> {
  const page = await getFlowPage();
  const opened = await page.evaluate(() => {
    const plus = [...document.querySelectorAll<HTMLElement>("button,[role=button]")]
      .filter((b) => b.offsetParent !== null)
      .find((b) =>
        /^\+$|add clip|add media/i.test(`${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`.trim()),
      );
    if (!plus) return false;
    plus.click();
    return true;
  });
  if (!opened) return false;

  await page.waitForTimeout(800);
  // "Add Clip" is the first popover item; "Extend" is the charged one below it.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  return true;
}

/**
 * The payload key nests differently across Flow releases, so search for it.
 * @internal exported for unit tests
 */
export function findEncodedVideo(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findEncodedVideo(v, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/^encodedVideo$|encoded_video/i.test(k) && typeof v === "string" && v.length > 1000) return v;
    const found = findEncodedVideo(v, depth + 1);
    if (found) return found;
  }
  return null;
}
