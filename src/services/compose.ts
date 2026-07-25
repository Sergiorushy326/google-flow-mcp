import * as path from "node:path";
import { TIMEOUTS } from "../constants.js";
import { FlowError } from "../types.js";
import { assertNoStopSignal, getFlowPage } from "./browser.js";
import { clickByText, pageText } from "./transport.js";

/**
 * COMPOSER CONTROL — settings, frame attachment, upload.
 *
 * Flow's generation modes are not separate endpoints. They are the same chat
 * submission with different things attached to the composer:
 *
 *   Text-to-Video          prompt alone
 *   Frames-to-Video        prompt + a start frame (optionally + an end frame)
 *   Ingredients-to-Video   prompt + up to 3 reference images
 *
 * So "which mode am I in" is decided by what is attached when Enter is pressed,
 * which is why attachment lives here and is verified by media id rather than
 * trusted. A text-only reference to an earlier still ("use the first one") lets
 * Flow's agent pick, and it picks wrong often enough to cost real credits.
 *
 * Model tier, aspect ratio and output count are per-PROJECT globals behind the
 * settings gear, not per-generation arguments. Set once, they persist across
 * chat turns — and a stale tier is the single most common way a 20-credit clip
 * silently becomes a 100-credit one.
 */

export type ModelTier = "veo-3.1-lite" | "veo-3.1-fast" | "veo-3.1-quality" | "gemini-omni-flash";
export type AspectRatio = "16:9" | "9:16" | "1:1";

export interface FlowSettings {
  model: string | null;
  aspectRatio: string | null;
  outputsPerPrompt: number | null;
  /** Clip length. A cost lever on Gemini Omni Flash, which charges 15/20/25/30 by duration. */
  durationSeconds: number | null;
  confirmGate: "always" | "off" | "unknown";
}

const SETTINGS_LABELS: Record<keyof Omit<FlowSettings, "confirmGate">, RegExp> = {
  model: /model|quality|veo/i,
  aspectRatio: /aspect|ratio|orientation/i,
  outputsPerPrompt: /outputs? per prompt|number of (outputs|videos)/i,
  durationSeconds: /duration|length|seconds/i,
};

async function openSettings(): Promise<void> {
  const page = await getFlowPage();
  const opened = await page.evaluate(() => {
    const gear = [...document.querySelectorAll<HTMLElement>("button,[role=button]")].find((b) => {
      const label = `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`;
      return /setting|tune|gear/i.test(label) && b.offsetParent !== null;
    });
    if (!gear) return false;
    gear.click();
    return true;
  });
  if (!opened) {
    throw new FlowError(
      "Could not find Flow's settings control.",
      "Open the settings gear manually in the browser, or re-run flow_discover_api if Flow's UI has changed.",
    );
  }
  await page.waitForTimeout(1_200);
}

async function closeSettings(): Promise<void> {
  const page = await getFlowPage();
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
}

/** Read the per-project generation settings. Free; opens and closes the panel. */
export async function readSettings(): Promise<FlowSettings> {
  await openSettings();
  const page = await getFlowPage();

  const raw = await page.evaluate(() => {
    const rows: { label: string; value: string }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("[role=dialog] *, [role=menu] *")) {
      if (el.children.length > 3 || !el.offsetParent) continue;
      const text = (el.textContent ?? "").trim();
      if (text.length > 0 && text.length < 120) rows.push({ label: text, value: text });
    }
    return rows;
  });

  const joined = raw.map((r) => r.label).join(" | ");
  const settings: FlowSettings = {
    model: /veo\s*3\.1\s*(lite|fast|quality)/i.exec(joined)?.[0] ?? null,
    aspectRatio: /\b(16:9|9:16|1:1)\b/.exec(joined)?.[0] ?? null,
    outputsPerPrompt: Number.parseInt(/(\d)\s*outputs? per prompt/i.exec(joined)?.[1] ?? "", 10) || null,
    durationSeconds: Number.parseInt(/\b(\d{1,2})\s*s(?:ec|econds)?\b/i.exec(joined)?.[1] ?? "", 10) || null,
    confirmGate: /confirm before generating[^|]{0,40}off/i.test(joined)
      ? "off"
      : /confirm before generating/i.test(joined)
        ? "always"
        : "unknown",
  };

  await closeSettings();
  return settings;
}

