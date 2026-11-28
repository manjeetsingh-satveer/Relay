import type { IntegrationId } from "../shared/types.ts";

/** Selectors live here so a contributor can fix a site without hunting through the driver. */
export interface SiteSelectors {
  composer: string[];
  send: string[];
  assistant: string[];
  code: string[];
  login: string[];
  captcha: string[];
  rateLimit: string[];
  streaming: string[];
  stop: string[];
}

export interface SiteDefinition {
  id: IntegrationId;
  label: string;
  homeUrl: string;
  termsUrl: string;
  termsNote: string;
  /** A URL that means "you are signed out" (checked before looking for the composer). */
  loginUrl?: RegExp;
  /** Chrome DevTools endpoint. Defaults to the desktop's Chromium on 127.0.0.1:9222. */
  cdpUrl?: string;
  /** A desktop (Electron) app: reuse its own window, never navigate or open tabs. */
  desktopApp?: boolean;
  /** Clicked before typing (e.g. the main chat in a desktop app). */
  startClick?: string;
  /** Attribute that identifies a reply row, for apps that only keep visible rows on screen. */
  rowKeyAttr?: string;
  /** Removed from the start of a copied reply (e.g. the app printing the bot name). */
  stripPrefix?: RegExp;
  selectors: SiteSelectors;
}

export const DEFAULT_CDP = "http://127.0.0.1:9222";
export const GROK_BOT_CDP = "http://127.0.0.1:9224";

const fixture = "[data-relay='composer']";

/**
 * The first selector in each list is the fixture attribute used by tests.
 * Later selectors are unconfirmed guesses for the live site. They were not
 * checked against a logged-in session. When a site changes, edit this file.
 */
