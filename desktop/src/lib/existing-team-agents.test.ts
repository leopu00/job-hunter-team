import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickAgentsRead, pickUsage, readTeamAgentsShared, resetTeamAgentsShared, SHARED_AGENTS_MS } from "./existing-team-agents";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "./existing-team-readonly";

// One read of the team's agents serves the Agents page and the office of the
// read-only view, and belongs to the opening of that view. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

const REPLY = { ok: true, data: { agents: [], roles: [], states: false } };
const T0 = Date.UTC(2026, 9, 19, 2, 0, 0);

beforeEach(() => {
  native.invoke.mockReset();
  native.invoke.mockResolvedValue(REPLY);
  resetTeamAgentsShared();
  enterExistingTeamReadOnly(false);
});
afterEach(() => {
  leaveExistingTeamReadOnly();
  resetTeamAgentsShared();
});

describe("readTeamAgentsShared", () => {
  it("serves the page and the office with one read of the VPS", async () => {
    const page = readTeamAgentsShared(T0);
    const office = readTeamAgentsShared(T0 + SHARED_AGENTS_MS - 1);
    expect(office).toBe(page);
    expect((await office).kind).toBe("read");
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_agents_read", { request: { op: "list" } });
  });

  it("reads again once the shared window is over", async () => {
    await readTeamAgentsShared(T0);
    await readTeamAgentsShared(T0 + SHARED_AGENTS_MS);
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });

  it("never serves the read of a view that was left or opened again (another VPS, another team)", async () => {
    await readTeamAgentsShared(T0);
    leaveExistingTeamReadOnly();
    enterExistingTeamReadOnly(true);
    await readTeamAgentsShared(T0 + 1);
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });

  it("a read that comes back after the view changed is not given to the new one", async () => {
    let answer: (value: unknown) => void = () => undefined;
    native.invoke.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const first = readTeamAgentsShared(T0);
    leaveExistingTeamReadOnly();
    enterExistingTeamReadOnly(true);
    answer({ ok: true, data: { agents: [], roles: [], states: true } });
    expect(await first).toMatchObject({ kind: "error", code: "existing_team_target_changed" });
    // the new view reads its own
    expect((await readTeamAgentsShared(T0 + 1)).kind).toBe("read");
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });
});

describe("who an agent is, as the native side lets it through", () => {
  it("keeps only the closed shape: a known cli, a short model, a known effort", async () => {
    const { pickIdentity } = await import("./existing-team-agents");
    expect(pickIdentity({ cli: "codex", model: "gpt-5.6-terra", effort: "high" })).toEqual({ cli: "codex", model: "gpt-5.6-terra", effort: "high" });
    expect(pickIdentity({ cli: "kimi", model: null, effort: null })).toEqual({ cli: "kimi", model: null, effort: null });
    expect(pickIdentity({ cli: "claude", model: "<b>opus</b>", effort: "extreme" })).toEqual({ cli: "claude", model: null, effort: null });
    expect(pickIdentity({ cli: "claude", model: "m".repeat(41), effort: "low" })?.model).toBeNull();
    for (const bad of [{ cli: "gpt" }, { model: "x" }, "codex", null, undefined]) expect(pickIdentity(bad)).toBeNull();
  });
});

describe("an agent's health in small (pickUsage)", () => {
  const UNKNOWN = { contextPct: null, contextTokens: null, contextWindow: null, contextAt: null, tokensHour: null, tokensAt: null };

  it("keeps a zero that was read and turns the native side's seconds into milliseconds", () => {
    expect(pickUsage({ contextPct: 0, contextTokens: 0, contextWindow: 258400, contextAt: 1_790_000_000, tokensHour: 0, tokensAt: 1_790_000_100.5 })).toEqual({
      contextPct: 0, contextTokens: 0, contextWindow: 258400, contextAt: 1_790_000_000_000, tokensHour: 0, tokensAt: 1_790_000_100_500,
    });
  });

  it("says «not known» for what is missing or is not a count, never 0", () => {
    expect(pickUsage(undefined)).toEqual(UNKNOWN);
    expect(pickUsage({ contextPct: 101, contextTokens: -1, contextWindow: "258k", contextAt: true, tokensHour: Number.NaN, tokensAt: null })).toEqual(UNKNOWN);
  });

  it("is on every agent of a list, also of an image that does not send it", () => {
    const read = pickAgentsRead({ agents: [{ name: "SCOUT-1", role: "scout", state: "idle" }], roles: [], states: true });
    expect(read?.agents[0].usage).toEqual(UNKNOWN);
  });
});

