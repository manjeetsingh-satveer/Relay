import type { IntegrationId } from "../shared/types.ts";

/**
 * Bots: named AI agents, each with its own chat thread, job, memory and optional daily schedule.
 * Schedules run inside the user's Codespace; a GitHub Actions workflow in the user's own
 * account wakes the Codespace at those times (see src/cloud/alarm.ts).
 */
export interface BotSchedule {
  /** Local time, "HH:MM" (24-hour). */
  time: string;
  /** Days of the week, 0 = Sunday. */
  days: number[];
  /** What to ask the bot each time. */
  prompt: string;
  /** IANA time zone the time is in, e.g. "America/Los_Angeles". */
  timeZone: string;
}

export interface Bot {
  id: string;
  name: string;
  agentId: IntegrationId;
  job: string;
  memory: string;
  conversationId: string;
  createdAt: string;
  schedule: BotSchedule | null;
  /** The local date ("YYYY-MM-DD") of the last scheduled run, so each day runs once. */
  lastRunKey?: string;
}

export interface AlarmStatus {
  ok: boolean;
  detail: string;
  at: string;
  repoUrl?: string;
}

/** Agents offered during onboarding. Each becomes a bot named "Relay-<name>". */
export const BOT_TEMPLATES: { agentId: IntegrationId; name: string; job: string }[] = [
  { agentId: "claude-web", name: "Relay-Claude", job: "Careful writing, analysis and reviewing other bots' work." },
  { agentId: "chatgpt-web", name: "Relay-ChatGPT", job: "General help: drafts, ideas, explanations and planning." },
  { agentId: "gemini-web", name: "Relay-Gemini", job: "Research with Google knowledge, summaries and comparisons." },
  { agentId: "grok-web", name: "Relay-Grok", job: "Current events, X/Twitter context and quick takes." },
  { agentId: "perplexity-web", name: "Relay-Perplexity", job: "Web research with sources." },
  { agentId: "claude-code", name: "Relay-ClaudeCode", job: "Writing and changing code in its project folder." },
  { agentId: "cursor-cli", name: "Relay-Cursor", job: "Coding tasks with the Cursor agent." },
];

export const BOT_AGENTS = BOT_TEMPLATES.map((item) => item.agentId);

interface LocalParts {
  dateKey: string;
  weekday: number;
  minutes: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localParts(now: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS.indexOf(parts.weekday!),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function parseTime(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Bots whose time has come today and haven't run yet today. A late wake-up still runs them. */
export function dueBots(bots: Bot[], now: Date): { bot: Bot; dateKey: string }[] {
  const due: { bot: Bot; dateKey: string }[] = [];
  for (const bot of bots) {
    if (!bot.schedule) continue;
    const at = parseTime(bot.schedule.time);
    if (at === null) continue;
    const local = localParts(now, bot.schedule.timeZone);
    if (bot.schedule.days.includes(local.weekday) && local.minutes >= at && bot.lastRunKey !== local.dateKey) {
      due.push({ bot, dateKey: local.dateKey });
    }
  }
  return due;
}

/** When a schedule is saved after today's time has passed, don't run it immediately. */
export function initialRunKey(schedule: BotSchedule, now: Date): string | undefined {
  const at = parseTime(schedule.time);
  const local = localParts(now, schedule.timeZone);
  return at !== null && local.minutes >= at ? local.dateKey : undefined;
}

/** Minutes the zone is ahead of UTC at `now`. */
function offsetMinutes(now: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const truncated = Math.floor(now.getTime() / 60000) * 60000;
  return Math.round((asUtc - truncated) / 60000);
}

/** GitHub Actions cron lines (UTC) for every scheduled bot. Uses today's UTC offset. */
export function cronLines(bots: Bot[], now: Date): string[] {
  const lines = new Set<string>();
  for (const bot of bots) {
    if (!bot.schedule || bot.schedule.days.length === 0) continue;
    const at = parseTime(bot.schedule.time);
    if (at === null) continue;
    let utc = at - offsetMinutes(now, bot.schedule.timeZone);
    const shift = Math.floor(utc / 1440);
    utc -= shift * 1440;
    const days = [...new Set(bot.schedule.days.map((day) => (((day + shift) % 7) + 7) % 7))].sort();
    lines.add(`${utc % 60} ${Math.floor(utc / 60)} * * ${days.join(",")}`);
  }
  return [...lines].sort();
}

/** The text placed before every request to a bot. */
export function botPreamble(bot: Bot): string {
  const parts = [`You are ${bot.name}, one of the user's Relay bots.`];
  if (bot.job.trim()) parts.push(`Your job: ${bot.job.trim()}`);
  if (bot.memory.trim()) parts.push(`Things the user asked you to remember:\n${bot.memory.trim()}`);
  return parts.join("\n");
}
