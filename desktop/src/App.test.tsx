import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import App from "./App";
import { checkPodman } from "./lib/podman";
import { startApiTeam } from "./lib/team";

vi.mock("./lib/podman", () => ({
  checkPodman: vi.fn(),
}));

vi.mock("./lib/team", () => ({
  startApiTeam: vi.fn(),
  isTeamAgentActivity: (progress: {
    role?: string;
    agentId?: string;
    status?: string;
  }) => Boolean(progress.role && progress.agentId && progress.status),
}));

beforeEach(() => {
  vi.mocked(checkPodman).mockResolvedValue({
    installed: true,
    ready: true,
    version: "podman version 5.5.2",
    issue: null,
  });
  vi.mocked(startApiTeam).mockImplementation(async (_key, onProgress) => {
    onProgress({ stage: "team", message: "Il team è partito" });
    return {
      runId: "run-test-12345678",
      scored: 5,
      reviewed: 2,
      spentUsd: 0.024,
      agentCount: 11,
      workspacePath: "C:\\JHT\\api-team",
      positions: [
        {
          sourceId: "job-1",
          title: "Agentic AI Engineer",
          company: "Synthetic Company",
          score: 88,
          state: "reviewed",
          criticScore: 9,
          criticVerdict: "pass",
          cvMarkdown: "# CV Agentic AI Engineer\n\nEsperienza verificata.",
        },
      ],
      agents: [
        {
          agentId: "captain-1",
          role: "captain",
          costUsd: 0.001,
          inputTokens: 100,
          outputTokens: 50,
        },
      ],
      timeline: [
        {
          sequence: 1,
          sourceId: "job-1",
          actor: "scout-1",
          event: "handoff_queued",
          from: "scout",
          to: "analyst",
        },
      ],
    };
  });
});

describe("desktop first-run flow", () => {
  it("starts on the welcome page and opens the local API setup", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "La ricerca cambia",
    );

    await user.click(
      screen.getByRole("button", { name: /inizia la configurazione/i }),
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Prepariamo il tuo ambiente",
    );
    expect(
      screen.getByText("Container isolati con Podman"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Consumo sulla tua chiave OpenAI"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Podman è pronto")).toBeInTheDocument();
    expect(screen.getByText("podman version 5.5.2")).toBeInTheDocument();
  });

  it("requires the API key, starts the team and shows its result", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /inizia la configurazione/i }),
    );

    const submit = screen.getByRole("button", { name: /avvia il team ora/i });
    const input = screen.getByLabelText("API key");
    expect(submit).toBeDisabled();

    await user.type(input, "sk-test-only-not-a-real-key");
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /la squadra ha iniziato/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("Agentic AI Engineer")).toBeInTheDocument();
    expect(screen.getByText("CV generato")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Agenti" }));
    expect(screen.getByText("captain-1")).toBeInTheDocument();
    expect(screen.getByText("150 token")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Attività" }));
    expect(screen.getByText("scout-1 · handoff queued")).toBeInTheDocument();
    expect(screen.getByText("scout → analyst")).toBeInTheDocument();
    expect(startApiTeam).toHaveBeenCalledWith(
      "sk-test-only-not-a-real-key",
      expect.any(Function),
    );
    expect(localStorage).toHaveLength(0);
  });

  it("shows real agent activity while the isolated team is running", async () => {
    let finishRun!: (value: Awaited<ReturnType<typeof startApiTeam>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof startApiTeam>>>(
      (resolve) => {
        finishRun = resolve;
      },
    );
    vi.mocked(startApiTeam).mockImplementation((_key, onProgress) => {
      onProgress({
        stage: "team",
        message: "Analista lavora su Agentic AI Engineer",
        role: "analyst",
        agentId: "analyst-1",
        status: "working",
        positionTitle: "Agentic AI Engineer",
      });
      return pending;
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /inizia la configurazione/i }),
    );
    await user.type(
      screen.getByLabelText("API key"),
      "sk-test-only-not-a-real-key",
    );
    await user.click(
      screen.getByRole("button", { name: /avvia il team ora/i }),
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /la squadra è al lavoro/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Analista 1")).toBeInTheDocument();
    expect(screen.getByText("al lavoro")).toBeInTheDocument();
    expect(screen.getAllByText("Agentic AI Engineer").length).toBeGreaterThan(
      0,
    );

    finishRun({
      runId: "cancelled-test-run",
      scored: 0,
      reviewed: 0,
      spentUsd: 0,
      agentCount: 0,
      workspacePath: "C:\\JHT\\api-team",
      positions: [],
      agents: [],
      timeline: [],
    });
  });

  it("explains how to recover when the Podman engine is unavailable", async () => {
    vi.mocked(checkPodman).mockResolvedValue({
      installed: true,
      ready: false,
      version: "podman version 6.0.2",
      issue: "engine_unavailable",
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /inizia la configurazione/i }),
    );

    expect(
      await screen.findByText("Podman è installato, ma il motore non risponde"),
    ).toBeInTheDocument();
    expect(screen.getByText(/avvia podman/i)).toBeInTheDocument();
  });

  it("clears the rejected key and reports a safe provider failure", async () => {
    vi.mocked(startApiTeam).mockRejectedValue({ code: "team_run_failed" });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /inizia la configurazione/i }),
    );
    const input = screen.getByLabelText("API key");
    await user.type(input, "sk-test-only-not-a-real-key");
    await user.click(
      screen.getByRole("button", { name: /avvia il team ora/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Il provider ha rifiutato la richiesta",
    );
    expect(screen.getByLabelText("API key")).toHaveValue("");
  });
});
