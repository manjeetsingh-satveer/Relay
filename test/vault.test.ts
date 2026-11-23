import { describe, expect, it } from "vitest";
import { looksSecret } from "../src/server/app.ts";

describe("vault secret check", () => {
  it("refuses card numbers and passwords", () => {
    expect(looksSecret("card 4242 4242 4242 4242")).toBe("a card number");
    expect(looksSecret("password: hunter2")).toBe("a password or other secret");
  });
  it("allows addresses and phone numbers", () => {
    expect(looksSecret("Jane Doe\n12 Main St, Springfield 12345\n+1 555 123 4567")).toBeNull();
  });
});
