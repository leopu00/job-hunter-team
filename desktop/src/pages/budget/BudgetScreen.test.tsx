import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SpendReport } from "../../lib/spend";
import BudgetScreen from "./BudgetScreen";
import type { UsageRead, UsageSample } from "./load-usage";

const NOW = Date.parse("2026-09-28T01:10:00Z");

function sample(over: Partial<UsageSample> = {}): UsageSample {
  return {
    ts: "2026-09-28T01:05:00Z",
    provider: "claude",
    usage: 37,
    weeklyUsage: 62,
    projection: 81,
    velocity: 9.4,
    status: "OK",
    throttle: 0,
    // 2 h 20 min after NOW
    resetAtUnix: Date.parse("2026-09-28T03:30:00Z") / 1000,
    weeklyResetAtUnix: Date.parse("2026-09-30T09:00:00Z") / 1000,
    ...over,
  };
}

const USAGE: UsageRead = { state: "ready", samples: [sample(), sample({ ts: "2026-09-28T00:55:00Z", usage: 33, projection: 78 })] };

const REPORT: SpendReport = {
  found: true,
  teamCapUsd: 0.1,
  agentCapUsd: 0.02,
  runs: [
    { runId: "run-new", status: "failed", budgetUsd: 0.1, spentUsd: 0.1, createdAt: "2026-09-27T10:00:00Z", updatedAt: "2026-09-27T10:09:00Z" },
    { runId: "run-old", status: "completed", budgetUsd: 0.1, spentUsd: 0.03, createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:20:00Z" },
  ],
  agents: [
    { runId: "run-new", role: "scout", agentId: "scout-1", status: "failed", tasks: 1, costUsd: 0.02, inputTokens: 9000, outputTokens: 900, lastError: "budget_exhausted", updatedAt: "2026-09-27T10:06:00Z" },
    { runId: "run-old", role: "critic", agentId: "critic-1", status: null, tasks: 2, costUsd: 0.004, inputTokens: 1200, outputTokens: 80, lastError: null, updatedAt: "2026-09-26T10:15:00Z" },
  ],
};

describe("BudgetScreen", () => {
  it("shows the totals, the caps and every run with its share of the budget", () => {
    render(<BudgetScreen spend={{ state: "ready", report: REPORT }} usage={USAGE} now={NOW} />);
    expect(screen.getByText("Speso in totale").parentElement).toHaveTextContent("0,13");
    expect(screen.getByText("Tetto per agente").parentElement).toHaveTextContent("0,02");
    const runs = within(screen.getByRole("region", { name: "Run" })).getAllByRole("row");
    expect(runs).toHaveLength(3);
    expect(runs[1]).toHaveTextContent("fallito");
    expect(runs[1]).toHaveTextContent("100%");
    expect(runs[2]).toHaveTextContent("30%");
  });

  it("opens on the newest run and moves to the one clicked", async () => {
    const user = userEvent.setup();
    render(<BudgetScreen spend={{ state: "ready", report: REPORT }} usage={USAGE} now={NOW} />);
    const byRole = () => screen.getByRole("region", { name: /^Per ruolo/ });
    expect(byRole()).toHaveTextContent("Scout");
    expect(byRole()).toHaveTextContent("budget_exhausted (scout-1)");
    expect(byRole()).not.toHaveTextContent("Critico");

    const runs = within(screen.getByRole("region", { name: "Run" })).getAllByRole("row");
    await user.click(runs[2]);
    expect(byRole()).toHaveTextContent("Critico");
    expect(byRole()).not.toHaveTextContent("Scout");
  });

  it("with no run says so, and still shows the caps", () => {
    render(<BudgetScreen spend={{ state: "ready", report: { ...REPORT, found: false, runs: [], agents: [] } }} usage={USAGE} now={NOW} />);
    expect(screen.getByText(/Nessun run API storico su questo computer/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team locale" })).not.toBeInTheDocument();
    expect(screen.getByText("Tetto per run")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Run" })).toBeNull();
  });

  it("outside the app and on a failed read it says why, without numbers", () => {
    const { unmount } = render(<BudgetScreen spend={{ state: "unavailable" }} usage={USAGE} now={NOW} />);
    expect(screen.getByText(/si legge solo dall'app desktop/)).toBeInTheDocument();
    unmount();
    render(<BudgetScreen spend={{ state: "failed" }} usage={USAGE} now={NOW} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Non riesco a leggere il database dei run");
  });

  it("shows the tmux team's usage window from the cloud's samples, in the same form as the API team", () => {
    // The page said «—» and «does not reach the cloud»; the samples do reach it (sentinel_ticks).
    render(<BudgetScreen spend={{ state: "ready", report: REPORT }} usage={USAGE} now={NOW} />);
    const tmux = screen.getByRole("region", { name: "Consumo del team tmux" });
    expect(within(tmux).getByText("Finestra 5 ore").parentElement).toHaveTextContent("37%");
    expect(within(tmux).getByText("Finestra 5 ore").parentElement).toHaveTextContent("claude · OK");
    expect(within(tmux).getByText("Settimana").parentElement).toHaveTextContent("62%");
    expect(within(tmux).getByText("Settimana").parentElement).toHaveTextContent("reset tra 2 g");
    expect(within(tmux).getByText("Prossimo reset").parentElement).toHaveTextContent("2 h 20 min");
    expect(within(tmux).getByText("Proiezione").parentElement).toHaveTextContent("81%");
    expect(tmux).not.toHaveTextContent("Non arriva al cloud");
    const rows = within(screen.getByRole("region", { name: "Campioni del team tmux" })).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("37%");
    expect(rows[2]).toHaveTextContent("33%");
  });

  it("says when the newest sample is old, when there is none, and when the cloud cannot be read", () => {
    const old: UsageRead = { state: "ready", samples: [sample({ ts: "2026-09-27T22:00:00Z" })] };
    const { unmount } = render(<BudgetScreen spend={{ state: "ready", report: REPORT }} usage={old} now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent("il team potrebbe essere fermo");
    unmount();

    const none = render(<BudgetScreen spend={{ state: "ready", report: REPORT }} usage={{ state: "ready", samples: [] }} now={NOW} />);
    const tmux = screen.getByRole("region", { name: "Consumo del team tmux" });
    expect(within(tmux).getByText("Finestra 5 ore").parentElement).toHaveTextContent("—");
    expect(tmux).toHaveTextContent("Nessun campione sul cloud");
    none.unmount();

    render(<BudgetScreen spend={{ state: "ready", report: REPORT }} usage={{ state: "failed" }} now={NOW} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Non riesco a leggere il consumo del team tmux dal cloud");
  });
});
