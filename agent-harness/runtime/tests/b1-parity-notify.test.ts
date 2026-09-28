/**
 * B1-T3 (banda/piani/B1-parita-ruoli.md): a message of a role to the person.
 *
 * In the TUI `jht-notify-user` writes it into `pending_user_messages`, which
 * the chat sync and `jht cloud push` carry to the web. The API roles wrote it
 * only into `channels/notify.jsonl`, and nothing read that file into the
 * database: the CAPITANO, MENTOR, ASSISTENTE and CLOSER of an API team spoke
 * to the person where the web does not look.
 *
 * The TUI side is the tool of this tree, run as the prompts run it, with a
 * `jht-telegram-send` that is not reached (the API has no Telegram: its
 * twin is the TUI's fallback to the web). The API side is the hub's
 * `/v1/notify`, with each role's token. `jobsdb_parity.py` does not read this
 * table, so the judge here is the strict one — every column, the agent by
 * its role, the clocks by their shape.
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb } from "../src/db/jobs-db.ts";
import { JobsDbNotifier } from "../src/db/user-messages.ts";
import { HUB_PATHS } from "../src/hub/protocol.ts";
import { createHub } from "../src/hub/server.ts";
import { createJhtTools, FileMailbox, FileNotifier, FileUserReplies, PauseRequest } from "../src/parity/jht-tools.ts";
import type { ToolContext } from "../src/tools/registry.ts";
import { pipelineSeed, PYTHON_SKILLS, strictDiff, twins, type Twins } from "./helpers/b1-twins.ts";
import { RUNTIME, runPython } from "./helpers/python-skills.ts";

const NOTIFY_USER = join(RUNTIME, "..", "..", "agents", "_tools", "jht-notify-user");
const TOKENS = new Map([
  ["k".repeat(40), "capitano-1"],
  ["m".repeat(40), "mentor-1"],
  ["a".repeat(40), "assistente-1"],
  ["c".repeat(40), "closer-1"],
]);
const tokenOf = (agent: string) => [...TOKENS].find(([, a]) => a === agent)![0];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-b1-notify-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A message as the prompts write it: who, the kind, the position if any, the text. */
type Message = [agent: string, kind: "notification" | "question" | "digest" | "alert", position: number | null, text: string];

const MESSAGES: Message[] = [
  ["capitano-1", "notification", null, "Trovate 3 offerte sopra 75/100. Top: Umbrella Platform Engineer (78)."],
  // The model writes paragraphs as `\n` in one string: the row gets the characters, as the TUI's.
  ["mentor-1", "digest", null, "Settimana 39:\\n\\n4 posizioni analizzate, 1 candidatura pronta."],
  ["assistente-1", "question", 4, "Per Umbrella preferisci il CV in italiano o in inglese?"],
  // CL-08 step 3: the round's single message, naming the key nothing supports.
  ["closer-1", "notification", 4, "Umbrella chiede la RAL attuale: nel profilo non c'è. Posizione saltata."],
];

/** The TUI's command, with a Telegram sender that fails: the fallback to the web. */
function tui(t: Twins, [agent, kind, position, text]: Message) {
  const bin = join(t.root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "jht-telegram-send"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(bin, "jht-telegram-send"), 0o755);
  const role = agent.replace(/-\d+$/, "");
  const argv = [NOTIFY_USER, "--agent", role, "--kind", kind, ...(position === null ? [] : ["--position-id", String(position)]), text];
  return runPython(PYTHON_SKILLS!, argv, { JHT_DB: t.tui, JHT_HOME: join(t.root, "tui-home"), PATH: `${bin}:${process.env["PATH"] ?? ""}` });
}

