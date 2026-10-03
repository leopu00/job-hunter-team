import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";

vi.mock("../components/SshKeyPicker", () => ({
  default: ({ value, onChange }: { value: string; onChange: (path: string) => void }) => (
    <div>
      <button type="button" onClick={() => onChange("/synthetic/private/id_ed25519")}>Scegli chiave SSH</button>
      {value && <><span>id_ed25519</span><button type="button" onClick={() => onChange("")}>Rimuovi chiave</button></>}
    </div>
  ),
}));

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
    onRetry: vi.fn().mockResolvedValue(undefined),
    onRestart: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<OnboardingFlow {...props} />), props };
}

async function begin(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /inizia la configurazione/i }));
  await screen.findByRole("heading", { name: /scegli l’ambiente/i });
}

async function reachProviderLocal(user: ReturnType<typeof userEvent.setup>) {
  await begin(user);
  await user.click(screen.getByRole("button", { name: /^continua/i }));
  await screen.findByRole("heading", { name: /scegli il provider/i });
}

describe("OnboardingFlow technical setup", () => {
  it("uses the Google name only in the greeting and never asks personal questions", async () => {
    const user = userEvent.setup();
    renderFlow();

    expect(screen.getByRole("heading", { name: "Ciao, Ada." })).toBeInTheDocument();
    expect(screen.queryByText(/configura il tuo profilo/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/nome completo|ruolo obiettivo|località|anni di esperienza|competenze|lingue|modalità di lavoro|note/i)).not.toBeInTheDocument();

    await begin(user);
    expect(screen.queryByText(/configura il tuo profilo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/partiamo da te|mettiamo a fuoco il profilo/i)).not.toBeInTheDocument();
  });

  it.each([
    ["Claude Code", "claude"],
    ["Codex", "codex"],
    ["Kimi", "kimi"],
  ] as const)("lets a local identity choose %s without exposing more personal fields", async (label, provider) => {
    const user = userEvent.setup();
    const { props } = renderFlow({ account: { displayName: "Ada Locale", identity: "local" } });

    expect(screen.getByText("Profilo locale attivo")).toBeInTheDocument();
    expect(screen.getByText(/nome resta su questo dispositivo/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/ruolo|esperienza|località/i)).not.toBeInTheDocument();
    await reachProviderLocal(user);
    await user.click(screen.getByRole("radio", { name: new RegExp(label, "i") }));
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    await user.click(screen.getByRole("button", { name: /prepara la squadra/i }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({
      host: { kind: "local" },
      provider,
    }));
  });

  it("submits only host and provider for the local path", async () => {
    const user = userEvent.setup();
    const { props } = renderFlow();
    await reachProviderLocal(user);
    await user.click(screen.getByRole("radio", { name: /Claude Code/i }));
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    await user.click(screen.getByRole("button", { name: /prepara la squadra/i }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({
      host: { kind: "local" },
      provider: "claude",
    }));
    expect(Object.keys(vi.mocked(props.onSubmit).mock.calls[0][0]).sort()).toEqual(["host", "provider"]);
  });

  it("supports arrow-key selection and focuses every new step", async () => {
    const user = userEvent.setup();
    renderFlow();
    await begin(user);
    expect(screen.getByRole("heading", { name: /scegli l’ambiente/i })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("radio", { name: /questo computer/i })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /server VPS/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /server VPS/i })).toHaveFocus();

    await user.type(screen.getByLabelText(/indirizzo VPS/i), "host.example.invalid");
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    await user.click(screen.getByRole("button", { name: /^continua/i }));
    expect(screen.getByRole("heading", { name: /scegli il provider/i })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("radio", { name: /Claude Code/i })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Codex/i })).toHaveAttribute("aria-checked", "true");
  });

  it("restores focus to the greeting when navigating back", async () => {
    const user = userEvent.setup();
    renderFlow();
    await begin(user);
    await user.click(screen.getByRole("button", { name: /indietro/i }));
    expect(screen.getByRole("heading", { name: "Ciao, Ada." })).toHaveFocus();
  });

  it("keeps the full SSH path out of the DOM but includes it in the VPS submission", async () => {
    const user = userEvent.setup();
    const { props } = renderFlow();
    await begin(user);
    await user.click(screen.getByRole("radio", { name: /server VPS/i }));
    await user.type(screen.getByLabelText(/indirizzo VPS/i), " host.example.invalid ");
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    expect(screen.getByText("id_ed25519")).toBeInTheDocument();
    expect(screen.queryByText("/synthetic/private/id_ed25519")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^continua/i }));
    await user.click(screen.getByRole("radio", { name: /Kimi/i }));
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    await user.click(screen.getByRole("button", { name: /prepara la squadra/i }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({
      host: {
        kind: "vps",
        address: "host.example.invalid",
        user: "root",
        port: 22,
        keyPath: "/synthetic/private/id_ed25519",
      },
      provider: "kimi",
    }));
  });

  it("requires VPS fields and a selected key when local runtime is unsupported", async () => {
    const user = userEvent.setup();
    renderFlow({ platform: "windows" });
    await begin(user);
    expect(screen.queryByRole("radio", { name: /questo computer/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^continua/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/indirizzo VPS/i), "host.example.invalid");
    expect(screen.getByRole("button", { name: /^continua/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    expect(screen.getByRole("button", { name: /^continua/i })).toBeEnabled();
  });

  it("keeps runtime errors at their verified stage and retries without advancing", async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    renderFlow({
      runtime: { status: "failed", stage: "container", message: "Podman è attivo ma il container non risponde." },
      onRetry,
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Podman è attivo ma il container non risponde.");
    expect(screen.getAllByText("Container")).not.toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: /riprova questo passaggio/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows verified step progress, elapsed time and a sanitized activity timeline", async () => {
    const startedAt = Date.now();
    renderFlow({
      runtime: { status: "working", stage: "container", message: "Preparo il container." },
      activity: {
        startedAt,
        invocation: 1,
        lastSequence: 3,
        current: {
          id: "1:container:2",
          invocation: 1,
          nativeStage: "container",
          sequence: 2,
          stage: "container",
          name: "Preparazione container",
          description: "Verifico lo stato del container.",
          elapsedMs: 2_000,
          stageElapsedMs: 2_000,
          updatedAt: startedAt,
          status: "active",
        },
        events: [
          {
            id: "1:engine:1",
            invocation: 1,
            nativeStage: "engine",
            sequence: 1,
            stage: "runtime",
            name: "Verifica ambiente",
            description: "Ambiente verificato.",
            elapsedMs: 1_000,
            stageElapsedMs: 1_000,
            updatedAt: startedAt,
            status: "completed",
          },
          {
            id: "1:container:2",
            invocation: 1,
            nativeStage: "container",
            sequence: 2,
            stage: "container",
            name: "Preparazione container",
            description: "Verifico lo stato del container.",
            elapsedMs: 2_000,
            stageElapsedMs: 2_000,
            updatedAt: startedAt,
            status: "active",
          },
          {
            id: "1:provider:3",
            invocation: 1,
            nativeStage: "provider",
            sequence: 3,
            stage: "provider",
            name: "Configurazione provider",
            description: "Configurazione interrotta.",
            elapsedMs: 3_000,
            stageElapsedMs: 1_000,
            updatedAt: startedAt,
            status: "failed",
          },
        ],
      },
    });

    expect(screen.getAllByText("Preparazione container")).toHaveLength(2);
    expect(screen.getAllByText("Verifico lo stato del container.")).toHaveLength(2);
    expect(screen.getByText(/Trascorso/)).toHaveTextContent(/00:0\d/);
    expect(screen.getByRole("progressbar", { name: "Passaggi completati" })).toHaveAttribute("value", "2");
    expect(screen.getByRole("progressbar", { name: "Passaggi completati" })).toHaveAttribute("max", "7");
    const activeProgress = screen.getByRole("progressbar", { name: "Avanzamento Preparazione container" });
    expect(activeProgress).toHaveAttribute("aria-valuetext", "Operazione in corso; percentuale non disponibile");
    expect(activeProgress).not.toHaveAttribute("aria-valuenow");

    await userEvent.click(screen.getByText(/Dettagli attività/));
    expect(screen.getByText("Completato")).toBeInTheDocument();
    expect(screen.getAllByText("In corso")).toHaveLength(2);
    expect(screen.getByText("Errore")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\bETA\b|tempo stimato/i);
  });

  it("offers a non-destructive restart even when the current failure cannot be retried", async () => {
    const onRestart = vi.fn().mockResolvedValue(undefined);
    renderFlow({
      runtime: {
        status: "failed",
        stage: "assistant",
        message: "Assistente non pronto.",
        retryable: false,
      },
      onRestart,
    });

    expect(screen.queryByRole("button", { name: /riprova questo passaggio/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Riparti da capo" }));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it("shows provider progress and invokes only the required interactive action", async () => {
    const onRuntimeAction = vi.fn().mockResolvedValue(undefined);
    renderFlow({
      runtime: { status: "action-required", stage: "provider-login", message: "Accedi con l’abbonamento scelto." },
      onRuntimeAction,
    });
    await userEvent.click(screen.getByRole("button", { name: /accedi al provider/i }));
    expect(onRuntimeAction).toHaveBeenCalledWith("provider-login");
  });

  it("starts a resumed team only from its explicit action", async () => {
    const onRuntimeAction = vi.fn().mockResolvedValue(undefined);
    renderFlow({
      runtime: {
        status: "action-required",
        stage: "team-start",
        message: "Le sessioni del team sono ferme.",
      },
      onRuntimeAction,
    });

    expect(onRuntimeAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /avvia la squadra/i }));
    expect(onRuntimeAction).toHaveBeenCalledOnce();
    expect(onRuntimeAction).toHaveBeenCalledWith("team-start");
  });

  it("does not present the previous completed operation as the current manual action", () => {
    const now = Date.now();
    renderFlow({
      runtime: { status: "action-required", stage: "provider-login", message: "Accedi con l’abbonamento scelto." },
      activity: {
        startedAt: now,
        invocation: 1,
        lastSequence: 4,
        current: {
          id: "1:provider:4",
          invocation: 1,
          nativeStage: "provider",
          sequence: 4,
          stage: "provider",
          name: "Configurazione provider",
          description: "Provider preparato.",
          elapsedMs: 3_000,
          stageElapsedMs: 1_000,
          updatedAt: now,
          status: "completed",
        },
        events: [],
      },
    });

    const summary = within(screen.getByRole("region", { name: "Avanzamento configurazione" }));
    expect(summary.getByText("Accesso provider")).toBeInTheDocument();
    expect(summary.getByText("Accedi con l’abbonamento scelto.")).toBeInTheDocument();
    expect(summary.queryByText("Configurazione provider")).not.toBeInTheDocument();
  });

  it("shows only the SSH fingerprint and requires explicit confirmation", async () => {
    const onConfirmHostKey = vi.fn().mockResolvedValue(undefined);
    const onCancelHostKey = vi.fn();
    renderFlow({
      runtime: { status: "action-required", stage: "ssh-host-key", message: "Confronta il fingerprint." },
      sshHostKey: { algorithm: "ssh-ed25519", fingerprint: "SHA256:synthetic-fingerprint" },
      onConfirmHostKey,
      onCancelHostKey,
    });
    expect(screen.getByText("ssh-ed25519")).toBeInTheDocument();
    expect(screen.getByText("SHA256:synthetic-fingerprint")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("host.example.invalid");
    await userEvent.click(screen.getByRole("button", { name: /conferma fingerprint/i }));
    expect(onConfirmHostKey).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: /annulla/i }));
    expect(onCancelHostKey).toHaveBeenCalledOnce();
  });

  it("keeps provider input fail-closed and retryable", async () => {
    const onProviderInput = vi.fn().mockRejectedValue(new Error("synthetic"));
    renderFlow({
      runtime: { status: "working", stage: "provider-login", message: "Login in corso" },
      providerLogin: { provider: "claude", status: "active", output: "Open browser" },
      onProviderInput,
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/risposta alla sessione/i), "response");
    await user.click(screen.getByRole("button", { name: /^invia/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invio non riuscito/i);
    expect(screen.getByLabelText(/risposta alla sessione/i)).toHaveValue("response");
  });
});
