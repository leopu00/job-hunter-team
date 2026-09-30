import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps, OnboardingProfileDraft, OnboardingRuntimeState } from "../lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";

const PROFILE: OnboardingProfileDraft = {
  fullName: "Ada Rossi",
  targetRole: "Frontend Engineer",
  location: "Torino",
  experienceYears: 6,
  skills: ["React", "TypeScript"],
  languages: ["Italiano", "Inglese"],
  workMode: "remote",
  notes: "No fintech",
};

function renderFlow(overrides: Partial<OnboardingFlowProps> = {}) {
  const props: OnboardingFlowProps = {
    account: { displayName: "Ada" },
    runtime: { status: "collecting", stage: "profile" },
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onRuntimeAction: vi.fn().mockResolvedValue(undefined),
    onRetry: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<OnboardingFlow {...props} />), props };
}

async function reachProfile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /inizia la configurazione/i }));
}

async function fillProfile(user: ReturnType<typeof userEvent.setup>) {
  await reachProfile(user);
  await user.clear(screen.getByLabelText(/nome completo/i));
  await user.type(screen.getByLabelText(/nome completo/i), " Ada Rossi ");
  await user.type(screen.getByLabelText(/ruolo obiettivo/i), " Frontend Engineer ");
  await user.type(screen.getByLabelText(/^località/i), " Torino ");
  await user.clear(screen.getByLabelText(/anni di esperienza/i));
  await user.type(screen.getByLabelText(/anni di esperienza/i), "6");
  await user.click(screen.getByRole("button", { name: /continua/i }));
  await user.type(screen.getByLabelText(/competenze principali/i), "React, TypeScript, React");
  await user.type(screen.getByLabelText(/^lingue/i), "Italiano, Inglese");
  await user.selectOptions(screen.getByLabelText(/modalità di lavoro/i), "remote");
  await user.type(screen.getByLabelText(/note per la squadra/i), "  No fintech  ");
  await user.click(screen.getByRole("button", { name: /continua/i }));
}

async function chooseProviderAndReview(user: ReturnType<typeof userEvent.setup>, provider = "Claude Code") {
  await user.click(screen.getByRole("button", { name: /continua/i }));
  await user.click(screen.getByRole("radio", { name: new RegExp(provider, "i") }));
  await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
}

describe("OnboardingFlow", () => {
  it("welcomes the Google account and never asks for an API key", async () => {
    const user = userEvent.setup();
    renderFlow();

    expect(screen.getByRole("heading", { name: "Ciao, Ada." })).toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
    await reachProfile(user);
    expect(screen.getByLabelText(/nome completo/i)).toHaveValue("Ada");
  });

  it("requires core data, two unique skills and one language", async () => {
    const user = userEvent.setup();
    renderFlow({ account: { displayName: null } });

    await reachProfile(user);
    expect(screen.getByRole("button", { name: /continua/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/nome completo/i), "Ada Rossi");
    await user.type(screen.getByLabelText(/ruolo obiettivo/i), "Engineer");
    await user.type(screen.getByLabelText(/^località/i), "Torino");
    await user.click(screen.getByRole("button", { name: /continua/i }));

    const next = screen.getByRole("button", { name: /continua/i });
    await user.type(screen.getByLabelText(/competenze principali/i), "React, React");
    await user.type(screen.getByLabelText(/^lingue/i), "Italiano");
    expect(next).toBeDisabled();
    await user.type(screen.getByLabelText(/competenze principali/i), ", TypeScript");
    expect(next).toBeEnabled();
  });

  it("collects a complete VPS transport without reading key contents", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderFlow({ runtime: { status: "collecting", stage: "host" }, initialDraft: PROFILE, onSubmit });

    await user.click(screen.getByRole("radio", { name: /server vps/i }));
    await user.type(screen.getByLabelText(/indirizzo vps/i), "vps.example.test");
    expect(screen.getByLabelText(/utente ssh/i)).toHaveValue("root");
    expect(screen.getByLabelText(/porta ssh/i)).toHaveValue(22);
    await user.type(screen.getByLabelText(/file chiave ssh/i), "/tmp/test-key");
    await user.click(screen.getByRole("button", { name: /continua/i }));
    await user.click(screen.getByRole("radio", { name: /codex/i }));
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    await user.click(screen.getByRole("button", { name: /prepara la squadra/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      profile: PROFILE,
      host: { kind: "vps", address: "vps.example.test", user: "root", port: 22, keyPath: "/tmp/test-key" },
      provider: "codex",
    });
  });

  it("submits normalized local setup and does not advance optimistically", async () => {
    const user = userEvent.setup();
    let resolveSubmit!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { resolveSubmit = resolve; }));
    renderFlow({ account: { displayName: null }, onSubmit });

    await fillProfile(user);
    await chooseProviderAndReview(user);
    await user.click(screen.getByRole("button", { name: /prepara la squadra/i }));

    expect(onSubmit).toHaveBeenCalledWith({ profile: PROFILE, host: { kind: "local" }, provider: "claude" });
    expect(screen.getByRole("button", { name: /avvio del setup/i })).toBeDisabled();
    expect(screen.queryByText(/prepariamo: runtime/i)).not.toBeInTheDocument();
    resolveSubmit();
    await waitFor(() => expect(screen.getByRole("button", { name: /prepara la squadra/i })).toBeEnabled());
  });

  it("opens only the requested provider login and remains on the same stage", async () => {
    const user = userEvent.setup();
    let resolveAction!: () => void;
    const onRuntimeAction = vi.fn(() => new Promise<void>((resolve) => { resolveAction = resolve; }));
    const runtime: OnboardingRuntimeState = { status: "action-required", stage: "provider-login", message: "Completa il login ufficiale." };
    renderFlow({ runtime, onRuntimeAction });

    await user.click(screen.getByRole("button", { name: /accedi al provider/i }));
    expect(onRuntimeAction).toHaveBeenCalledWith("provider-login");
    expect(screen.getByRole("button", { name: /attendi/i })).toBeDisabled();
    resolveAction();
    expect(await screen.findByRole("button", { name: /accedi al provider/i })).toBeEnabled();
    expect(screen.getByText(/completa il login ufficiale/i)).toBeInTheDocument();
  });

  it("opens the Assistant only when its runtime stage requests it", async () => {
    const user = userEvent.setup();
    const onRuntimeAction = vi.fn().mockResolvedValue(undefined);
    renderFlow({ runtime: { status: "action-required", stage: "assistant", message: "Presentati al tuo Assistente." }, onRuntimeAction });

    await user.click(screen.getByRole("button", { name: /apri l’assistente/i }));
    expect(onRuntimeAction).toHaveBeenCalledWith("assistant");
  });

  it("retries the exact failed stage without hiding its message", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    renderFlow({ runtime: { status: "failed", stage: "team-start", message: "Il container non risponde." }, onRetry });

    expect(screen.getByRole("alert")).toHaveTextContent(/container non risponde/i);
    await user.click(screen.getByRole("button", { name: /riprova questo passaggio/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the team as ready only from verified runtime state", () => {
    renderFlow({ runtime: { status: "ready" } });
    expect(screen.getByRole("heading", { name: /squadra è pronta/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/agenti pronti/i)).toHaveTextContent("Assistente");
  });
});
