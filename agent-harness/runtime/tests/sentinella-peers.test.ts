/**
 * T37: the SENTINELLA writes to the CAPITANO, and to nobody else.
 *
 * Its prompt opens with RULE #0 — "DO NOT talk to other agents except the
 * Capitano" — and its `spawn-doctor` skill adds the one exception, the DOTTORE
 * it may raise when an agent stops consuming mid-window. In the TUI that rule
 * is a sentence and nothing else: every agent reaches every pane through the
 * same wrapper. Here it is a fence, because this is the role that would be
 * believed if it ordered the team around: it carries numbers nobody else has,
 * and its whole job is to advise the one agent who decides.
 *
 * What the tests below hold: the two allowed peers go through, a third name is
 * refused with a sentence the model can report, nothing reaches the mailbox
 * when it is refused, and every other role is untouched — the fence is a
 * per-role table, not a new rule for the team.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createJhtTools, FileMailbox, FileNotifier, FileUserReplies, PauseRequest } from "../src/parity/jht-tools.ts";
import { allowedPeers, peerRefusal } from "../src/parity/peers.ts";
import type { ToolContext, ToolHandler } from "../src/tools/registry.ts";

const context = {} as ToolContext;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-peers-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sender(agent: string): { send: ToolHandler; mailbox: FileMailbox } {
  const mailbox = new FileMailbox(join(root, "mailbox"));
  const tools = createJhtTools({
    agent,
    homeDir: join(root, "agents", agent.toLowerCase()),
    mailbox,
    notifier: new FileNotifier(join(root, "notify.jsonl")),
    replies: new FileUserReplies(join(root, "replies")),
    pause: new PauseRequest(),
    now: () => 1_700_000_000_000,
  });
  return { send: tools.find((t) => t.spec.name === "send_message")!, mailbox };
}

const say = (tool: ToolHandler, to: string) => tool.execute(tool.spec.schema.parse({ to, text: `[@sentinella -> @${to}] [INFO] usage 41%` }), context);

describe("the SENTINELLA's peers (T37)", () => {
  it("delivers to the CAPITANO and to the DOTTORE it may raise", async () => {
    const { send, mailbox } = sender("sentinella");
    expect(await say(send, "CAPITANO")).toMatchObject({ ok: true });
    expect(await say(send, "dottore-1")).toMatchObject({ ok: true });
    expect((await mailbox.drain("capitano-1")).map((m) => m.from)).toEqual(["sentinella-1"]);
    expect((await mailbox.drain("dottore-1")).map((m) => m.from)).toEqual(["sentinella-1"]);
  });

  it("refuses any other agent, says why, and sends nothing", async () => {
    const { send, mailbox } = sender("sentinella");
    const refused = await say(send, "scout-2");
    expect(refused.ok).toBe(false);
    // The refusal is for a model to act on: the rule, the name, and what to do instead.
    expect(refused.content).toContain("RULE #0");
    expect(refused.content).toContain("scout-2");
    expect(refused.content).toMatch(/Nothing was sent/);
    expect(refused.content).toMatch(/through the CAPITANO/);
    expect(await mailbox.drain("scout-2")).toEqual([]);
    // Not even to the person's other coordinators, and not to itself by another name.
    for (const name of ["scrittore-1", "assistente-1", "mantenitore-1"]) {
      expect(await say(send, name)).toMatchObject({ ok: false });
      expect(await mailbox.drain(name)).toEqual([]);
    }
  });

  it("tells the SENTINELLA in the tool's own description who it may write to", () => {
    const { send } = sender("sentinella");
    expect(send.spec.description).toContain("CAPITANO and to the DOTTORE");
    expect(send.spec.description).toMatch(/refused/);
    // A model that meets a fence it was never shown learns nothing from it.
    const { send: scoutSend } = sender("scout-1");
    expect(scoutSend.spec.description).toContain("CAPITANO or SCOUT-2");
    expect(scoutSend.spec.description).not.toMatch(/nobody else/);
  });

  it("leaves every other role as it was: the table is per role, not a new team rule", async () => {
    const { send, mailbox } = sender("scout-1");
    expect(await say(send, "capitano")).toMatchObject({ ok: true });
    expect(await say(send, "analista-1")).toMatchObject({ ok: true });
    expect((await mailbox.drain("analista-1")).length).toBe(1);
    expect(allowedPeers("scout-1")).toBeNull();
    expect(peerRefusal("scout-1", "whoever-1")).toBeNull();
  });

  it("the numbered instances of the two peers are the same peers", () => {
    expect(peerRefusal("sentinella-1", "capitano")).toBeNull();
    expect(peerRefusal("sentinella-1", "capitano-1")).toBeNull();
    expect(peerRefusal("sentinella-1", "dottore-2")).toBeNull();
    expect(peerRefusal("sentinella-2", "scorer-1")).not.toBeNull();
  });

  it("still refuses the message to itself before anything else", async () => {
    const { send } = sender("sentinella");
    const self = await say(send, "sentinella-1");
    expect(self.ok).toBe(false);
    expect(self.content).toContain("that is you");
  });
});

/**
 * T41, SICUREZZA P2: the DOTTORE's addressees, now that it revives nobody.
 *
 * In the TUI it writes to every session, and it must: it interviews each one
 * before recreating it. Here it interviews nobody, so the set it used to write
 * to does not exist — and a role that can still write to everyone is one more
 * channel into every model, kept open for a use that is gone (MASTER, 23/09).
 */
describe("the DOTTORE's peers (T41)", () => {
  const report = (tool: ToolHandler, to: string) =>
    tool.execute(tool.spec.schema.parse({ to, text: `[@dottore -> @${to}] [REPORT] scorer-1: window empty` }), context);

  it("delivers its report to the CAPITANO, whatever instance", async () => {
    const { send, mailbox } = sender("dottore");
    expect(await report(send, "capitano")).toMatchObject({ ok: true });
    expect(await report(send, "CAPITANO-1")).toMatchObject({ ok: true });
    // `dottore` with no number is `dottore-1`, as the launcher names a singleton.
    expect((await mailbox.drain("capitano-1")).map((m) => m.from)).toEqual(["dottore-1", "dottore-1"]);
  });

  it("refuses every other agent — the ones it used to revive included — and sends nothing", async () => {
    const { send, mailbox } = sender("dottore");
    for (const name of ["scout-1", "scorer-1", "analista-2", "scrittore-1", "sentinella-1", "assistente-1", "mentor-1"]) {
      const refused = await report(send, name);
      expect(refused.ok, name).toBe(false);
      expect(refused.content).toContain(name);
      expect(refused.content).toMatch(/Nothing was sent/);
      expect(refused.content).toMatch(/through the CAPITANO/);
      expect(await mailbox.drain(name)).toEqual([]);
    }
  });

  it("is shown the fence in the tool's own description, not left to meet it", () => {
    const { send } = sender("dottore-1");
    expect(send.spec.description).toContain("CAPITANO");
    expect(allowedPeers("dottore-1")).toEqual(["capitano"]);
    expect(peerRefusal("dottore-1", "capitano-2")).toBeNull();
    expect(peerRefusal("dottore", "scout-1")).not.toBeNull();
  });
});

describe("the mailbox file after a refusal", () => {
  it("has no line at all: a refused message is not a delivered one", async () => {
    const { send } = sender("sentinella");
    await say(send, "scout-1");
    await expect(readFile(join(root, "mailbox", "scout-1.jsonl"), "utf8")).rejects.toThrow();
  });
});
