import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SpendReport } from "../../lib/spend";
import BudgetScreen from "./BudgetScreen";

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
    render(<BudgetScreen spend={{ state: "ready", report: REPORT }} />);
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
    render(<BudgetScreen spend={{ state: "ready", report: REPORT }} />);
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
    render(<BudgetScreen spend={{ state: "ready", report: { ...REPORT, found: false, runs: [], agents: [] } }} />);
    expect(screen.getByText(/Nessun run del team API su questo computer/)).toBeInTheDocument();
    expect(screen.getByText("Tetto per run")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Run" })).toBeNull();
  });

  it("outside the app and on a failed read it says why, without numbers", () => {
    const { unmount } = render(<BudgetScreen spend={{ state: "unavailable" }} />);
    expect(screen.getByText(/si legge solo dall'app desktop/)).toBeInTheDocument();
    unmount();
    render(<BudgetScreen spend={{ state: "failed" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Non riesco a leggere il database dei run");
  });

  it("the tmux team's usage is «—», with the reason", () => {
    render(<BudgetScreen spend={{ state: "ready", report: REPORT }} />);
    const tmux = screen.getByRole("region", { name: "Consumo del team tmux" });
    for (const label of ["Finestra 5 ore", "Settimana", "Prossimo reset", "Proiezione"]) {
      expect(within(tmux).getByText(label).parentElement).toHaveTextContent("—");
    }
    expect(tmux).toHaveTextContent("Non arriva al cloud");
  });
});
