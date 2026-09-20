/**
 * `db_update.py position` and `db_update.py company`, whole (T14).
 *
 * The Python's order, SQL and messages, field by field: the SET list is made
 * of constant fragments and every value is bound, as in the script. Who may
 * run which update, on which rows, is decided before this is called
 * (`tools.ts`, `role-policy.ts`); a caller that must also hold the row in the
 * write itself passes a `guard` for the WHERE.
 *
 * `tests/db-update.test.ts` runs db_update.py on a twin database and
 * compares the output and every row it touches.
 */

import { readFileSync } from "node:fs";

import type { Parsed } from "./argv.ts";
import { flattenExternalValue, EXTERNAL_INLINE_FIELDS } from "./external-content.ts";
import type { Database } from "./jobs-db.ts";
import { interpretEscapes, pyFloatRepr, pySlice, pyStr, pyTruthy, PY_SPACE_CLASS } from "./py-format.ts";
import type { ScriptResult } from "./tools.ts";

/** `maintenance_log.ACTIONS` / `OUTCOMES` / `EVIDENCE_KINDS`: the history's closed vocabularies. */
export const MAINTENANCE_ACTIONS = ["liveness_check", "geocode", "logo_fetch", "website_fetch", "jd_refresh", "exclude", "rescore"];
export const MAINTENANCE_OUTCOMES = [
  "confirmed_open", "confirmed_closed", "inconclusive", "updated", "unchanged", "unreachable", "skipped", "failed",
];
export const EVIDENCE_KINDS = ["http", "api", "manual", "none"];
const INCONCLUSIVE_OUTCOMES = ["inconclusive", "unreachable", "failed", "skipped"];

/** `MAINTENANCE_TRACKED_FIELDS`: last_checked and last_open_check left out on purpose, as the Python explains. */
const POSITION_TRACKED = [
  "status", "url", "deadline", "expires_at", "is_open", "office_lat", "office_lon", "office_address",
  "office_geocoded", "office_verified", "jd_summary", "jd_text", "notes",
];
/** `COMPANY_TRACKED_FIELDS`. */
const COMPANY_TRACKED = ["website", "logo", "logo_source", "logo_fetched", "sector", "hq_country", "size"];

/** Extra conditions on the UPDATE's WHERE, so the write itself cannot reach a row the caller does not hold. */
export interface UpdateGuard {
  where: string;
  params: Array<string | number>;
}

class MaintenanceError extends Error {}

type Value = string | number | null;

/** `check_closing_write`: an inconclusive check cannot close a position. */
function checkClosingWrite(field: string, value: unknown, outcome: string): void {
  if (!INCONCLUSIVE_OUTCOMES.includes(outcome)) return;
  const closing: unknown[] | undefined = { is_open: ["false", "0", 0], status: ["excluded", "expired"] }[field];
  if (!closing || !closing.includes(value)) return;
  throw new MaintenanceError(
    `outcome '${outcome}' means you could NOT verify the result, while '${field}=${pyStr(value)}' would close the position. ` +
      "Not knowing does not prove it expired: closing on doubt can silently lose an opportunity. " +
      "Keep it active — the check remains in history and will be retried. Close it only with outcome 'confirmed_closed'.",
  );
}

/** `_snapshot`: the tracked fields as `str()` would print them, or `{}` for a missing row. */
function snapshot(db: Database, table: "positions" | "companies", id: number, fields: string[]): Map<string, { raw: unknown; text: string }> {
  // Table and columns are the constant lists above.
  const statement = db.prepare(`SELECT ${fields.join(", ")} FROM ${table} WHERE id = ?`);
  const declared = Object.fromEntries(statement.columns().map((c) => [c.name, c.type ?? null]));
  const row = statement.get(id) as Record<string, unknown> | undefined;
  const out = new Map<string, { raw: unknown; text: string }>();
  if (!row) return out;
  for (const f of fields) out.set(f, { raw: row[f], text: pyStr(row[f], declared[f]) });
  return out;
}

