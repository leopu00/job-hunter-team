import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatOAuthLoginElapsed, OAuthLoginTakeover, type OAuthLoginTakeoverProps } from "./OAuthLoginTakeover";

function props(overrides: Partial<OAuthLoginTakeoverProps> = {}): OAuthLoginTakeoverProps {
  return {
    providerName: "Codex",
    actions: [{ kind: "url", instruction: "Apri il link verificato.", safeUrl: "https://example.com/device" }],
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
  it("shows structured actions and never renders a PTY log", () => {
    const view = render(<OAuthLoginTakeover {...props()} />);
    expect(screen.getByRole("heading", { name: /completa l’accesso a codex/i })).toHaveFocus();
    expect(screen.getByLabelText("Tempo trascorso 01:02")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/device")).toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
    expect(view.container.querySelector("input")).not.toBeInTheDocument();
  });

  it("keeps URL and code visible together and copies only their structured values", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn().mockResolvedValue(undefined);
    const base = props({ onCopy });
    const view = render(<OAuthLoginTakeover {...base} />);
    const copyUrl = screen.getByRole("button", { name: /copia url/i });
    await user.click(copyUrl);
    expect(onCopy).toHaveBeenLastCalledWith("https://example.com/device");
    expect(copyUrl).toHaveFocus();

    view.rerender(<OAuthLoginTakeover {...base} actions={[
      ...base.actions,
      { kind: "code", instruction: "Inserisci il codice.", userCode: "ABCD-EFGH" },
      { kind: "input", instruction: "Conferma.", inputRequest: { id: "same-request", label: "Risposta" } },
    ]} />);
    expect(screen.getByRole("button", { name: /copia url/i })).toBeInTheDocument();
    const copyCode = screen.getByRole("button", { name: /copia codice/i });
    await user.click(copyCode);
    expect(onCopy).toHaveBeenLastCalledWith("ABCD-EFGH");
    expect(copyCode).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Risposta" })).toBeInTheDocument();
  });

  it("mounts stdin only for input State, focuses it and never auto-submits", async () => {
    const user = userEvent.setup();
    const onSubmitInput = vi.fn().mockResolvedValue(undefined);
    render(<OAuthLoginTakeover {...props({
      actions: [{
        kind: "input", instruction: "Incolla il codice restituito.",
        inputRequest: { id: "browser-code", label: "Codice restituito", description: "Invialo dopo il browser.", submitLabel: "Continua" },
      }],
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
      actions: [{ kind: "input", instruction: "Conferma.", inputRequest: { id: "confirmation", label: "Risposta", secret: true } }],
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
      actions: [{ kind: "input", instruction: "Connessione interrotta.", inputRequest: { id: "answer", label: "Risposta" } }],
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
    const base = props({ actions: [{ kind: "input", instruction: "Prima", inputRequest: { id: "first", label: "Prima risposta" } }] });
    const view = render(<OAuthLoginTakeover {...base} />);
    await user.type(screen.getByLabelText("Prima risposta"), "bozza");
    view.rerender(<OAuthLoginTakeover {...base} actions={[{ kind: "input", instruction: "Prima aggiornata", inputRequest: { id: "first", label: "Prima risposta" } }]} />);
    expect(screen.getByLabelText("Prima risposta")).toHaveValue("bozza");
    view.rerender(<OAuthLoginTakeover {...base} actions={[{ kind: "input", instruction: "Seconda", inputRequest: { id: "second", label: "Seconda risposta" } }]} />);
    expect(screen.getByLabelText("Seconda risposta")).toHaveValue("");
    expect(screen.getByLabelText("Seconda risposta")).toHaveFocus();
  });

  it("focuses and announces the provider wait after input submission", () => {
    const initial = props({ actions: [
      { kind: "url", instruction: "Apri il browser.", safeUrl: "https://example.com/device" },
      { kind: "input", instruction: "Conferma.", inputRequest: { id: "submitted-request", label: "Risposta" } },
    ] });
    const view = render(<OAuthLoginTakeover {...initial} />);
    expect(screen.getByRole("textbox", { name: "Risposta" })).toHaveFocus();
    view.rerender(<OAuthLoginTakeover
      {...initial}
      actions={[initial.actions[0]]}
      verifying
    />);

    const waiting = screen.getByText("Risposta inviata, attendo il provider.");
    expect(waiting).toHaveAttribute("role", "status");
    expect(waiting).toHaveFocus();
    expect(screen.getByText("https://example.com/device")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Connesso")).toBeInTheDocument();
  });
});

describe("OAuth login formatting helpers", () => {
  it("formats elapsed time without negative, NaN or overflowing minutes", () => {
    expect(formatOAuthLoginElapsed(-1)).toBe("00:00");
    expect(formatOAuthLoginElapsed(Number.NaN)).toBe("00:00");
    expect(formatOAuthLoginElapsed(3_723_000)).toBe("01:02:03");
  });
});
