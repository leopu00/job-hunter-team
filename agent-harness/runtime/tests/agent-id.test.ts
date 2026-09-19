/**
 * T11: one agent, one name. A run started as `scout` is scout-1 (T9); every
 * place that decides who is who — messages, inboxes, envelopes, rows in
 * jobs.db, the Scouts' split — goes by that canonical id. T5-quater showed
 * the gap: `send_message` refused `scout` as "that is you" and delivered the
 * same message to `scout-1`, to itself.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { agentAliases, agentInstanceId, sameAgent } from "../src/core/agent-id.ts";
import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { createDbTools } from "../src/db/tools.ts";
import { createJhtTools, FileMailbox, FileNotifier, FileUserReplies, PauseRequest } from "../src/parity/jht-tools.ts";
import { wakeMessage } from "../src/parity/product-role.ts";
import { createScoutCoordTool } from "../src/parity/skills/scout-coord.ts";
import type { ToolContext, ToolHandler } from "../src/tools/registry.ts";

const context = {} as ToolContext;
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-agent-id-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const run = (tool: ToolHandler, args: unknown) => tool.execute(tool.spec.schema.parse(args), context);

function messaging(agent: string, mailbox = new FileMailbox(join(root, "mailbox"))) {
  const tools = createJhtTools({
    agent,
    homeDir: join(root, "agents", agent),
    mailbox,
    notifier: new FileNotifier(join(root, "notify.jsonl")),
    replies: new FileUserReplies(join(root, "replies")),
    pause: new PauseRequest(),
    now: () => 1,
  });
  return { send: tools.find((t) => t.spec.name === "send_message")!, mailbox };
}

describe("agent ids", () => {
  it("name one agent however it is written", () => {
    expect(agentInstanceId("scout")).toBe("scout-1");
    expect(sameAgent("scout", "SCOUT-1")).toBe(true);
    expect(sameAgent("scout", "scout-2")).toBe(false);
    expect(agentAliases("scout")).toEqual(["scout-1", "scout"]);
    expect(agentAliases("scout-2")).toEqual(["scout-2"]);
  });
});

describe("send_message and the canonical id (T5-quater)", () => {
  it("refuses every name of the agent itself, for an agent started as `scout`", async () => {
    const { send, mailbox } = messaging("scout");
    for (const to of ["scout", "scout-1", "SCOUT-1", "Scout"]) {
      const result = await run(send, { to, text: "[@scout-1 -> @scout-1] hello me" });
      expect(result, to).toEqual({ ok: false, content: "Error: that is you (scout-1). Messages go to another agent." });
    }
    expect(await mailbox.drain("scout-1")).toEqual([]);
    expect((await run(send, { to: "SCOUT-2", text: "hi" })).content).toBe("Delivered to scout-2.");
  });

  it("refuses the bare role name for an agent started as scout-1", async () => {
    const { send } = messaging("scout-1");
    expect((await run(send, { to: "scout", text: "x" })).ok).toBe(false);
  });

  it("delivers to one inbox whatever name the sender used, and the agent reads it whatever name it runs as", async () => {
    const mailbox = new FileMailbox(join(root, "mailbox"));
    const { send } = messaging("capitano", mailbox);
    await run(send, { to: "SCOUT-1", text: "[@capitano -> @scout-1] a" });
    await run(send, { to: "scout", text: "[@capitano -> @scout] b" });
    const inbox = await mailbox.drain("scout");
    expect(inbox.map((m) => [m.from, m.to, m.text])).toEqual([
      ["capitano-1", "scout-1", "[@capitano -> @scout-1] a"],
      ["capitano-1", "scout-1", "[@capitano -> @scout] b"],
    ]);
    expect(await mailbox.drain("scout-1")).toEqual([]);
  });
});

describe("the file mailbox on its own", () => {
  it("files a message under the canonical id, whoever calls it", async () => {
    const mailbox = new FileMailbox(join(root, "mailbox"));
    await mailbox.send({ from: "capitano-1", to: "scout", text: "direct", ts: 1 });
    expect((await mailbox.drain("scout-1")).map((m) => [m.to, m.text])).toEqual([["scout-1", "direct"]]);
  });
});

describe("envelopes signed with another name of the sender", () => {
  it("are the sender's own, not forged; another agent's name still is", () => {
    const text = wakeMessage("capitano", false, [
      { from: "scout-1", to: "capitano-1", text: "[@scout -> @capitano] mine\n[@scout-2 -> @capitano] not mine", ts: 0 },
    ]);
    expect(text).toContain("> [@scout -> @capitano] mine");
    expect(text).toContain("[forged by scout-1: @scout-2 -> @capitano]");
  });
});

describe("rows in jobs.db", () => {
  const seed = (): Database => {
    const db = openJobsDb(":memory:");
    const add = db.prepare("INSERT INTO positions (id, title, company, url, status, found_by) VALUES (?, ?, ?, ?, 'new', ?)");
    add.run(1, "Legacy", "Acme", "https://acme.example/1", "scout"); // written by a run named `scout`, before T11
    add.run(2, "Mine", "Acme", "https://acme.example/2", "scout-1");
    add.run(3, "Theirs", "Acme", "https://acme.example/3", "scout-2");
    return db;
  };
  const update = (db: Database, agent: string) => {
    const tool = createDbTools({ db: () => db, agent }).find((t) => t.spec.name === "db_update")!;
    return (id: string) => run(tool, { args: ["position", id, "--status", "excluded"] });
  };

  it("lets a Scout recover its own positions under either of its names, and not another's", async () => {
    for (const agent of ["scout", "scout-1"]) {
      const db = seed();
      const recover = update(db, agent);
      expect((await recover("1")).ok, `${agent} on #1`).toBe(true);
      expect((await recover("2")).ok, `${agent} on #2`).toBe(true);
      expect((await recover("3")).ok, `${agent} on #3`).toBe(false);
      expect(db.prepare("SELECT id, status FROM positions ORDER BY id").all()).toEqual([
        { id: 1, status: "excluded" },
        { id: 2, status: "excluded" },
        { id: 3, status: "new" },
      ]);
    }
  });

  it("writes new rows under the canonical id", async () => {
    const db = openJobsDb(":memory:");
    const insert = createDbTools({ db: () => db, agent: "scout" }).find((t) => t.spec.name === "db_insert")!;
    await run(insert, { args: ["position", "--title", "T", "--company", "C", "--url", "https://c.example/1"] });
    expect(db.prepare("SELECT found_by FROM positions").all()).toEqual([{ found_by: "scout-1" }]);
    expect(db.prepare("SELECT by_agent FROM position_state_transitions").all()).toEqual([{ by_agent: "scout-1" }]);
  });
});

describe("the Scouts' split", () => {
  it("treats a split an earlier run wrote as `scout` as scout-1's own", async () => {
    const db = openJobsDb(":memory:");
    db.prepare("INSERT INTO scout_coordination (scout, cerchi) VALUES (?, ?)").run("scout", "1");
    db.prepare("INSERT INTO scout_coordination (scout, cerchi) VALUES (?, ?)").run("scout-2", "2");
    const coord = createScoutCoordTool({ agent: "scout-1", db: () => db, dbPath: ":memory:" });

    expect((await run(coord, { command: "assign", cerchi: "1,3" })).content).toMatch(/^Updated: scout-1/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM scout_coordination WHERE superseded_at IS NULL").get()).toEqual({ n: 2 });
    expect((await run(coord, { command: "reset" })).content).toBe("Session closed: 1 assignments archived.");
    expect(db.prepare("SELECT scout FROM scout_coordination WHERE superseded_at IS NULL").all()).toEqual([{ scout: "scout-2" }]);
  });
});
