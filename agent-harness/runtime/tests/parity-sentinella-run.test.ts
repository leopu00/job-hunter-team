/**
 * T37: `npm run role -- --role sentinella` on the mock, as a person types it.
 *
 * The SENTINELLA wakes on a tick it must act on: it drains the verdicts no
 * pane received, reads whether the person has suspended the daily ceiling,
 * reaches for the freeze it knows from the TUI — a tmux command, answered
 * here with what the harness has instead — advises the CAPITANO with the
 * numbers, and is refused when it tries to tell the burning worker directly.
 *
 * Two things this run is here to prove, beyond "it starts": the database it
 * never touches is the same before and after, and the only message that left
 * the box went to the CAPITANO. This is the role that would be believed if it
 * gave orders — it carries numbers nobody else has.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb } from "../src/db/jobs-db.ts";
import { documentPaths, onDisk } from "../src/parity/prompt-paths.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-sentinella-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("npm run role -- --role sentinella (T37)", () => {
  it("drains the mailbox, reads the derogation, advises the CAPITANO and reaches nobody else", async () => {
    // A position and a score: the rows that must be exactly as they were afterwards.
    const db = openJobsDb(join(root, "api", "db", "jobs.db"));
    db.prepare("INSERT INTO positions (title, company, url, status, found_by) VALUES ('Backend Engineer', 'Acme', 'https://acme.example/1', 'scored', 'scout-1')").run();
    const before = db.prepare("SELECT id, title, status FROM positions ORDER BY id").all();
    db.close();

    const jhtHome = join(root, "jht");
    await mkdir(join(jhtHome, "logs"), { recursive: true });
    // One verdict the pacing bridge could not deliver, and no derogation flag at all.
    await writeFile(
      join(jhtHome, "logs", "bridge-mailbox.jsonl"),
      `${JSON.stringify({ ts: "2026-09-21T06:45:00Z", kind: "pacing", msg: "[BRIDGE PACING] 06:45 UTC agenti: scout-1=2.1%/h share 41% cadenza 0.15 VERDETTO: SFORO", delivered_via_tmux: false })}\n`,
    );

    const profileDir = join(root, "person-profile");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "candidate_profile.yml"), "target_role: Backend Engineer\ntimezone: Europe/Rome\n");
    const imageRoot = join(root, "image-app");
    await cp(join(RUNTIME, "..", "..", "agents"), join(imageRoot, "agents"), { recursive: true });

    const { stdout } = await run(
      process.execPath,
      ["--experimental-strip-types", "src/cli/run.ts", "--role", "sentinella", "--agent", "sentinella-1", "--turns", "2", "--pause-ms", "0", "--quiet"],
      {
        cwd: RUNTIME,
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: root,
          JHT_API_HOME: join(root, "api"),
          JHT_HOME: jhtHome,
          JHT_API_PROFILE_DIR: profileDir,
          JHT_API_APP_ROOT: imageRoot,
          JHT_API_PROVIDER: "mock",
          // The window the tick is computed against, declared as whoever
          // starts the run declares it (T37-3, MASTER's call).
          JHT_API_WINDOW_START: "2026-09-21T09:00:00Z",
          JHT_API_WINDOW_HOURS: "5",
          JHT_API_WINDOW_USD: "1",
        },
      },
    );
    expect(stdout.trim()).toMatch(/logs\/sentinella-1\/.+\.jsonl$/);
    const records = (await readFile(stdout.trim(), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
    const finished = records.filter((r) => r.type === "tool_finished");
    expect(finished.map((r) => [r["name"], r["outcome"]])).toEqual([
      ["read_file", "accepted"],
      ["bridge_mailbox", "accepted"],
      ["burn_intent", "accepted"],
      // The freeze is a tmux command: not a role's here, and the answer says so.
      ["bash", "failed"],
      ["send_message", "accepted"],
      // RULE #0: the worker that burns hears it from the CAPITANO, not from the watcher.
      ["send_message", "failed"],
      ["throttle", "accepted"],
      ["check_user_replies", "accepted"],
    ]);
    // T37-3: it was woken by a tick, not by a task — and the tick names what
    // no bridge here computes, so its absence is not read as calm.
    const woke = records.find((r) => r.type === "message_in")?.["text"] as string;
    expect(woke).toContain("[BRIDGE TICK]");
    expect(woke).toContain("src=harness.");
    expect(woke).toContain("missing=weekly,daily,cadenza");

    const results = finished.map((r) => String(r["result"]));
    expect(results[1]).toContain("VERDETTO: SFORO");
    expect(results[2]).toContain('"active": false');
    expect(results[2]).toContain('"state": "off"');
    // The WORDS of the refusal, not the name of the script: the name is in a
    // shell's own `command not found` too, which is how this assertion used to
    // pass while the call was really dying with 127 (VPS's mock run, 21/09).
    expect(results[3]).toContain("stopping the team is the hub's");
    expect(results[3]).toContain("Nothing was run");
    expect(results[3]).not.toMatch(/command not found|127/);
    expect(results[4]).toBe("Delivered to capitano-1.");
    expect(results[5]).toContain("RULE #0");
    expect(results[5]).toMatch(/Nothing was sent/);
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    // The cursor moved: the next turn does not re-read a verdict already acted on.
    expect((await readFile(join(jhtHome, "logs", "bridge-mailbox.cursor"), "utf8")).trim()).toMatch(/^\d+$/);

    // The mailbox only ever had the CAPITANO's line in it.
    const mailbox = join(root, "api", "channels", "mailbox");
    expect((await readdir(mailbox)).sort()).toEqual(["capitano-1.jsonl"]);
    const delivered = (await readFile(join(mailbox, "capitano-1.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { from: string; text: string });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.from).toBe("sentinella-1");
    expect(delivered[0]!.text).toContain("SFORO GIORNALIERO");

    // It advises; it does not write. The rows are the ones that were there.
    const after = openJobsDb(join(root, "api", "db", "jobs.db"));
    expect(after.prepare("SELECT id, title, status FROM positions ORDER BY id").all()).toEqual(before);
    expect(after.prepare("SELECT count(*) AS n FROM applications").get()).toEqual({ n: 0 });
    after.close();

    // The prompt is the product's, with the API harness's words for the scripts.
    const prompt = records.find((r) => r.type === "system_prompt")?.["text"] as string;
    const sentinellaMd = await readFile(join(RUNTIME, "..", "..", "agents", "sentinella", "sentinella.md"), "utf8");
    expect(prompt.slice(0, 200)).toBe(sentinellaMd.slice(0, 200));
    expect(prompt).toContain("burn_intent");
    const home = join(root, "api", "agents", "sentinella-1");
    const texts = [prompt];
    for (const f of (await readdir(home, { recursive: true })).filter((p) => p.endsWith(".md"))) texts.push(await readFile(join(home, f), "utf8"));
    for (const t of texts) {
      expect(t).not.toMatch(/python3/);
      expect(t).not.toMatch(/jht-throttle/);
      expect(t).not.toMatch(/(?:\$\{?JHT_HOME\}?|\/jht_home|~\/\.jht)\/profile/);
    }
    const referenced = [...new Set(texts.flatMap((t) => documentPaths(t, imageRoot, [home, profileDir])))];
    const optional = (p: string) => p.startsWith(`${profileDir}/`) && !p.endsWith("/candidate_profile.yml");
    expect(referenced.filter((p) => !optional(p) && !existsSync(onDisk(p, home)))).toEqual([]);
  });
});