/** `_diffs`: the fields whose text changed, as `(field, before, after)`. */
function diffs(before: ReturnType<typeof snapshot>, after: ReturnType<typeof snapshot>) {
  const out: Array<{ field: string; before: { raw: unknown; text: string }; after: { raw: unknown; text: string } }> = [];
  for (const [field, old] of before) {
    const now = after.get(field) ?? { raw: null, text: "None" };
    if (old.text !== now.text) out.push({ field, before: old, after: now });
  }
  return out;
}

/** `maintenance_log.record_diffs`: one event per changed field, one when nothing changed. */
function recordDiffs(
  db: Database,
  targetType: string,
  targetId: number,
  action: string,
  changes: ReturnType<typeof diffs>,
  a: Parsed,
  actor: string,
): number {
  const outcome = pyTruthy(a["outcome"]) ? (a["outcome"] as string) : changes.length ? "updated" : "unchanged";
  for (const c of changes) checkClosingWrite(c.field, c.after.raw, outcome);
  const url = a["evidence_url"] as string | null;
  const code = a["evidence_code"] as number | null;
  let kind = a["evidence_kind"] as string | null;
  if (!pyTruthy(kind) && (pyTruthy(url) || code !== null)) kind = "http";
  const insert = db.prepare(
    "INSERT INTO maintenance_events (by_agent, target_type, target_id, action, outcome, field, before, after, evidence_kind, evidence_url, evidence_code, evidence_hash, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  // `_as_text`: None stays NULL, anything else is its str().
  const text = (v: { raw: unknown; text: string }) => (v.raw === null || v.raw === undefined ? null : v.text);
  const rows = changes.length ? changes : [null];
  for (const c of rows) {
    insert.run(
      actor, targetType, targetId, action, outcome,
      c ? c.field : null, c ? text(c.before) : null, c ? text(c.after) : null,
      kind, url, code, a["evidence_hash"] as string | null, a["duration_ms"] as number | null,
    );
  }
  return rows.length;
}

/** `role_taxonomy.normalize_key`: surface variants of a label collapse to one key. */
function normalizeKey(label: string): string {
  let s = label.replace(new RegExp(`^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`, "gu"), "").toLowerCase();
  if (!s) return "";
  s = s.replace(new RegExp(`[^a-z0-9${PY_SPACE_CLASS}]+`, "gu"), " ").replace(new RegExp(`[${PY_SPACE_CLASS}]+`, "gu"), " ").trim();
  if (!s) return "";
  const connectors = new Set(["and", "&", "/", "+", "-", "–", "—", "|", ","]);
  const tokens = [...new Set(s.split(" ").filter((t) => t && !connectors.has(t)))].sort();
  return tokens.join(" ");
}

/** `_guard_role_family`: an active registry name, or the sentinel with the label as a proposal. */
function guardRoleFamily(raw: string, active: string[]): { family: string; proposed: string } {
  const v = raw.replace(new RegExp(`^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`, "gu"), "");
  if (v.toLowerCase() === "other" || v.toLowerCase() === "altro") return { family: "Other", proposed: "" };
  if (active.includes(v)) return { family: v, proposed: "" };
  const key = normalizeKey(v);
  if (key) for (const name of active) if (normalizeKey(name) === key) return { family: name, proposed: "" };
  return { family: "Other", proposed: v };
}

/** `update_position`, with the actor as `last_actor` and in the transition and history rows. */
export function updatePosition(db: Database, a: Parsed, actor: string, userId: string, guard?: UpdateGuard): ScriptResult {
  const id = a["id"] as number;
  // T21: the column's vocabulary is onsite | hybrid | remote (location-enrichment, the dashboard's
  // filters); analista.md names the full-remote case with remote_type's word. Stored as the column's.
  if (a["work_mode"] === "full_remote") a["work_mode"] = "remote";
  // normalize_external_inline_fields: the page's short fields stay one line.
  for (const f of EXTERNAL_INLINE_FIELDS) if (typeof a[f] === "string") a[f] = flattenExternalValue(a[f]);
  const out: string[] = [];
  const result = (exitCode: number): ScriptResult => ({ stdout: out.map((l) => `${l}\n`).join(""), exitCode });

  if (a["status"] === "applied") {
    return {
      stdout: "",
      stderr:
        "⚠\ufe0f  APPLIED REJECTED: use `db_update.py application <ID> --applied-at now --applied-via <channel>` so position and application are updated atomically.\n",
      exitCode: 1,
    };
  }

  const action = a["action"] as string | null;
  const outcome = a["outcome"] as string | null;
  db.exec("BEGIN IMMEDIATE");
  try {
    let previous: string | null = null;
    if (pyTruthy(a["status"])) {
      const row = db.prepare("SELECT status FROM positions WHERE id = ?").get(id) as { status: string | null } | undefined;
      if (row) previous = row.status;
    }
    if (pyTruthy(outcome)) {
      try {
        checkClosingWrite("is_open", a["is_open"], outcome!);
        checkClosingWrite("status", a["status"], outcome!);
      } catch (error) {
        db.exec("ROLLBACK");
        out.push(`⚠\ufe0f  CLOSE REJECTED: ${(error as Error).message}`);
        return result(1);
      }
    }
    const before = pyTruthy(action) ? snapshot(db, "positions", id, POSITION_TRACKED) : new Map();

    const sets: string[] = [];
    const params: Value[] = [];
    const changed: string[] = [];
    const set = (clause: string, value?: Value) => {
      sets.push(clause);
      if (value !== undefined) params.push(value);
    };
    const str = (k: string) => a[k] as string;
    const num = (k: string) => a[k] as number;

    if (pyTruthy(a["status"])) {
      set("status = ?", str("status"));
      changed.push(`status=${str("status")}`);
    }
    if (pyTruthy(a["notes"])) {
      set("notes = ?", interpretEscapes(str("notes")));
      changed.push(`notes=${pySlice(str("notes"), 0, 40)}...`);
    }
    if (pyTruthy(a["jd_text"])) {
      set("jd_text = ?", str("jd_text"));
      changed.push("jd_text");
    }
    if (pyTruthy(a["jd_summary"])) {
      set("jd_summary = ?", interpretEscapes(str("jd_summary")));
      changed.push("jd_summary");
    }
    if (pyTruthy(a["requirements"])) {
      set("requirements = ?", str("requirements"));
      changed.push("requirements");
    }
    if (pyTruthy(a["location"])) {
      set("location = ?", str("location"));
      changed.push(`location=${str("location")}`);
    }
    if (pyTruthy(a["remote_type"])) {
      set("remote_type = ?", str("remote_type"));
      changed.push(`remote_type=${str("remote_type")}`);
    }
    if (pyTruthy(a["url"])) {
      set("url = ?", str("url"));
      changed.push("url");
    }
    if (pyTruthy(a["deadline"])) {
      set("deadline = ?", str("deadline"));
      changed.push(`deadline=${str("deadline")}`);
    }
    if (pyTruthy(a["title"])) {
      set("title = ?", str("title"));
      changed.push(`title=${str("title")}`);
    }
    if (pyTruthy(a["company"])) {
      set("company = ?", str("company"));
      changed.push(`company=${str("company")}`);
      const cid = (db.prepare("SELECT id FROM companies WHERE LOWER(name) = LOWER(?)").get(str("company")) as { id: number } | undefined)?.id;
      if (cid) {
        set("company_id = ?", cid);
        changed.push(`company_id=${cid}`);
      }
    }
    for (const k of ["salary_declared_min", "salary_declared_max"]) {
      if (a[k] !== null) {
        set(`${k} = ?`, num(k));
        changed.push(`${k}=${num(k)}`);
      }
    }
    if (pyTruthy(a["salary_declared_currency"])) {
      set("salary_declared_currency = ?", str("salary_declared_currency"));
      changed.push(`salary_declared_currency=${str("salary_declared_currency")}`);
    }
    for (const k of ["salary_estimated_min", "salary_estimated_max"]) {
      if (a[k] !== null) {
        set(`${k} = ?`, num(k));
        changed.push(`${k}=${num(k)}`);
      }
    }
    for (const k of ["salary_estimated_currency", "salary_estimated_source", "source"]) {
      if (pyTruthy(a[k])) {
        set(`${k} = ?`, str(k));
        changed.push(`${k}=${str(k)}`);
      }
    }
    if (pyTruthy(a["last_checked"])) {
      if (a["last_checked"] === "now") set("last_checked = datetime('now', 'localtime')");
      else set("last_checked = ?", str("last_checked"));
      changed.push(`last_checked=${str("last_checked")}`);
    }

    if (a["role_family"] !== null) {
      const raw = str("role_family");
      if (raw.replace(new RegExp(`[${PY_SPACE_CLASS}]`, "gu"), "") === "") {
        set("role_family = NULL");
        changed.push("role_family=NULL");
        set("role_family_proposed = NULL");
        changed.push("role_family_proposed=NULL");
      } else {
        const active = (
          db
            .prepare("SELECT name FROM role_family_registry WHERE user_id = ? AND status = 'active' ORDER BY support_count DESC, name ASC")
            .all(userId) as Array<{ name: string }>
        ).map((r) => r.name);
        const { family, proposed } = guardRoleFamily(raw, active);
        const stripped = raw.replace(new RegExp(`^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`, "gu"), "");
        if (family !== stripped) changed.push(`role_family-guard(${pySlice(raw, 0, 24)}→${family})`);
        set("role_family = ?", family);
        changed.push(`role_family=${family}`);
        if (proposed === "") {
          set("role_family_proposed = NULL");
          changed.push("role_family_proposed=NULL");
        } else {
          set("role_family_proposed = ?", proposed);
          changed.push(`role_family_proposed=${pySlice(proposed, 0, 30)}`);
        }
      }
    }

    for (const col of ["loc_city", "loc_region", "loc_country", "loc_country_code", "loc_continent", "work_mode", "work_country", "work_country_code", "location_notes"]) {
      const v = a[col] as string | null;
      if (v === null) continue;
      if (v === "") {
        set(`${col} = NULL`);
        changed.push(`${col}=NULL`);
      } else {
        set(`${col} = ?`, v);
        changed.push(Array.from(v).length > 40 ? `${col}=${pySlice(v, 0, 40)}` : `${col}=${v}`);
      }
    }
    if (a["is_multi_location"] !== null) {
      set("is_multi_location = ?", a["is_multi_location"] === "true" ? 1 : 0);
      changed.push(`is_multi_location=${str("is_multi_location")}`);
    }
    for (const k of ["office_lat", "office_lon"]) {
      if (a[k] !== null) {
        set(`${k} = ?`, num(k));
        changed.push(`${k}=${pyFloatRepr(num(k))}`);
      }
    }
    if (a["office_address"] !== null) {
      if (a["office_address"] === "") {
        set("office_address = NULL");
        changed.push("office_address=NULL");
      } else {
        set("office_address = ?", str("office_address"));
        changed.push(`office_address=${pySlice(str("office_address"), 0, 40)}`);
      }
    }
    for (const k of ["office_geocoded", "office_verified"]) {
      if (a[k] !== null) {
        set(`${k} = ?`, a[k] === "true" ? 1 : 0);
        changed.push(`${k}=${str(k)}`);
      }
    }
    // The geocoding request and its result land in one transaction.
    if (action === "geocode" && a["office_geocoded"] !== null) {
      set("geocode_requested = 0");
      set("geocode_requested_at = NULL");
      changed.push("geocode_requested=acknowledged");
    }
    if (a["expires_at"] !== null) {
      if (a["expires_at"] === "") {
        set("expires_at = NULL");
        changed.push("expires_at=NULL");
      } else {
        set("expires_at = ?", str("expires_at"));
        changed.push(`expires_at=${str("expires_at")}`);
      }
    }
    if (a["is_open"] !== null) {
      set("is_open = ?", a["is_open"] === "true" ? 1 : 0);
      changed.push(`is_open=${str("is_open")}`);
    }
    if (pyTruthy(a["last_open_check"])) {
      if (a["last_open_check"] === "now") set("last_open_check = datetime('now', 'localtime')");
      else set("last_open_check = ?", str("last_open_check"));
      changed.push(`last_open_check=${str("last_open_check")}`);
    }
    // [RECHECK-MUST-UPDATE-LAST-CHECKED]: whoever wrote the liveness looked at the ad.
    if ((a["is_open"] !== null || pyTruthy(a["last_open_check"])) && !pyTruthy(a["last_checked"])) {
      if (pyTruthy(a["last_open_check"]) && a["last_open_check"] !== "now") {
        set("last_checked = ?", str("last_open_check"));
        changed.push(`last_checked=${str("last_open_check")} (liveness)`);
      } else {
        set("last_checked = datetime('now', 'localtime')");
        changed.push("last_checked=now (liveness)");
      }
    }

    if (sets.length === 0) {
      db.exec("ROLLBACK");
      out.push("No fields to update.");
      return result(0);
    }
    set("last_actor = ?", actor);
    const where = guard ? `id = ? ${guard.where}` : "id = ?";
    const run = db.prepare(`UPDATE positions SET ${sets.join(", ")} WHERE ${where}`).run(...params, id, ...(guard?.params ?? []));
    if (Number(run.changes) === 0) {
      db.exec("ROLLBACK");
      out.push(`⚠\ufe0f  ERROR: no position found with id=${id}!`);
      return result(1);
    }
    if (pyTruthy(a["status"]) && previous !== a["status"]) {
      db.prepare("INSERT INTO position_state_transitions (position_id, from_state, to_state, by_agent, notes) VALUES (?, ?, ?, ?, ?)").run(
        id, previous, str("status"), actor, pyTruthy(a["notes"]) ? str("notes") : null,
      );
    }
    if (pyTruthy(action)) {
      try {
        const n = recordDiffs(db, "position", id, action!, diffs(before, snapshot(db, "positions", id, POSITION_TRACKED)), a, actor);
        changed.push(`[${action}] ${n} event(s)`);
      } catch (error) {
        if (!(error instanceof MaintenanceError)) throw error;
        db.exec("ROLLBACK");
        out.push(`⚠\ufe0f  WRITE ABORTED: ${error.message}`);
        return result(1);
      }
    }
    db.exec("COMMIT");
    out.push(`Position ${id} updated: ${changed.join(", ")}`);
    return result(0);
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Already closed.
    }
    throw error;
  }
}