export const WEB_SITES: SiteDefinition[] = [
  {
    id: "grok-bot",
    label: "via the Grok Bot desktop app",
    homeUrl: "file:///opt/Grok%20Bot/resources/app.asar/dist/renderer/index.html",
    cdpUrl: GROK_BOT_CDP,
    desktopApp: true,
    startClick: "[aria-label='Grok Bot, Main Bot']",
    rowKeyAttr: "data-row-key",
    stripPrefix: /^Grok Bot\s*\n+/,
    termsUrl: "https://x.ai/legal/terms-of-service",
    termsNote: "xAI's terms apply to Grok Bot. Relay types into the Grok Bot window you signed in to, on your own desktop.",
    // Unconfirmed guesses until checked against a signed-in Grok Bot window.
    selectors: {
      // Checked against a signed-in Grok Bot 1.2.3 window on 24 Nov 2026. Enter sends.
      composer: [fixture, "[role='textbox'][aria-label='Prompt']"],
      send: ["[data-relay='send']"],
      assistant: ["[data-relay='assistant']", "[data-row-key] [data-role='assistant']"],
      code: ["pre code"],
      login: ["[data-relay='login']", "button:text-is('Sign in')"],
      captcha: ["[data-relay='captcha']", "iframe[src*='captcha']"],
      rateLimit: ["[data-relay='limit']", "text=/usage limit|rate limit|message limit/i"],
      // While Grok Bot works it shows a "Grok Bot is typing / Typing…" row, sometimes for minutes.
      streaming: ["[data-relay='streaming']", "text=/is typing|^Typing…$/"],
      stop: ["[data-relay='stop']", "button[aria-label*='Stop' i]"],
    },
  },
  {
    id: "claude-web",
    label: "via Claude web app",
    homeUrl: "https://claude.ai/new",
    loginUrl: /claude\.ai\/login/,
    termsUrl: "https://www.anthropic.com/legal/consumer-terms",
    termsNote: "Anthropic's consumer terms restrict how claude.ai may be accessed. Driving the website can violate those terms. Relay types only into the composer you already opened.",
    selectors: {
      composer: [fixture, "div.ProseMirror", "fieldset [contenteditable='true']"],
      send: ["[data-relay='send']", "button[aria-label='Send message']", "button[aria-label='Send Message']"],
      // [data-perf-reply-text] holds only the answer (not the "thinking" status line). Checked on claude.ai, 24 Nov 2026.
      assistant: ["[data-relay='assistant']", "[data-is-streaming] [data-perf-reply-text]"],
      code: ["[data-filename]", "pre code"],
      login: ["[data-relay='login']", "a[href*='login']", "button:text-is('Continue with Google')"],
      captcha: ["[data-relay='captcha']", "iframe[src*='captcha']", "iframe[src*='hcaptcha']", "iframe[src*='recaptcha']"],
      rateLimit: ["[data-relay='limit']", "text=/usage limit|rate limit|message limit/i"],
      streaming: ["[data-relay='streaming']", "[data-is-streaming='true']"],
      stop: ["[data-relay='stop']", "button[aria-label='Stop response']"],
    },
  },
  {
    id: "chatgpt-web",
    label: "via ChatGPT web app",
    homeUrl: "https://chatgpt.com/",
    // ChatGPT can open in "Work" mode; Relay uses the normal "Chat" mode.
    startClick: ":is(button, [role='radio'], [role='tab']):text-is('Chat')",
    termsUrl: "https://openai.com/policies/terms-of-use",
    termsNote: "OpenAI's terms cover chatgpt.com separately from the API. Automating the website can violate those terms.",
    selectors: {
      composer: [fixture, "#prompt-textarea", "[contenteditable='true'][aria-label='Work with ChatGPT']", "main form [contenteditable='true']", "textarea[aria-label='Chat with ChatGPT']", "textarea[placeholder='Ask ChatGPT']", "textarea[data-id='root']"],
      send: ["[data-relay='send']", "button[data-testid='send-button']", "button[aria-label='Send prompt']", "button[aria-label='Send']"],
      assistant: ["[data-relay='assistant']", "[data-message-author-role='assistant']"],
      code: ["[data-filename]", "pre code"],
      login: ["[data-relay='login']", "button:text-is('Log in')", "a[href*='/auth/login']"],
      captcha: ["[data-relay='captcha']", "iframe[src*='captcha']", "iframe[src*='hcaptcha']"],
      rateLimit: ["[data-relay='limit']", "text=/rate limit|too many requests|usage cap/i"],
      streaming: ["[data-relay='streaming']", "button[data-testid='stop-button']"],
      stop: ["[data-relay='stop']", "button[data-testid='stop-button']"],
    },
  },
  {
    id: "gemini-web",
    label: "via Gemini web app",
    homeUrl: "https://gemini.google.com/app",
    termsUrl: "https://policies.google.com/terms",
    termsNote: "Google's terms cover gemini.google.com. Automating that site can violate those terms. This is not the Gemini API.",
    selectors: {
      composer: [fixture, "rich-textarea [contenteditable='true']", "div.ql-editor"],
      send: ["[data-relay='send']", "button[aria-label='Send message']"],
      assistant: ["[data-relay='assistant']", "message-content", "model-response"],
      code: ["[data-filename]", "pre code"],
      login: ["[data-relay='login']", "a[href*='ServiceLogin']", "a[aria-label='Sign in']"],
      captcha: ["[data-relay='captcha']", "iframe[src*='recaptcha']"],
      rateLimit: ["[data-relay='limit']", "text=/quota|rate limit|try again later/i"],
      streaming: ["[data-relay='streaming']", "button[aria-label='Stop response']"],
      stop: ["[data-relay='stop']", "button[aria-label='Stop response']"],
    },
  },
  {
    id: "perplexity-web",
    label: "via Perplexity web app",
    homeUrl: "https://www.perplexity.ai/",
    termsUrl: "https://www.perplexity.ai/hub/legal/terms-of-service",
    termsNote: "Perplexity's terms cover perplexity.ai. Automating the site can violate those terms. Comet, the Perplexity browser, is a different product and is not driven here.",
    selectors: {
      composer: [fixture, "[aria-label='Ask anything…']", "textarea[placeholder*='Ask']", "div[contenteditable='true']"],
      send: ["[data-relay='send']", "button[aria-label='Submit']"],
      assistant: ["[data-relay='assistant']", "[data-testid='answer']", "div.prose"],
      code: ["[data-filename]", "pre code"],
      login: ["[data-relay='login']", "button:text-is('Sign in')"],
      captcha: ["[data-relay='captcha']", "iframe[src*='captcha']"],
      rateLimit: ["[data-relay='limit']", "text=/rate limit|quota exceeded/i"],
      streaming: ["[data-relay='streaming']"],
      stop: ["[data-relay='stop']"],
    },
  },
  {
    id: "grok-web",
    label: "via Grok web app",
    homeUrl: "https://grok.com/",
    termsUrl: "https://x.ai/legal/terms-of-service",
    termsNote: "grok.com is the Grok website. It is not Grok Bot. Grok Bot's phone calls are still unavailable. xAI's terms cover use of the website.",
    selectors: {
      composer: [fixture, "div.tiptap.ProseMirror", "[aria-label='Message Grok']", "textarea", "div[contenteditable='true']"],
      send: ["[data-relay='send']", "button[aria-label='Submit']", "button[aria-label='Send']"],
      assistant: ["[data-relay='assistant']", "[data-testid='assistant-message']", "div.message-bubble div.response-content-markdown"],
      code: ["[data-filename]", "pre code"],
      login: ["[data-relay='login']", "a[href*='login']"],
      captcha: ["[data-relay='captcha']", "iframe[src*='captcha']"],
      rateLimit: ["[data-relay='limit']", "text=/rate limit/i"],
      streaming: ["[data-relay='streaming']"],
      stop: ["[data-relay='stop']"],
    },
  },
];

export function siteById(id: IntegrationId): SiteDefinition | undefined {
  return WEB_SITES.find((site) => site.id === id);
}
