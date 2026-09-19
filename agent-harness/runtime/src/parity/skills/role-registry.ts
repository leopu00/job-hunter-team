/**
 * `role_registry.py promote` as a native tool (T14, analista.md step 8).
 *
 * The ANALISTA reads the `Other` pile (`db_query other-pile`), judges which
 * offers form a family, and promotes it: the name becomes an active category
 * of the registry, the chosen positions are tagged with it, and every active
 * category's support is recounted. The Python's SQL and output, `--dry-run`
 * included. `merge` is the Capitano's verdict and `pass` a legacy
 * diagnostic: both refused with the reason.
 *
 * One difference, on purpose: the registry is the local candidate's. The
 * script's `--user-id` would let a caller write another candidate's
 * categories; here it is accepted only when it names that same candidate.
 */

import { parseArgv, pyRepr, type CommandSpec } from "../../db/argv.ts";
import type { Database } from "../../db/jobs-db.ts";
import { PY_SPACE_CLASS, pyInt } from "../../db/py-format.ts";
import { refused, type ScriptResult } from "../../db/tools.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { argvTool } from "./argv-tool.ts";

const SENTINEL = "Other";
const SUBCOMMANDS = ["promote", "merge", "pass"];
const GLOBAL: CommandSpec = {
  prog: "role_registry.py",
  options: [{ flag: "--user-id", default: null }, { flag: "--dry-run", storeTrue: true }],
};
const PROMOTE: CommandSpec = {
  prog: "role_registry.py promote",
  mainProg: "role_registry.py",
  options: [{ flag: "--name", required: true }, { flag: "--ids", required: true }],
};
const STRIP = new RegExp(`^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`, "gu");

/** `ValueError` escaping the script: a traceback whose last line is this, exit 1. */
const valueError = (message: string): ScriptResult => ({ stdout: "", stderr: `ValueError: ${message}\n`, exitCode: 1 });

export function roleRegistry(db: () => Database, userId: string, argv: string[]): ScriptResult {
  // The global options come before the subcommand, as argparse reads them.
  let at = 0;
  while (at < argv.length && argv[at]!.startsWith("-")) {
    const word = argv[at]!;
    // `--user-id X` (or a prefix of it, `--u X`) takes the next word; `--user-id=X` and `--dry-run` do not.
    const takesValue = !word.includes("=") && word.length >= 3 && "--user-id".startsWith(word);
    at += takesValue ? 2 : 1;
  }
  const g = parseArgv(GLOBAL, argv.slice(0, at));
  const sub = argv[at];
  if (sub === undefined) {
    return { stdout: "usage: role_registry.py [-h] [--user-id USER_ID] [--dry-run] {promote,merge,pass} ...\n", exitCode: 0 };
  }
  if (!SUBCOMMANDS.includes(sub)) {
    return {
      stdout: "",
      stderr: `usage: role_registry.py [-h] ...\nrole_registry.py: error: argument cmd: invalid choice: ${pyRepr(sub)} (choose from ${SUBCOMMANDS.map((c) => `'${c}'`).join(", ")})\n`,
      exitCode: 2,
    };
  }
  if (sub !== "promote") return refused("role_registry", sub, ["promote"]);
  const a = parseArgv(PROMOTE, argv.slice(at + 1));
  const uid = (g["user_id"] as string | null) || userId;
  if (uid !== userId) {
    return { stdout: "", stderr: `--user-id ${uid}: this agent works on the local candidate's registry (${userId}) only.\n`, exitCode: 1 };
  }
  const apply = !g["dry_run"];

  const name = (a["name"] as string).replace(STRIP, "");
  if (!name) return valueError("category name is empty");
  if (name === SENTINEL) return valueError(`'${SENTINEL}' is the holding category, not a family: choose a real name`);
  const ids: number[] = [];
  for (const token of (a["ids"] as string).replaceAll(",", " ").split(new RegExp(`[${PY_SPACE_CLASS}]+`, "u"))) {
    if (!token) continue;
    const n = pyInt(token);
    if (n === null) return valueError(`invalid literal for int() with base 10: ${pyRepr(token)}`);
    ids.push(n);
  }
  if (ids.length === 0) return valueError("no member IDs: a family must come from a cluster");

  const conn = db();
  if (apply) {
    conn.exec("BEGIN IMMEDIATE");
    try {
      conn
        .prepare(
          "INSERT INTO role_family_registry (user_id, name, status, support_count, promoted_at, created_at) " +
            "VALUES (?, ?, 'active', ?, datetime('now','localtime'), datetime('now','localtime')) " +
            "ON CONFLICT(user_id, name) DO UPDATE SET status = 'active', promoted_at = COALESCE(role_family_registry.promoted_at, excluded.promoted_at)",
        )
        .run(uid, name, ids.length);
      conn.prepare(`UPDATE positions SET role_family = ?, role_family_proposed = NULL WHERE id IN (${ids.map(() => "?").join(",")})`).run(name, ...ids);
      // recompute_support: each active category counts the positions tagged with it.
      const names = conn.prepare("SELECT name FROM role_family_registry WHERE user_id = ? AND status = 'active'").all(uid) as Array<{ name: string }>;
      for (const { name: n } of names) {
        const count = Number((conn.prepare("SELECT COUNT(*) AS n FROM positions WHERE role_family = ?").get(n) as { n: number }).n);
        conn.prepare("UPDATE role_family_registry SET support_count = ? WHERE user_id = ? AND name = ?").run(count, uid, n);
      }
      conn.exec("COMMIT");
    } catch (error) {
      conn.exec("ROLLBACK");
      throw error;
    }
  }
  const active = conn
    .prepare("SELECT name, support_count FROM role_family_registry WHERE user_id = ? AND status = 'active' ORDER BY support_count DESC, name ASC")
    .all(uid) as Array<{ name: string; support_count: number }>;
  const tuples = active.map((r) => `(${pyRepr(r.name)}, ${r.support_count})`).join(", ");
  return { stdout: `${apply ? "" : "[DRY-RUN] "}promote '${name}' ← ${ids.length} positions\nactive: [${tuples}]\n`, exitCode: 0 };
}

export function createRoleRegistryTool(options: { db: () => Database; userId?: string }): ToolHandler {
  return argvTool({
    name: "role_registry",
    script: "role_registry.py",
    description: "Promote a family you judged from the Other pile: promote --name \"<family>\" --ids <id,id,...> (--dry-run first to preview).",
    run: (args) => roleRegistry(options.db, options.userId ?? "local", args),
  });
}
