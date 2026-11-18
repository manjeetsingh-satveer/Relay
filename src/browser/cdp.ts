import { chromium, type Browser, type Page } from "playwright-core";
import { RelayError } from "../core/errors.ts";
import type { ExecuteResult } from "../adapters/execute.ts";
import { driveChat } from "./drive.ts";
import { siteById, type SiteDefinition } from "./sites.ts";
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
  const browser = await connect(cdpUrl);
  try {
    const page = await browser.newPage();
    await page.goto(site.homeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
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
  const browser = await connect(input.cdpUrl);
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

async function connect(cdpUrl: string): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(cdpUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "connect failed";
    throw new RelayError(
      "vm-browser",
      `The browser inside the VM is not reachable at ${cdpUrl}. Start the VM from the Computer tab and wait until Chromium is open. ${message}`,
    );
  }
}

async function openPage(browser: Browser, site: SiteDefinition, continuedUrl?: string): Promise<Page> {
  const context = browser.contexts()[0] ?? await browser.newContext();
  if (continuedUrl) {
    const existing = context.pages().find((page) => page.url() === continuedUrl);
    if (existing) return existing;
    const page = await context.newPage();
    await page.goto(continuedUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    return page;
  }
  const page = await context.newPage();
  await page.goto(site.homeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  return page;
}
