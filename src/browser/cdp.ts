import { chromium, type Browser, type Page } from "playwright-core";
import { RelayError } from "../core/errors.ts";
import type { ExecuteResult } from "../adapters/execute.ts";
import { driveChat } from "./drive.ts";
import { WEB_SITES, siteById, type SiteDefinition } from "./sites.ts";
import type { IntegrationId } from "../shared/types.ts";

export async function probeCdp(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(new URL("/json/version", url), { signal: AbortSignal.timeout(400) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function openLoginPage(cdpUrl: string, site: SiteDefinition): Promise<string> {
  const browser = await connect(site.cdpUrl ?? cdpUrl);
  try {
    const page = await openPage(browser, site);
    void page;
    if (site.desktopApp) return "Brought Grok Bot to the front of your cloud desktop. Sign in there yourself. Relay will not type your password.";
    return `Opened ${site.homeUrl} in the VM browser. Sign in there, including MFA or a human check. Relay will not type your password.`;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function runWebTask(input: {
  cdpUrl: string;
  siteId: IntegrationId;
  prompt: string;
  continuedUrl?: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<ExecuteResult> {
  const site = siteById(input.siteId);
  if (!site) throw new RelayError("unsupported", "That site has no web adapter.");
  const browser = await connect(site.cdpUrl ?? input.cdpUrl);
  try {
    const page = await openPage(browser, site, input.continuedUrl);
    const driven = await driveChat(page, site, { prompt: input.prompt, timeoutMs: input.timeoutMs, signal: input.signal });
    const continued = Boolean(input.continuedUrl) && driven.pageUrl.startsWith(new URL(site.homeUrl).origin);
    return {
      text: driven.text,
      files: driven.files,
      providerSessionId: driven.pageUrl,
      sessionMode: continued ? "continued" : "new",
      sessionDetail: continued
        ? `${site.label}. Continued the open browser thread at ${driven.pageUrl}.`
        : `${site.label}. Started a new browser thread.`,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Removes terminal colour codes and Playwright's call log so errors read cleanly in the chat. */
export function cleanError(message: string): string {
  return message
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\[[0-9;]*m/g, "")
    .split(/\r?\n?Call log:/)[0]!
    .replace(/\s+/g, " ")
    .trim();
}

async function connect(cdpUrl: string): Promise<Browser> {
  // The VM is small, so Chromium can be slow to answer while it is busy. Retry before giving up.
  let last = "connect failed";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await chromium.connectOverCDP(cdpUrl, { timeout: 45000 });
    } catch (error) {
      last = cleanError(error instanceof Error ? error.message : "connect failed");
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw new RelayError(
    "vm-browser",
    `The browser inside the VM did not answer at ${cdpUrl} after 3 tries. Make sure the VM is running and Chromium is open in the Computer tab. (${last})`,
  );
}

function sameSite(page: Page, site: SiteDefinition): boolean {
  try {
    return new URL(page.url()).hostname === new URL(site.homeUrl).hostname;
  } catch {
    return false;
  }
}

/** Closes extra tabs for this site so they do not pile up and slow the VM. Keeps `keep`. */
async function closeDuplicates(pages: Page[], site: SiteDefinition, keep: Page): Promise<void> {
  for (const page of pages) {
    if (page !== keep && sameSite(page, site)) await page.close().catch(() => undefined);
  }
}

async function openPage(browser: Browser, site: SiteDefinition, continuedUrl?: string): Promise<Page> {
  const context = browser.contexts()[0] ?? await browser.newContext();
  const pages = context.pages();
  if (site.desktopApp) {
    const main = pages.find((item) => !item.url().startsWith("devtools://")) ?? pages[0];
    if (!main) throw new RelayError("not_installed", `${site.label} has no open window. Open it from the desktop icon.`);
    await main.bringToFront().catch(() => undefined);
    return main;
  }
  const target = continuedUrl ?? site.homeUrl;
  // Reuse one tab per site instead of opening a new tab for every message.
  const page = pages.find((item) => item.url() === target) ?? pages.find((item) => sameSite(item, site)) ?? await context.newPage();
  await closeDuplicates(pages, site, page);
  // The VM is small: close other AI sites so only one heavy app is loaded at a time.
  for (const other of pages) {
    if (other !== page && WEB_SITES.some((item) => !item.desktopApp && item.id !== site.id && sameSite(other, item))) await other.close().catch(() => undefined);
  }
  if (page.url() !== target) await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.bringToFront().catch(() => undefined);
  return page;
}
