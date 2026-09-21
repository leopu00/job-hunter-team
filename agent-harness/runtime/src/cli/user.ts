/**
 * `npm run user` — what the PERSON does, from the host (T28).
 *
 * The team has no way to ask itself for a CV, and should not: on a real box
 * `write_requested = 1` is a click on the dashboard or `/cv <id>` on Telegram.
 * A rehearsal without that command has to fake it — on 20/09 the request was
 * typed into the test database as an UPDATE by hand — and a run that needs a
 * human with an SQL client is not a rehearsal of anything.
 *
 *   npm run user -- cv <position-id>                  the person asks for a CV
 *   npm run user -- cv <position-id> --off            …and changes their mind
 *   npm run user -- cover-letter <position-id>        a letter for an application
 *
 * It prints the script's own JSON line and exits 0 on success, 1 on a refusal
 * (`shared/skills/write_request.py`), so a host script can read it.
 *
 * Where it writes, in order:
 *   JHT_HUB_URL + JHT_HUB_TEAM_TOKEN   through the hub, which during a live run
 *                                      is the only process holding jobs.db. The
 *                                      token is the host's: no role has it.
 *   JHT_API_DB (or <JHT_API_HOME>/db)  straight into the database, for a box
 *                                      with no hub running.
 */

import { homedir } from "node:os";
import { parseArgs } from "node:util";

import { jobsDbPath, openJobsDb } from "../db/jobs-db.ts";
import { requestWrite, type WriteRequestKind, type WriteRequestResult } from "../db/write-request.ts";
import { HUB_PATHS } from "../hub/protocol.ts";
import { resolveUserPath } from "../tools/paths.ts";

const COMMANDS: Record<string, WriteRequestKind> = { cv: "cv", "cover-letter": "cover_letter", cover_letter: "cover_letter" };

const { values, positionals } = parseArgs({
  options: { off: { type: "boolean", default: false }, help: { type: "boolean", default: false } },
  allowPositionals: true,
});

const usage = "usage: npm run user -- <cv|cover-letter> <position-id> [--off]";
if (values.help || positionals.length !== 2) {
  console.error(usage);
  process.exit(values.help ? 0 : 2);
}
const kind = COMMANDS[positionals[0]!];
const positionId = Number(positionals[1]);
if (kind === undefined || !Number.isInteger(positionId) || positionId <= 0) {
  console.error(usage);
  process.exit(2);
}
const mode = values.off ? "off" : "on";

const hubUrl = process.env["JHT_HUB_URL"]?.trim();
const teamToken = process.env["JHT_HUB_TEAM_TOKEN"]?.trim();
const result = hubUrl && teamToken ? await throughHub(hubUrl, teamToken) : here();

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);

/**
 * Straight into the database, the way the dashboard does on a person's own
 * box. The home is resolved here and not with `loadConfig`: this command
 * spends nothing and starts no role, and it must work in a box whose
 * provider settings would stop a run (a model set without `JHT_API_LIVE`).
 */
function here(): WriteRequestResult {
  const apiHome = resolveUserPath(process.env["JHT_API_HOME"]?.trim() || "~/.jht-api", process.cwd(), homedir());
  const db = openJobsDb(jobsDbPath(process.env, apiHome));
  try {
    return requestWrite(db, positionId, mode, kind!);
  } finally {
    db.close();
  }
}

/** Through the hub: during a live run it is the only process that opens jobs.db. */
async function throughHub(url: string, token: string): Promise<WriteRequestResult> {
  const response = await fetch(new URL(HUB_PATHS.userRequest, url), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ position_id: positionId, mode, kind }),
  });
  const body = (await response.json().catch(() => ({}))) as WriteRequestResult & { error?: string };
  if (!response.ok) return { ok: false, error: body.error ?? `the hub answered ${response.status}`, status_code: "HUB_ERROR" };
  return body;
}
