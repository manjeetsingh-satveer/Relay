import type { Contact, CallResolution } from "../shared/types.ts";

const CALL = /^(?:please\s+)?call\s+([A-Za-z][A-Za-z .'-]{0,80}?)(?:\s+please)?[.!?]?$/i;

export function parseCall(text: string): string | null {
  const match = text.trim().match(CALL);
  if (!match) return null;
  return match[1]?.trim() ?? null;
}

export function resolveCall(contacts: Contact[], text: string): CallResolution {
  const query = parseCall(text);
  if (!query) return { kind: "not-a-call" };
  const exact = contacts.filter((contact) => contact.name.toLowerCase() === query.toLowerCase());
  if (exact.length === 1 && exact[0]) {
    return { kind: "match", query, contact: exact[0], reason: "The name matches one saved contact exactly." };
  }
  if (exact.length > 1) {
    return { kind: "ambiguous", query, matches: exact, reason: "More than one saved contact has this name." };
  }
  const prefix = contacts.filter((contact) => {
    const name = contact.name.toLowerCase();
    const q = query.toLowerCase();
    return name.startsWith(q + " ") || name.startsWith(q);
  });
  if (prefix.length === 1 && prefix[0]) {
    return {
      kind: "match",
      query,
      contact: prefix[0],
      reason: `No exact name match. "${prefix[0].name}" is the only saved contact starting with "${query}".`,
    };
  }
  if (prefix.length > 1) {
    return { kind: "ambiguous", query, matches: prefix, reason: "More than one saved contact matches that name." };
  }
  return { kind: "no-match", query, reason: "No saved contact matches. Nothing was called." };
}
