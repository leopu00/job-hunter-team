// Which boxes of this user no longer sync, or are about to stop, because of their token.
//
// A box's token expired on 07/10 and its box failed every push for 16 days
// without anybody seeing it: the token list said nothing (it sat among the
// active ones) and no page warned. The website knows the expiry of every token,
// so it says so on every page, not only in the token list.
//
// Only tokens whose box was in use count: an expired token nobody had used for
// a month before it expired is a forgotten one (the list says so), not a box
// that just went silent.

import { tokenExpiry } from "@/lib/cloud-sync/token-expiry";
import { TOKEN_INACTIVITY_WARNING_DAYS } from "@/lib/cloud-sync/token-inactivity";

const DAY_MS = 86_400_000;

export interface BannerTokenRow {
  name: string;
  expires_at: string | null;
  /** The last call of its box (the box writes it at every cloud-sync call). */
  client_seen_at: string | null;
}

export type BoxTokenTrouble =
  | { kind: "expired"; name: string; expiresAt: string }
  | { kind: "expiring"; name: string; expiresAt: string; daysLeft: number };

/** The boxes to warn about, expired first, each once; [] when there is nothing to say. */
export function boxTokenTroubles(
  tokens: readonly BannerTokenRow[],
  now: number = Date.now(),
): BoxTokenTrouble[] {
  const out: BoxTokenTrouble[] = [];
  for (const token of tokens) {
    const expiry = tokenExpiry(token.expires_at, now);
    if (
      expiry.kind !== "expired" &&
      !(expiry.kind === "active" && expiry.warning)
    )
      continue;
    const used = token.client_seen_at
      ? new Date(token.client_seen_at).getTime()
      : NaN;
    if (Number.isNaN(used)) continue;
    // in use within the month before the expiry (expired) or before now (expiring)
    const reference =
      expiry.kind === "expired" ? new Date(expiry.expiresAt).getTime() : now;
    if (reference - used > TOKEN_INACTIVITY_WARNING_DAYS * DAY_MS) continue;
    out.push(
      expiry.kind === "expired"
        ? { kind: "expired", name: token.name, expiresAt: expiry.expiresAt }
        : {
            kind: "expiring",
            name: token.name,
            expiresAt: expiry.expiresAt,
            daysLeft: expiry.daysLeft,
          },
    );
  }
  return out.sort((a, b) =>
    a.kind === b.kind
      ? a.expiresAt.localeCompare(b.expiresAt)
      : a.kind === "expired"
        ? -1
        : 1,
  );
}
