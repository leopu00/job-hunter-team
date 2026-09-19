import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MemoryAuditLog } from "../src/core/audit.ts";
import { DEFAULT_LIMITS, Guardrails } from "../src/core/guardrails.ts";
import { PermissionPolicy } from "../src/core/permissions.ts";
import { MockProvider, type ScriptedTurn } from "../src/core/provider/mock.ts";
import { RoleSession, type SessionEvent } from "../src/core/role-session.ts";
import type { ToolHandler } from "../src/tools/registry.ts";

const lookup: ToolHandler = {
  spec: { name: "lookup", description: "Looks up.", schema: z.object({ key: z.string() }).strict() },
  classify: () => ({ risk: "read", paths: [], summary: "lookup" }),
  execute: async (args) => ({ ok: true, content: `value of ${(args as { key: string }).key}` }),
};

function build(script: ScriptedTurn[], options: { maxSteps?: number } = {}) {
  const provider = new MockProvider(script);
  const audit = new MemoryAuditLog();
  const events: SessionEvent[] = [];
  const guardrails = new Guardrails({
    limits: { ...DEFAULT_LIMITS, ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}) },
    pricing: { inputPerMTokUsd: 0, outputPerMTokUsd: 0 },
  });
  const session = new RoleSession({
    provider,
    guardrails,
    audit,
    systemPrompt: "You are a test role.",
    tools: [lookup],
    permissions: new PermissionPolicy({ mode: "ask", freeReadRoots: [] }),
    subagents: true,
    todos: true,
    onEvent: (e) => events.push(e),
  });
  return { provider, audit, events, session };
}

describe("agent tool", () => {
  it("runs a subagent in a fresh context and hands back only its report", async () => {
    const { session, provider, events, audit } = build([
      { text: "", toolCalls: [{ name: "agent", args: { description: "find the key", prompt: "Look up the key 'zone' and report it." } }] },
      // The subagent's own rounds.
      { text: "", toolCalls: [{ name: "lookup", args: { key: "zone" } }] },
      { text: "The zone is Monteverde." },
      // Back in the main agent.
      { text: "Your notes say Monteverde." },
    ]);

    const turn = await session.send("Go.");
    expect(turn).toMatchObject({ text: "Your notes say Monteverde." });
    expect(turn.stats.rounds).toBe(4);

    const sub = provider.requests[1]!;
    expect(sub.system).toContain("You are a subagent of Job Hunter Team");
    expect(sub.messages).toEqual([{ role: "user", content: "Look up the key 'zone' and report it." }]);
    // No recursion and no todo list inside a subagent.
    expect(sub.tools?.map((t) => t.name)).toEqual(["lookup"]);

    const fed = provider.requests[3]!.messages.at(-1);
    expect(fed).toMatchObject({ role: "tool", name: "agent", content: "The zone is Monteverde." });

    expect(events).toContainEqual({ type: "agent_started", agent: "find the key", prompt: "Look up the key 'zone' and report it." });
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_started", name: "lookup", agent: "find the key" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "agent_finished", agent: "find the key", rounds: 2, ok: true }));
    expect(audit.events).toContainEqual({ type: "agent_finished", rounds: 2, ok: true });
  });

  it("reports a subagent that runs out of rounds as a failed call", async () => {
    const loop: ScriptedTurn = { text: "still looking", toolCalls: [{ name: "lookup", args: { key: "x" } }] };
    const script: ScriptedTurn[] = [
      { text: "", toolCalls: [{ name: "agent", args: { description: "loop forever", prompt: "Keep looking up keys." } }] },
      ...Array.from({ length: 30 }, () => loop),
      { text: "It did not finish." },
    ];
    const { session, provider } = build(script);
    const turn = await session.send("Go.");
    expect(turn.stats.tools.find((t) => t.name === "agent")).toEqual({ name: "agent", outcome: "failed" });
    const fed = provider.requests.at(-1)!.messages.at(-1);
    expect(fed?.role === "tool" ? fed.content : "").toContain("stopped after 30 rounds");
  });

  it("refuses a registered tool that clashes with a built-in", () => {
    const provider = new MockProvider([]);
    const guardrails = new Guardrails({ limits: DEFAULT_LIMITS, pricing: { inputPerMTokUsd: 0, outputPerMTokUsd: 0 } });
    const clash = { ...lookup, spec: { ...lookup.spec, name: "agent" } };
    expect(() => new RoleSession({ provider, guardrails, audit: new MemoryAuditLog(), systemPrompt: "x", tools: [clash] })).toThrowError(
      expect.objectContaining({ code: "config_invalid" }),
    );
  });
});

describe("todo_write tool", () => {
  it("publishes the list and confirms with counts, never asking permission", async () => {
    const todos = [
      { content: "Read the notes", status: "completed" },
      { content: "Ask about the budget", status: "in_progress" },
      { content: "Confirm the summary", status: "pending" },
    ];
    const { session, provider, events } = build([
      { text: "", toolCalls: [{ name: "todo_write", args: { todos } }] },
      { text: "ok" },
    ]);
    const turn = await session.send("Go.");
    expect(turn.stats.tools).toEqual([{ name: "todo_write", outcome: "accepted" }]);
    expect(events).toContainEqual({ type: "todos_updated", todos });
    const fed = provider.requests[1]!.messages.at(-1);
    expect(fed?.role === "tool" ? fed.content : "").toBe("Todo list updated: 1 completed, 1 in progress, 1 pending.");
  });

  it("rejects two items in progress at once", async () => {
    const { session } = build([
      {
        text: "",
        toolCalls: [
          {
            name: "todo_write",
            args: { todos: [{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }] },
          },
        ],
      },
      { text: "ok" },
    ]);
    const turn = await session.send("Go.");
    expect(turn.stats.tools).toEqual([{ name: "todo_write", outcome: "rejected" }]);
  });

  it("lists the built-ins after the registered tools, in a fixed order", () => {
    const { session } = build([]);
    expect(session.toolNames).toEqual(["lookup", "agent", "todo_write"]);
  });
});
