import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { describeError, ERROR_LOCALES } from "../lib/error-catalog";
import { ASSISTANCE_TEXT } from "./assistance.i18n";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";

vi.mock("../components/SshKeyPicker", () => ({
  default: ({ onChange }: { value: string; onChange: (path: string) => void }) => (
    <button type="button" onClick={() => onChange("/synthetic/private/id_ed25519")}>Scegli chiave SSH</button>
  ),
}));

const styles = readFileSync("src/onboarding/onboarding.css", "utf8");

function renderFlow(overrides: Partial<OnboardingFlowProps> = {}) {
  const props: OnboardingFlowProps = {
    account: { displayName: "Ada" },
    platform: "macos",
    runtime: { status: "collecting", stage: "host" },
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onRuntimeAction: vi.fn().mockResolvedValue(undefined),
    providerLogin: null,
    sshHostKey: null,
    onConfirmHostKey: vi.fn().mockResolvedValue(undefined),
    onCancelHostKey: vi.fn(),
    onProviderInput: vi.fn().mockResolvedValue(undefined),
    onProviderClose: vi.fn().mockResolvedValue(undefined),
    onProviderRestart: vi.fn().mockResolvedValue(undefined),
    onRetry: vi.fn().mockResolvedValue(undefined),
    onRestart: vi.fn().mockResolvedValue(undefined),
    onExitFailure: vi.fn(),
    onConnectExistingTeam: vi.fn(),
    ...overrides,
  };
  return { ...render(<OnboardingFlow {...props} />), props };
}

const follows = (first: Element, second: Element | null) =>
  Boolean(second && first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("a failed preparation step: the reason is next to the error", () => {
  const failed = {
    status: "failed" as const,
    stage: "runtime" as const,
    code: "runtime_install_failed",
    message: "La frase del catalogo per questo errore.",
    action: "Riprova fra un minuto.",
    retryable: true,
  };

  it("puts the catalog's sentence and its action right under the title, before the progress, the step list and the technical details", () => {
    renderFlow({ runtime: failed });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("La frase del catalogo per questo errore.");
    expect(alert).toHaveTextContent("Riprova fra un minuto.");
    const title = alert.closest("section")!.querySelector("h2")!;
    expect(follows(title, alert)).toBe(true);
    for (const selector of [".onboarding-runtime-progress", ".onboarding-runtime-track", ".onboarding-activity-details", ".onboarding-technical-details"]) {
      expect(follows(alert, document.querySelector(selector)), selector).toBe(true);
    }
    // the code stays where the technical person looks for it
    expect(document.querySelector(".onboarding-technical-details")).toHaveTextContent("runtime_install_failed");
  });

  it("leaves the status of a step that is still running below its progress, as it was", () => {
    renderFlow({ runtime: { status: "working", stage: "runtime", message: "Sto preparando l’ambiente." } });
    const status = screen.getByRole("status", { name: "" });
    expect(follows(document.querySelector(".onboarding-runtime-progress")!, status)).toBe(true);
  });
});

describe("the Environment step shows only what the choice made needs", () => {
  const t = ONBOARDING_TEXT.it;

  async function toEnvironment() {
    const user = userEvent.setup();
    const flow = renderFlow();
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    await screen.findByRole("heading", { name: /scegli l’ambiente/i });
    return { user, ...flow };
  }

  it("with «Questo computer» there is no browser assistance and no «team già attivo» block", async () => {
    await toEnvironment();
    expect(screen.getByRole("radio", { name: new RegExp(t.thisComputer) })).toBeChecked();
    expect(screen.queryByText(ASSISTANCE_TEXT.it.intro)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ASSISTANCE_TEXT.it.connect })).not.toBeInTheDocument();
    expect(screen.queryByText(/assistenza browser/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.existingTeam.verifyVps })).not.toBeInTheDocument();
  });

  it("with a VPS both blocks are there, as small cards and not as second full-height panels", async () => {
    const { user } = await toEnvironment();
    await user.click(screen.getByRole("radio", { name: new RegExp(t.vpsServer) }));
    const assistance = screen.getByText(ASSISTANCE_TEXT.it.intro).closest("section")!;
    const existing = screen.getByRole("button", { name: t.existingTeam.verifyVps }).closest("section")!;
    expect(assistance).toHaveClass("onboarding-aside");
    expect(existing).toHaveClass("onboarding-aside");
    expect(document.querySelectorAll("section.onboarding-panel")).toHaveLength(0);
  });

  it("styles those cards: a border, a title, muted text, and no minimum height of a whole panel", () => {
    const rule = (selector: string) => styles.match(new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule(".onboarding-aside")).toMatch(/border:/);
    expect(rule(".onboarding-aside")).not.toMatch(/min-height/);
    expect(rule(".onboarding-aside h3")).toMatch(/font-size:/);
    expect(rule(".onboarding-aside p")).toMatch(/color: var\(--color-muted\)/);
  });
});

