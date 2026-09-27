import type { SpendAgent, SpendReport, SpendRun } from "../../lib/spend";

/** The API team's role names (api-worker), as the team pages call them. */
const ROLE_LABELS: Record<string, string> = {
  captain: "Capitano",
  scout: "Scout",
  analyst: "Analista",
  scorer: "Scorer",
  writer: "Scrittore",
  critic: "Critico",
  sentinel: "Sentinella",
};

const ROLE_ORDER = ["captain", "scout", "analyst", "scorer", "writer", "critic", "sentinel"];

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

const RUN_STATUS: Record<string, string> = {
  running: "in corso",
  completed: "completato",
  failed: "fallito",
};

export function runStatusLabel(status: string): string {
  return RUN_STATUS[status] ?? status;
}

export type SpendTotals = {
  spentUsd: number;
  runs: number;
  latest: SpendRun | null;
};

/** The runs come newest first (spend.rs): the latest is the first. */
export function totals(report: SpendReport): SpendTotals {
  return {
    spentUsd: report.runs.reduce((sum, r) => sum + r.spentUsd, 0),
    runs: report.runs.length,
    latest: report.runs[0] ?? null,
  };
}

/** Share of the budget a run spent, 0..1; null when the run had no budget. */
export function budgetShare(run: SpendRun): number | null {
  if (!(run.budgetUsd > 0)) return null;
  return run.spentUsd / run.budgetUsd;
}

export type RoleSpend = {
  role: string;
  agents: number;
  tasks: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** the latest error of the role in the run, with the agent that had it */
  lastError: { agentId: string | null; message: string } | null;
};

/** One row per role of a run, in the team's order, summing its agents. */
export function spendByRole(agents: SpendAgent[], runId: string): RoleSpend[] {
  const byRole = new Map<string, RoleSpend & { errorAt: string }>();
  for (const a of agents) {
    if (a.runId !== runId) continue;
    const row =
      byRole.get(a.role) ??
      ({ role: a.role, agents: 0, tasks: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, lastError: null, errorAt: "" } as RoleSpend & {
        errorAt: string;
      });
    if (a.agentId) row.agents += 1;
    row.tasks += a.tasks;
    row.costUsd += a.costUsd;
    row.inputTokens += a.inputTokens;
    row.outputTokens += a.outputTokens;
    if (a.lastError && a.updatedAt >= row.errorAt) {
      row.lastError = { agentId: a.agentId, message: a.lastError };
      row.errorAt = a.updatedAt;
    }
    byRole.set(a.role, row);
  }
  const rank = (role: string) => {
    const i = ROLE_ORDER.indexOf(role);
    return i < 0 ? ROLE_ORDER.length : i;
  };
  return [...byRole.values()]
    .sort((x, y) => rank(x.role) - rank(y.role) || x.role.localeCompare(y.role))
    .map(({ errorAt: _errorAt, ...row }) => row);
}

/** The agents of a run, most expensive first. */
export function agentsOfRun(agents: SpendAgent[], runId: string): SpendAgent[] {
  return agents.filter((a) => a.runId === runId).sort((x, y) => y.costUsd - x.costUsd);
}

const usd = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function formatUsd(value: number): string {
  return usd.format(value);
}

const count = new Intl.NumberFormat("it-IT");

export function formatCount(value: number): string {
  return count.format(value);
}

export function formatPercent(share: number | null): string {
  return share == null ? "—" : `${Math.round(share * 100)}%`;
}

/** A timestamp of the run database (ISO), as the page shows it; «—» when it does not parse. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