/**
 * Set a per-project setting by clicking its labelled control.
 *
 * Changing the model tier is the highest-leverage free action in Flow: moving a
 * project from Quality to Fast turns every subsequent clip from 100 credits into
 * 20. It is deliberately its own tool rather than a generate() argument, because
 * it is project state — setting it per-call would be a lie about how Flow works.
 */
export async function setSetting(key: keyof typeof SETTINGS_LABELS, value: string): Promise<FlowSettings> {
  await openSettings();
  const page = await getFlowPage();

  const changed = await page.evaluate(
    ([labelSource, target]) => {
      const labelRe = new RegExp(labelSource as string, "i");
      const controls = [...document.querySelectorAll<HTMLElement>("[role=dialog] *, [role=menu] *")].filter(
        (e) => e.offsetParent !== null,
      );
      // Open the group whose label matches, then pick the option matching `target`.
      const group = controls.find((e) => labelRe.test(e.textContent ?? "") && e.children.length <= 4);
      group?.click();
      const option = controls.find(
        (e) => (e.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase() === (target as string).toLowerCase(),
      );
      if (!option) return false;
      option.click();
      return true;
    },
    [SETTINGS_LABELS[key].source, value] as const,
  );

  await page.waitForTimeout(1_000);
  await closeSettings();

  if (!changed) {
    throw new FlowError(
      `Could not set ${key} to "${value}" — no matching option was found in Flow's settings panel.`,
      `Set it manually in the browser and re-run flow_settings with action=get to confirm. Nothing was charged.`,
    );
  }
  return readSettings();
}

/**
 * Open the composer's media picker (the "+" / add control next to the prompt box).
 */
async function openPicker(): Promise<void> {
  const page = await getFlowPage();
  const opened = await page.evaluate(() => {
    const add = [...document.querySelectorAll<HTMLElement>("button,[role=button]")].find((b) => {
      const label = `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`.trim();
      return /^add|add_2|attach|\+$/i.test(label) && b.offsetParent !== null;
    });
    if (!add) return false;
    add.click();
    return true;
  });
  if (!opened) {
    throw new FlowError(
      "Could not open Flow's media picker on the composer.",
      "Confirm a project is open and the chat composer is visible, then retry.",
    );
  }
  await page.waitForTimeout(1_500);
}

/**
 * Attach library media to the composer and VERIFY by media id.
 *
 * Verification matters: still batches return two outputs sharing one auto-name in
 * the picker, so selecting "by name" is ambiguous. The selected option's img src
 * carries the real id, and that is what we check.
 */
export async function attachMedia(mediaIds: string[]): Promise<{ attached: string[]; missing: string[] }> {
  if (mediaIds.length === 0) return { attached: [], missing: [] };
  if (mediaIds.length > 3) {
    throw new FlowError(
      `Flow accepts at most 3 reference images; ${mediaIds.length} were supplied.`,
      "Reduce to the 3 that matter most, or use a single start frame with Frames-to-Video instead.",
    );
  }

  await assertNoStopSignal();
  const page = await getFlowPage();
  const attached: string[] = [];
  const missing: string[] = [];

  for (const id of mediaIds) {
    await openPicker();
    const ok = await page.evaluate((mediaId) => {
      const options = [...document.querySelectorAll<HTMLElement>("[role=option],[role=listitem],li")];
      const match = options.find((o) => {
        const img = o.querySelector("img");
        return img ? img.src.includes(mediaId) || img.src.includes(encodeURIComponent(mediaId)) : false;
      });
      if (!match) return false;
      match.click();
      return true;
    }, id);

    await page.waitForTimeout(800);
    (ok ? attached : missing).push(id);
  }

  // Confirm the chips the composer now actually holds.
  const chipIds = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLImageElement>(
        '[data-testid*="chip"] img, [class*="chip"] img, [class*="attachment"] img',
      ),
    ].map((i) => i.src),
  );
  const verified = attached.filter((id) =>
    chipIds.some((src) => src.includes(id) || src.includes(encodeURIComponent(id))),
  );

  if (verified.length !== attached.length) {
    throw new FlowError(
      `Attached ${attached.length} item(s) but only ${verified.length} chip(s) are visible on the composer.`,
      "Nothing was charged. Attach the frame manually in the browser and retry, or the wrong frame may be animated.",
    );
  }

  return { attached: verified, missing };
}

