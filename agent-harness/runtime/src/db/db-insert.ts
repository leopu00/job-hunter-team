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
import type { ScriptResult } from "./tools.ts";

export function insertCompany(db: Database, a: Parsed): ScriptResult {
  db.prepare(
      `
        INSERT INTO companies (name, website, hq_country, sector, size,
                               glassdoor_rating, red_flags, culture_notes,
                               analyzed_by, verdict)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            analyzed_at      = CURRENT_TIMESTAMP
    `,
    )
    .run(
      a["name"] as string, a["website"] as string | null, a["hq_country"] as string | null, a["sector"] as string | null,
      a["size"] as string | null, a["glassdoor_rating"] as number | null, a["red_flags"] as string | null,
      a["culture_notes"] as string | null, a["analyzed_by"] as string | null, a["verdict"] as string | null,
    );
  // lastInsertRowid says nothing after an update: the id is read.
  const row = db.prepare("SELECT id FROM companies WHERE name = ?").get(a["name"] as string) as { id: number };
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
