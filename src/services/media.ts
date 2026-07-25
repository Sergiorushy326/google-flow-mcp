import { promises as fs } from "node:fs";
import * as path from "node:path";
import { config } from "../config.js";
import { FILE_SIGNATURES, KNOWN_PROCEDURES, MIN_MEDIA_BYTES } from "../constants.js";
import { FlowError, type MediaItem } from "../types.js";
import { getFlowPage, reloadSession } from "./browser.js";
import { callTrpc } from "./transport.js";

/**
 * Flow's Download button frequently writes nothing to disk in an automated
 * profile, and Scenebuilder exports never touch the filesystem at all. The
 * reliable path is always: media id -> signed CDN url -> fetch bytes ourselves.
 */

/** Enumerate the project library from the grid DOM. No endpoint is confirmed for this yet. */
export async function listMedia(limit = 50, offset = 0): Promise<{ items: MediaItem[]; total: number }> {
  const page = await getFlowPage();
  const all = await page.evaluate(() => {
    const seen = new Map<string, { mediaId: string; kind: string; name: string | null; thumbnailUrl: string | null }>();
    for (const img of document.querySelectorAll<HTMLImageElement>("img")) {
      const m = /getMediaUrlRedirect\?name=([^&"']+)/.exec(img.src);
      if (!m) continue;
      const id = decodeURIComponent(m[1]);
      if (seen.has(id)) continue;
      const card = img.closest("[data-media-id],[role=listitem],li,article") as HTMLElement | null;
      seen.set(id, {
        mediaId: id,
        kind: /video/i.test(id) ? "video" : "image",
        name: card?.getAttribute("aria-label") ?? img.alt ?? null,
        thumbnailUrl: img.src,
      });
    }
    return [...seen.values()];
  });

  const items = all.slice(offset, offset + limit).map((i) => ({ ...i, kind: i.kind as MediaItem["kind"] }));
  return { items, total: all.length };
}

/** Resolve a media id to its signed, time-limited CDN url. */
export async function resolveMediaUrl(mediaId: string): Promise<string> {
  const res = await callTrpc({
    procedure: KNOWN_PROCEDURES.mediaUrlRedirect,
    method: "GET",
    rawQuery: { name: mediaId },
  });

  // The endpoint 302s; fetch follows it, so the final url is what we want.
  if (res.finalUrl && !res.finalUrl.includes("getMediaUrlRedirect")) return res.finalUrl;

  const fromBody = typeof res.data === "string" ? res.data : (res.data as { url?: string })?.url;
  if (fromBody && /^https?:\/\//.test(fromBody)) return fromBody;

  throw new FlowError(
    `Could not resolve a CDN url for media ${mediaId}.`,
    `Run flow_check_session — an idle tab's API session expires and this endpoint then returns "No session found".`,
  );
}

/**
 * Download and verify. The verification is not paranoia: an expired session
 * returns a 200-ish JSON error body, and writing that straight to disk produces
 * a 27-byte "video" that only fails much later, in the edit.
 */
export async function downloadMedia(
  mediaId: string,
  outFile: string,
): Promise<{ file: string; bytes: number; kind: string }> {
  const target = path.isAbsolute(outFile) ? outFile : path.join(config.outputDir, outFile);
  await fs.mkdir(path.dirname(target), { recursive: true });

  let buffer = await fetchSigned(mediaId);

  // A stale session yields a JSON/text body where media bytes belong. One reload fixes it.
  if (!identify(buffer)) {
    await reloadSession();
    buffer = await fetchSigned(mediaId);
  }

  const kind = identify(buffer);
  if (!kind) {
    const preview = buffer.subarray(0, 200).toString("utf8").replace(/\s+/g, " ");
    throw new FlowError(
      `Downloaded ${buffer.length} bytes for ${mediaId} that are not image or video data. Body starts: ${preview}`,
      `This is the expired-session signature ("No session found"). Nothing was written. Run flow_check_session, then retry.`,
    );
  }
  if (buffer.length < MIN_MEDIA_BYTES) {
    throw new FlowError(
      `Downloaded file for ${mediaId} is only ${buffer.length} bytes — too small to be a real ${kind}.`,
      `Nothing was written. Confirm the generation actually finished before downloading.`,
    );
  }

  await fs.writeFile(target, buffer);
  return { file: target, bytes: buffer.length, kind };
}

async function fetchSigned(mediaId: string): Promise<Buffer> {
  const url = await resolveMediaUrl(mediaId);
  const res = await fetch(url, { redirect: "follow" });
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Magic-byte identification. This is the check that stops an expired-session JSON
 * error body from being written to disk as a .jpg.
 * @internal exported for unit tests
 */
export function identify(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  return FILE_SIGNATURES.find((s) => s.test(buffer))?.ext ?? null;
}

/**
 * Deletion hygiene keeps a project navigable, but it is genuinely destructive and
 * has over-reached before — a deleted source clip cannot be re-added to a scene
 * reliably. Callers must pass explicit ids; there is deliberately no "delete all".
 */
export async function deleteMedia(mediaIds: string[]): Promise<{ deleted: string[]; failed: string[] }> {
  const page = await getFlowPage();
  const deleted: string[] = [];
  const failed: string[] = [];

  for (const id of mediaIds) {
    const ok = await page.evaluate((mediaId) => {
      const img = [...document.querySelectorAll<HTMLImageElement>("img")].find(
        (i) => i.src.includes(encodeURIComponent(mediaId)) || i.src.includes(mediaId),
      );
      const card = img?.closest("[data-media-id],[role=listitem],li,article") as HTMLElement | null;
      if (!card) return false;
      const menu = [...card.querySelectorAll<HTMLElement>("button,[role=button]")].find((b) =>
        /more|option|menu|⋮/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
      );
      if (!menu) return false;
      menu.click();
      return true;
    }, id);

    if (!ok) {
      failed.push(id);
      continue;
    }
    await page.waitForTimeout(600);
    const confirmed = await page.evaluate(() => {
      const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem],button,div[role]")].find(
        (e) => e.offsetParent && /^delete|remove$/i.test((e.textContent ?? "").trim()),
      );
      if (!item) return false;
      item.click();
      return true;
    });
    (confirmed ? deleted : failed).push(id);
    await page.waitForTimeout(600);
  }

  return { deleted, failed };
}
