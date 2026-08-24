import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import App from "./App";
import { checkPodman } from "./lib/podman";

vi.mock("./lib/podman", () => ({
  checkPodman: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(checkPodman).mockResolvedValue({
    installed: true,
    ready: true,
    version: "podman version 5.5.2",
    issue: null,
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

  it("requires the API key and clears it after confirming the prototype path", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /inizia la configurazione/i }),
    );

    const submit = screen.getByRole("button", { name: /conferma questo setup/i });
    const input = screen.getByLabelText("API key");
    expect(submit).toBeDisabled();

    await user.type(input, "sk-test-only-not-a-real-key");
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(input).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Percorso confermato");
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
});
