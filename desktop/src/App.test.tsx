import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

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
});