describe("the SSH user is not guessed", () => {
  const t = ONBOARDING_TEXT.it;

  it("starts empty with an example as placeholder, and Continue waits for a user that is typed", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    await user.click(screen.getByRole("radio", { name: new RegExp(t.vpsServer) }));
    const field = screen.getByLabelText(t.sshUser);
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "es. ubuntu");
    await user.type(screen.getByLabelText(t.vpsAddress), "host.example.invalid");
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toBeDisabled();
    await user.type(field, "ubuntu");
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toBeEnabled();
  });

  it.each(Object.keys(ONBOARDING_TEXT) as (keyof typeof ONBOARDING_TEXT)[])("%s: the example is there and is not root", (locale) => {
    const example = ONBOARDING_TEXT[locale].sshUserPlaceholder;
    expect(example.trim()).not.toBe("");
    expect(example.toLowerCase()).not.toContain("root");
  });
});

describe("a team on a VPS needs the Google account", () => {
  const t = ONBOARDING_TEXT.it;
  const signIn = "Continua con Google";

  async function chooseVps(overrides: Partial<OnboardingFlowProps>) {
    const user = userEvent.setup();
    const flow = renderFlow(overrides);
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    await user.click(screen.getByRole("radio", { name: new RegExp(t.vpsServer) }));
    await user.type(screen.getByLabelText(t.vpsAddress), "host.example.invalid");
    await user.type(screen.getByLabelText(t.sshUser), "ubuntu");
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    return { user, ...flow };
  }

  it("says so in the Environment step, offers the way to the sign-in, and does not let the setup start", async () => {
    const onSignInWithGoogle = vi.fn();
    const { user } = await chooseVps({ account: { displayName: "Ada", identity: "local" }, onSignInWithGoogle });
    expect(screen.getByRole("note")).toHaveTextContent("Per una squadra su VPS serve accedere con Google");
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: signIn }));
    expect(onSignInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it("says nothing of the kind to a Google profile with a VPS, or to a local profile on this computer", async () => {
    await chooseVps({ account: { displayName: "Ada", identity: "google" } });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toBeEnabled();
  });

  it("does not show it for a local profile that chose this computer", async () => {
    const user = userEvent.setup();
    renderFlow({ account: { displayName: "Ada", identity: "local" } });
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: signIn })).not.toBeInTheDocument();
  });

  it.each(Object.keys(ONBOARDING_TEXT) as (keyof typeof ONBOARDING_TEXT)[])("%s: the sentence is there", (locale) => {
    expect(ONBOARDING_TEXT[locale].vpsNeedsGoogle).toMatch(/Google/);
  });
});

describe("pairing_token_missing does not tell a person without an account to sign back in", () => {
  it.each(ERROR_LOCALES)("%s: it names the Google account, and is not the expired-session sentence", (locale) => {
    const missing = describeError("pairing_token_missing", { locale });
    const invalid = describeError("pairing_token_invalid", { locale });
    expect(missing.text).toMatch(/Google/);
    expect(missing.action).toMatch(/Google/);
    expect(missing.text).not.toBe(invalid.text);
    expect(missing.known).toBe(true);
  });

  it("keeps the expired-session sentence for a token that was there and is not valid", () => {
    expect(describeError("pairing_token_invalid", { locale: "it" }).text).toBe("La sessione del tuo account non è più valida.");
    expect(describeError("pairing_token_missing", { locale: "it" }).text).toBe("Una squadra su VPS ha bisogno del tuo account Google.");
  });
});

describe("the SSH user of the setup step is not capitalised or corrected by the keyboard", () => {
  it("turns autocapitalize, autocorrect and spellcheck off", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: new RegExp(ONBOARDING_TEXT.it.startSetup) }));
    await user.click(screen.getByRole("radio", { name: new RegExp(ONBOARDING_TEXT.it.vpsServer) }));
    const field = screen.getByLabelText(ONBOARDING_TEXT.it.sshUser);
    expect(field).toHaveAttribute("autocapitalize", "off");
    expect(field).toHaveAttribute("autocorrect", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
  });
});

