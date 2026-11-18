import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { driveChat } from "../src/browser/drive.ts";
import { WEB_SITES } from "../src/browser/sites.ts";
import type { SiteDefinition } from "../src/browser/sites.ts";

const chrome = process.env.RELAY_CHROME || "/usr/local/bin/google-chrome";

const site: SiteDefinition = {
  ...WEB_SITES[0]!,
  homeUrl: "http://127.0.0.1/",
  selectors: {
    composer: ["[data-relay='composer']"],
    send: ["[data-relay='send']"],
    assistant: ["[data-relay='assistant']"],
    code: ["[data-filename]"],
    login: ["[data-relay='login']"],
    captcha: ["[data-relay='captcha']"],
    rateLimit: ["[data-relay='limit']"],
    streaming: ["[data-relay='streaming']"],
    stop: ["[data-relay='stop']"],
  },
};

describe("web app driver", () => {
  it("keeps every live selector list in src/browser/sites.ts", () => {
    for (const entry of WEB_SITES) {
      expect(entry.selectors.composer.length).toBeGreaterThan(0);
      expect(entry.termsUrl.startsWith("https://")).toBe(true);
      expect(entry.label.startsWith("via ")).toBe(true);
    }
  });

  it("copies a finished reply and a named file, then a follow-up from the same page", async () => {
    const { page, close } = await open("");
    const first = await driveChat(page, site, { prompt: "Build a page", timeoutMs: 4000, signal: AbortSignal.timeout(5000) });
    expect(first.text).toContain("Fixture reply to: Build a page");
    expect(first.files.some((file) => file.name === "notes.txt")).toBe(true);
    expect(first.files.some((file) => file.name === "page.txt")).toBe(true);
    const second = await driveChat(page, site, { prompt: "Change the title", timeoutMs: 4000, signal: AbortSignal.timeout(5000) });
    expect(second.text).toContain("Change the title");
    expect(second.text).not.toContain("Build a page");
    await close();
  });

  it("reports login, a human check, a usage cap, a password field, and a missing composer", async () => {
    for (const [gate, code] of [["login", "login"], ["captcha", "captcha"], ["limit", "rate-limit"], ["password", "refused"]] as const) {
      const { page, close } = await open(`?gate=${gate}`);
      await expect(driveChat(page, site, { prompt: "Hi", timeoutMs: 1000, signal: AbortSignal.timeout(2000) })).rejects.toMatchObject({ code });
      await close();
    }
    const broken = { ...site, selectors: { ...site.selectors, composer: ["[data-relay='missing']"], login: ["[data-relay='missing-login']"] } };
    const { page, close } = await open("");
    await expect(driveChat(page, broken, { prompt: "Hi", timeoutMs: 1000, signal: AbortSignal.timeout(2000) })).rejects.toMatchObject({ code: "selector" });
    await close();
  });

  it("times out without inventing a reply", async () => {
    const { page, close } = await open("?delay=5000");
    await expect(driveChat(page, site, { prompt: "Hi", timeoutMs: 400, signal: AbortSignal.timeout(2000) })).rejects.toMatchObject({ code: "timeout" });
    await close();
  });
});

async function open(query: string) {
  const html = await readFile(path.join(process.cwd(), "test/fixtures/chat.html"));
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/${query}`);
  return {
    page,
    close: async () => {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
