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
