import { describe, expect, it } from "vitest";
import { extractFencedFiles } from "../src/core/artifacts.ts";

describe("fenced files", () => {
  it("keeps fences that name a file and skips language tags", () => {
    const text = ["```html", "<p>no</p>", "```", "```index.html", "<h1>Hi</h1>", "```", "```src/app.tsx", "export const a = 1;", "```"].join("\n");
    const files = extractFencedFiles(text);
    expect(files.map((file) => file.name)).toEqual(["index.html", "src/app.tsx"]);
    expect(files[0]?.text).toBe("<h1>Hi</h1>");
  });
});
