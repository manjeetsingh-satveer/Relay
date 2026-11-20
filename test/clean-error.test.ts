import { describe, expect, it } from "vitest";
import { cleanError } from "../src/browser/cdp.ts";

describe("cleanError", () => {
  it("drops colour codes and Playwright's call log", () => {
    const raw =
      "browserType.connectOverCDP: Timeout 30000ms exceeded.\nCall log:\n\u001b[2m  - <ws preparing> retrieving websocket url from http://127.0.0.1:9222\u001b[22m\n";
    expect(cleanError(raw)).toBe("browserType.connectOverCDP: Timeout 30000ms exceeded.");
  });

  it("drops colour codes whose escape byte was already stripped", () => {
    expect(cleanError("[2mhello[22m  world")).toBe("hello world");
  });
});
