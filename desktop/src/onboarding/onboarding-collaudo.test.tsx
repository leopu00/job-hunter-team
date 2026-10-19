import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
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
