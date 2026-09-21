/**
 * Where the CRITICO's review lands, written by the hub (T34).
 *
 * In the TUI the CRITICO is its own agent with its own uid, and `critiche/`
 * is its folder to write. In the harness the critic-loop runs in-process: the
 * Critic is a subagent of the SCRITTORE and carries the SCRITTORE's uid, which
 * on `critiche/` has read and nothing else. On the live chain of 21/09 the
 * loop ran to the end — CV, PDF, verdict NEEDS_WORK 7.2 — and `critiche/`
 * stayed empty: the review existed only in the trace.
 *
 * Giving the SCRITTORE write access there was the tempting fix and the wrong
 * one (SICUREZZA): the reviewed would be able to rewrite its own review, in
 * silence, and that separation buys exactly one thing — that it cannot. The
 * runtime writing it changes nothing either, because inside that process the
 * kernel still sees the SCRITTORE. So the hub writes it: it already is the
 * only process holding the database, it has a uid of its own, and the text is
 * in its hands the moment the role asks.
 *
 * What the model chooses: the text of the review, and which position it is
 * for. **Not one character of the path.** The company is read from the
 * database, not taken from the request — and even so it is a scraped string
 * from a job ad (SICUREZZA): it is cut to a slug of [a-z0-9-], and the
 * finished path is resolved and checked to be inside the deliverables before
 * anything is opened. A company called `../cv/CV_1.md` writes nothing.
 *
 * A review never replaces the one before it: the Writer may still be reading
 * it, critico.md forbids it, and the three rounds of the loop are the history
 * of the judgement. The hub picks the first free name — `-v2`, `-v3` — so the
 * ordinal is the round order, decided here and never by the caller.
 */

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Database } from "../db/jobs-db.ts";
import { isInside, realPath } from "../tools/paths.ts";

/** The longest review the hub writes: the skill's seven sections fit many times over. */
export const MAX_REVIEW_CHARS = 40_000;

/** Tries before giving up on a name: three rounds is the protocol, ten is a wall. */
const MAX_VERSIONS = 10;

export interface SaveReviewResult {
  ok: boolean;
  /** Absolute path of the file written. */
  path?: string;
  error?: string;
  status_code?: "NOT_FOUND" | "TOO_LONG" | "UNWRITABLE" | "PATH_REFUSED";
}

/**
 * `review-<company>-<date>.md`, as `blind-review/SKILL.md` names it. The slug
 * keeps letters and digits and nothing else: no dot, no separator, no space,
 * so the name cannot become a path however the ad spelled the company.
 */
export function reviewFileName(company: string, day: string): string {
  return `${reviewPrefix(company)}-${day}.md`;
}

/**
 * What every review of a company is named after: `review-<slug>`. The same
 * function names a new file and finds the ones already there — two spellings
 * would mean writing under one name and looking under another.
 *
 * The slug keeps letters and digits and nothing else: no dot, no separator,
 * no space, so the name cannot become a path however the ad spelled the
 * company. Decomposing first keeps the letters of an accented name ("Ünïcødé"
 * gives "unicde", not a row of dashes).
 */
export function reviewPrefix(company: string): string {
  const slug = company
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `review-${slug || "azienda"}`;
}

export interface SaveReviewOptions {
  /** The deliverables folder: the review goes in its `critiche/`. */
  userDir: string;
  positionId: number;
  text: string;
  now?: () => Date;
}

/** Writes one review and answers with its path, or with the reason there is none. */
export function saveReview(db: Database, options: SaveReviewOptions): SaveReviewResult {
  if (options.text.length > MAX_REVIEW_CHARS) {
    return { ok: false, error: `A review is at most ${MAX_REVIEW_CHARS} characters.`, status_code: "TOO_LONG" };
  }
  // The position first: nothing is created for a review of nothing.
  const row = db.prepare("SELECT id, company FROM positions WHERE id = ?").get(options.positionId) as { id: number; company: string | null } | undefined;
  if (!row) return { ok: false, error: `Position #${options.positionId} not found.`, status_code: "NOT_FOUND" };

  const day = (options.now?.() ?? new Date()).toISOString().slice(0, 10);
  const dir = join(options.userDir, "critiche");
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    return { ok: false, error: `${dir} cannot be written: ${message(error)}`, status_code: "UNWRITABLE" };
  }
  // The deliverables, not `critiche/` itself: a folder that is a link out of
  // them writes nothing, and the slug cannot climb even one level.
  const root = realPath(options.userDir);
  const name = reviewFileName(row.company ?? "", day);

  for (let version = 1; version <= MAX_VERSIONS; version++) {
    const candidate = join(dir, version === 1 ? name : name.replace(/\.md$/, `-v${version}.md`));
    // The slug cannot hold a separator, and this says so a second time, on the
    // finished path, with every symlink resolved: what is opened is inside.
    if (!isInside(root, realPath(candidate))) {
      return { ok: false, error: "The review's path fell outside the deliverables.", status_code: "PATH_REFUSED" };
    }
    try {
      // `wx`: the file is created or the write fails. Two reviews landing in the
      // same millisecond take two names instead of one overwriting the other.
      writeFileSync(candidate, options.text.endsWith("\n") ? options.text : `${options.text}\n`, { flag: "wx" });
      return { ok: true, path: candidate };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      return { ok: false, error: `${candidate} cannot be written: ${message(error)}`, status_code: "UNWRITABLE" };
    }
  }
  return { ok: false, error: `${MAX_VERSIONS} reviews already exist for that company today.`, status_code: "UNWRITABLE" };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The reviews already written for a company, newest name last. Used to say
 * out loud when a verdict reaches the database with no review beside it: the
 * file is what the person reads, and a verdict nobody can read is not one.
 */
export function reviewsFor(userDir: string, company: string): string[] {
  const prefix = reviewPrefix(company);
  try {
    return readdirSync(join(userDir, "critiche"))
      .filter((name) => name.startsWith(prefix) && name.endsWith(".md"))
      .sort();
  } catch {
    // No folder yet is no reviews, which is exactly what the caller asks.
    return [];
  }
}

/**
 * What a `db_update application` call records a critic verdict for, or null.
 * The arguments are the script's own words (`["application", "7",
 * "--critic-verdict", "PASS"]`), as the tool takes them.
 */
export function verdictPosition(name: string, args: unknown): number | null {
  if (name !== "db_update") return null;
  const words = (args as { args?: unknown })?.args;
  if (!Array.isArray(words) || words[0] !== "application") return null;
  if (!words.some((word) => word === "--critic-verdict" || word === "--critic-score")) return null;
  const id = Number(words[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}