describe("the questions an agent asked the person (pickQuestions)", () => {
  const asked = (fields: Record<string, unknown> = {}) => ({
    id: "aq:scout:1790000000-ab12cd", tipo: "blocco", oggetto: "CV per Acme", testo: "Quale CV uso?",
    opzioni: [{ id: "breve", label: "CV breve", reversibile: true }, { id: "_rinvia", label: "Rinvia" }],
    multipla: false, libera: false, scadenza: 1_790_003_600, default: "_rinvia", at: 1_790_000_000, ...fields,
  });
  const free = { id: null, tipo: null, oggetto: null, testo: "Procedo?", opzioni: [], multipla: false, libera: true, scadenza: null, default: null, at: 1_790_000_001 };

  it("keeps the closed shape, with milliseconds, and «reversible» only when it is true", async () => {
    const { pickQuestions } = await import("./existing-team-agents");
    const picked = pickQuestions({ open: 2, unread: 3, items: [asked(), free] });
    expect(picked).toEqual({
      open: 2,
      unread: 3,
      items: [
        {
          id: "aq:scout:1790000000-ab12cd", type: "blocco", subject: "CV per Acme", text: "Quale CV uso?",
          options: [{ id: "breve", label: "CV breve", reversible: true }, { id: "_rinvia", label: "Rinvia", reversible: false }],
          multiple: false, free: false, expiresAt: 1_790_003_600_000, fallback: "_rinvia", at: 1_790_000_000_000,
        },
        { id: null, type: null, subject: null, text: "Procedo?", options: [], multiple: false, free: true, expiresAt: null, fallback: null, at: 1_790_000_001_000 },
      ],
    });
  });

  it("every type passes, and a zero that was read stays zero", async () => {
    const { pickQuestions, QUESTION_TYPES } = await import("./existing-team-agents");
    for (const tipo of QUESTION_TYPES) expect(pickQuestions({ open: 1, unread: 0, items: [asked({ tipo })] })?.items[0].type).toBe(tipo);
    expect(pickQuestions({ open: 0, unread: 0, items: [] })).toEqual({ open: 0, unread: 0, items: [] });
  });

  it("is «not known» when the counts are not counts, and leaves out a question out of shape", async () => {
    const { pickQuestions } = await import("./existing-team-agents");
    for (const bad of [null, undefined, "2", { open: -1, unread: 0, items: [] }, { open: 1, unread: 1.5, items: [] }, { open: 1, unread: 0 }]) {
      expect(pickQuestions(bad)).toBeNull();
    }
    const out = [
      asked({ tipo: "ordine" }),
      asked({ id: "AQ:scout:1-x" }),
      asked({ oggetto: "riga\nfinta" }),
      asked({ testo: "CV‮otnemucod" }),
      asked({ testo: "x".repeat(281) }),
      asked({ opzioni: [{ id: "Rm -rf", label: "x" }, { id: "b", label: "y" }] }),
      asked({ opzioni: [{ id: "a", label: "x" }] }),
      asked({ default: "altro" }),
      { ...free, tipo: "domanda" },
      { ...free, opzioni: [{ id: "a", label: "x" }] },
    ];
    expect(pickQuestions({ open: 10, unread: 0, items: out })).toEqual({ open: 10, unread: 0, items: [] });
  });

  it("keeps five per agent and twenty in the whole list, and an older image has none", async () => {
    const { pickAgentsRead, pickQuestions } = await import("./existing-team-agents");
    const seven = Array.from({ length: 7 }, (_, n) => asked({ id: `aq:scout:1790000000-q${n}` }));
    expect(pickQuestions({ open: 7, unread: 0, items: seven })?.items).toHaveLength(5);
    const agents = Array.from({ length: 5 }, (_, n) => ({ name: `SCOUT-${n + 1}`, role: "scout", state: "idle", questions: { open: 7, unread: 0, items: seven } }));
    const read = pickAgentsRead({ agents: [...agents, { name: "CAPITANO", role: "capitano", state: "idle" }], roles: [], states: true })!;
    expect(read.agents.map((agent) => agent.questions?.items.length ?? null)).toEqual([5, 5, 5, 5, 0, null]);
    expect(read.agents[4].questions?.open).toBe(7);
  });
});
