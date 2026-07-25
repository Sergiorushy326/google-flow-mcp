import { FLOW_HOME } from "../constants.js";
import { FlowError } from "../types.js";
import { assertNoStopSignal, getFlowPage } from "./browser.js";
import { extractProjectId } from "./session.js";

/**
 * PROJECT MANAGEMENT
 *
 * Everything else in this server operates on "the currently open project" —
 * settings are per-project globals, the media library is per-project, and
 * Scenebuilder scenes belong to a project. So being able to see and switch
 * projects is a prerequisite for batching work, not a convenience.
 *
 * Switching projects resets the settings context. Always re-read flow_settings
 * after a switch rather than assuming the tier carried over.
 */

export interface FlowProject {
  projectId: string;
  name: string | null;
  url: string;
}

export async function listProjects(): Promise<FlowProject[]> {
  const page = await getFlowPage();
  await assertNoStopSignal(page);

  return page.evaluate(() => {
    const seen = new Map<string, { projectId: string; name: string | null; url: string }>();
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="/project/"]')) {
      const m = /\/project\/([A-Za-z0-9_-]+)/.exec(a.href);
      if (!m || seen.has(m[1])) continue;
      seen.set(m[1], {
        projectId: m[1],
        name: (a.getAttribute("aria-label") ?? a.textContent ?? "").trim() || null,
        url: a.href,
      });
    }
    return [...seen.values()];
  });
}

export async function openProject(projectId: string): Promise<FlowProject> {
  const page = await getFlowPage();
  const url = `${FLOW_HOME}/project/${projectId}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3_000);
  await assertNoStopSignal(page);

  const landed = extractProjectId(page.url());
  if (landed !== projectId) {
    throw new FlowError(
      `Asked to open project ${projectId} but landed on ${landed ?? page.url()}.`,
      "Confirm the project id with flow_list_projects. A wrong project means the wrong library and the wrong settings.",
    );
  }

  return { projectId, name: null, url: page.url() };
}

/**
 * Create a new project. Free. Worth doing per batch: the playbook's chat-context
 * anchoring problem — where new people-generations lock onto faces from earlier
 * images in the same chat — is scoped to a project's chat, so a fresh project is
 * the cleanest way to break it.
 */
export async function createProject(name?: string): Promise<FlowProject> {
  const page = await getFlowPage();
  await page.goto(FLOW_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2_000);
  await assertNoStopSignal(page);

  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll<HTMLElement>("button,[role=button],a")].find((b) => {
      const label = `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`.replace(/\s+/g, " ").trim();
      return /^(new project|create project|new)$/i.test(label) && b.offsetParent !== null;
    });
    if (!btn) return false;
    btn.click();
    return true;
  });

  if (!clicked) {
    throw new FlowError(
      "Could not find a New Project control on Flow's home screen.",
      "Create the project manually in the browser, then use flow_open_project with its id.",
    );
  }

  await page.waitForTimeout(4_000);
  const projectId = extractProjectId(page.url());
  if (!projectId) {
    throw new FlowError(
      "Clicked New Project but the URL never became a /project/<id>.",
      "Check the browser — Flow may have shown a template chooser that needs a manual selection.",
    );
  }

  if (name) await renameProject(name).catch(() => {});
  return { projectId, name: name ?? null, url: page.url() };
}

async function renameProject(name: string): Promise<void> {
  const page = await getFlowPage();
  const field = await page.$('input[aria-label*="name" i], [contenteditable="true"][aria-label*="name" i]');
  if (!field) return;
  await field.click();
  await page.keyboard.press("Control+A").catch(() => {});
  await page.keyboard.type(name, { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
}
