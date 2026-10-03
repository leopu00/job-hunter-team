import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatOAuthLoginElapsed, OAuthLoginTakeover, type OAuthLoginTakeoverProps } from "./OAuthLoginTakeover";

function props(overrides: Partial<OAuthLoginTakeoverProps> = {}): OAuthLoginTakeoverProps {
  return {
    providerName: "Codex",
    action: { kind: "url", instruction: "Apri il link verificato.", safeUrl: "https://example.com/device" },
    connectionState: "connected",
    elapsedMs: 62_000,
    onSubmitInput: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn().mockResolvedValue(undefined),
    onRestart: vi.fn().mockResolvedValue(undefined),
    onCopy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("OAuthLoginTakeover", () => {
  it("shows only the current structured action and never renders a PTY log", () => {
    const view = render(<OAuthLoginTakeover {...props()} />);
    expect(screen.getByRole("heading", { name: /completa l’accesso a codex/i })).toHaveFocus();
    expect(screen.getByLabelText("Tempo trascorso 01:02")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/device")).toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
    expect(view.container.querySelector("input")).not.toBeInTheDocument();
  });

  it("copies URL and code only from their exclusive structured states", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn().mockResolvedValue(undefined);
    const base = props({ onCopy });
    const view = render(<OAuthLoginTakeover {...base} />);
    const copyUrl = screen.getByRole("button", { name: /copia url/i });
    await user.click(copyUrl);
    expect(onCopy).toHaveBeenLastCalledWith("https://example.com/device");
    expect(copyUrl).toHaveFocus();

    view.rerender(<OAuthLoginTakeover {...base} action={{ kind: "code", instruction: "Inserisci il codice.", userCode: "ABCD-EFGH" }} />);
    expect(screen.queryByRole("button", { name: /copia url/i })).not.toBeInTheDocument();
    const copyCode = screen.getByRole("button", { name: /copia codice/i });
    await user.click(copyCode);
    expect(onCopy).toHaveBeenLastCalledWith("ABCD-EFGH");
    expect(copyCode).toHaveFocus();
  });

  it("mounts stdin only for input State, focuses it and never auto-submits", async () => {
    const user = userEvent.setup();
    const onSubmitInput = vi.fn().mockResolvedValue(undefined);
    render(<OAuthLoginTakeover {...props({
      action: {
        kind: "input", instruction: "Incolla il codice restituito.",
        inputRequest: { id: "browser-code", label: "Codice restituito", description: "Invialo dopo il browser.", submitLabel: "Continua" },
      },
      onSubmitInput,
    })} />);
    const input = screen.getByRole("textbox", { name: /codice restituito/i });
    const submit = screen.getByRole("button", { name: "Continua" });
    expect(input).toHaveFocus();
    expect(submit).toBeDisabled();
    expect(onSubmitInput).not.toHaveBeenCalled();
    await user.type(input, "  risposta-utente  ");
    await user.click(submit);
    expect(onSubmitInput).toHaveBeenCalledOnce();
    expect(onSubmitInput).toHaveBeenCalledWith("risposta-utente");
  });

  it("keeps a rejected input editable and reports only a safe retry message", async () => {
    const user = userEvent.setup();
    const onSubmitInput = vi.fn().mockRejectedValue(new Error("raw backend secret"));
    render(<OAuthLoginTakeover {...props({
      action: { kind: "input", instruction: "Conferma.", inputRequest: { id: "confirmation", label: "Risposta", secret: true } },
      onSubmitInput,
    })} />);
    const input = screen.getByLabelText("Risposta");
    await user.type(input, "dato-temporaneo");
    await user.click(screen.getByRole("button", { name: /invia risposta/i }));
    expect(input).toHaveValue("dato-temporaneo");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/raw backend secret/i);
  });

  it("disables input while disconnected and locks competing controls while pending", async () => {
    const user = userEvent.setup();
    let finishCancel!: () => void;
    const onCancel = vi.fn(() => new Promise<void>((resolve) => { finishCancel = resolve; }));
    const onRestart = vi.fn().mockResolvedValue(undefined);
    render(<OAuthLoginTakeover {...props({
      connectionState: "disconnected",
      action: { kind: "input", instruction: "Connessione interrotta.", inputRequest: { id: "answer", label: "Risposta" } },
      onCancel,
      onRestart,
    })} />);
    expect(screen.getByLabelText("Risposta")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.getByRole("button", { name: /annullamento/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /riavvia accesso/i })).toBeDisabled();
    await act(async () => finishCancel());
  });

  it("preserves a draft for the same request and resets plus focuses a new request id", async () => {
    const user = userEvent.setup();
    const base = props({ action: { kind: "input", instruction: "Prima", inputRequest: { id: "first", label: "Prima risposta" } } });
    const view = render(<OAuthLoginTakeover {...base} />);
    await user.type(screen.getByLabelText("Prima risposta"), "bozza");
    view.rerender(<OAuthLoginTakeover {...base} action={{ kind: "input", instruction: "Prima aggiornata", inputRequest: { id: "first", label: "Prima risposta" } }} />);
    expect(screen.getByLabelText("Prima risposta")).toHaveValue("bozza");
    view.rerender(<OAuthLoginTakeover {...base} action={{ kind: "input", instruction: "Seconda", inputRequest: { id: "second", label: "Seconda risposta" } }} />);
    expect(screen.getByLabelText("Seconda risposta")).toHaveValue("");
    expect(screen.getByLabelText("Seconda risposta")).toHaveFocus();
  });
});

describe("OAuth login formatting helpers", () => {
  it("formats elapsed time without negative, NaN or overflowing minutes", () => {
    expect(formatOAuthLoginElapsed(-1)).toBe("00:00");
    expect(formatOAuthLoginElapsed(Number.NaN)).toBe("00:00");
    expect(formatOAuthLoginElapsed(3_723_000)).toBe("01:02:03");
  });
});
