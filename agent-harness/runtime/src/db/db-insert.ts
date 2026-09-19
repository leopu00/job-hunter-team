/**
 * `db_insert.py company` and `db_insert.py highlight`, the ANALISTA's inserts (T14).
 *
 * The Python's SQL and messages. `company` is `INSERT OR REPLACE` as in the
 * script: a name already there is replaced whole — the ANALISTA's skill
 * checks with `db_query company` first and updates with `db_update company`
 * — and with foreign keys on, replacing a company positions point at fails,
 * as it does for the Python.
 */

import type { Parsed } from "./argv.ts";
import type { Database } from "./jobs-db.ts";
import { pySlice } from "./py-format.ts";
import type { ScriptResult } from "./tools.ts";

export function insertCompany(db: Database, a: Parsed): ScriptResult {
  const result = db
    .prepare(
      `
        INSERT OR REPLACE INTO companies (name, website, hq_country, sector, size,
                                          glassdoor_rating, red_flags, culture_notes,
                                          analyzed_by, verdict)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      a["name"] as string, a["website"] as string | null, a["hq_country"] as string | null, a["sector"] as string | null,
      a["size"] as string | null, a["glassdoor_rating"] as number | null, a["red_flags"] as string | null,
      a["culture_notes"] as string | null, a["analyzed_by"] as string | null, a["verdict"] as string | null,
    );
  return { stdout: `Company inserted/updated: ${a["name"] as string} (ID: ${Number(result.lastInsertRowid)})\n`, exitCode: 0 };
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
