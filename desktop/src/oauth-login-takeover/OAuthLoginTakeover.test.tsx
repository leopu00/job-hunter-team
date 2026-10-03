import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  formatOAuthLoginElapsed,
  OAuthLoginTakeover,
  type OAuthLoginTakeoverProps,
  sanitizePtyOutput,
} from "./OAuthLoginTakeover";

function props(overrides: Partial<OAuthLoginTakeoverProps> = {}): OAuthLoginTakeoverProps {
  return {
    providerName: "Codex",
    sanitizedOutput: ["Avvio del login…", "Attendo l’accesso nel browser."],
    action: {
      instruction: "Apri il link nel browser e inserisci il codice temporaneo.",
      safeUrl: "https://example.com/device",
      userCode: "ABCD-EFGH",
    },
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
  it("shows connection, elapsed, copyable values and readable redacted PTY output", () => {
    const view = render(<OAuthLoginTakeover {...props({
      sanitizedOutput: [
        "\u001b[31mApri il browser\u001b[0m",
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
        "https://example.com/callback?access_token=very-secret-value&ok=1",
        "\"refresh_token\":\"another-secret-value\"",
        "\u0000Operazione in attesa",
      ],
    })} />);

    const heading = screen.getByRole("heading", { name: /completa l’accesso a codex/i });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveFocus();
    expect(screen.getByText("Connesso").closest("[role=status]")).not.toHaveTextContent("01:02");
    expect(screen.getByLabelText("Tempo trascorso 01:02")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/device")).toBeInTheDocument();
    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();

    const log = screen.getByRole("log", { name: /attività del login provider/i });
    expect(log).toHaveAttribute("aria-live", "off");
    expect(log).toHaveTextContent("Apri il browser");
    expect(log).toHaveTextContent("Bearer [redatto]");
    expect(log).toHaveTextContent("access_token=[redatto]");
    expect(log).not.toHaveTextContent("very-secret-value&ok=1");
    expect(log).toHaveTextContent("refresh_token\":[redatto]");
    expect(log.textContent).not.toContain("\u001b");
    expect(log).not.toHaveTextContent(/very-secret|another-secret|abcdefghijklmnop/i);
    expect(view.container.querySelector("input")).not.toBeInTheDocument();
  });

  it("copies the structured URL and code without parsing terminal text", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn().mockResolvedValue(undefined);
    render(<OAuthLoginTakeover {...props({ onCopy })} />);

    await user.click(screen.getByRole("button", { name: /copia url/i }));
    expect(onCopy).toHaveBeenLastCalledWith("https://example.com/device");
    expect(screen.getByText("URL copiato.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /copia codice/i }));
    expect(onCopy).toHaveBeenLastCalledWith("ABCD-EFGH");
    expect(screen.getByText("Codice copiato.")).toBeInTheDocument();
  });

  it("renders stdin only for an explicit request and never submits automatically", async () => {
    const user = userEvent.setup();
    const onSubmitInput = vi.fn().mockResolvedValue(undefined);
    render(<OAuthLoginTakeover {...props({
      action: {
        instruction: "Incolla il codice restituito dal browser.",
        inputRequest: {
          id: "browser-code",
          label: "Codice restituito",
          description: "Invialo soltanto dopo aver completato il browser.",
          placeholder: "Codice",
          submitLabel: "Continua",
        },
      },
      onSubmitInput,
    })} />);

    const input = screen.getByRole("textbox", { name: /codice restituito/i });
    const submit = screen.getByRole("button", { name: "Continua" });
    expect(input).toHaveAttribute("aria-describedby");
    expect(input).toHaveFocus();
    expect(submit).toBeDisabled();
    expect(onSubmitInput).not.toHaveBeenCalled();

    await user.type(input, "  risposta-utente  ");
    expect(onSubmitInput).not.toHaveBeenCalled();
    await user.click(submit);
    expect(onSubmitInput).toHaveBeenCalledOnce();
    expect(onSubmitInput).toHaveBeenCalledWith("risposta-utente");
    expect(input).toHaveValue("");
  });

  it("keeps a rejected input editable and reports a safe retry message", async () => {
    const user = userEvent.setup();
    const onSubmitInput = vi.fn().mockRejectedValue(new Error("raw backend secret"));
    render(<OAuthLoginTakeover {...props({
      action: {
        instruction: "Conferma nel terminale.",
        inputRequest: { id: "confirmation", label: "Risposta", secret: true },
      },
      onSubmitInput,
    })} />);

    const input = screen.getByLabelText("Risposta");
    expect(input).toHaveAttribute("type", "password");
    await user.type(input, "dato-temporaneo");
    await user.click(screen.getByRole("button", { name: /invia risposta/i }));

    expect(input).toHaveValue("dato-temporaneo");
    expect(screen.getByRole("alert")).toHaveTextContent(/sessione resta aperta/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/raw backend secret/i);
  });

  it("disables requested input while disconnected but keeps cancel and restart explicit", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn().mockRejectedValue(new Error("raw close failure"));
    const onRestart = vi.fn().mockResolvedValue(undefined);
    render(<OAuthLoginTakeover {...props({
      connectionState: "disconnected",
      action: {
        instruction: "La connessione si è interrotta.",
        inputRequest: { id: "answer", label: "Risposta" },
      },
      onCancel,
      onRestart,
    })} />);

    expect(screen.getByLabelText("Risposta")).toBeDisabled();
    expect(screen.getByText("Connessione interrotta")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(/annullare la sessione/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/raw close failure/i);

    await user.click(screen.getByRole("button", { name: /riavvia accesso/i }));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it("locks competing controls while an action is pending", async () => {
    const user = userEvent.setup();
    let finishCancel!: () => void;
    const onCancel = vi.fn(() => new Promise<void>((resolve) => { finishCancel = resolve; }));
    const onRestart = vi.fn().mockResolvedValue(undefined);
    render(<OAuthLoginTakeover {...props({ onCancel, onRestart })} />);

    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.getByRole("button", { name: /annullamento/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /riavvia accesso/i })).toBeDisabled();
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");
    expect(onRestart).not.toHaveBeenCalled();

    await act(async () => finishCancel());
    expect(screen.getByRole("button", { name: /riavvia accesso/i })).toBeEnabled();
  });

  it("bounds terminal history and resets typed input when the backend asks a new question", async () => {
    const user = userEvent.setup();
    const base = props({
      sanitizedOutput: Array.from({ length: 85 }, (_, index) => `riga-${index}`),
      action: { instruction: "Prima domanda", inputRequest: { id: "first", label: "Prima risposta" } },
    });
    const view = render(<OAuthLoginTakeover {...base} />);

    const log = screen.getByRole("log");
    expect(log).toHaveTextContent("5 righe precedenti omesse");
    expect(log).not.toHaveTextContent("riga-0");
    expect(log).toHaveTextContent("riga-84");

    await user.type(screen.getByLabelText("Prima risposta"), "bozza");
    view.rerender(<OAuthLoginTakeover {...base} action={{ instruction: "Seconda domanda", inputRequest: { id: "second", label: "Seconda risposta" } }} />);
    expect(screen.getByLabelText("Seconda risposta")).toHaveValue("");
  });
});

describe("OAuth login formatting helpers", () => {
  it("formats elapsed time without negative, NaN or overflowing minutes", () => {
    expect(formatOAuthLoginElapsed(-1)).toBe("00:00");
    expect(formatOAuthLoginElapsed(Number.NaN)).toBe("00:00");
    expect(formatOAuthLoginElapsed(3_723_000)).toBe("01:02:03");
  });

  it("never returns more than the bounded sanitized output", () => {
    const output = sanitizePtyOutput(["ok\rprogress", `sk-${"a".repeat(24)}`]);
    expect(output.lines).toHaveLength(3);
    expect(output.lines[1]).toBe("progress");
    expect(output.lines.join(" ")).not.toContain("sk-");
  });
});
