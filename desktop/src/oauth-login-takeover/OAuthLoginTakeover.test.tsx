import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import {
  DEVICE_CODE_LIFETIME_MS,
  formatOAuthLoginElapsed,
  NO_REQUEST_HINT_AFTER_MS,
  OAuthLoginTakeover,
  type OAuthLoginTakeoverProps,
} from "./OAuthLoginTakeover";
import { TAKEOVER_TEXT } from "./oauth-login-takeover.i18n";

// the wording of the screen is the app's language: these cases are in Italian
beforeEach(() => localStorage.setItem("jht-lang", "it"));
afterEach(() => localStorage.removeItem("jht-lang"));

function props(overrides: Partial<OAuthLoginTakeoverProps> = {}): OAuthLoginTakeoverProps {
  return {
    provider: "codex",
    providerName: "Codex",
    actions: [{ kind: "url", instruction: "Apri il link verificato.", safeUrl: "https://auth.openai.com/device" }],
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
    expect(screen.getByText("https://auth.openai.com/device")).toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
    expect(view.container.querySelector("input")).not.toBeInTheDocument();
  });

  it("keeps Codex URL and device code visible together and copies only on explicit gestures", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn().mockResolvedValue(undefined);
    const base = props({ onCopy });
    const view = render(<OAuthLoginTakeover {...base} />);
    const copyUrl = screen.getByRole("button", { name: /copia url/i });
    await user.click(copyUrl);
    expect(onCopy).toHaveBeenLastCalledWith("https://auth.openai.com/device");
    expect(copyUrl).toHaveFocus();

    view.rerender(<OAuthLoginTakeover {...base} actions={[
      ...base.actions,
      { kind: "code", instruction: "Inserisci il codice.", userCode: "ABCD-EFGH" },
    ]} />);
    expect(screen.getByText("Codice dispositivo").closest("div")).toHaveFocus();
    expect(screen.getByRole("button", { name: /copia url/i })).toBeInTheDocument();
    const copyCode = screen.getByRole("button", { name: /copia codice/i });
    await user.click(copyCode);
    expect(onCopy).toHaveBeenLastCalledWith("ABCD-EFGH");
    expect(copyCode).toHaveFocus();
    expect(onCopy).toHaveBeenCalledTimes(2);
  });

  it("copies only the canonical allowlisted URL", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn().mockResolvedValue(undefined);
    render(<OAuthLoginTakeover {...props({
      actions: [{ kind: "url", instruction: "Apri il link verificato.", safeUrl: "https://AUTH.OPENAI.COM/device" }],
      onCopy,
    })} />);

    expect(screen.getByText("https://auth.openai.com/device")).toBeInTheDocument();
    expect(onCopy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /copia url/i }));
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledWith("https://auth.openai.com/device");
  });

  it("rejects an URL with terminal residue without showing or copying it", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn().mockResolvedValue(undefined);
    const onRestart = vi.fn().mockResolvedValue(undefined);
    render(<OAuthLoginTakeover {...props({
      actions: [
        { kind: "url", instruction: "Testo non attendibile.", safeUrl: "https://auth.openai.com/device\u001b[0m" },
        { kind: "code", instruction: "Inserisci il codice.", userCode: "ABCD-EFGH" },
      ],
      onCopy,
      onRestart,
    })} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Il provider ha restituito un indirizzo non valido");
    expect(screen.queryByText(/auth\.openai\.com/i)).not.toBeInTheDocument();
    expect(screen.queryByText("ABCD-EFGH")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copia/i })).not.toBeInTheDocument();
    expect(onCopy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /riavvia accesso/i }));
    expect(onRestart).toHaveBeenCalledOnce();
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
      { kind: "url", instruction: "Apri il browser.", safeUrl: "https://auth.openai.com/device" },
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
    expect(screen.getByText("https://auth.openai.com/device")).toBeInTheDocument();
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

const DEVICE: OAuthLoginTakeoverProps["actions"] = [
  { kind: "url", instruction: "Apri l’indirizzo e inserisci il codice temporaneo.", safeUrl: "https://auth.openai.com/codex/device" },
  { kind: "code", instruction: "Apri l’indirizzo e inserisci il codice temporaneo.", userCode: "VXTP-0BB30" },
];

