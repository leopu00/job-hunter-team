import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SwipeReviewedRow } from "@/lib/swipe-decks";
import { salaryPreference } from "@/lib/salary-source";
import type { PositionWithScore } from "@/lib/types";
import { localTeamDataKey, reportLocalTeamRead } from "./local-team-data";

/**
 * The two decks of the Swipe of a local profile, read from the jobs.db of the team on this computer by the
 * native command (src-tauri/src/local_swipe.rs), and the token that deck came with. A verdict names a
 * position by its number in THAT database, so it is sent back with the token of the deck it was judged on:
 * the native side refuses it (`deck_outdated`) if the profile or the team changed since. The page never reads
 * the token; it is kept here for each position of the deck, so a read that comes in between never lends its
 * token to a card of an older one. A new read replaces them all; `forgetLocalDeck` drops them.
 */
let tokens = new Map<string, string>();

/** The token of the deck the position was read in, or none: a position that is in no deck read here is not judged. */
export function localDeckToken(id: string): string | null {
  return tokens.get(id) ?? null;
}

export function forgetLocalDeck(): void {
  tokens = new Map();
}

/**
 * The token a position's own detail read came with (the page of one position, not the Swipe's deck). Kept with the
 * profile it was read for: a token of another profile is never lent. The native side accepts either token.
 */
let positionTokens = new Map<string, { identity: string | null; token: string }>();

export function rememberLocalPositionToken(id: string, token: string): void {
  if (positionTokens.size >= 64) positionTokens = new Map([...positionTokens].slice(-32));
  positionTokens.set(id, { identity: localTeamDataKey(), token });
}

export function forgetLocalPositionTokens(): void {
  positionTokens = new Map();
}

/** The token of the last detail read of the position, if it was read for the profile now shown; else the deck's. */
export function localPositionToken(id: string): string | null {
  const own = positionTokens.get(id);
  if (own && own.identity === localTeamDataKey()) return own.token;
  return tokens.get(id) ?? null;
}

/** Whether the token that would be sent is the deck's (the Swipe's command takes only that one). */
export function localPositionTokenIsDeck(id: string): boolean {
  const own = positionTokens.get(id);
  return !(own && own.identity === localTeamDataKey()) && tokens.has(id);
}

export class LocalSwipeError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type Decks = { pending: PositionWithScore[]; reviewed: SwipeReviewedRow[] };
type Row = Record<string, unknown>;

/** A position of the native deck as the card wants it: the number of the database is its `legacy_id`, and the salary is the declared one before the estimated one. */
function card(row: Row): PositionWithScore {
  const salary = salaryPreference(row as Parameters<typeof salaryPreference>[0]);
  return {
    ...row,
    id: String(row.id),
    legacy_id: row.id as number,
    salary_min: salary.min,
    salary_max: salary.max,
    salary_currency: salary.currency,
  } as unknown as PositionWithScore;
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The decks of the team on this computer. A refusal or a bad answer throws its closed code and forgets the deck. */
export async function getSwipeDecksLocal(): Promise<Decks> {
  forgetLocalDeck();
  if (!isTauri()) throw new LocalSwipeError("desktop_transport_unavailable");
  let answer: unknown;
  try {
    answer = await invoke<unknown>("local_swipe_deck_read");
  } catch {
    reportLocalTeamRead("desktop_transport_unavailable");
    throw new LocalSwipeError("desktop_transport_unavailable");
  }
  if (!isRecord(answer) || answer.ok !== true) {
    const code = isRecord(answer) && typeof answer.error === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(answer.error) ? answer.error : "desktop_bad_reply";
    reportLocalTeamRead(code);
    throw new LocalSwipeError(code);
  }
  const { token, pending, reviewed } = answer;
  if (typeof token !== "string" || !Array.isArray(pending) || !Array.isArray(reviewed)) {
    reportLocalTeamRead("desktop_bad_reply");
    throw new LocalSwipeError("desktop_bad_reply");
  }
  // Made from the data the team saved while it is off: it names no file, so no token is kept for it and no verdict goes out of it.
  const saved = isRecord(answer.saved) ? answer.saved : null;
  const mark = saved ? { at: typeof saved.at === "number" && Number.isFinite(saved.at) && saved.at > 0 ? saved.at : null } : null;
  reportLocalTeamRead(null, mark);
  const decks = {
    pending: pending.filter(isRecord).map(card),
    reviewed: reviewed.filter(isRecord).flatMap((item) =>
      isRecord(item.row) && typeof item.action === "string"
        ? [{ position: card(item.row), action: item.action, fb_score: typeof item.fbScore === "number" ? item.fbScore : null }]
        : [],
    ),
  };
  tokens = mark
    ? new Map()
    : new Map([...decks.pending, ...decks.reviewed.map((r) => r.position)].map((position) => [String(position.legacy_id), token]));
  return decks;
}
