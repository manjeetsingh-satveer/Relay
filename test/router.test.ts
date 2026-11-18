import { describe, expect, it } from "vitest";
import { interpretDrex, routeLocal } from "../src/core/router.ts";
import type { IntegrationView } from "../src/shared/types.ts";

function view(partial: Partial<IntegrationView> & Pick<IntegrationView, "id">): IntegrationView {
  return {
    displayName: partial.id,
    support: "supported",
    summary: partial.id,
    docsUrl: "https://example.com",
    install: "not-applicable",
    auth: "stored",
    authDetail: "",
    capabilities: { chat: true, files: true, review: true, codingAgent: partial.id === "cursor" || partial.id === "claude-code", sessionContinue: false, cancel: true, phone: false },
    credential: "api-key",
    model: "",
    modelEditable: true,
    modelHelp: "",
    ...partial,
  };
}

describe("local router", () => {
  it("refuses to invent an agent when none are ready", () => {
    expect(() => routeLocal({ prompt: "Hello", mode: "single", available: [], allowSameAgentReview: false })).toThrow(/Nothing was sent/);
  });

  it("sends a coding task to Cursor when a repository is set", () => {
    const decision = routeLocal({
      prompt: "Build a portfolio website",
      mode: "single",
      repoUrl: "https://github.com/example/site",
      available: [view({ id: "openai" }), view({ id: "cursor" })],
      allowSameAgentReview: false,
    });
    expect(decision.steps[0]?.adapterId).toBe("cursor");
    expect(decision.explanation).toMatch(/coding/);
  });

  it("requires two agents for review", () => {
    expect(() =>
      routeLocal({
        prompt: "Review this",
        mode: "collaborative",
        available: [view({ id: "openai" })],
        allowSameAgentReview: false,
      }),
    ).toThrow(/two different/);
  });

  it("plans draft, review, and one revision", () => {
    const decision = routeLocal({
      prompt: "Build a portfolio website",
      mode: "collaborative",
      available: [view({ id: "anthropic" }), view({ id: "openai" })],
      allowSameAgentReview: false,
    });
    expect(decision.steps.map((step) => step.role)).toEqual(["draft", "review", "revision"]);
    expect(new Set(decision.steps.map((step) => step.adapterId)).size).toBe(2);
  });
});

describe("Drex answers", () => {
  it("accepts a confident choice and rejects a weak one", () => {
    const json = { answers: { assignee: { choice: "openai", confidence: 0.91 }, wants_review: { noul: 0.2 } } };
    expect(interpretDrex({ json, allowed: ["openai"], minConfidence: 0.6 }).accepted).toBe(true);
    expect(interpretDrex({ json: { answers: { assignee: { choice: "openai", confidence: 0.4 } } }, allowed: ["openai"], minConfidence: 0.6 }).accepted).toBe(false);
    expect(interpretDrex({ json: { answers: { assignee: { choice: "grok-bot", confidence: 0.99 } } }, allowed: ["openai"], minConfidence: 0.6 }).accepted).toBe(false);
  });
});
