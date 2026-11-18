import type { Capabilities, IntegrationId } from "../shared/types.ts";

export interface AdapterMeta {
  id: IntegrationId;
  displayName: string;
  support: "supported" | "unsupported";
  unsupportedReason?: string;
  summary: string;
  docsUrl: string;
  credential: "api-key" | "none" | "local-cli";
  modelEditable: boolean;
  modelHelp: string;
  capabilities: Capabilities;
  secretEnv?: string;
}

export const ADAPTERS: AdapterMeta[] = [
  {
    id: "openai",
    displayName: "OpenAI API",
    support: "supported",
    summary: "ChatGPT subscription chat is not automated. This adapter calls the OpenAI Responses API with an API key, which is billed separately from ChatGPT Plus.",
    docsUrl: "https://developers.openai.com/api/reference/resources/responses/methods/create",
    credential: "api-key",
    modelEditable: true,
    modelHelp: "Default gpt-4.1-mini is a documented Responses model. It is deprecated. Change this to a current model id from the OpenAI model docs.",
    secretEnv: "OPENAI_API_KEY",
    capabilities: { chat: true, files: true, review: true, codingAgent: false, sessionContinue: true, cancel: true, phone: false },
  },
  {
    id: "anthropic",
    displayName: "Anthropic API",
    support: "supported",
    summary: "Claude.ai subscription chat is not automated. This adapter calls the Messages API. A Claude subscription does not include API access.",
    docsUrl: "https://platform.claude.com/docs/en/api/messages",
    credential: "api-key",
    modelEditable: true,
    modelHelp: "Default claude-sonnet-5-5 is listed on the Messages API model parameter. Change it if your account uses a different id.",
    secretEnv: "ANTHROPIC_API_KEY",
    capabilities: { chat: true, files: true, review: true, codingAgent: false, sessionContinue: false, cancel: true, phone: false },
  },
  {
    id: "gemini",
    displayName: "Gemini API",
    support: "supported",
    summary: "The Gemini app is not automated. This adapter calls generateContent on the Gemini API with an AI Studio key.",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    credential: "api-key",
    modelEditable: true,
    modelHelp: "Default gemini-3.5-flash-lite is the model Google's deprecation notes recommend for new projects. Change it to match your account.",
    secretEnv: "GEMINI_API_KEY",
    capabilities: { chat: true, files: true, review: true, codingAgent: false, sessionContinue: false, cancel: true, phone: false },
  },
  {
    id: "perplexity",
    displayName: "Perplexity Agent API",
    support: "supported",
    summary: "Calls POST /v1/agent. Comet, the Perplexity browser, has no documented task API and is a separate unsupported row.",
    docsUrl: "https://docs.perplexity.ai/docs/agent-api/quickstart",
    credential: "api-key",
    modelEditable: true,
    modelHelp: "Leave the model blank to send effort=low and let Perplexity choose. Set a model id only if it is listed in the current Agent API docs.",
    secretEnv: "PERPLEXITY_API_KEY",
    capabilities: { chat: true, files: false, review: true, codingAgent: false, sessionContinue: true, cancel: true, phone: false },
  },
  {
    id: "xai",
    displayName: "xAI API",
    support: "supported",
    summary: "This is the xAI developer API for Grok models. It is not Grok Bot. It cannot place Grok Bot phone calls or read Bot chats.",
    docsUrl: "https://docs.x.ai/docs/overview",
    credential: "api-key",
    modelEditable: true,
    modelHelp: "Relay does not guess an xAI model id. Paste the current id from the xAI console or docs before a live check.",
    secretEnv: "XAI_API_KEY",
    capabilities: { chat: true, files: true, review: true, codingAgent: false, sessionContinue: false, cancel: true, phone: false },
  },
  {
    id: "cursor",
    displayName: "Cursor cloud agents",
    support: "supported",
    summary: "Launches a cloud agent with the public beta Cloud Agents API. A Cursor subscription does not by itself prove API access. Repo tasks need a repository URL on the project. Omitting it starts a no-repo agent, which the API allows.",
    docsUrl: "https://cursor.com/docs/cloud-agent/api/endpoints",
    credential: "api-key",
    modelEditable: true,
    modelHelp: "Leave blank to use your Cursor default model. Set an id only from GET /v1/models.",
    secretEnv: "CURSOR_API_KEY",
    capabilities: { chat: true, files: true, review: true, codingAgent: true, sessionContinue: true, cancel: true, phone: false },
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    support: "supported",
    summary: "Runs the local claude CLI in the project workspace when the binary is installed. Installing the app and proving a login are separate: use the live check. The CLI is allowed to edit files in that workspace only.",
    docsUrl: "https://code.claude.com/docs/en/headless",
    credential: "local-cli",
    modelEditable: true,
    modelHelp: "Default sonnet is a documented CLI alias. You can set a full model name instead.",
    capabilities: { chat: true, files: true, review: true, codingAgent: true, sessionContinue: true, cancel: true, phone: false },
  },
  {
    id: "grok-bot",
    displayName: "Grok Bot",
    support: "unsupported",
    unsupportedReason:
      "Grok Bot docs describe chat, routines, and US phone calls inside the Grok Bot desktop and phone apps. They do not describe an API for another app to send a Bot a message, read the reply, place a call, or read call status. A routine webhook can start a routine you already created, and HTTP 200 only means the run was accepted. Relay does not call that webhook, because it cannot show a real result. The xAI API row is a different product.",
    summary: "Separate product from grok.com and from the xAI API. Phone calls stay unavailable here.",
    docsUrl: "https://docs.x.ai/grok-bot/chat-and-collaboration",
    credential: "none",
    modelEditable: false,
    modelHelp: "No model setting. There is no documented chat API to point at a model.",
    capabilities: { chat: false, files: false, review: false, codingAgent: false, sessionContinue: false, cancel: false, phone: false },
  },
  {
    id: "drex",
    displayName: "Nace Drex",
    support: "supported",
    summary: "Drex is a decision model at POST /v1/systemone. It answers typed questions with probabilities. It is not a chat model and it does not provide a virtual machine. Relay can use it to choose an agent. The reply still comes from that agent.",
    docsUrl: "https://console.nace.ai/docs/drex",
    credential: "api-key",
    modelEditable: false,
    modelHelp: "Routing calls use drex-latest, the model id in the current Drex quickstart.",
    secretEnv: "NACE_API_KEY",
    capabilities: { chat: false, files: false, review: false, codingAgent: false, sessionContinue: false, cancel: true, phone: false },
  },
];

export function adapterMeta(id: IntegrationId): AdapterMeta {
  const found = ADAPTERS.find((item) => item.id === id);
  if (!found) throw new Error(`unknown adapter ${id}`);
  return found;
}
