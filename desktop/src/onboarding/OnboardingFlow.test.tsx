import { readFileSync } from "node:fs";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { describeError, ERROR_LOCALES } from "../lib/error-catalog";
import { OnboardingFlow } from "./OnboardingFlow";
import { WINDOWS_SETUP } from "./windows-setup";

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

describe("OnboardingFlow reopened for the provider only (T128)", () => {
  const reopened = (overrides: Partial<OnboardingFlowProps> = {}) => {
    const onCancel = vi.fn();
    const view = renderFlow({ account: { displayName: "Ada Locale", identity: "local" }, providerOnly: { onCancel }, ...overrides });
    return { ...view, onCancel };
  };

  it("starts on the Provider step, with nothing chosen for the person, and no way back to the environment", async () => {
    reopened();
    expect(await screen.findByRole("heading", { name: /scegli il provider/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /scegli l’ambiente/i })).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: /rivedi il setup/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^indietro/i })).not.toBeInTheDocument();
  });

  it("cancel leaves it without preparing anything", async () => {
    const user = userEvent.setup();
    const { onCancel, props } = reopened();
    await user.click(await screen.findByRole("button", { name: /^annulla/i }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("prepares on this computer with the provider chosen, and says nothing of installs or of an earlier install", async () => {
    const user = userEvent.setup();
    const { props } = reopened({ platform: "windows", previousLocalData: true });
    await user.click(await screen.findByRole("radio", { name: /codex/i }));
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    expect(screen.getByText("Questo computer")).toBeInTheDocument();
    expect(screen.queryByText(/l’app installa, se mancano/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /prepara la squadra/i }));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({ host: { kind: "local" }, provider: "codex" }));
  });

  it("the first setup is as it was: it starts on the greeting, with the proposed provider, and the notes of a first install", async () => {
    const user = userEvent.setup();
    renderFlow({ account: { displayName: "Ada Locale", identity: "local" }, platform: "windows", previousLocalData: true });
    expect(screen.getByRole("heading", { name: "Ciao, Ada Locale." })).toBeInTheDocument();
    await reachProviderLocal(user);
    expect(screen.getByRole("radio", { name: /codex/i })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    expect(screen.getByText(/l’app installa, se mancano/i)).toBeInTheDocument();
  });
});

describe("OnboardingFlow technical setup", () => {
  it("lets a local profile change its on-device label before setup", async () => {
    const user = userEvent.setup();
    const rename = vi.fn();
    renderFlow({ account: { displayName: "Ada", identity: "local" }, onRenameLocalProfile: rename });
    const name = screen.getByRole("textbox", { name: "Nome del profilo" });
    await user.clear(name); await user.type(name, "Bea"); await user.tab();
    expect(rename).toHaveBeenCalledWith("Bea");
  });
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
    ["Codex", "codex"],
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

  it("proposes Codex: first and already chosen, so going on submits it", async () => {
    const user = userEvent.setup();
    const { props } = renderFlow();
    await reachProviderLocal(user);
    const providers = screen.getAllByRole("radio");
    expect(providers[0]).toHaveTextContent("Codex");
    // Codex is the only choice (0.4: one subscription) and carries the recommended label.
    expect(providers).toHaveLength(1);
    expect(providers[0]).toHaveTextContent("consigliato");
    expect(screen.getByRole("radio", { name: /Codex/i })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    await user.click(screen.getByRole("button", { name: /prepara la squadra/i }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({
      host: { kind: "local" },
      provider: "codex",
    }));
  });

  it("says before the setup that a local profile takes an earlier version's data as it is", async () => {
    const user = userEvent.setup();
    renderFlow({ account: { displayName: "Ada", identity: "local" }, platform: "windows", previousLocalData: true });
    await reachProviderLocal(user);
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    const note = screen.getByRole("note", { name: /versione precedente/i });
    expect(note).toHaveTextContent(/riutilizziamo configurazione, profilo, accesso al provider e documenti/i);
    expect(note).toHaveTextContent(/cambia la password per app/i);
    // The v0.3.9 team may still run in Docker Desktop on the same data.
    expect(note).toHaveTextContent(/lascia Docker Desktop spento/i);
    expect(note).toHaveTextContent(/fermalo ed eliminalo da Docker Desktop/i);
  });

  it("tells an account that only a local profile takes an earlier version's data", async () => {
    const user = userEvent.setup();
    renderFlow({ account: { displayName: "Ada", identity: "google" }, previousLocalData: true });
    await reachProviderLocal(user);
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    expect(screen.getByRole("note", { name: /versione precedente/i })).toHaveTextContent(/lo riprende solo un profilo locale/i);
  });

  it("lists, before the Windows setup starts, what it installs: the values are the script's", async () => {
    const script = readFileSync("../scripts/enable-podman-windows-runtime.ps1", "utf8");
    const init = script.match(/'machine' 'init' '--update-connection=false' '--provider' 'wsl' '--cpus' '(\d+)' '--memory' '(\d+)' '--disk-size' '(\d+)'/);
    expect(init, "podman machine init not found in the script").not.toBeNull();
    const [, cpus, memoryMb, diskGb] = init!;
    expect(WINDOWS_SETUP).toMatchObject({ cpus: Number(cpus), memoryGb: Number(memoryMb) / 1024, diskGb: Number(diskGb) });
    expect(script).toContain(`$PodmanCliVersion = '${WINDOWS_SETUP.podmanVersion}'`);
    expect(script).toContain(`$ComposeProviderVersion = '${WINDOWS_SETUP.composeVersion}'`);
    // every package winget installs: the script's one winget line, `& winget install ... --id <package>`
    const packages = [...script.matchAll(/& winget install [^\n]*--id ([A-Za-z.]+)/g)].map((match) => match[1]);
    expect(packages).toEqual(["Podman.CLI"]);
    // the consent names the version the script installs, not winget's latest: the install is pinned to it
    expect(script).toMatch(/& winget install [^\n]*--version \$PodmanCliVersion /);
    // Compose is the runtime's own binary, from the release of that version.
    expect(script).toContain(`/releases/download/v${WINDOWS_SETUP.composeVersion}/docker-compose-windows-x86_64.exe'`);

    const user = userEvent.setup();
    renderFlow({ platform: "windows" });
    await reachProviderLocal(user);
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    const installs = screen.getByRole("note", { name: /cosa installa l’app/i });
    expect(installs).toHaveTextContent(`Podman ${WINDOWS_SETUP.podmanVersion}, con winget (pacchetto Podman.CLI, proprio questa versione e non la più recente)`);
    expect(installs).toHaveTextContent(`Docker Compose ${WINDOWS_SETUP.composeVersion}, scaricato dalla sua release ufficiale e verificato, privato nel runtime di JHT`);
    expect(installs).toHaveTextContent(`${cpus} CPU, ${Number(memoryMb) / 1024} GB di memoria, fino a ${diskGb} GB di disco`);
    for (const id of packages) expect(installs).toHaveTextContent(id);
    expect(installs).toHaveTextContent(/servizio .* tiene acceso il team anche ad app chiusa/i);
    expect(installs).toHaveTextContent(/comando jht nel PATH del tuo utente/i);
    expect(installs).toHaveTextContent(/docker\.exe compatibile resta privato nel runtime e non cambia Docker per gli altri programmi/i);
    // How they are removed: JHT's own part (Compose included) from the app, Podman from Windows.
    expect(installs).toHaveTextContent(/docker\.exe e Docker Compose si tolgono dall’app, da «Questo computer › Rimuovi JHT da questo computer»/);
    expect(installs).toHaveTextContent(/Podman resta: si disinstalla da Impostazioni › App › App installate/);
  });

  it("shows where the runtime log is on a failed local step, with a button that opens it", async () => {
    const open = vi.fn(async () => true);
    const failed = { status: "failed" as const, stage: "runtime" as const, code: "runtime_install_failed", message: "Non riuscita.", retryable: true };
    const path = "C:\\Users\\prova\\AppData\\Local\\ai.jobhunterteam.desktop\\logs\\runtime.log";
    const { unmount } = renderFlow({ platform: "windows", runtime: failed, runtimeLogPath: path, onOpenRuntimeLog: open });
    const status = screen.getByRole("alert");
    expect(status).toHaveTextContent(`Il registro di ogni passo, con l’errore completo, è in: ${path}`);
    // the path may break after each separator, so a folder name stays whole on a narrow line
    expect(status.querySelectorAll("code wbr")).toHaveLength(path.split("\\").length - 1);
    await userEvent.click(within(status).getByRole("button", { name: "Mostra il file del registro" }));
    expect(open).toHaveBeenCalledOnce();
    unmount();

    // No log yet, or a step that is not this computer's: nothing to show.
    renderFlow({ platform: "windows", runtime: failed, runtimeLogPath: null, onOpenRuntimeLog: open });
    expect(screen.queryByText(/Il registro di ogni passo/)).toBeNull();
  });

  it("asks for the consent in the language of Windows when the person chose none", async () => {
    const navigator = window.navigator;
    const languages = Object.getOwnPropertyDescriptor(navigator, "languages");
    const language = Object.getOwnPropertyDescriptor(navigator, "language");
    Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["de-DE", "en-US"] });
    Object.defineProperty(navigator, "language", { configurable: true, get: () => "de-DE" });
    try {
      const user = userEvent.setup();
      renderFlow({ platform: "windows" });
      await user.click(screen.getByRole("button", { name: /einrichtung starten/i }));
      await user.click(screen.getByRole("button", { name: /^weiter/i }));
      await user.click(screen.getByRole("button", { name: /einrichtung prüfen/i }));
      const installs = screen.getByRole("note", { name: /was die app installiert/i });
      expect(installs).toHaveTextContent(`eine Podman-Maschine in WSL: ${WINDOWS_SETUP.cpus} CPUs, ${WINDOWS_SETUP.memoryGb} GB Arbeitsspeicher`);
      expect(installs).toHaveTextContent(/auch bei geschlossener App laufen lässt/);
      expect(installs).toHaveTextContent(/Einstellungen › Apps › Installierte Apps/);
      expect(screen.getByRole("button", { name: /team vorbereiten/i })).toBeInTheDocument();
    } finally {
      if (languages) Object.defineProperty(navigator, "languages", languages);
      if (language) Object.defineProperty(navigator, "language", language);
    }
  });

  it.each(["en", "es", "fr", "hu", "pt"] as const)("shows the Windows consent in %s with the script's values", async (locale) => {
    const user = userEvent.setup();
    renderFlow({ platform: "windows", locale });
    for (let step = 0; step < 3; step += 1) {
      const buttons = screen.getAllByRole("button").filter((button) => button.className.includes("onboarding-primary"));
      await user.click(buttons[buttons.length - 1]);
    }
    const installs = screen.getAllByRole("note")[0];
    expect(installs).toHaveTextContent(`Podman ${WINDOWS_SETUP.podmanVersion}`);
    expect(installs).toHaveTextContent(`Docker Compose ${WINDOWS_SETUP.composeVersion}`);
    expect(installs).toHaveTextContent(`${WINDOWS_SETUP.diskGb}`);
    expect(installs).toHaveTextContent("winget");
    expect(installs).not.toHaveTextContent(/installa|macchina|servizio/);
  });

  it("lists nothing to install for Windows on a Mac", async () => {
    const user = userEvent.setup();
    renderFlow();
    await reachProviderLocal(user);
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    expect(screen.queryByRole("note", { name: /cosa installa l’app/i })).not.toBeInTheDocument();
  });

  it("says nothing about earlier data when there is none", async () => {
    const user = userEvent.setup();
    renderFlow({ account: { displayName: "Ada", identity: "local" } });
    await reachProviderLocal(user);
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("offers only Codex, on any platform: neither Kimi nor Claude Code can be chosen", async () => {
    // Kimi is archived (0.4): the code that reads a team already on it stays, but no choice leads there.
    for (const platform of ["macos", "linux", "windows"] as const) {
      const user = userEvent.setup();
      const view = renderFlow({ platform });
      await reachProviderLocal(user);
      expect(screen.getAllByRole("radio").map((radio) => radio.textContent?.replace(/consigliato/i, "").trim())).toEqual([
        expect.stringContaining("Codex"),
      ]);
      expect(screen.queryByText(/Kimi|Moonshot|Claude|Anthropic/i)).not.toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/Kimi|Moonshot|Claude|Anthropic/i);
      view.unmount();
    }
  });

  it("submits only host and provider for the local path", async () => {
    const user = userEvent.setup();
    const { props } = renderFlow();
    await reachProviderLocal(user);
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    await user.click(screen.getByRole("button", { name: /prepara la squadra/i }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({
      host: { kind: "local" },
      provider: "codex",
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
    await user.type(screen.getByLabelText(/utente ssh/i), "ubuntu");
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    await user.click(screen.getByRole("button", { name: /^continua/i }));
    expect(screen.getByRole("heading", { name: /scegli il provider/i })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("radio", { name: /Codex/i })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    // with one choice the arrow stays on it
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
    await user.type(screen.getByLabelText(/utente ssh/i), "ubuntu");
    await user.click(screen.getByRole("button", { name: /scegli chiave SSH/i }));
    expect(screen.getByText("id_ed25519")).toBeInTheDocument();
    expect(screen.queryByText("/synthetic/private/id_ed25519")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^continua/i }));
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    await user.click(screen.getByRole("button", { name: /prepara la squadra/i }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({
      host: {
        kind: "vps",
        address: "host.example.invalid",
        user: "ubuntu",
        port: 22,
        keyPath: "/synthetic/private/id_ed25519",
      },
      provider: "codex",
    }));
  });

  it("offers this computer on Windows, with Podman in WSL installed by the app", async () => {
    // Red if the Windows block of 03/10 (66e744298) comes back.
    const user = userEvent.setup();
    renderFlow({ platform: "windows" });
    await begin(user);
    const local = screen.getByRole("radio", { name: /questo computer/i });
    expect(local).toHaveAttribute("aria-checked", "true");
    expect(local).toHaveTextContent(/installa Podman e la sua macchina in WSL/i);
    expect(local).not.toHaveTextContent(/docker/i);
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
    await user.type(screen.getByLabelText(/utente ssh/i), "ubuntu");
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
    await userEvent.click(screen.getByRole("button", { name: /riprendi la preparazione/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("offers «Resume» only when part of the preparation was done, and «Retry» when nothing was", async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const failedAtTheFirstStep = { status: "failed", stage: "runtime", message: "La preparazione si è fermata.", retryable: true, code: "runtime_install_failed" } as const;
    // nothing done yet: the same preparation is tried again
    const first = renderFlow({ runtime: failedAtTheFirstStep, onRetry });
    expect(screen.getByRole("button", { name: "Riprova la preparazione" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Riprendi la preparazione" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-resume-note")).not.toBeInTheDocument();
    first.unmount();
    // the engine step was done and the next one failed: «Resume» says so and runs the same retry
    renderFlow({
      runtime: failedAtTheFirstStep,
      activity: {
        startedAt: Date.now() - 10_000, invocation: 1, lastSequence: 2, current: null,
        events: [{
          id: "1:engine:2", invocation: 1, nativeStage: "engine", sequence: 2, stage: "runtime", name: "Verifica ambiente",
          description: "Podman è pronto.", elapsedMs: 3_000, stageElapsedMs: 3_000, updatedAt: Date.now(), status: "completed",
        }],
      },
      onRetry,
    });
    expect(screen.getByTestId("onboarding-resume-note")).toHaveTextContent("Una parte è già pronta su questo computer");
    expect(screen.queryByRole("button", { name: "Riprova la preparazione" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Riprendi la preparazione" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("offers neither when the failure cannot be retried", () => {
    renderFlow({
      runtime: { status: "failed", stage: "container", message: "Versione non compatibile.", retryable: false, code: "container_version_incompatible" },
    });
    expect(screen.queryByRole("button", { name: /riprendi|riprova/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-resume-note")).not.toBeInTheDocument();
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

    await user.dblClick(screen.getByRole("button", { name: "Riprendi la preparazione" }));
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
    const retry = screen.getByRole("button", { name: "Riprendi la preparazione" });

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

  it("returns a retryable failure to the host form without retrying and preserves its draft", async () => {
    const user = userEvent.setup();
    let result!: ReturnType<typeof renderFlow>;
    const onRetry = vi.fn();
    const onExitFailure = vi.fn(() => {
      result.rerender(<OnboardingFlow {...result.props} runtime={{ status: "collecting", stage: "host" }} />);
    });
    result = renderFlow({ onRetry, onExitFailure });

    await begin(user);
    await user.click(screen.getByRole("radio", { name: /vps/i }));
    await user.type(screen.getByLabelText(/indirizzo VPS/i), "draft.example.invalid");
    await user.clear(screen.getByLabelText(/utente ssh/i));
    await user.type(screen.getByLabelText(/utente ssh/i), "draft-user");
    await user.click(screen.getByRole("button", { name: /scegli chiave ssh/i }));
    await user.click(screen.getByRole("button", { name: /^continua/i }));
    await user.click(screen.getByRole("radio", { name: /codex/i }));

    result.rerender(<OnboardingFlow {...result.props} runtime={{
      status: "failed", stage: "runtime", message: "Errore terminale.", retryable: true,
    }} />);
    await user.click(screen.getByRole("button", { name: "Torna alla scelta ambiente" }));

    expect(onExitFailure).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/indirizzo VPS/i)).toHaveValue("draft.example.invalid");
    expect(screen.getByLabelText(/utente ssh/i)).toHaveValue("draft-user");
    expect(screen.getByText("id_ed25519")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^continua/i }));
    expect(screen.getByRole("radio", { name: /codex/i })).toHaveAttribute("aria-checked", "true");
  });

  it("does not offer a return to configuration while an operation is still working", () => {
    const onExitFailure = vi.fn();
    renderFlow({
      runtime: { status: "working", stage: "runtime", message: "Operazione in corso." },
      onExitFailure,
    });

    expect(screen.queryByRole("button", { name: "Torna alla scelta ambiente" })).not.toBeInTheDocument();
    expect(onExitFailure).not.toHaveBeenCalled();
  });

  it("keeps an active provider-login takeover in control when its outer state has failed", () => {
    const onExitFailure = vi.fn();
    renderFlow({
      runtime: { status: "failed", stage: "provider-login", message: "Accesso non completato.", retryable: true },
      providerLogin: {
        provider: "codex",
        status: "needs_user_action",
        actions: [{ kind: "code", instruction: "Conferma il codice.", userCode: "synthetic-code" }],
        connectionState: "connected",
        startedAt: Date.now(),
      },
      onExitFailure,
    });

    expect(screen.getByRole("heading", { name: /completa l’accesso a codex/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Torna alla scelta ambiente" })).not.toBeInTheDocument();
    expect(onExitFailure).not.toHaveBeenCalled();
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

  it("offers to open the app without the team where the team waits or cannot start, and nowhere else", async () => {
    const onOpenWithoutTeam = vi.fn();
    const onRuntimeAction = vi.fn().mockResolvedValue(undefined);
    const waiting = { status: "action-required" as const, stage: "team-start" as const, message: "Le sessioni del team sono ferme." };
    const view = renderFlow({ runtime: waiting, onOpenWithoutTeam, onRuntimeAction });
    await userEvent.click(screen.getByRole("button", { name: "Apri l’app senza avviare la squadra" }));
    expect(onOpenWithoutTeam).toHaveBeenCalledOnce();
    // opening the app starts nothing
    expect(onRuntimeAction).not.toHaveBeenCalled();
    view.unmount();

    // a team that could not start (a provider limit) has the way out too
    const limited = renderFlow({
      runtime: { status: "failed", stage: "team-start", code: "team_start_failed", retryable: false, message: "I limiti sono esauriti." },
      onOpenWithoutTeam,
    });
    expect(screen.getByTestId("open-without-team")).toBeInTheDocument();
    limited.unmount();

    // another step, or a person with no such way: no button
    const other = renderFlow({
      runtime: { status: "action-required", stage: "provider-login", message: "Accedi." },
      onOpenWithoutTeam,
    });
    expect(screen.queryByTestId("open-without-team")).toBeNull();
    other.unmount();
    renderFlow({ runtime: waiting });
    expect(screen.queryByTestId("open-without-team")).toBeNull();
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
    await userEvent.click(screen.getByRole("button", { name: /conferma l’impronta/i }));
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
