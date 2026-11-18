/**
 * `db_insert.py company` and `db_insert.py highlight`, the ANALISTA's inserts (T14).
 *
 * The Python's SQL and messages. `company` is an upsert on the name, as in
 * the script (B1-T1, 28/09): it was `INSERT OR REPLACE` on both sides, a
 * delete and an insert that the foreign key refused as soon as a position
 * pointed at the company — the ANALISTA's second position of a company it
 * knew — and that, when it went through, changed the id and blanked what it
 * was not told (the logo). The row stays; only the fields given change.
 */

import type { Parsed } from "./argv.ts";
import type { Database } from "./jobs-db.ts";
import { pySlice } from "./py-format.ts";
import { cleanAbout } from "./company-about.ts";
import type { ScriptResult } from "./tools.ts";

/** `COMPANY_LEGAL_FORMS` (_db.py): the legal forms dropped from the end of a company name before comparing it. */
const COMPANY_LEGAL_FORMS = new Set([
  "spa", "srl", "srls", "sas", "snc", "sapa", "scarl", "scrl", "scpa", "soccoop", "coop", "onlus",
  "gmbh", "ag", "kg", "ohg", "ug", "ev", "se", "sa", "sarl", "sl", "slu", "ltd", "limited", "inc", "llc", "plc",
  "corp", "bv", "nv", "ab", "as", "asa", "oy", "oyj", "aps", "kft", "zrt", "nyrt", "bt", "sro", "ltda", "lda",
]);

/**
 * `company_key` (_db.py): the name as it is compared, no accents, no case, no punctuation, no legal form at the end.
 * «Gamma Italia S.p.a.» and «Gamma Italia» give the same key; anything else of the name stays.
 */
export function companyKey(name: string | null | undefined): string {
  if (!name) return "";
  const text = String(name).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[.'\u2019]/g, "");
  const words = text.match(/[a-z0-9]+/g) ?? [];
  while (words.length > 1 && COMPANY_LEGAL_FORMS.has(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

function companiesByKey(db: Database, key: string): number[] {
  const rows = db.prepare("SELECT id, name FROM companies").all() as { id: number; name: string }[];
  return rows.filter((row) => companyKey(row.name) === key).map((row) => row.id);
}

/** `_db.resolve_company_id`: the company's id by case-insensitive name, then by companyKey when one company has it. */
export function resolveCompanyId(db: Database, name: string | null): number | null {
  if (!name) return null;
  const row = db.prepare("SELECT id FROM companies WHERE LOWER(name) = LOWER(?)").get(name) as { id: number } | undefined;
  if (row) return row.id;
  const key = companyKey(name);
  const found = key ? companiesByKey(db, key) : [];
  return found.length === 1 ? found[0]! : null;
}

/**
 * `link_positions_to_company` (_db.py): the positions of the same name with no company yet (company_id NULL) get this one.
 * A position links itself only when the company already exists as it is inserted; the SCOUT inserts it before the
 * ANALISTA creates the company, and the position stayed unlinked for good. An existing link is never touched. The
 * same name first, then the same companyKey when this company is the only one with it.
 */
export function linkPositionsToCompany(db: Database, companyId: number | null, name: string): number {
  if (!companyId || !name) return 0;
  let linked = Number(
    db.prepare("UPDATE positions SET company_id = ? WHERE company_id IS NULL AND LOWER(company) = LOWER(?)").run(companyId, name).changes,
  );
  const key = companyKey(name);
  const owners = key ? companiesByKey(db, key) : [];
  if (owners.length !== 1 || owners[0] !== companyId) return linked;
  const rows = db.prepare("SELECT id, company FROM positions WHERE company_id IS NULL AND company IS NOT NULL").all() as {
    id: number;
    company: string;
  }[];
  const link = db.prepare("UPDATE positions SET company_id = ? WHERE id = ? AND company_id IS NULL");
  for (const row of rows) {
    if (companyKey(row.company) !== key) continue;
    link.run(companyId, row.id);
    linked += 1;
  }
  return linked;
}

export function insertCompany(db: Database, a: Parsed): ScriptResult {
  db.prepare(
      `
        INSERT INTO companies (name, website, hq_country, sector, size,
                               glassdoor_rating, red_flags, culture_notes,
                               analyzed_by, verdict, about)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            website          = COALESCE(excluded.website, companies.website),
            hq_country       = COALESCE(excluded.hq_country, companies.hq_country),
            sector           = COALESCE(excluded.sector, companies.sector),
            size             = COALESCE(excluded.size, companies.size),
            glassdoor_rating = COALESCE(excluded.glassdoor_rating, companies.glassdoor_rating),
            red_flags        = COALESCE(excluded.red_flags, companies.red_flags),
            culture_notes    = COALESCE(excluded.culture_notes, companies.culture_notes),
            analyzed_by      = COALESCE(excluded.analyzed_by, companies.analyzed_by),
            verdict          = COALESCE(excluded.verdict, companies.verdict),
            about            = COALESCE(excluded.about, companies.about),
            analyzed_at      = CURRENT_TIMESTAMP
    `,
    )
    .run(
      a["name"] as string, a["website"] as string | null, a["hq_country"] as string | null, a["sector"] as string | null,
      a["size"] as string | null, a["glassdoor_rating"] as number | null, a["red_flags"] as string | null,
      a["culture_notes"] as string | null, a["analyzed_by"] as string | null, a["verdict"] as string | null,
      cleanAbout(a["about"]),
    );
  // lastInsertRowid says nothing after an update: the id is read.
  const row = db.prepare("SELECT id FROM companies WHERE name = ?").get(a["name"] as string) as { id: number };
  // the positions inserted before the company (by the SCOUT) are linked now
  linkPositionsToCompany(db, row.id, a["name"] as string);
  return { stdout: `Company inserted/updated: ${a["name"] as string} (ID: ${row.id})\n`, exitCode: 0 };
}

export function insertHighlight(db: Database, a: Parsed): ScriptResult {
  db.prepare("INSERT INTO position_highlights (position_id, type, text) VALUES (?, ?, ?)").run(
    a["position_id"] as number, a["type"] as string, a["text"] as string,
  );
  return {
    stdout: `Highlight (${a["type"] as string}) inserted for position ${a["position_id"] as number}: ${pySlice(a["text"] as string, 0, 50)}\n`,
    exitCode: 0,
  };
}

/**
 * `insert_application` (T25): the SCRITTORE's row for a position the person
 * asked a CV for. The script's `INSERT OR REPLACE` is kept — the caller has
 * already refused an existing row, which is what would be erased — and
 * `--written-at` is bound as given, `'now'` included, exactly as the script
 * does (the skill warns about it: application-flow step 5).
 */
export function insertApplication(db: Database, a: Parsed): ScriptResult {
  db.prepare(
    "INSERT OR REPLACE INTO applications (position_id, cv_path, cl_path, cv_pdf_path, cl_pdf_path, written_by, written_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    a["position_id"] as number, a["cv_path"] as string | null, a["cl_path"] as string | null,
    a["cv_pdf_path"] as string | null, a["cl_pdf_path"] as string | null,
    (a["written_by"] as string | null) || null, a["written_at"] as string | null,
  );
  return { stdout: `Application inserted for position ${a["position_id"] as number}\n`, exitCode: 0 };
}
