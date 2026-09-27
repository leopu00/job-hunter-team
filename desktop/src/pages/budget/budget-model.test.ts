import { describe, expect, it } from "vitest";
import type { SpendAgent, SpendReport, SpendRun } from "../../lib/spend";
import { agentsOfRun, budgetShare, formatPercent, formatWhen, roleLabel, spendByRole, totals } from "./budget-model";

function run(over: Partial<SpendRun> = {}): SpendRun {
  return {
    runId: "run-1",
    status: "completed",
    budgetUsd: 0.1,
    spentUsd: 0.03,
    createdAt: "2026-09-27T10:00:00Z",
    updatedAt: "2026-09-27T10:10:00Z",
    ...over,
  };
}

function agent(over: Partial<SpendAgent> = {}): SpendAgent {
  return {
    runId: "run-1",
    role: "scorer",
    agentId: "scorer-1",
    status: null,
    tasks: 1,
    costUsd: 0.01,
    inputTokens: 100,
    outputTokens: 10,
    lastError: null,
    updatedAt: "2026-09-27T10:01:00Z",
    ...over,
  };
}

function report(runs: SpendRun[], agents: SpendAgent[] = []): SpendReport {
  return { found: true, teamCapUsd: 0.1, agentCapUsd: 0.02, runs, agents };
}

describe("totals", () => {
  it("sums every listed run and takes the first as the latest", () => {
    const t = totals(report([run({ runId: "b", spentUsd: 0.05 }), run({ runId: "a", spentUsd: 0.02 })]));
    expect(t.spentUsd).toBeCloseTo(0.07);
    expect(t.runs).toBe(2);
    expect(t.latest?.runId).toBe("b");
  });

  it("has no latest run when there are none", () => {
    expect(totals(report([])).latest).toBeNull();
  });
});

describe("budgetShare", () => {
  it("is spent over budget, and null without a budget", () => {
    expect(budgetShare(run({ spentUsd: 0.05, budgetUsd: 0.1 }))).toBeCloseTo(0.5);
    expect(budgetShare(run({ budgetUsd: 0 }))).toBeNull();
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(1.004)).toBe("100%");
  });
});

describe("spendByRole", () => {
  const agents = [
    agent({ role: "scorer", agentId: "scorer-1", costUsd: 0.01, tasks: 2 }),
    agent({ role: "scorer", agentId: "scorer-2", costUsd: 0.02, lastError: "rate_limited", updatedAt: "2026-09-27T10:05:00Z" }),
    agent({ role: "scorer", agentId: "scorer-3", lastError: "older", updatedAt: "2026-09-27T10:02:00Z" }),
    agent({ role: "captain", agentId: "captain-1", status: "completed" }),
    agent({ role: "writer", agentId: null, costUsd: 0 }),
    agent({ runId: "other", role: "critic", agentId: "critic-1" }),
  ];

  it("sums a run's agents per role, in the team's order, only for that run", () => {
    const rows = spendByRole(agents, "run-1");
    expect(rows.map((r) => r.role)).toEqual(["captain", "scorer", "writer"]);
    const scorer = rows[1];
    expect(scorer.agents).toBe(3);
    expect(scorer.tasks).toBe(4);
    expect(scorer.costUsd).toBeCloseTo(0.04);
    expect(scorer.lastError).toEqual({ agentId: "scorer-2", message: "rate_limited" });
  });

  it("does not count an unclaimed task as an agent", () => {
    expect(spendByRole(agents, "run-1")[2].agents).toBe(0);
  });

  it("lists a run's agents most expensive first", () => {
    expect(agentsOfRun(agents, "run-1")[0].agentId).toBe("scorer-2");
  });
});

describe("labels", () => {
  it("names the API team's roles as the team pages do, and keeps an unknown one", () => {
    expect(roleLabel("writer")).toBe("Scrittore");
    expect(roleLabel("closer")).toBe("closer");
  });

  it("shows «—» for a timestamp that is missing or does not parse", () => {
    expect(formatWhen(null)).toBe("—");
    expect(formatWhen("not a date")).toBe("—");
    expect(formatWhen("2026-09-27T10:00:00Z")).toMatch(/27\/09\/2026/);
  });
});
