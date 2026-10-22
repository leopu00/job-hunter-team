// The census of the web's write routes (JHT-T46 family). Pure: it reads source text, nothing else, so a
// test can run it on the real tree and on synthetic routes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
export type WriteMethod = (typeof WRITE_METHODS)[number];

/** The guards that keep a write to the desktop, the local box or a local machine. */
export const WRITE_GUARDS = [
  "requireLocalWrite",
  "requireDesktopWrite",
  "requireLocalMachine",
  "requireLocalSecretAccess",
  "blockIfRemote",
] as const;

/** The call that gates a write for the levels L2 and L3 (JHT web-capace): the action library. */
export const ACTION_GATES = ["requestAction"] as const;

const guardPattern = (names: readonly string[]) => new RegExp(`\\b(${names.join("|")})\\(`);

/**
 * What must not happen before the guard: reading the body, resolving the user against the database,
 * touching a table, running a process, writing a file, calling out, queueing a command. Answering a
 * static reply (the demo) or checking the session is allowed before it.
 */
const EFFECT =
  /\.(json|text|formData|arrayBuffer)\(\)|\bresolveUser\(|\.from\(\s*["'`]|\brunBash\(|\bexecFile|\bspawn\(|\bwriteFile|\benqueueIfRemote\(|\bfetch\(|\.rpc\(|\blocalFirstWrite\(/;

export type HandlerState = "guard-first" | "guard-late" | "unguarded";

export interface HandlerReport {
  method: WriteMethod;
  state: HandlerState;
}

function handlerStart(source: string, method: string): number {
  const match =
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).exec(source) ??
    new RegExp(`export\\s+const\\s+${method}\\b`).exec(source);
  return match ? match.index : -1;
}

/** The text of a handler: from its start to the next export, or to the next function when it is a helper. */
function sliceFrom(source: string, start: number, pattern: RegExp): string {
  const rest = source.slice(start + 10);
  const next = pattern.exec(rest);
  return source.slice(start, next ? start + 10 + next.index : source.length);
}

/**
 * The write handlers of one route file. `helpers` names, per method, the local function the handler
 * delegates to: the guard is then looked for there (user-note and apply-request keep it in one helper).
 */
export function writeHandlers(
  source: string,
  helpers: Partial<Record<WriteMethod, string>> = {},
  gates: readonly string[] = WRITE_GUARDS,
): HandlerReport[] {
  const GUARD = guardPattern(gates);
  const out: HandlerReport[] = [];
  for (const method of WRITE_METHODS) {
    const start = handlerStart(source, method);
    if (start < 0) continue;
    let text = sliceFrom(source, start, /\nexport\s/);
    const helper = helpers[method];
    if (helper) {
      const at = new RegExp(`(?:async\\s+)?function\\s+${helper}\\b`).exec(source);
      if (!at) {
        out.push({ method, state: "unguarded" });
        continue;
      }
      text = sliceFrom(source, at.index, /\n(?:export\s+)?(?:async\s+)?function\s/);
    }
    const guard = GUARD.exec(text);
    const effect = EFFECT.exec(text);
    const state: HandlerState = !guard
      ? "unguarded"
      : effect && effect.index < guard.index
        ? "guard-late"
        : "guard-first";
    out.push({ method, state });
  }
  return out;
}

export interface RouteReport {
  /** Path under web/app/api, without `/route.ts`. */
  route: string;
  handlers: HandlerReport[];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : name === "route.ts" ? [path] : [];
  });
}

/** Every route of `apiDir` that exports a write method. */
export function censusOf(
  apiDir: string,
  helpersOf: (route: string) => Partial<Record<WriteMethod, string>> = () => ({}),
): RouteReport[] {
  return walk(apiDir)
    .map((file) => {
      const route = relative(apiDir, file).replace(/\\/g, "/").replace(/\/?route\.ts$/, "");
      return { route, handlers: writeHandlers(readFileSync(file, "utf8"), helpersOf(route)) };
    })
    .filter((r) => r.handlers.length > 0)
    .sort((a, b) => a.route.localeCompare(b.route));
}
