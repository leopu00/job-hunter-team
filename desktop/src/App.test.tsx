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
          title: "Agentic AI Engineer",
          company: "Synthetic Company",
          score: 88,
          state: "reviewed",
          criticScore: 9,
          criticVerdict: "pass",
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
    expect(screen.getByText("Container isolati con Podman")).toBeInTheDocument();
    expect(screen.getByText("Consumo sulla tua chiave OpenAI")).toBeInTheDocument();
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
      await screen.findByRole("heading", { level: 1, name: /la squadra ha iniziato/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("Agentic AI Engineer")).toBeInTheDocument();
    expect(startApiTeam).toHaveBeenCalledWith(
      "sk-test-only-not-a-real-key",
      expect.any(Function),
    );
    expect(localStorage).toHaveLength(0);
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
    await user.click(screen.getByRole("button", { name: /avvia il team ora/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Il provider ha rifiutato la richiesta",
    );
    expect(screen.getByLabelText("API key")).toHaveValue("");
  });
});
