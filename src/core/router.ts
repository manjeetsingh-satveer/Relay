import type { IntegrationId, IntegrationView } from "../shared/types.ts";
import { RelayError } from "./errors.ts";

export interface RouteChoice {
  adapterId: IntegrationId;
  role: "single" | "draft" | "review" | "revision";
}

export interface RouteDecision {
  explanation: string;
  steps: RouteChoice[];
  /** Other ready agents, best first. A failed draft or single step escalates to these in order. */
  fallbacks?: IntegrationId[];
  source: "you" | "local-rules" | "drex" | "drex-fallback";
}

const CODING = /\b(build|implement|code|website|portfolio|refactor|fix|bug|component|function|repository|repo|html|css)\b/i;
const RESEARCH = /\b(research|sources?|cite|citation|news|latest|compare|who is|what is|look up)\b/i;

const CHAT_ORDER: IntegrationId[] = ["claude-web", "chatgpt-web", "gemini-web", "perplexity-web", "grok-web", "anthropic", "openai", "gemini", "xai", "perplexity"];
const CODING_ORDER: IntegrationId[] = ["claude-code", "cursor-cli", "claude-web", "chatgpt-web", "cursor", "anthropic", "openai", "gemini"];
const RESEARCH_ORDER: IntegrationId[] = ["perplexity-web", "claude-web", "chatgpt-web", "gemini-web", "perplexity", "anthropic", "openai"];

export function routeLocal(input: {
  prompt: string;
  mode: "single" | "collaborative";
  requested?: IntegrationId;
  repoUrl?: string;
  available: IntegrationView[];
  allowSameAgentReview: boolean;
}): RouteDecision {
  const usable = input.available.filter(canExecute);
  if (input.requested) {
    const chosen = usable.find((item) => item.id === input.requested);
    if (!chosen) {
      throw new RelayError(
        "agent_unavailable",
        `${input.requested} is not available. It is unsupported, missing a credential, or not installed.`,
      );
    }
    const rest = usable.filter((item) => item.id !== chosen.id);
    const decision = finish(input, [chosen, ...rest], `You chose ${chosen.displayName}. Routing was not used.`);
    return { ...decision, source: "you" };
  }
  if (usable.length === 0) {
    throw new RelayError(
      "no_agent",
      "No web app is reachable. Start the Linux VM from the Computer tab and sign in there. API keys are optional and off unless you enable them. Nothing was sent.",
    );
  }
  const order = CODING.test(input.prompt)
    ? CODING_ORDER
    : RESEARCH.test(input.prompt)
      ? RESEARCH_ORDER
      : CHAT_ORDER;
  const ranked = rank(usable, order, input.repoUrl);
  const why = CODING.test(input.prompt)
    ? "The message looks like a coding task, so local rules preferred a coding agent that is actually ready."
    : RESEARCH.test(input.prompt)
      ? "The message looks like a research question, so local rules preferred a research agent that is actually ready."
      : "Local rules used the default chat order among agents that are ready.";
  return finish(input, ranked, `${why} Local rules are deterministic checks in Relay. They are not a model.`);
}

function finish(input: { mode: "single" | "collaborative"; allowSameAgentReview: boolean }, ranked: IntegrationView[], explanation: string): RouteDecision {
  const primary = ranked[0];
  if (!primary) {
    throw new RelayError("no_agent", "No web app is reachable. Start the Linux VM from the Computer tab and sign in there. Nothing was sent.");
  }
  const fallbacks = ranked.slice(1).map((item) => item.id);
  if (input.mode === "single") {
    return {
      source: "local-rules",
      explanation: `${explanation} ${primary.displayName} will handle it.`,
      steps: [{ adapterId: primary.id, role: "single" }],
      fallbacks,
    };
  }
  const reviewer = ranked.find((item) => item.id !== primary.id && item.capabilities.review);
  if (!reviewer) {
    if (!input.allowSameAgentReview) {
      throw new RelayError(
        "reviewer_missing",
        "Collaborative mode needs two different ready agents. Connect another one, or turn on same-agent review in Settings. Nothing was sent.",
      );
    }
    return {
      source: "local-rules",
      explanation: `${explanation} Same-agent review is on, so ${primary.displayName} will draft and review. This is not an independent review.`,
      steps: [
        { adapterId: primary.id, role: "draft" },
        { adapterId: primary.id, role: "review" },
        { adapterId: primary.id, role: "revision" },
      ],
    };
  }
  return {
    source: "local-rules",
    explanation: `${explanation} ${primary.displayName} will draft. ${reviewer.displayName} will review. ${primary.displayName} will revise once. The loop stops there.`,
    steps: [
      { adapterId: primary.id, role: "draft" },
      { adapterId: reviewer.id, role: "review" },
      { adapterId: primary.id, role: "revision" },
    ],
  };
}

export function canExecute(view: IntegrationView): boolean {
  if (view.support !== "supported") return false;
  if (!view.availableForRouting) return false;
  if (view.id === "drex" || view.id === "grok-bot") return false;
  if (view.install === "not-installed") return false;
  if (view.credential === "api-key" && view.auth !== "stored") return false;
  return view.capabilities.chat || view.capabilities.codingAgent;
}

function rank(available: IntegrationView[], order: IntegrationId[], repoUrl?: string): IntegrationView[] {
  const scored = [...available].sort((a, b) => score(a, order, repoUrl) - score(b, order, repoUrl));
  return scored;
}

function score(view: IntegrationView, order: IntegrationId[], repoUrl?: string): number {
  let index = order.indexOf(view.id);
  if (index < 0) index = order.length + 1;
  if (view.id === "cursor" && !repoUrl) index += 0.5;
  return index;
}

export interface DrexAnswer {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  noul?: number;
}

export function interpretDrex(input: {
  json: unknown;
  allowed: IntegrationId[];
  minConfidence: number;
}): { assignee?: IntegrationId; confidence?: number; wantsReview?: number; accepted: boolean; explanation: string } {
  const answers = (input.json as { answers?: Record<string, DrexAnswer> } | null)?.answers;
  const assignee = answers?.assignee;
  const review = answers?.wants_review;
  const choice = assignee?.choice;
  const confidence = typeof assignee?.confidence === "number" ? assignee.confidence : undefined;
  const wantsReview = typeof review?.noul === "number" ? review.noul : undefined;
  if (!choice || !input.allowed.includes(choice as IntegrationId)) {
    return {
      accepted: false,
      wantsReview,
      explanation: "Drex did not return a choice among the agents that are ready.",
    };
  }
  if (confidence === undefined || confidence < input.minConfidence) {
    return {
      accepted: false,
      assignee: choice as IntegrationId,
      confidence,
      wantsReview,
      explanation: `Drex leaned toward ${choice} at confidence ${confidence ?? "unknown"}, below your minimum of ${input.minConfidence}.`,
    };
  }
  return {
    accepted: true,
    assignee: choice as IntegrationId,
    confidence,
    wantsReview,
    explanation: `Drex chose ${choice} with confidence ${confidence.toFixed(2)}.`,
  };
}

export function drexRequest(state: string, agents: { id: IntegrationId; description: string }[]): Record<string, unknown> {
  const criteria: Record<string, string> = {};
  for (const agent of agents) criteria[agent.id] = agent.description;
  return {
    model: "drex-latest",
    state,
    questions: {
      assignee: {
        type: "choice",
        instructions: "Which ready agent should do this task?",
        criteria,
      },
      wants_review: {
        type: "noul",
        instructions: "Should a second, different agent review the result before it is returned?",
      },
    },
  };
}
