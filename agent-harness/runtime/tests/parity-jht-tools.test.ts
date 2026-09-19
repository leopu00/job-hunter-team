import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createJhtTools,
  FileMailbox,
  FileNotifier,
  FileUserReplies,
  guardShellTool,
  JHT_TOOL_NAMES,
  PauseRequest,
  replacedCommand,
} from "../src/parity/jht-tools.ts";
import type { ToolContext, ToolHandler } from "../src/tools/registry.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-tools-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// The tools here never look at the context; the loop's own tests cover it.
const context = {} as ToolContext;

function toolkit() {
  const pause = new PauseRequest();
  const mailbox = new FileMailbox(join(root, "mailbox"));
  const tools = createJhtTools({
    agent: "SCOUT-1",
    homeDir: join(root, "agents", "scout-1"),
    mailbox,
    notifier: new FileNotifier(join(root, "notify.jsonl")),
    replies: new FileUserReplies(join(root, "replies")),
    pause,
    now: () => 1_700_000_000_000,
  });
  const byName = (name: string) => {
    const tool = tools.find((t) => t.spec.name === name);
    if (!tool) throw new Error(`no ${name}`);
    return {
      tool,
      run: (args: unknown) => tool.execute(tool.spec.schema.parse(args), context),
      valid: (args: unknown) => tool.spec.schema.safeParse(args).success,
    };
  };
  return { tools, pause, mailbox, byName };
}

describe("createJhtTools", () => {
  it("exposes the advertised names and asks no permission for any", () => {
    const { tools } = toolkit();
    expect(tools.map((t) => t.spec.name)).toEqual([...JHT_TOOL_NAMES]);
    for (const tool of tools) expect(tool.classify({ to: "x", text: "y" }).risk).toBe("none");
  });

  it("send_message lands in the peer's inbox, once", async () => {
    const { byName, mailbox } = toolkit();
    const send = byName("send_message");

    const result = await send.run({ to: "CAPITANO", text: "[@scout-1 -> @capitano] [RES] 3 new" });
    expect(result).toEqual({ ok: true, content: "Delivered to capitano." });

    expect(await mailbox.drain("capitano")).toEqual([
      { from: "scout-1", to: "capitano", text: "[@scout-1 -> @capitano] [RES] 3 new", ts: 1_700_000_000_000 },
    ]);
    expect(await mailbox.drain("capitano")).toEqual([]);
  });

  it("send_message refuses a path for a name and a message to itself", async () => {
    const { byName } = toolkit();
    const send = byName("send_message");
    expect(send.valid({ to: "../../etc/passwd", text: "x" })).toBe(false);
    expect(send.valid({ to: "a/b", text: "x" })).toBe(false);
    expect((await send.run({ to: "scout-1", text: "x" })).ok).toBe(false);
  });

  it("chat_reply writes jht-send's line to the agent's chat.jsonl", async () => {
    const { byName } = toolkit();
    await byName("chat_reply").run({ text: "working on it", partial: true });
    await byName("chat_reply").run({ text: "done" });

    const lines = (await readFile(join(root, "agents", "scout-1", "chat.jsonl"), "utf8")).trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { role: "assistant", text: "working on it", ts: 1_700_000_000, done: false },
      { role: "assistant", text: "done", ts: 1_700_000_000, done: true },
    ]);
  });

  it("throttle raises the pause for the loop and tells the model to stop", async () => {
    const { byName, pause } = toolkit();
    expect(pause.requested).toBe(false);
    const result = await byName("throttle").run({ reason: "batch done" });
    expect(result.content).toMatch(/End your turn now/);
    expect(pause.requested).toBe(true);
    expect(pause.reason).toBe("batch done");
    pause.clear();
    expect(pause.requested).toBe(false);
  });

  it("notify_user queues the notification with its kind", async () => {
    const { byName } = toolkit();
    await byName("notify_user").run({ text: "10 offers above 75", kind: "digest", position_id: 42 });
    expect(JSON.parse(await readFile(join(root, "notify.jsonl"), "utf8"))).toEqual({
      from: "scout-1",
      kind: "digest",
      text: "10 offers above 75",
      positionId: 42,
      ts: 1_700_000_000_000,
    });
  });

  it("check_user_replies hands each reply out once, in the TUI tool's format", async () => {
    const { byName } = toolkit();
    const check = byName("check_user_replies");
    expect((await check.run({})).content).toBe("No new replies.");

    await mkdir(join(root, "replies"), { recursive: true });
    await writeFile(
      join(root, "replies", "scout-1.jsonl"),
      JSON.stringify({ id: "42", text: "short CV please", inReplyTo: "Which CV?" }) + "\n{torn\n",
    );
    const first = await check.run({});
    expect(first.content).toBe('[USER REPLY via WEB — id=42] short CV please\n    ↳ in reply to: "Which CV?"');
    expect((await check.run({})).content).toBe("No new replies.");
  });
});

describe("guardShellTool", () => {
  const ran: string[] = [];
  const shell: ToolHandler = {
    spec: { name: "bash", description: "", schema: {} as ToolHandler["spec"]["schema"] },
    classify: () => ({ risk: "execute", paths: [], summary: "" }),
    async execute(args) {
      ran.push((args as { command: string }).command);
      return { ok: true, content: "ran" };
    },
  };
  const guarded = guardShellTool(shell, (args) => (args as { command: string }).command);

  it("answers a TUI command with the tool that replaces it and runs nothing", async () => {
    ran.length = 0;
    const result = await guarded.execute({ command: 'jht-tmux-send CAPITANO "[@scout-1 -> @capitano] hi"' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("`send_message`");

    const ack = await guarded.execute({ command: "throttle-ack scout-1" }, context);
    expect(ack.content).toContain("not needed");
    expect(ran).toEqual([]);
  });

  it("lets every other command through", async () => {
    ran.length = 0;
    const result = await guarded.execute({ command: "python3 /app/shared/skills/db_query.py positions" }, context);
    expect(result).toEqual({ ok: true, content: "ran" });
    expect(ran).toEqual(["python3 /app/shared/skills/db_query.py positions"]);
  });
});

describe("replacedCommand", () => {
  it("finds a TUI command at any command position, by bare name or path", () => {
    expect(replacedCommand("throttle scout-1")).toBe("throttle");
    expect(replacedCommand("jht-throttle-check scout-1 || jht-throttle-wait scout-1")).toBe("jht-throttle-check");
    expect(replacedCommand("cd /tmp && /app/agents/_tools/jht-send 'hi'")).toBe("jht-send");
    expect(replacedCommand("echo x | jht-telegram-send --from capitano")).toBe("jht-telegram-send");
    expect(replacedCommand("out=$(jht-check-user-replies --agent scout-1)")).toBe("jht-check-user-replies");
    expect(replacedCommand("  throttle-ack scout-1")).toBe("throttle-ack");
  });

  it("ignores the names inside arguments and longer names", () => {
    expect(replacedCommand("grep throttle scout.md")).toBeNull();
    expect(replacedCommand("echo 'use jht-send later'")).toBeNull();
    expect(replacedCommand("throttle-set scout 600")).toBeNull();
    expect(replacedCommand("python3 throttle_engine.py check")).toBeNull();
  });
});