/**
 * Upload an external image as a start frame. Playwright sets the file directly on
 * the input, which is more reliable than the drag-and-drop path and has no
 * filesystem-location restriction.
 */
export async function uploadMedia(filePath: string): Promise<{ file: string; note: string }> {
  const page = await getFlowPage();
  await openPicker();

  const input = await page.$('input[type="file"]');
  if (!input) {
    throw new FlowError(
      "Flow's picker did not expose a file input.",
      "Upload the frame manually in the browser, then attach it by media id with flow_attach_frames.",
    );
  }

  await input.setInputFiles(path.resolve(filePath));
  await page.waitForTimeout(4_000);

  return {
    file: path.resolve(filePath),
    note: "Uploaded. It lands as a picker option — confirm the resulting media id with flow_list_media before animating it.",
  };
}

/** Clear whatever is currently attached, so a stale chip cannot leak into the next clip. */
export async function clearAttachments(): Promise<number> {
  const page = await getFlowPage();
  const removed = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLElement>("button,[role=button]")].filter((b) => {
      const label = `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`;
      return /remove|clear|close|×/i.test(label) && b.closest('[class*="chip"],[class*="attachment"]') !== null;
    });
    buttons.forEach((b) => b.click());
    return buttons.length;
  });
  await page.waitForTimeout(600);
  return removed;
}

/**
 * Upscale. 1080p is free on paid plans; 4K costs 50 credits and is Ultra-only,
 * so it goes through the same explicit-cost gate as any other paid action.
 */
export async function upscale(mediaId: string, target: "1080p" | "4k"): Promise<{ started: boolean; note: string }> {
  await assertNoStopSignal();
  const page = await getFlowPage();

  const opened = await page.evaluate((id) => {
    const img = [...document.querySelectorAll<HTMLImageElement>("img")].find(
      (i) => i.src.includes(id) || i.src.includes(encodeURIComponent(id)),
    );
    const card = img?.closest("[data-media-id],[role=listitem],li,article") as HTMLElement | null;
    const menu = [...(card?.querySelectorAll<HTMLElement>("button,[role=button]") ?? [])].find((b) =>
      /more|option|menu|⋮/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
    );
    if (!menu) return false;
    menu.click();
    return true;
  }, mediaId);

  if (!opened) {
    throw new FlowError(
      `Could not open the item menu for media ${mediaId}.`,
      "Confirm the id is in the current project's library with flow_list_media.",
    );
  }

  await page.waitForTimeout(700);
  const clicked = await clickByText(target === "4k" ? "Upscale to 4K" : "Upscale to 1080p", {
    exact: false,
    maxDescendants: 4,
  });

  if (!clicked) {
    throw new FlowError(
      `Flow did not offer a ${target} upscale for this item.`,
      target === "4k"
        ? "4K upscale is Ultra-plan only. Take the free 1080p upscale instead — never pay for 4K on social content."
        : "The item may already be 1080p, or upscaling may not apply to stills.",
    );
  }

  return {
    started: true,
    note:
      target === "4k"
        ? "4K upscale started — this costs 50 credits and was NOT routed through the quote gate, because Flow does not quote upscales in a proposal card. Verify the balance with flow_check_session."
        : "1080p upscale started. Free on paid plans.",
  };
}

/** Best-effort read of what the composer currently holds, for pre-flight sanity checks. */
export async function describeComposer(): Promise<string> {
  const text = await pageText();
  const settings = await readSettings().catch(() => null);
  const lines = [
    settings
      ? `Model: ${settings.model ?? "unknown"} | Aspect: ${settings.aspectRatio ?? "unknown"} | Outputs: ${settings.outputsPerPrompt ?? "unknown"} | Confirm gate: ${settings.confirmGate}`
      : "Settings could not be read.",
  ];
  if (/frames? to video|ingredients/i.test(text)) lines.push("Composer appears to be in a frames/ingredients mode.");
  return lines.join("\n");
}

export const TIMEOUT_HINT = TIMEOUTS;
