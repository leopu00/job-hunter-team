/**
 * `role_registry.py promote` as a native tool (T14, analista.md step 8).
 *
 * The ANALISTA reads the `Other` pile (`db_query other-pile`), judges which
 * offers form a family, and promotes it: the name becomes an active category
 * of the registry, the chosen positions are tagged with it, and every active
 * category's support is recounted. The Python's SQL and output, `--dry-run`
 * included. `merge` is the Capitano's verdict on near-duplicates (T21,
 * capitano.md C-17): the sources' positions pass to the destination, the
 * sources go dormant; the Capitano gets `merge` and the ANALISTA `promote`.
 * `pass` is a legacy diagnostic: refused with the reason.
 *
 * One difference, on purpose: the registry is the local candidate's. The
 * script's `--user-id` would let a caller write another candidate's
 * categories; here it is accepted only when it names that same candidate.
 */

import { ArgvError, parseArgv, pyRepr, type CommandSpec } from "../../db/argv.ts";
import type { Database } from "../../db/jobs-db.ts";
import { PY_SPACE_CLASS, pyInt } from "../../db/py-format.ts";
import { roleOf } from "../../db/role-policy.ts";
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
const MERGE: CommandSpec = {
  prog: "role_registry.py merge",
  mainProg: "role_registry.py",
  options: [{ flag: "--into", required: true }, { flag: "--sources", required: true }],
};
const STRIP = new RegExp(`^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`, "gu");

/** `ValueError` escaping the script: a traceback whose last line is this, exit 1. */
const valueError = (message: string): ScriptResult => ({ stdout: "", stderr: `ValueError: ${message}\n`, exitCode: 1 });

/** `recompute_support`: each active category counts the positions tagged with it. */
function recomputeSupport(conn: Database, uid: string): void {
  const names = conn.prepare("SELECT name FROM role_family_registry WHERE user_id = ? AND status = 'active'").all(uid) as Array<{ name: string }>;
  for (const { name: n } of names) {
    const count = Number((conn.prepare("SELECT COUNT(*) AS n FROM positions WHERE role_family = ?").get(n) as { n: number }).n);
    conn.prepare("UPDATE role_family_registry SET support_count = ? WHERE user_id = ? AND name = ?").run(count, uid, n);
  }
}

/** `active_categories(with_support=True)` as the script prints the list. */
function activeLine(conn: Database, uid: string): string {
  const active = conn
    .prepare("SELECT name, support_count FROM role_family_registry WHERE user_id = ? AND status = 'active' ORDER BY support_count DESC, name ASC")
    .all(uid) as Array<{ name: string; support_count: number }>;
  return `active: [${active.map((r) => `(${pyRepr(r.name)}, ${r.support_count})`).join(", ")}]`;
}

/** A word argparse reads as a flag rather than as a value. */
const isFlag = (w: string) => w.startsWith("-") && w !== "-" && !/^-\d+(\.\d+)?$/.test(w);

/**
 * `merge --into X --sources A B …`. `argv.ts` has no `nargs="+"`: the words
 * after `--sources` up to the next flag are taken out here, the rest parsed
 * as usual, so the errors stay argparse's.
 */
function parseMerge(words: string[]): { into: string; sources: string[] } {
  let sources: string[] | null = null;
  const rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const eq = w.indexOf("=");
    const name = eq >= 0 ? w.slice(0, eq) : w;
    if (name.length >= 3 && "--sources".startsWith(name)) {
      if (eq >= 0) {
        sources = [w.slice(eq + 1)];
      } else {
        const values: string[] = [];
        while (i + 1 < words.length && !isFlag(words[i + 1]!)) values.push(words[++i]!);
        if (!values.length) throw new ArgvError("usage: role_registry.py merge [-h] --into INTO --sources SOURCES [SOURCES ...]\nrole_registry.py merge: error: argument --sources: expected at least one argument");
        sources = values;
      }
      rest.push("--sources=");
    } else {
      rest.push(w);
    }
  }
  const a = parseArgv(MERGE, rest);
  return { into: a["into"] as string, sources: sources ?? [] };
}

export function roleRegistry(db: () => Database, userId: string, argv: string[], ours: readonly string[] = ["promote"]): ScriptResult {
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
  if (!ours.includes(sub)) return refused("role_registry", sub, [...ours]);
  const merge = sub === "merge" ? parseMerge(argv.slice(at + 1)) : null;
  const a = merge ? {} : parseArgv(PROMOTE, argv.slice(at + 1));
  const uid = (g["user_id"] as string | null) || userId;
  if (uid !== userId) {
    return { stdout: "", stderr: `--user-id ${uid}: this agent works on the local candidate's registry (${userId}) only.\n`, exitCode: 1 };
  }
  const apply = !g["dry_run"];
  if (merge) return mergeFamilies(db(), uid, merge.into, merge.sources, apply);

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
      recomputeSupport(conn, uid);
      conn.exec("COMMIT");
    } catch (error) {
      conn.exec("ROLLBACK");
      throw error;
    }
  }
  return { stdout: `${apply ? "" : "[DRY-RUN] "}promote '${name}' ← ${ids.length} positions\n${activeLine(conn, uid)}\n`, exitCode: 0 };
}

/** `merge_families`: the sources' positions to `into`, the sources dormant with `merged_into`. */
function mergeFamilies(conn: Database, uid: string, rawInto: string, rawSources: string[], apply: boolean): ScriptResult {
  const into = rawInto.replace(STRIP, "");
  if (!into) return valueError("merge: destination 'into' is empty");
  const sources = rawSources.map((x) => x.replace(STRIP, "")).filter((x) => x && x !== into);
  if (!sources.length) return valueError("merge: at least one source different from 'into' is required");
  if (apply) {
    conn.exec("BEGIN IMMEDIATE");
    try {
      conn
        .prepare(
          "INSERT INTO role_family_registry (user_id, name, status, support_count, promoted_at, created_at) " +
            "VALUES (?, ?, 'active', 0, datetime('now','localtime'), datetime('now','localtime')) ON CONFLICT(user_id, name) DO UPDATE SET status = 'active'",
        )
        .run(uid, into);
      for (const src of sources) {
        conn.prepare("UPDATE positions SET role_family = ? WHERE role_family = ?").run(into, src);
        conn.prepare("UPDATE role_family_registry SET status = 'dormant', merged_into = ? WHERE user_id = ? AND name = ?").run(into, uid, src);
      }
      recomputeSupport(conn, uid);
      conn.exec("COMMIT");
    } catch (error) {
      conn.exec("ROLLBACK");
      throw error;
    }
  }
  return {
    stdout: `${apply ? "" : "[DRY-RUN] "}merge [${sources.map(pyRepr).join(", ")}] → '${into}'\n${activeLine(conn, uid)}\n`,
    exitCode: 0,
  };
}

export function createRoleRegistryTool(options: { db: () => Database; userId?: string; agent?: string }): ToolHandler {
  const captain = options.agent !== undefined && roleOf(options.agent) === "capitano";
  return argvTool({
    name: "role_registry",
    script: "role_registry.py",
    description: captain
      ? "Merge near-duplicate categories on your verdict: --dry-run merge --into \"<family>\" --sources \"<A>\" \"<B>\" to preview, then without --dry-run."
      : "Promote a family you judged from the Other pile: promote --name \"<family>\" --ids <id,id,...> (--dry-run first to preview).",
    run: (args) => roleRegistry(options.db, options.userId ?? "local", args, captain ? ["merge"] : ["promote"]),
  });
}