describe("Continue says why it is off", () => {
  const t = ONBOARDING_TEXT.it;
  const missing = () => document.getElementById("onboarding-vps-missing");

  async function vps(overrides: Partial<OnboardingFlowProps> = {}) {
    const user = userEvent.setup();
    renderFlow(overrides);
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    await user.click(screen.getByRole("radio", { name: new RegExp(t.vpsServer) }));
    return user;
  }

  it("lists what the VPS form still lacks, and the list shrinks as it is filled", async () => {
    const user = await vps();
    expect(missing()).toHaveTextContent("Per continuare manca ancora: l’indirizzo VPS, l’utente SSH e il file della chiave privata.");
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toHaveAttribute("aria-describedby", "onboarding-vps-missing");
    await user.type(screen.getByLabelText(t.vpsAddress), "host.example.invalid");
    expect(missing()).toHaveTextContent("manca ancora: l’utente SSH e il file della chiave privata.");
    await user.type(screen.getByLabelText(t.sshUser), "ubuntu");
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    expect(missing()).toBeNull();
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toBeEnabled();
  });

  it("names a port that is not valid, and says nothing on «Questo computer»", async () => {
    const user = await vps();
    await user.clear(screen.getByLabelText(t.sshPort));
    expect(missing()).toHaveTextContent("una porta valida");
    await user.click(screen.getByRole("radio", { name: new RegExp(t.thisComputer) }));
    expect(missing()).toBeNull();
  });

  it("names what the form lacks AND the Google note to a local profile on a VPS, and the button points at both", async () => {
    const user = await vps({ account: { displayName: "Ada", identity: "local" } });
    expect(missing()).toHaveTextContent("Per continuare manca ancora: l’indirizzo VPS, l’utente SSH e il file della chiave privata.");
    expect(screen.getByRole("note")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /^continua(?! con google)/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-describedby", "onboarding-vps-missing onboarding-vps-account");
    expect(document.getElementById("onboarding-vps-account")).toHaveTextContent(t.vpsNeedsGoogle);
    // filled in, the button is still off: the Google note is the only reason left, and the list is gone
    await user.type(screen.getByLabelText(t.vpsAddress), "host.example.invalid");
    await user.type(screen.getByLabelText(t.sshUser), "ubuntu");
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    expect(missing()).toBeNull();
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toHaveAttribute("aria-describedby", "onboarding-vps-account");
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toBeDisabled();
  });

  it.each(Object.keys(ONBOARDING_TEXT) as (keyof typeof ONBOARDING_TEXT)[])("%s: the example is there and is not root", (locale) => {
    const example = ONBOARDING_TEXT[locale].sshUserPlaceholder;
    expect(example.trim()).not.toBe("");
    expect(example.toLowerCase()).not.toContain("root");
  });
});

describe("a team on a VPS needs the Google account", () => {
  const t = ONBOARDING_TEXT.it;
  const signIn = "Continua con Google";

  async function chooseVps(overrides: Partial<OnboardingFlowProps>) {
    const user = userEvent.setup();
    const flow = renderFlow(overrides);
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    await user.click(screen.getByRole("radio", { name: new RegExp(t.vpsServer) }));
    await user.type(screen.getByLabelText(t.vpsAddress), "host.example.invalid");
    await user.type(screen.getByLabelText(t.sshUser), "ubuntu");
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    return { user, ...flow };
  }

  it("says so in the Environment step, offers the way to the sign-in, and does not let the setup start", async () => {
    const onSignInWithGoogle = vi.fn();
    const { user } = await chooseVps({ account: { displayName: "Ada", identity: "local" }, onSignInWithGoogle });
    expect(screen.getByRole("note")).toHaveTextContent("Per una squadra su VPS serve accedere con Google");
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: signIn }));
    expect(onSignInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it("says nothing of the kind to a Google profile with a VPS, or to a local profile on this computer", async () => {
    await chooseVps({ account: { displayName: "Ada", identity: "google" } });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toBeEnabled();
  });

  it("does not show it for a local profile that chose this computer", async () => {
    const user = userEvent.setup();
    renderFlow({ account: { displayName: "Ada", identity: "local" } });
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: signIn })).not.toBeInTheDocument();
  });

  it.each(Object.keys(ONBOARDING_TEXT) as (keyof typeof ONBOARDING_TEXT)[])("%s: the sentence is there", (locale) => {
    expect(ONBOARDING_TEXT[locale].vpsNeedsGoogle).toMatch(/Google/);
  });
});

describe("pairing_token_missing does not tell a person without an account to sign back in", () => {
  it.each(ERROR_LOCALES)("%s: it names the Google account, and is not the expired-session sentence", (locale) => {
    const missing = describeError("pairing_token_missing", { locale });
    const invalid = describeError("pairing_token_invalid", { locale });
    expect(missing.text).toMatch(/Google/);
    expect(missing.action).toMatch(/Google/);
    expect(missing.text).not.toBe(invalid.text);
    expect(missing.known).toBe(true);
  });

  it("keeps the expired-session sentence for a token that was there and is not valid", () => {
    expect(describeError("pairing_token_invalid", { locale: "it" }).text).toBe("La sessione del tuo account non è più valida.");
    expect(describeError("pairing_token_missing", { locale: "it" }).text).toBe("Una squadra su VPS ha bisogno del tuo account Google.");
  });
});