/** `update_company`: prints the SET clauses it ran, and never checks that the name matched a row, as the Python. */
export function updateCompany(db: Database, a: Parsed, actor: string): ScriptResult {
  const name = a["name"] as string;
  const action = a["action"] as string | null;
  db.exec("BEGIN IMMEDIATE");
  try {
    const companyId = (db.prepare("SELECT id FROM companies WHERE name = ?").get(name) as { id: number } | undefined)?.id ?? null;
    const before = pyTruthy(action) && companyId ? snapshot(db, "companies", companyId, COMPANY_TRACKED) : new Map();
    const sets: string[] = [];
    const params: Value[] = [];
    for (const k of ["verdict", "red_flags", "culture_notes", "sector", "size", "glassdoor_rating", "analyzed_by", "hq_country", "website"]) {
      if (pyTruthy(a[k])) {
        sets.push(`${k} = ?`);
        params.push(a[k] as Value);
      }
    }
    if (sets.length === 0) {
      db.exec("ROLLBACK");
      return { stdout: "No fields to update.\n", exitCode: 0 };
    }
    db.prepare(`UPDATE companies SET ${sets.join(", ")} WHERE name = ?`).run(...params, name);
    if (pyTruthy(action) && companyId) {
      // The Python lets a closing check through here: companies have no closing write.
      recordDiffs(db, "company", companyId, action!, diffs(before, snapshot(db, "companies", companyId, COMPANY_TRACKED)), a, actor);
    }
    db.exec("COMMIT");
    return { stdout: `Company '${name}' updated: ${sets.join(", ")}\n`, exitCode: 0 };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Already closed.
    }
    throw error;
  }
}

