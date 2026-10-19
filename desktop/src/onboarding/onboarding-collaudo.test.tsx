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
