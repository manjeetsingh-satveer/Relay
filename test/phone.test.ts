import { describe, expect, it } from "vitest";
import { resolveCall } from "../src/core/phone.ts";
import type { Contact } from "../src/shared/types.ts";

const contacts: Contact[] = [
  { id: "1", name: "Arpanjeet", phone: "+1-202-555-0101", notes: "", createdAt: "" },
  { id: "2", name: "Arpan Singh", phone: "+1-202-555-0102", notes: "", createdAt: "" },
];

describe("call resolution", () => {
  it("matches one exact contact and does not treat ordinary chat as a call", () => {
    expect(resolveCall(contacts, "Build a portfolio website.").kind).toBe("not-a-call");
    const match = resolveCall(contacts, "Call Arpanjeet");
    expect(match.kind).toBe("match");
    expect(match.contact?.id).toBe("1");
  });

  it("does not guess when several contacts fit", () => {
    expect(resolveCall(contacts, "Please call Arpan").kind).toBe("ambiguous");
    expect(resolveCall(contacts, "Call Priya").kind).toBe("no-match");
  });
});