/**
 * `update_application` for the fields the SCRITTORE writes (T25): the CV and
 * cover-letter paths, the Critic's rounds and the application's own status.
 *
 * Not ported, on purpose: the send and its outcome (`--applied`,
 * `--applied-at`, `--applied-via`, `--response`, `--response-at`,
 * `--interview-round`), which move `positions` too and belong to the person
 * and the Capitano (scrittore.md "DB boundaries"). Without them the script's
 * `marks_applied`/`marks_response` branches cannot arise; what stays is its
 * UPSERT, its refusal to replace the CV of an application already sent, and
 * the schema's own trigger, which clears the Critic's verdict when
 * `written_at` changes — the judgement was on the previous text (O-64).
 */
export function updateApplication(db: Database, a: Parsed, actor: string, checkpoint?: string): ScriptResult {
  const id = a["position_id"] as number;
  const sets: string[] = [];
  const params: Value[] = [];
  const set = (column: string, value: Value) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  // `written_by`: the agent the runtime runs, as `found_by` for the SCOUT (D-5), and only
  // where the writer's own fields move — a Critic's update never claims a CV it did not write.
  const writerFieldsChanged = ["written_at", "cv_path", "cl_path", "cv_pdf_path", "cl_pdf_path"].some((k) => pyTruthy(a[k]));
  if (writerFieldsChanged) set("written_by", actor);
  for (const column of ["status", "critic_verdict", "critic_notes", "reviewed_by"]) {
    if (pyTruthy(a[column])) set(column, a[column] as Value);
  }
  if (a["critic_score"] !== null && a["critic_score"] !== undefined) {
    set("critic_score", a["critic_score"] as Value);
    sets.push("critic_reviewed_at = datetime('now', 'localtime')");
  }
  if (a["critic_round"] !== null && a["critic_round"] !== undefined) set("critic_round", a["critic_round"] as Value);
  if (pyTruthy(a["written_at"])) {
    if (a["written_at"] === "now") sets.push("written_at = datetime('now', 'localtime')");
    else set("written_at", a["written_at"] as Value);
  }
  for (const column of ["cv_path", "cl_path", "cv_pdf_path", "cl_pdf_path"]) {
    if (pyTruthy(a[column])) set(column, a[column] as Value);
  }
  if (sets.length === 0) return { stdout: "No fields to update.\n", exitCode: 0 };

  // [JHT-CV-REWORK] The CV of an application that went out is what the employer has: a
  // later render must not replace it in the record. The send state is checked before the
  // call and bound into the UPDATE, for a send that lands in between.
  const guardsSentCv = pyTruthy(a["cv_pdf_path"]) || pyTruthy(a["cv_path"]);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (guardsSentCv) {
      const blocker = sentBlocker(db, id, checkpoint);
      if (blocker) {
        db.exec("ROLLBACK");
        return {
          stdout: "",
          stderr: `⚠️  CV UPDATE REJECTED (${blocker}): this application was sent or its send started, so its CV stays the one that went out.\n`,
          exitCode: 1,
        };
      }
    }
    let where = "position_id = ?";
    if (guardsSentCv) {
      where += " AND COALESCE(applied, 0) != 1";
      if (hasTable(db, "email_application_attempts")) {
        where +=
          " AND NOT EXISTS (SELECT 1 FROM email_application_attempts e WHERE e.position_id = applications.position_id AND e.state IN " +
          "('send_started', 'send_outcome_unknown', 'receipt_incomplete', 'sent'))";
      }
    }
    const changed = Number(db.prepare(`UPDATE applications SET ${sets.join(", ")} WHERE ${where}`).run(...params, id).changes);
    if (changed === 0) {
      const exists = db.prepare("SELECT 1 FROM applications WHERE position_id = ?").get(id) !== undefined;
      if (guardsSentCv && exists) {
        db.exec("ROLLBACK");
        return {
          stdout: "",
          stderr: "⚠️  CV UPDATE REJECTED (send_started): the send started while the CV was being recorded, so its CV stays the one that went out.\n",
          exitCode: 1,
        };
      }
      if (db.prepare("SELECT 1 FROM positions WHERE id = ?").get(id) === undefined) {
        db.exec("ROLLBACK");
        return { stdout: `⚠️  position_id=${id} does not exist in positions. Aborting INSERT.\n`, exitCode: 0 };
      }
      // The UPSERT of the script: the same fields, plus `written_at` defaulted to now.
      const columns = ["position_id"];
      const placeholders = ["?"];
      const values: Value[] = [id];
      let at = 0;
      for (const clause of sets) {
        const [column, rhs] = clause.split("=").map((part) => part.trim()) as [string, string];
        columns.push(column);
        if (rhs === "?") {
          placeholders.push("?");
          values.push(params[at++]!);
        } else {
          placeholders.push(clause.slice(clause.indexOf("=") + 1).trim());
        }
      }
      if (!columns.includes("written_at")) {
        columns.push("written_at");
        placeholders.push("datetime('now', 'localtime')");
      }
      db.prepare(`INSERT INTO applications (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`).run(...values);
      db.exec("COMMIT");
      return { stdout: `Application for position ${id} CREATED (initial INSERT).\n`, exitCode: 0 };
    }
    db.exec("COMMIT");
    return { stdout: `Application for position ${id} updated (${changed} row)\n`, exitCode: 0 };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Already closed.
    }
    throw error;
  }
}

