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

const notLoggedIn = (site: SiteDefinition) =>
  new RelayError(
    "login",
    `${site.label}: not signed in. Sign in yourself in the Computer tab, including any MFA or human check. Relay does not type passwords.`,
  );

/** Any visible "stop generating" button, for sites whose own selector is out of date. */
const GENERIC_STOP = "button[aria-label*='Stop' i], button[data-testid*='stop' i]";

export async function driveChat(page: Page, site: SiteDefinition, input: DriveInput): Promise<DriveOutput> {
  // Pages are heavy single-page apps: give them time to render the composer or a sign-in screen.
  let composer: Locator | null = null;
  const loadDeadline = Date.now() + 30_000;
  while (Date.now() < loadDeadline && !input.signal.aborted) {
    if (site.loginUrl?.test(page.url())) throw notLoggedIn(site);
    await blockIfNeeded(page, site);
    if (await anyVisible(page, site.selectors.login)) throw notLoggedIn(site);
    composer = await firstVisible(page, site.selectors.composer);
    if (composer) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!composer) {
    throw new RelayError(
      "selector",
      `${site.label}: the composer was not found. Tried ${site.selectors.composer.join(", ")}. Edit src/browser/sites.ts. Nothing was copied.`,
    );
  }
  const type = await composer.getAttribute("type");
  if (type === "password") {
    throw new RelayError("refused", "Refusing to type into a password field. Nothing was sent.");
  }
  const assistantSelector = site.selectors.assistant.join(", ");
  const before = await page.locator(assistantSelector).count();
  const rowKeyAttr = site.rowKeyAttr;
  const lastKey = async () =>
    rowKeyAttr
      ? await page.locator(assistantSelector).last().evaluate((el, attr) => el.closest(`[${attr}]`)?.getAttribute(attr) ?? null, rowKeyAttr, { timeout: 1000 }).catch(() => null)
      : null;
  const keyBefore = await lastKey();
  const bodyBefore = await pageText(page);
  const tag = await composer.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "textarea" || tag === "input") {
    await composer.fill(input.prompt);
  } else {
    // Rich editors (ProseMirror, Quill, Tiptap) ignore fill(); type like a person instead.
    await composer.click();
    await page.keyboard.insertText(input.prompt);
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const send = await firstVisible(page, site.selectors.send);
  if (send && (await send.isEnabled().catch(() => false))) await send.click();
  else await composer.press("Enter");

  // Finished = a new reply whose text has stopped changing and no stop button is showing.
  // If the site's reply selector no longer matches, fall back to the text that appeared on the page.
  const sentAt = Date.now();
  let lastText = "";
  let stable = 0;
  let unchangedFor = 0;
  let fallbackText = "";
  const ready = await waitUntil(async () => {
    await blockIfNeeded(page, site);
    const streaming = (await anyVisible(page, site.selectors.streaming)) || (await anyVisible(page, [GENERIC_STOP]));
    const count = await page.locator(assistantSelector).count();
    let current = "";
    const key = site.rowKeyAttr && count > 0 ? await lastKey() : null;
    if (count > before || (key !== null && key !== keyBefore)) {
      current = (await page.locator(assistantSelector).last().innerText().catch(() => "")).trim();
      fallbackText = "";
    } else if (Date.now() - sentAt > 15_000) {
      current = newLines(bodyBefore, await pageText(page), input.prompt);
      fallbackText = current;
    }
    // A "… is typing" placeholder is never the answer.
    if (/is typing|^Typing…?$/im.test(current)) current = "";
    // Desktop apps can leave a "typing" marker up after the reply is done: accept a reply that
    // hasn't changed for 60 seconds even if the marker is still showing.
    if (current && current === lastText) unchangedFor += 1;
    else unchangedFor = 0;
    if (current && (!streaming || (site.desktopApp && unchangedFor >= 60)) && current === lastText) stable += 1;
    else stable = 0;
    lastText = current;
    return stable >= 2;
  }, input.timeoutMs, input.signal, 1000);

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
  const last = page.locator(assistantSelector).last();
  const raw = fallbackText || (await last.innerText()).trim();
  const text = site.stripPrefix ? raw.replace(site.stripPrefix, "").trim() : raw;
  if (!text) throw new RelayError("empty", `${site.label}: the new message was empty. Nothing was invented.`);
  const files = fallbackText ? extractFencedFiles(text).map((file) => ({ name: file.name, bytes: Buffer.from(file.text, "utf8"), mediaType: mediaTypeFor(file.name), source: `Copied from the page (${site.label}). Page content is untrusted.` })) : await filesFrom(last, site, text);
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

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, signal: AbortSignal, intervalMs = 100): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (signal.aborted) return false;
    if (await check()) return !signal.aborted;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => (document.querySelector("main") ?? document.body).innerText).catch(() => "");
}

/** Lines that appeared after sending, minus the prompt itself. Used only when the reply selector is stale. */
function newLines(before: string, after: string, prompt: string): string {
  const seen = new Set(before.split("\n").map((line) => line.trim()));
  const promptLines = new Set(prompt.split("\n").map((line) => line.trim()));
  return after
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !seen.has(line) && !promptLines.has(line))
    .join("\n")
    .trim();
}
