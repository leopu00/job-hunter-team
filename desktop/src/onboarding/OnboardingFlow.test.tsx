import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { describeError, ERROR_LOCALES } from "../lib/error-catalog";
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
    onProviderRestart: vi.fn().mockResolvedValue(undefined),
    onRetry: vi.fn().mockResolvedValue(undefined),
    onRestart: vi.fn().mockResolvedValue(undefined),
    onExitFailure: vi.fn(),
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

  it("offers VPS profile import only to the local identity while preparing a local runtime", async () => {
    const user = userEvent.setup();
    const local = renderFlow({ account: { displayName: "Ada Locale", identity: "local" } });
    await begin(user);
    expect(screen.getByRole("button", { name: /importa profilo/i })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /server VPS/i }));
    expect(screen.queryByRole("button", { name: /importa profilo/i })).not.toBeInTheDocument();
    local.unmount();

    renderFlow({ account: { displayName: "Ada", identity: "google" } });
    await begin(user);
    expect(screen.queryByRole("button", { name: /importa profilo/i })).not.toBeInTheDocument();
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

  it("offers this computer on Windows, with Docker Desktop", async () => {
    // Red if the Windows block of 03/10 (66e744298) comes back.
    const user = userEvent.setup();
    renderFlow({ platform: "windows" });
    await begin(user);
    const local = screen.getByRole("radio", { name: /questo computer/i });
    expect(local).toHaveAttribute("aria-checked", "true");
    expect(local).toHaveTextContent("Docker Desktop");
    expect(screen.queryByText(/VPS Linux/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^continua/i })).toBeEnabled();
  });

  it("requires VPS fields and a selected key when local runtime is unsupported", async () => {
    const user = userEvent.setup();
    renderFlow({ platform: "other" });
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
    await userEvent.click(screen.getByRole("button", { name: /riprova la preparazione/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows what to do next under a failure that carries an action", () => {
    renderFlow({
      runtime: {
        status: "failed", stage: "team-start", code: "team_start_failed", retryable: true,
        message: "La squadra non è partita.", action: "Riprova l’avvio.",
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("La squadra non è partita.");
    expect(screen.getByRole("alert")).toHaveTextContent("Cosa fare: Riprova l’avvio.");
  });

  it("recreates the Podman machine only after a second, explicit confirmation", async () => {
    const user = userEvent.setup();
    // Still running: a double click must not start a second recreation.
    const onRecreatePodmanMachine = vi.fn(() => new Promise<void>(() => undefined));
    const mountsFailure = {
      status: "failed", stage: "runtime", code: "podman_machine_mounts_home", retryable: false,
      title: "Macchina Podman da ricreare",
      message: "La macchina Podman di JHT vede più cartelle del Mac di quelle che servono a Job Hunter Team.",
      action: "Ricrea la macchina Podman.",
    } as const;
    const { props } = renderFlow({ runtime: mountsFailure, onRecreatePodmanMachine });

    expect(screen.queryByRole("button", { name: "Riprova la preparazione" })).not.toBeInTheDocument();
    expect(screen.queryByText(/correggi i dati indicati/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^ricrea la macchina podman/i }));
    expect(onRecreatePodmanMachine).not.toHaveBeenCalled();
    // It says what is lost (the jht-deps volume with the provider CLIs, the
    // broker's portal logins and mail state) and what the person redoes.
    const confirmation = screen.getByRole("region", { name: "Conferma ricreazione macchina Podman" });
    const copy = describeError("podman_machine_recreate_confirm");
    expect(copy.known).toBe(true);
    expect(confirmation).toHaveTextContent(copy.text);
    expect(confirmation).toHaveTextContent(copy.action);
    expect(copy.text).toContain("jht-deps");
    expect(copy.text).toContain("CLI dei provider");
    expect(copy.action).toContain("riscarica");
    // The broker's mail state survives the recreation (jht-broker-state is
    // exported and imported); its secrets do not (jht-secrets).
    expect(copy.text).toContain("password della posta");
    expect(copy.text).not.toContain("diario");
    expect(copy.action).toContain("diario, bozze e autorizzazioni");
    for (const locale of ERROR_LOCALES) {
      const localized = describeError("podman_machine_recreate_confirm", { locale });
      expect(localized.known, locale).toBe(true);
      expect(localized.text, locale).toContain("jht-deps");
      expect(localized.action, locale).toContain("LinkedIn");
    }

    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByRole("region", { name: "Conferma ricreazione macchina Podman" })).not.toBeInTheDocument();
    expect(onRecreatePodmanMachine).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^ricrea la macchina podman/i }));
    await user.dblClick(screen.getByRole("button", { name: /sì, cancella e ricrea/i }));
    expect(onRecreatePodmanMachine).toHaveBeenCalledOnce();
    expect(props.onRetry).not.toHaveBeenCalled();
  });

  it("offers no Podman machine recreation for another error or a server setup", () => {
    const onRecreatePodmanMachine = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderFlow({
      runtime: { status: "failed", stage: "runtime", code: "runtime_missing", retryable: false, message: "Runtime mancante." },
      onRecreatePodmanMachine,
    });
    expect(screen.queryByRole("button", { name: /ricrea la macchina podman/i })).not.toBeInTheDocument();
    unmount();

    renderFlow({
      platform: "other",
      runtime: { status: "failed", stage: "runtime", code: "podman_machine_mounts_home", retryable: false, message: "Macchina." },
      onRecreatePodmanMachine,
    });
    expect(screen.queryByRole("button", { name: /ricrea la macchina podman/i })).not.toBeInTheDocument();
  });

  it("presents a version mismatch once, keeps diagnostics closed and focuses each new failure once", async () => {
    let result!: ReturnType<typeof renderFlow>;
    const onExitFailure = vi.fn(() => {
      result.rerender(<OnboardingFlow {...result.props} runtime={{ status: "collecting", stage: "host" }} />);
    });
    const startedAt = Date.now() - 4_200;
    const failure = {
      status: "failed" as const,
      stage: "container" as const,
      title: "Versione del container non compatibile",
      message: "La versione installata non coincide con quella richiesta da questa app. Il team non è stato avviato.",
      code: "container_version_incompatible",
      retryable: false,
    };
    result = renderFlow({
      runtime: failure,
      activity: {
        startedAt,
        invocation: 1,
        lastSequence: 3,
        current: {
          id: "1:container:3", invocation: 1, nativeStage: "container", sequence: 3,
          stage: "container", name: "Preparazione container",
          description: "Verifica del container interrotta.", elapsedMs: 4_000,
          stageElapsedMs: 2_400, updatedAt: Date.now(), status: "failed",
        },
        events: [{
          id: "1:container:3", invocation: 1, nativeStage: "container", sequence: 3,
          stage: "container", name: "Preparazione container",
          description: "Verifica del container interrotta.", elapsedMs: 4_000,
          stageElapsedMs: 2_400, updatedAt: Date.now(), status: "failed",
        }],
      },
      onExitFailure,
    });

    const heading = screen.getByRole("heading", { name: "Versione del container non compatibile" });
    expect(heading).toHaveFocus();
    const alert = screen.getByRole("alert");
    expect(alert).not.toHaveAttribute("aria-labelledby");
    expect(alert).toHaveTextContent(failure.message);
    expect(alert).not.toHaveTextContent("Versione del container non compatibile");
    expect(alert).not.toHaveTextContent("container_version_incompatible");
    expect(screen.getByText(/Trascorso/)).toHaveTextContent("00:04");
    expect(screen.getByRole("progressbar", { name: "Passaggi completati" })).toHaveAttribute("value", "1");
    expect(screen.getByText("Passaggio 2 di 6")).toBeInTheDocument();
    expect(screen.getByText("1 completati")).toBeInTheDocument();

    const technicalSummary = screen.getByText("Dettagli tecnici");
    const technicalDetails = technicalSummary.closest("details");
    expect(technicalDetails).not.toHaveAttribute("open");
    technicalSummary.focus();
    expect(technicalSummary).toHaveFocus();
    expect(technicalSummary.tagName).toBe("SUMMARY");
    await userEvent.click(technicalSummary);
    expect(technicalDetails).toHaveAttribute("open");
    expect(screen.getByText("container_version_incompatible")).toBeInTheDocument();

    result.rerender(<OnboardingFlow {...result.props} />);
    expect(technicalSummary).toHaveFocus();
    expect(document.body).not.toHaveTextContent(/raw|rm\s|delete|remove|reset|docker\s+rm/i);
    expect(document.body).not.toHaveTextContent("Correggi i dati indicati");
    expect(screen.queryByRole("button", { name: /riprova/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Torna alla scelta ambiente" }));
    expect(onExitFailure).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Scegli l’ambiente." })).toHaveFocus();
  });

  it("blocks duplicate retry clicks and renders the verified container progress after the click", async () => {
    let resolveRetry!: () => void;
    const onRetry = vi.fn(() => new Promise<void>((resolve) => { resolveRetry = resolve; }));
    const startedAt = Date.now() - 3_000;
    const failedActivity = {
      startedAt,
      invocation: 1,
      lastSequence: 3,
      current: {
        id: "1:container:3", invocation: 1, nativeStage: "container" as const, sequence: 3,
        stage: "container" as const, name: "Preparazione container",
        description: "Il container non si è avviato.", elapsedMs: 2_900,
        stageElapsedMs: 2_400, updatedAt: Date.now(), status: "failed" as const,
      },
      events: [{
        id: "1:container:3", invocation: 1, nativeStage: "container" as const, sequence: 3,
        stage: "container" as const, name: "Preparazione container",
        description: "Il container non si è avviato.", elapsedMs: 2_900,
        stageElapsedMs: 2_400, updatedAt: Date.now(), status: "failed" as const,
      }],
    };
    const result = renderFlow({
      runtime: {
        status: "failed", stage: "container", title: "Avvio del container non riuscito",
        message: "Il container del team non risulta pronto. Il team non è stato avviato.",
        code: "container_start_failed", retryable: true,
      },
      activity: failedActivity,
      onRetry,
    });
    const user = userEvent.setup();

    await user.dblClick(screen.getByRole("button", { name: "Riprova la preparazione" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Verifica in corso…" })).toBeDisabled();
    expect(screen.getByRole("region", { name: /avanzamento configurazione/i }).closest(".onboarding-runtime-card")).toHaveAttribute("aria-busy", "true");

    await act(async () => resolveRetry());
    const retryActivity = {
      ...failedActivity,
      invocation: 2,
      lastSequence: 3,
      current: {
        id: "2:container:3", invocation: 2, nativeStage: "container" as const, sequence: 3,
        stage: "container" as const, name: "Preparazione container",
        description: "Container verificato.", elapsedMs: 5_600,
        stageElapsedMs: 2_600, updatedAt: Date.now(), status: "completed" as const,
      },
      events: [
        ...failedActivity.events,
        {
          id: "2:container:3", invocation: 2, nativeStage: "container" as const, sequence: 3,
          stage: "container" as const, name: "Preparazione container",
          description: "Container verificato.", elapsedMs: 5_600,
          stageElapsedMs: 2_600, updatedAt: Date.now(), status: "completed" as const,
        },
      ],
    };
    result.rerender(<OnboardingFlow {...result.props} runtime={{
      status: "working", stage: "container", message: "Container verificato.",
    }} activity={retryActivity} />);

    expect(screen.getByRole("progressbar", { name: "Passaggi completati" })).toHaveAttribute("value", "1");
    await user.click(screen.getByText(/Dettagli attività/));
    expect(screen.getAllByText("Completato")).toHaveLength(1);
    expect(screen.getAllByText("Container verificato.").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps a failed retry repeatable without adding a second alert", async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error("synthetic backend detail"));
    renderFlow({
      runtime: {
        status: "failed", stage: "container", title: "Avvio del container non riuscito",
        message: "Il container del team non risulta pronto. Il team non è stato avviato.",
        code: "container_start_failed", retryable: true,
      },
      onRetry,
    });
    const user = userEvent.setup();
    const retry = screen.getByRole("button", { name: "Riprova la preparazione" });

    await user.click(retry);
    await waitFor(() => expect(retry).toBeEnabled());
    await user.click(retry);

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(document.body).not.toHaveTextContent("synthetic backend detail");
  });

  it("derives local progress from the six stages that can actually run", () => {
    const result = renderFlow({
      runtime: { status: "working", stage: "container", message: "Preparo il container." },
    });
    const track = result.container.querySelector(".onboarding-runtime-track");
    expect(track).not.toBeNull();
    const timeline = within(track as HTMLElement);

    expect(timeline.queryByText("Identità server")).not.toBeInTheDocument();
    expect(timeline.queryByText("Fingerprint SSH verificata")).not.toBeInTheDocument();
    expect(timeline.getByText("Runtime").closest("li")).toHaveClass("is-complete");
    expect(timeline.getByText("Container").closest("li")).toHaveClass("is-active");
    expect(screen.getByRole("progressbar", { name: "Passaggi completati" })).toHaveAttribute("max", "6");
    expect(screen.getByRole("progressbar", { name: "Passaggi completati" })).toHaveAttribute("value", "1");
    expect(screen.getByText("Passaggio 2 di 6")).toBeInTheDocument();
    expect(screen.getByText("1 completati")).toBeInTheDocument();
  });

  it("keeps SSH fingerprint first and counts it only for a selected VPS", async () => {
    const user = userEvent.setup();
    const result = renderFlow();
    await begin(user);
    await user.click(screen.getByRole("radio", { name: /server vps/i }));
    result.rerender(<OnboardingFlow
      {...result.props}
      runtime={{ status: "working", stage: "container", message: "Preparo il container." }}
    />);
    const track = result.container.querySelector(".onboarding-runtime-track");
    expect(track).not.toBeNull();
    const timeline = within(track as HTMLElement);
    const stages = timeline.getAllByRole("listitem");

    expect(stages[0]).toHaveTextContent("Identità server");
    expect(stages[0]).toHaveTextContent("Fingerprint SSH verificata");
    expect(stages[0]).toHaveClass("is-complete");
    expect(timeline.getByText("Container").closest("li")).toHaveClass("is-active");
    expect(screen.getByRole("progressbar", { name: "Passaggi completati" })).toHaveAttribute("max", "7");
    expect(screen.getByRole("progressbar", { name: "Passaggi completati" })).toHaveAttribute("value", "2");
    expect(screen.getByText("Passaggio 3 di 7")).toBeInTheDocument();
    expect(screen.getByText("2 completati")).toBeInTheDocument();
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
    expect(screen.getByRole("progressbar", { name: "Passaggi completati" })).toHaveAttribute("value", "1");
    expect(screen.getByRole("progressbar", { name: "Passaggi completati" })).toHaveAttribute("max", "6");
    const activeProgress = screen.getByRole("progressbar", { name: "Avanzamento Preparazione container" });
    expect(activeProgress).toHaveAttribute("aria-valuetext", "Operazione in corso; percentuale non disponibile");
    expect(activeProgress).not.toHaveAttribute("aria-valuenow");

    await userEvent.click(screen.getByText(/Dettagli attività/));
    expect(screen.getByText("Completato")).toBeInTheDocument();
    expect(screen.getAllByText("In corso")).toHaveLength(2);
    expect(screen.getByText("Errore")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\bETA\b|tempo stimato/i);
  });

  it("offers only safe UI navigation when the current failure cannot be retried", async () => {
    const onRestart = vi.fn().mockResolvedValue(undefined);
    const onExitFailure = vi.fn();
    renderFlow({
      runtime: {
        status: "failed",
        stage: "assistant",
        message: "Assistente non pronto.",
        retryable: false,
      },
      onRestart,
      onExitFailure,
    });

    expect(screen.queryByRole("button", { name: /riprova/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Riparti da capo" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Torna alla scelta ambiente" }));
    expect(onExitFailure).toHaveBeenCalledOnce();
    expect(onRestart).not.toHaveBeenCalled();
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

  it("mounts the OAuth takeover with structured action data and no inferred input", () => {
    renderFlow({
      runtime: { status: "working", stage: "provider-login", message: "Login in corso" },
      providerLogin: {
        provider: "codex",
        status: "needs_user_action",
        actions: [{
          kind: "url",
          instruction: "Apri il browser e inserisci il codice temporaneo.",
          safeUrl: "https://auth.openai.com/device",
        }],
        connectionState: "connected",
        startedAt: Date.now() - 2_000,
      },
    });

    expect(screen.getByRole("heading", { name: /completa l’accesso a codex/i })).toBeInTheDocument();
    expect(screen.getByText("https://auth.openai.com/device")).toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("synthetic-secret");
  });

  it("keeps requested provider input fail-closed and exposes cancel and restart", async () => {
    const onProviderInput = vi.fn().mockRejectedValue(new Error("synthetic"));
    const onProviderClose = vi.fn().mockResolvedValue(undefined);
    const onProviderRestart = vi.fn().mockResolvedValue(undefined);
    renderFlow({
      runtime: { status: "working", stage: "provider-login", message: "Login in corso" },
      providerLogin: {
        provider: "claude",
        status: "needs_user_action",
        actions: [{
          kind: "input",
          instruction: "Conferma la richiesta del provider.",
          inputRequest: { id: "confirmation", label: "Risposta richiesta" },
        }],
        connectionState: "connected",
        startedAt: Date.now(),
      },
      onProviderInput,
      onProviderClose,
      onProviderRestart,
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/risposta richiesta/i), "response");
    await user.click(screen.getByRole("button", { name: /invia risposta/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/risposta non è stata inviata/i);
    expect(screen.getByLabelText(/risposta richiesta/i)).toHaveValue("response");
    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(onProviderClose).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: /riavvia accesso/i }));
    expect(onProviderRestart).toHaveBeenCalledOnce();
  });
});
