import type { Capabilities, IntegrationId } from "../shared/types.ts";

export interface AdapterMeta {
  id: IntegrationId;
  displayName: string;
  support: "supported" | "unsupported";
  unsupportedReason?: string;
  summary: string;
  docsUrl: string;
  credential: "api-key" | "none" | "vm-cli" | "browser";
  modelEditable: boolean;
  modelHelp: string;
  capabilities: Capabilities;
  secretEnv?: string;
}

export const ADAPTERS: AdapterMeta[] = [
  {
    id: "claude-web",
    displayName: "Claude",
    support: "supported",
    summary: "Primary path. Playwright drives claude.ai in the VM browser after you sign in through the Computer tab. Relay does not store or type your password. Anthropic's consumer terms may restrict this. Selectors are in src/browser/sites.ts.",
    docsUrl: "https://claude.ai/",
    credential: "browser",
    modelEditable: false,
    modelHelp: "The website chooses the model. Relay does not send an API model id.",
    capabilities: { chat: true, files: true, review: true, codingAgent: false, sessionContinue: true, cancel: true, phone: false },
  },
  {
    id: "chatgpt-web",
    displayName: "ChatGPT",
    support: "supported",
    summary: "Primary path. Playwright drives chatgpt.com in the VM browser. A ChatGPT subscription is the login in that browser, not an API key. OpenAI's terms may restrict automating the site. Selectors are in src/browser/sites.ts.",
    docsUrl: "https://chatgpt.com/",
    credential: "browser",
    modelEditable: false,
    modelHelp: "The website chooses the model.",
    capabilities: { chat: true, files: true, review: true, codingAgent: false, sessionContinue: true, cancel: true, phone: false },
  },
  {
    id: "gemini-web",
    displayName: "Gemini",
    support: "supported",
    summary: "Primary path. Playwright drives gemini.google.com in the VM browser. This is not the Gemini API. Google's terms may restrict automating the site. Selectors are in src/browser/sites.ts.",
    docsUrl: "https://gemini.google.com/app",
    credential: "browser",
    modelEditable: false,
    modelHelp: "The website chooses the model.",
    capabilities: { chat: true, files: true, review: true, codingAgent: false, sessionContinue: true, cancel: true, phone: false },
  },
  {
    id: "perplexity-web",
    displayName: "Perplexity",
    support: "supported",
    summary: "Primary path. Playwright drives perplexity.ai in the VM browser. Comet, the Perplexity browser, is not this integration. Perplexity's terms may restrict automating the site. Selectors are in src/browser/sites.ts.",
    docsUrl: "https://www.perplexity.ai/",
    credential: "browser",
    modelEditable: false,
    modelHelp: "The website chooses the model.",
    capabilities: { chat: true, files: false, review: true, codingAgent: false, sessionContinue: true, cancel: true, phone: false },
  },
  {
    id: "grok-web",
    displayName: "Grok website",
    support: "supported",
    summary: "Primary path for grok.com only. This is not Grok Bot and it cannot place Grok Bot phone calls. xAI's terms may restrict automating the site. Selectors are in src/browser/sites.ts and were not verified against a logged-in session.",
    docsUrl: "https://grok.com/",
    credential: "browser",
    modelEditable: false,
    modelHelp: "The website chooses the model.",
    capabilities: { chat: true, files: true, review: true, codingAgent: false, sessionContinue: true, cancel: true, phone: false },
  },
  {
    id: "openai",
    displayName: "OpenAI API",
    support: "supported",
    summary: "Optional. Off until API keys are enabled in Settings. Calls the OpenAI Responses API. A ChatGPT login does not include this key.",
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
    summary: "Optional API path, off until API keys are enabled. A Claude login in the browser is the primary path and does not include this key.",
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
    summary: "Optional API path, off until API keys are enabled. The Gemini website is the primary path.",
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
    summary: "Optional API path, off until API keys are enabled. The Perplexity website is the primary path. Comet has no documented task API.",
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
    summary: "Optional API path, off until API keys are enabled. This is not Grok Bot and not the grok.com page.",
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
    summary: "Optional API path, off until API keys are enabled. The Cursor CLI inside the VM is separate and uses the login on that machine.",
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
    summary: "Runs the claude CLI inside the Linux VM, using the login you create on that machine. Relay does not type the password. The host copy of claude is not used.",
    docsUrl: "https://code.claude.com/docs/en/headless",
    credential: "vm-cli",
    modelEditable: true,
    modelHelp: "Default sonnet is a documented CLI alias. You can set a full model name instead.",
    capabilities: { chat: true, files: true, review: true, codingAgent: true, sessionContinue: true, cancel: true, phone: false },
  },
  {
    id: "cursor-cli",
    displayName: "Cursor CLI",
    support: "supported",
    summary: "Runs cursor-agent inside the Linux VM when that binary is installed there. Relay does not type a password. If the binary is missing, the task reports that and stops.",
    docsUrl: "https://cursor.com/docs",
    credential: "vm-cli",
    modelEditable: false,
    modelHelp: "The CLI uses the account logged in inside the VM.",
    capabilities: { chat: true, files: false, review: true, codingAgent: true, sessionContinue: false, cancel: true, phone: false },
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