/** The hub of the API team on the twin database; `post` sends one role's message. */
async function hubOn(t: Twins, notifyLimit?: { max: number; windowMs: number }) {
  const server = createHub({
    ...(notifyLimit ? { notifyLimit } : {}),
    tokens: TOKENS,
    dbPath: t.api,
    channelsDir: join(t.root, "channels"),
    stateDir: join(t.root, "hub-state"),
    appRoot: join(RUNTIME, "..", ".."),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async ([agent, kind, position, text]: Message) => {
    const response = await fetch(`${url}${HUB_PATHS.notify}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenOf(agent)}`, "content-type": "application/json" },
      body: JSON.stringify({ kind, text, ...(position === null ? {} : { positionId: position }) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { post, close: () => new Promise<void>((done) => server.close(() => done())) };
}

const rows = (path: string) => {
  const db = openJobsDb(path);
  try {
    return db.prepare("SELECT agent, body, kind, related_position_id, delivered_via FROM pending_user_messages ORDER BY id").all();
  } finally {
    db.close();
  }
};

const record = (t: Twins) => {
  try {
    return readFileSync(join(t.root, "channels", "notify.jsonl"), "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

describe.skipIf(PYTHON_SKILLS === null)("B1-T3 · a role's message to the person, the same row on both sides", () => {
  it("writes into pending_user_messages what jht-notify-user writes, and keeps notify.jsonl as the record", async () => {
    const t = twins(root, pipelineSeed);
    const hub = await hubOn(t);
    try {
      for (const message of MESSAGES) {
        const py = tui(t, message);
        expect(py.status, py.stderr).toBe(0);
        expect(py.stdout).toMatch(/^\d+ via=web$/m);
        expect(await hub.post(message)).toEqual({ status: 200, body: {} });
      }
    } finally {
      await hub.close();
    }
    // Not two empty tables: four rows each side, the role as the agent, on the web.
    expect(rows(t.api)).toEqual([
      { agent: "capitano", body: MESSAGES[0]![3], kind: "notification", related_position_id: null, delivered_via: "web" },
      { agent: "mentor", body: "Settimana 39:\n\n4 posizioni analizzate, 1 candidatura pronta.", kind: "digest", related_position_id: null, delivered_via: "web" },
      { agent: "assistente", body: MESSAGES[2]![3], kind: "question", related_position_id: 4, delivered_via: "web" },
      { agent: "closer", body: MESSAGES[3]![3], kind: "notification", related_position_id: 4, delivered_via: "web" },
    ]);
    expect(strictDiff(t)).toEqual([]);
    expect(record(t)).toHaveLength(4);
  });

  it("refuses a position that does not exist on both sides, sends nothing, and spends no slot of the limit", async () => {
    const t = twins(root, pipelineSeed);
    // One message an hour: a refusal that took the slot would leave the real message a 429.
    const hub = await hubOn(t, { max: 1, windowMs: 60 * 60_000 });
    const ghost: Message = ["assistente-1", "question", 99, "Confermi la candidatura?"];
    try {
      expect(tui(t, ghost).status).toBe(2);
      const refused = await hub.post(ghost);
      expect(refused.status).toBe(400);
      expect(String(refused.body["error"])).toMatch(/Position 99 is not in jobs\.db/);
      expect(rows(t.api)).toEqual([]);
      expect(record(t)).toEqual([]);
      expect((await hub.post(["assistente-1", "question", 4, "Confermi la candidatura?"])).status).toBe(200);
      expect((await hub.post(["assistente-1", "question", 4, "E la lettera?"])).status).toBe(429);
    } finally {
      await hub.close();
    }
    expect(rows(t.tui)).toEqual([]);
    expect(rows(t.api)).toHaveLength(1);
    expect(record(t)).toHaveLength(1);
  });
});

describe("B1-T3 · without a hub, the role's notify_user writes the same row", () => {
  it("records the row before the file, and refuses an unknown position without touching either or spending the limit", async () => {
    const path = join(root, "jobs.db");
    const seeded = openJobsDb(path);
    pipelineSeed(seeded);
    seeded.close();
    let db: ReturnType<typeof openJobsDb> | undefined;
    const open = () => (db ??= openJobsDb(path));
    const tools = createJhtTools({
      agent: "capitano-1",
      homeDir: join(root, "agents", "capitano-1"),
      mailbox: new FileMailbox(join(root, "mailbox")),
      notifier: new JobsDbNotifier(open, new FileNotifier(join(root, "notify.jsonl"))),
      replies: new FileUserReplies(join(root, "replies")),
      pause: new PauseRequest(),
      notifyLimit: { max: 1, windowMs: 60 * 60_000 },
    });
    const notify = tools.find((tool) => tool.spec.name === "notify_user")!;
    const context = {} as ToolContext;
    try {
      // The refusal first: with one message an hour, it must leave the slot to the real one.
      await expect(notify.execute({ text: "Nessuna posizione.", position_id: 99 }, context)).rejects.toThrow(/Position 99/);
      expect((await notify.execute({ text: "Candidatura pronta.", position_id: 4 }, context)).ok).toBe(true);
      expect((await notify.execute({ text: "Ancora una.", position_id: 4 }, context)).ok).toBe(false);
      expect(open().prepare("SELECT agent, body, kind, related_position_id, delivered_via FROM pending_user_messages").all()).toEqual([
        { agent: "capitano", body: "Candidatura pronta.", kind: "notification", related_position_id: 4, delivered_via: "web" },
      ]);
      const lines = readFileSync(join(root, "notify.jsonl"), "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ from: "capitano-1", text: "Candidatura pronta.", positionId: 4 });
    } finally {
      db?.close();
    }
  });
});