describe("OAuthLoginTakeover, the device login of Codex", () => {
  it("shows the address and the code in the clear, with copy and open-in-browser, and the way out", async () => {
    const user = userEvent.setup();
    const onOpenUrl = vi.fn().mockResolvedValue(true);
    render(<OAuthLoginTakeover {...props({ actions: DEVICE, onOpenUrl })} />);
    expect(screen.getByText("https://auth.openai.com/codex/device")).toBeInTheDocument();
    expect(screen.getByText("VXTP-0BB30")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apri nel browser" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://auth.openai.com/codex/device");
    expect(screen.getByRole("button", { name: "Annulla" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Riavvia accesso" })).toBeEnabled();
  });

  it("says so when the browser cannot be opened, and keeps the address to copy", async () => {
    const user = userEvent.setup();
    render(<OAuthLoginTakeover {...props({ actions: DEVICE, onOpenUrl: vi.fn().mockResolvedValue(false) })} />);
    await user.click(screen.getByRole("button", { name: "Apri nel browser" }));
    expect(screen.getByText(TAKEOVER_TEXT.it.openFailed)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copia URL" })).toBeEnabled();
  });

  it("counts down the 15 minutes of the code from when it appeared, and says when it has expired", () => {
    const view = render(<OAuthLoginTakeover {...props({ actions: DEVICE, elapsedMs: 40_000 })} />);
    expect(screen.getByTestId("oauth-code-expiry")).toHaveTextContent("Il codice scade tra 15:00.");
    view.rerender(<OAuthLoginTakeover {...props({ actions: DEVICE, elapsedMs: 40_000 + 5 * 60_000 })} />);
    expect(screen.getByTestId("oauth-code-expiry")).toHaveTextContent("Il codice scade tra 10:00.");
    view.rerender(<OAuthLoginTakeover {...props({ actions: DEVICE, elapsedMs: 40_000 + DEVICE_CODE_LIFETIME_MS })} />);
    expect(screen.queryByTestId("oauth-code-expiry")).not.toBeInTheDocument();
    expect(screen.getByTestId("oauth-login-error")).toHaveTextContent(TAKEOVER_TEXT.it.expired);
    expect(screen.getByRole("button", { name: "Copia codice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apri nel browser" })).toBeDisabled();
    // an expired code is not the end: «Restart» is there, and so is «Cancel»
    expect(screen.getByRole("button", { name: "Riavvia accesso" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Annulla" })).toBeEnabled();
  });

  it("a new code starts its own 15 minutes", () => {
    const view = render(<OAuthLoginTakeover {...props({ actions: DEVICE, elapsedMs: 0 })} />);
    view.rerender(<OAuthLoginTakeover {...props({ actions: DEVICE, elapsedMs: DEVICE_CODE_LIFETIME_MS + 1_000 })} />);
    expect(screen.getByTestId("oauth-login-error")).toBeInTheDocument();
    const next: OAuthLoginTakeoverProps["actions"] = [DEVICE[0], { ...DEVICE[1], userCode: "ABCD-12345" } as (typeof DEVICE)[1]];
    view.rerender(<OAuthLoginTakeover {...props({ actions: next, elapsedMs: DEVICE_CODE_LIFETIME_MS + 2_000 })} />);
    expect(screen.queryByTestId("oauth-login-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("oauth-code-expiry")).toHaveTextContent("15:00");
  });

  it("with no request from the provider it shows the wait, then says what to do, and always offers Cancel", () => {
    const view = render(<OAuthLoginTakeover {...props({ actions: [], connectionState: "connecting", elapsedMs: 3_000 })} />);
    expect(screen.getByText(TAKEOVER_TEXT.it.waiting)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annulla" })).toBeEnabled();
    view.rerender(<OAuthLoginTakeover {...props({ actions: [], connectionState: "connecting", elapsedMs: NO_REQUEST_HINT_AFTER_MS + 1_000 })} />);
    expect(screen.getByText(TAKEOVER_TEXT.it.waitingLong)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annulla" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Riavvia accesso" })).toBeEnabled();
  });
});

describe("the words of the sign-in screen", () => {
  it.each(locales)("%s: are all there, and the screen speaks that language", (locale) => {
    const text = TAKEOVER_TEXT[locale];
    for (const [key, value] of Object.entries(text)) {
      const written = typeof value === "function" ? value("Codex") : value;
      expect(written.trim().length, `${locale}.${key}`).toBeGreaterThan(1);
    }
    render(<OAuthLoginTakeover {...props({ actions: DEVICE, locale })} />);
    expect(screen.getByRole("button", { name: text.cancel })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: text.openBrowser })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: text.title("Codex") })).toBeInTheDocument();
  });

  it("does not leave the other languages with the Italian words", () => {
    for (const locale of locales.filter((entry) => entry !== "it")) {
      expect(TAKEOVER_TEXT[locale].cancel, locale).not.toBe(TAKEOVER_TEXT.it.cancel);
      expect(TAKEOVER_TEXT[locale].waiting, locale).not.toBe(TAKEOVER_TEXT.it.waiting);
    }
    // Portuguese of Portugal says «equipa» and «ecrã», not the Brazilian forms
    expect(JSON.stringify(TAKEOVER_TEXT.pt)).not.toMatch(/equipe|tela|usuário/i);
  });
});