describe("the SSH user of the setup step is not capitalised or corrected by the keyboard", () => {
  it("turns autocapitalize, autocorrect and spellcheck off", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: new RegExp(ONBOARDING_TEXT.it.startSetup) }));
    await user.click(screen.getByRole("radio", { name: new RegExp(ONBOARDING_TEXT.it.vpsServer) }));
    const field = screen.getByLabelText(ONBOARDING_TEXT.it.sshUser);
    expect(field).toHaveAttribute("autocapitalize", "off");
    expect(field).toHaveAttribute("autocorrect", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
  });
});

describe("Continue says why it is off", () => {
  const t = ONBOARDING_TEXT.it;
  const missing = () => document.getElementById("onboarding-vps-missing");

  async function vps(overrides: Partial<OnboardingFlowProps> = {}) {
    const user = userEvent.setup();
    renderFlow(overrides);
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    await user.click(screen.getByRole("radio", { name: new RegExp(t.vpsServer) }));
    return user;
  }

  it("lists what the VPS form still lacks, and the list shrinks as it is filled", async () => {
    const user = await vps();
    expect(missing()).toHaveTextContent("Per continuare manca ancora: l’indirizzo VPS, l’utente SSH e il file della chiave privata.");
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toHaveAttribute("aria-describedby", "onboarding-vps-missing");
    await user.type(screen.getByLabelText(t.vpsAddress), "host.example.invalid");
    expect(missing()).toHaveTextContent("manca ancora: l’utente SSH e il file della chiave privata.");
    await user.type(screen.getByLabelText(t.sshUser), "ubuntu");
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    expect(missing()).toBeNull();
    expect(screen.getByRole("button", { name: /^continua(?! con google)/i })).toBeEnabled();
  });

  it("names a port that is not valid, and says nothing on «Questo computer»", async () => {
    const user = await vps();
    await user.clear(screen.getByLabelText(t.sshPort));
    expect(missing()).toHaveTextContent("una porta valida");
    await user.click(screen.getByRole("radio", { name: new RegExp(t.thisComputer) }));
    expect(missing()).toBeNull();
  });

  it("names both reasons for a local profile on a VPS: the form's gaps and the Google account, and keeps the account once the form is full", async () => {
    const user = await vps({ account: { displayName: "Ada", identity: "local" } });
    const next = () => screen.getByRole("button", { name: /^continua(?! con google)/i });
    expect(missing()).toHaveTextContent("l’indirizzo VPS, l’utente SSH e il file della chiave privata");
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    expect(next()).toHaveAttribute("aria-describedby", "onboarding-vps-missing onboarding-vps-account");
    await user.type(screen.getByLabelText(t.vpsAddress), "host.example.invalid");
    await user.type(screen.getByLabelText(t.sshUser), "ubuntu");
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    expect(missing()).toBeNull();
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    expect(next()).toHaveAttribute("aria-describedby", "onboarding-vps-account");
  });

  it.each(Object.keys(ONBOARDING_TEXT) as (keyof typeof ONBOARDING_TEXT)[])("%s: the sentence has its slot and all four items are named", (locale) => {
    const text = ONBOARDING_TEXT[locale];
    expect(text.vpsMissing).toContain("{list}");
    for (const item of Object.values(text.vpsMissingItems)) expect(item.trim()).not.toBe("");
  });
});

describe("the SSH key is named as the PRIVATE key, once", () => {
  it("shows the field label, and under the picker where the key usually is and which file is not it", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: new RegExp(ONBOARDING_TEXT.it.startSetup) }));
    await user.click(screen.getByRole("radio", { name: new RegExp(ONBOARDING_TEXT.it.vpsServer) }));
    expect(screen.getByText("Chiave SSH privata")).toBeInTheDocument();
    const hint = screen.getByText(/di solito nella cartella ~\/\.ssh/);
    expect(hint).toHaveTextContent("Non quello che finisce in .pub");
    expect(hint).toHaveTextContent("Resta su questo computer");
    expect(hint.closest(".onboarding-field")).toContainElement(screen.getByText("Chiave SSH privata"));
  });

  it.each(Object.keys(ONBOARDING_TEXT) as (keyof typeof ONBOARDING_TEXT)[])("%s: the two labels differ, and the hint gives the folder and the .pub warning", (locale) => {
    const text = ONBOARDING_TEXT[locale];
    expect(text.sshKey).not.toBe(text.sshKeyPicker.label);
    expect(text.sshKeyHint).toContain("~/.ssh");
    expect(text.sshKeyHint).toContain(".pub");
    // the promise after the warning: the key stays on this computer
    expect(text.sshKeyHint.split(".pub")[1].length).toBeGreaterThan(20);
  });
});
