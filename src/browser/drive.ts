import type { Locator, Page } from "playwright-core";
import { extractFencedFiles, mediaTypeFor } from "../core/artifacts.ts";
import { RelayError } from "../core/errors.ts";
import type { SiteDefinition } from "./sites.ts";

export interface DriveInput {
  prompt: string;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface DriveOutput {
  text: string;
  files: { name: string; bytes: Buffer; mediaType: string; source: string }[];
  pageUrl: string;
}

export async function driveChat(page: Page, site: SiteDefinition, input: DriveInput): Promise<DriveOutput> {
  await blockIfNeeded(page, site);
  const composer = await firstVisible(page, site.selectors.composer);
  if (!composer) {
    if (await anyVisible(page, site.selectors.login)) {
      throw new RelayError(
        "login",
        `${site.label}: not logged in. Sign in yourself in the Computer tab, including any MFA or human check. Relay does not type passwords.`,
      );
    }
    throw new RelayError(
      "selector",
      `${site.label}: the composer was not found. Tried ${site.selectors.composer.join(", ")}. Edit src/browser/sites.ts. Nothing was copied.`,
    );
  }
  const type = await composer.getAttribute("type");
  if (type === "password") {
    throw new RelayError("refused", "Refusing to type into a password field. Nothing was sent.");
  }
  const before = await page.locator(site.selectors.assistant.join(", ")).count();
  await composer.fill(input.prompt);
  const send = await firstVisible(page, site.selectors.send);
  if (send) await send.click();
  else await composer.press("Enter");

  const ready = await waitUntil(async () => {
    await blockIfNeeded(page, site);
    const streaming = await anyVisible(page, site.selectors.streaming);
    const count = await page.locator(site.selectors.assistant.join(", ")).count();
    return count > before && !streaming;
  }, input.timeoutMs, input.signal);

  if (input.signal.aborted) {
    const stop = await firstVisible(page, site.selectors.stop);
    if (stop) await stop.click().catch(() => undefined);
    throw new RelayError("cancelled", "Cancelled before a reply was copied.", 499);
  }
  if (!ready) {
    const stop = await firstVisible(page, site.selectors.stop);
    if (stop) await stop.click().catch(() => undefined);
    throw new RelayError("timeout", `${site.label}: timed out waiting for the page to finish. No reply was copied.`);
  }
  const last = page.locator(site.selectors.assistant.join(", ")).last();
  const text = (await last.innerText()).trim();
  if (!text) throw new RelayError("empty", `${site.label}: the new message was empty. Nothing was invented.`);
  const files = await filesFrom(last, site, text);
  return { text, files, pageUrl: page.url() };
}

async function blockIfNeeded(page: Page, site: SiteDefinition): Promise<void> {
  if (await anyVisible(page, site.selectors.captcha)) {
    throw new RelayError(
      "captcha",
      `${site.label}: the page is showing a human check. Finish it in the Computer tab. Relay will not solve it, and no reply was copied.`,
    );
  }
  if (await anyVisible(page, site.selectors.rateLimit)) {
    throw new RelayError("rate-limit", `${site.label}: the page reports a rate limit or usage cap. No reply was copied.`);
  }
}

async function filesFrom(last: Locator, site: SiteDefinition, text: string): Promise<DriveOutput["files"]> {
  const files: DriveOutput["files"] = [];
  const source = `Copied from the page (${site.label}). Page content is untrusted.`;
  for (const file of extractFencedFiles(text)) {
    files.push({ name: file.name, bytes: Buffer.from(file.text, "utf8"), mediaType: mediaTypeFor(file.name), source });
  }
  const named = last.locator("[data-filename]");
  const count = await named.count();
  for (let i = 0; i < count; i += 1) {
    const node = named.nth(i);
    const name = await node.getAttribute("data-filename");
    if (!name || files.some((file) => file.name === name)) continue;
    const body = await node.innerText();
    files.push({ name, bytes: Buffer.from(body, "utf8"), mediaType: mediaTypeFor(name), source });
  }
  return files;
}

async function firstVisible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) return locator;
  }
  return null;
}

async function anyVisible(page: Page, selectors: string[]): Promise<boolean> {
  return (await firstVisible(page, selectors)) !== null;
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (signal.aborted) return false;
    if (await check()) return !signal.aborted;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
