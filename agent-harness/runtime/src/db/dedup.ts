/**
 * The hierarchical duplicate check of `db_insert.py` (bug #25, SC-05).
 *
 * `check_duplicate` decides whether a position the SCOUT found is one the
 * team already has. Both `db_insert position` and `scout_dedup check` answer
 * with it, so the API SCOUT must skip exactly what the TUI SCOUT skips:
 *
 * - level 0: the same LinkedIn job id, read from the `/jobs/view/<id>` path;
 * - level 1: the same URL;
 * - level 2: same company and title (case-insensitive), same city;
 * - level 3: same company, a title with difflib ratio > 0.85, same city.
 *
 * "Same city" is the first comma-separated token of the location, lowercased,
 * without diacritics, through a small cross-language synonym map. Excluded
 * positions count: re-inserting one wastes the SCOUT's work.
 */

import type { Database } from "./jobs-db.ts";
import { sequenceRatio } from "./sequence-matcher.ts";

export interface DuplicateRow {
  id: number;
  title: string;
  company: string;
  url?: string | null;
  location?: string | null;
}

export interface Duplicate {
  row: DuplicateRow;
  level: 0 | 1 | 2 | 3;
  /** The label the Python prints: `URL esatto`, `LinkedIn job ID <id>`… */
  matchType: string;
}

/** The id in `linkedin.com/jobs/view/<id>`. A `currentJobId=` in the query is another ad and is ignored. */
export function extractLinkedinJobId(url: string | null | undefined): string | null {
  if (!url) return null;
  return /linkedin\.com\/jobs\/view\/(\d+)/.exec(url)?.[1] ?? null;
}

/** `_title_similarity`: difflib's ratio on lowercased titles; 0 when either is empty. */
export function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0.0;
  return sequenceRatio(a.toLowerCase(), b.toLowerCase());
}

/** `_normalize_city`: first comma token, trimmed, lowercased, combining marks removed. */
export function normalizeCity(location: string | null | undefined): string {
  if (!location) return "";
  const first = (location.split(",")[0] ?? "").trim().toLowerCase();
  return first.normalize("NFD").replace(/\p{Mn}/gu, "");
}

const CITY_SYNONYMS: Record<string, string> = {
  milano: "milan",
  milan: "milan",
  roma: "rome",
  rome: "rome",
  torino: "turin",
  turin: "turin",
  firenze: "florence",
  florence: "florence",
  venezia: "venice",
  venice: "venice",
  napoli: "naples",
  naples: "naples",
  genova: "genoa",
  genoa: "genoa",
  "monaco di baviera": "munich",
  munchen: "munich",
  munich: "munich",
  koln: "cologne",
  cologne: "cologne",
  wien: "vienna",
  vienna: "vienna",
  praha: "prague",
  prague: "prague",
};

/** `_normalize_city_canonical`: the normalised city through the synonym map. */
export function normalizeCityCanonical(location: string | null | undefined): string {
  const raw = normalizeCity(location);
  return Object.hasOwn(CITY_SYNONYMS, raw) ? CITY_SYNONYMS[raw]! : raw;
}

/**
 * `check_duplicate(conn, url, company, title, location)`. Constant SQL, bound
 * parameters; the LIKE pattern is built from `\d+` and a literal prefix, so no
 * `%` or `_` from the input can reach it.
 */
export function checkDuplicate(
  db: Database,
  input: { url?: string | null; company?: string | null; title?: string | null; location?: string | null },
): Duplicate | null {
  const { url, company, title, location } = input;

  const linkedinId = extractLinkedinJobId(url);
  if (linkedinId) {
    const candidates = db
      .prepare("SELECT id, title, company, url FROM positions WHERE url LIKE ?")
      .all(`%/jobs/view/${linkedinId}%`) as unknown as DuplicateRow[];
    for (const cand of candidates) {
      if (extractLinkedinJobId(cand.url) === linkedinId) {
        return { row: cand, level: 0, matchType: `LinkedIn job ID ${linkedinId}` };
      }
    }
  }

  if (url) {
    const existing = db.prepare("SELECT id, title, company FROM positions WHERE url = ?").get(url) as DuplicateRow | undefined;
    if (existing) return { row: existing, level: 1, matchType: "URL esatto" };
  }

  const cityNew = normalizeCityCanonical(location);
  if (company && title) {
    const candidates = db
      .prepare(
        "SELECT id, title, company, location FROM positions WHERE LOWER(company) = LOWER(?) AND LOWER(title) = LOWER(?)",
      )
      .all(company, title) as unknown as DuplicateRow[];
    for (const cand of candidates) {
      if (normalizeCityCanonical(cand.location) === cityNew) {
        return { row: cand, level: 2, matchType: "azienda+titolo+city-norm" };
      }
    }

    const sameCompany = db
      .prepare("SELECT id, title, company, location FROM positions WHERE LOWER(company) = LOWER(?)")
      .all(company) as unknown as DuplicateRow[];
    for (const cand of sameCompany) {
      if (normalizeCityCanonical(cand.location) !== cityNew) continue;
      if (titleSimilarity(title, cand.title) > 0.85) {
        return { row: cand, level: 3, matchType: "azienda+titolo simile+city-norm" };
      }
    }
  }
  return null;
}