/**
 * `application_rework.sent_blocker`: why this application's CV may not be
 * replaced, or "". The browser checkpoint it reads third is a file of the
 * TUI's send flow (`$JHT_HOME/…/<id>.json`); the harness sends nothing, and
 * the file, when a person's box has one, is read the same way: unreadable
 * counts as started, since it may hold a submit.
 */
function sentBlocker(db: Database, positionId: number, checkpoint?: string): string {
  const row = db.prepare("SELECT applied FROM applications WHERE position_id = ?").get(positionId) as { applied: unknown } | undefined;
  if (row && (row.applied === 1 || row.applied === true)) return "already_sent";
  if (hasTable(db, "email_application_attempts")) {
    const attempt = db
      .prepare(
        "SELECT state FROM email_application_attempts WHERE position_id = ? AND state IN " +
          "('send_started', 'send_outcome_unknown', 'receipt_incomplete', 'sent') ORDER BY id DESC LIMIT 1",
      )
      .get(positionId) as { state: string } | undefined;
    if (attempt) return "send_started";
  }
  if (checkpoint !== undefined && submitStarted(checkpoint)) return "submit_started";
  return "";
}

/** `_browser_submit_started`: a checkpoint that holds a submit, or that cannot be read at all. */
function submitStarted(path: string): boolean {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return true;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return true;
  const row = data as Record<string, unknown>;
  return pyTruthy(row["submit_started"]) || pyTruthy(row["receipt"]);
}

const hasTable = (db: Database, name: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
