import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  ExistingTeamBridge,
  ExistingTeamConnectionResult,
  ExistingTeamReadOnlyConnectionResult,
  ExistingTeamReceipt,
  SshHostKeyProbe,
} from "../lib/existing-team";
import ExistingTeamConnectModal from "./ExistingTeamConnectModal";
import { ERROR_CATALOG } from "../lib/error-catalog";
import { EXISTING_TEAM_RECEIPT_TEXT } from "./existing-team-receipt.i18n";

vi.mock("../components/SshKeyPicker", () => ({
  default: ({ value, onChange, disabled }: { value: string; onChange: (path: string) => void; disabled?: boolean }) => (
    <div>
      <button type="button" disabled={disabled} onClick={() => onChange("/synthetic/private/id_ed25519")}>Scegli chiave SSH</button>
      {value && <span>id_ed25519</span>}
    </div>
  ),
}));

const PROBE: SshHostKeyProbe = {
  status: "confirmation_required",
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:synthetic-fingerprint",
};

const READONLY_RESULT: ExistingTeamReadOnlyConnectionResult = {
  readiness: false,
  snapshot: {
    runtimeInstalled: true, containerRunning: true, providerConfigured: true,
    providerAuthenticated: true, assistantRunning: false, captainRunning: true,
    profileReady: false, assistantWelcomed: false, directChatReady: false,
  },
};

const RECEIPT: ExistingTeamReceipt = {
  teamId: "team-opaque-0001",
  hostAddress: "host.example.invalid",
  hostPort: 22,
  sshFingerprint: "SHA256:synthetic-fingerprint",
  containerId: "c0a1".repeat(16),
  imageId: `sha256:${"1a2b".repeat(16)}`,
  platformImageId: `sha256:${"de3f".repeat(16)}`,
  ociRevision: "7071".repeat(10),
  digest: `sha256:${"9d4c".repeat(16)}`,
  candidateSha256: "ab12".repeat(16),
  readiness: false,
};

const CANDIDATE_REQUIRED = { code: "existing_team_runtime_candidate_required" };

const RESULT: ExistingTeamConnectionResult = {
  runtimeInstalled: true,
  containerRunning: true,
  providerConfigured: true,
  providerAuthenticated: true,
  assistantRunning: true,
  captainRunning: true,
  profileReady: false,
  assistantWelcomed: false,
  directChatReady: true,
};

function bridge(overrides: Partial<ExistingTeamBridge> = {}): ExistingTeamBridge {
  return {
    probe: vi.fn().mockResolvedValue(PROBE),
    confirm: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(RESULT),
    connectReadOnly: vi.fn().mockResolvedValue(READONLY_RESULT),
    reopen: vi.fn(),
    discover: vi.fn().mockResolvedValue(RECEIPT),
    register: vi.fn().mockResolvedValue({ outcome: "registered" }),
    ...overrides,
  };
}

async function fillHost(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/host o indirizzo ip/i), "host.example.invalid");
  await user.type(screen.getByLabelText(/utente ssh/i), "ubuntu");
  await user.click(screen.getByRole("button", { name: /scegli chiave ssh/i }));
}

describe("ExistingTeamConnectModal", () => {
  it("keeps host data local and does nothing before the user starts the probe", async () => {
    const native = bridge();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: /hai già un team attivo su vps/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /vps proietta l’ufficio/i }))
      .toHaveAttribute("src", "/onboarding/environment-vps-v2.webp");
    expect(screen.getByLabelText(/utente ssh/i)).toHaveValue("");
    expect(screen.getByLabelText(/utente ssh/i)).toHaveAttribute("placeholder", "es. ubuntu");
    expect(screen.getByLabelText(/utente ssh/i)).toHaveAttribute("autocapitalize", "off");
    expect(screen.getByLabelText(/utente ssh/i)).toHaveAttribute("autocorrect", "off");
    expect(screen.getByLabelText(/utente ssh/i)).toHaveAttribute("spellcheck", "false");
    expect(screen.getByLabelText(/porta ssh/i)).toHaveValue(22);
    expect(native.probe).not.toHaveBeenCalled();
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();
    expect(native.discover).not.toHaveBeenCalled();
    expect(native.register).not.toHaveBeenCalled();
  });

  it("probes first, shows only the fingerprint and attaches after explicit confirmation", async () => {
    const user = userEvent.setup();
    const native = bridge();
    const onConnected = vi.fn().mockResolvedValue(undefined);
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={onConnected} onReadOnlyConnected={vi.fn()} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));

    expect(await screen.findByText(PROBE.fingerprint)).toBeInTheDocument();
    expect(native.probe).toHaveBeenCalledWith(expect.objectContaining({
      kind: "vps",
      address: "host.example.invalid",
      user: "ubuntu",
      port: 22,
      keyPath: "/synthetic/private/id_ed25519",
    }));
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /conferma e collega/i }));
    await waitFor(() => expect(native.confirm).toHaveBeenCalledWith(expect.any(Object), PROBE));
    expect(native.connect).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-opaque-0001" }), expect.any(Function));
    expect(onConnected).toHaveBeenCalledWith(RESULT);
  });

  it("returns from confirmation to editable fields without pinning or attaching", async () => {
    const user = userEvent.setup();
    const native = bridge();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    await screen.findByText(PROBE.fingerprint);
    await user.click(screen.getByRole("button", { name: /indietro/i }));

    expect(screen.getByLabelText(/host o indirizzo ip/i)).toHaveValue("host.example.invalid");
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();
  });

  it("retries a transient probe without confirming or attaching", async () => {
    const user = userEvent.setup();
    const probe = vi.fn()
      .mockRejectedValueOnce({ code: "host_key_unavailable", message: "raw ssh output" })
      .mockResolvedValueOnce(PROBE);
    const native = bridge({ probe });
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/non riesco a leggere l’identità ssh/i);
    expect(screen.queryByText(/raw ssh output/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /riprova/i }));
    expect(await screen.findByText(PROBE.fingerprint)).toBeInTheDocument();
    expect(probe).toHaveBeenCalledTimes(2);
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();
  });

  it("treats a changed host key as terminal and never calls attach", async () => {
    const user = userEvent.setup();
    const native = bridge({ confirm: vi.fn().mockRejectedValue({ code: "host_key_changed", message: "raw secret" }) });
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    await user.click(await screen.findByRole("button", { name: /conferma e collega/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_CATALOG.host_key_changed.text.it);
    expect(screen.getByRole("alert")).toHaveTextContent(ERROR_CATALOG.host_key_changed.action.it);
    expect(screen.queryByText(/raw secret/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /riprova/i })).not.toBeInTheDocument();
    expect(native.connect).not.toHaveBeenCalled();
  });

  it("with no saved configuration «Confirm and connect» asks the server instead of failing", async () => {
    const user = userEvent.setup();
    const native = bridge({ connect: vi.fn().mockRejectedValue({ code: "existing_team_runtime_candidate_required" }) });
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    await user.click(await screen.findByRole("button", { name: /conferma e collega/i }));

    expect(await screen.findByText(/ciò che il server dichiara/i, { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(native.discover).toHaveBeenCalledOnce();
  });

  it("never renders the full key path and keeps cancel explicit", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={bridge()} onCancel={onCancel} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    await fillHost(user);

    expect(screen.getByText("id_ed25519")).toBeInTheDocument();
    expect(screen.queryByText("/synthetic/private/id_ed25519")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /configura un nuovo team/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("moves focus to confirmation and Escape returns to fields without closing", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={bridge()} onCancel={onCancel} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    expect(await screen.findByRole("heading", { name: /hai già un team attivo su vps/i })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText(/host o indirizzo ip/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("hands the read-only connection to the app and never calls the operational callback", async () => {
    const user = userEvent.setup();
    const native = bridge();
    const onConnected = vi.fn();
    const onReadOnlyConnected = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={onConnected} onReadOnlyConnected={onReadOnlyConnected} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    await user.click(await screen.findByRole("button", { name: /visualizza annunci in sola lettura/i }));
    await waitFor(() => expect(onReadOnlyConnected).toHaveBeenCalledOnce());
    // The degraded state travels with the result: the app, not the dialog, shows it.
    expect(onReadOnlyConnected).toHaveBeenCalledWith(READONLY_RESULT);
    expect(native.connectReadOnly).toHaveBeenCalledOnce();
    expect(native.connect).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("keeps identity denial out of the read-only view", async () => {
    const user = userEvent.setup();
    const native = bridge({ connectReadOnly: vi.fn().mockRejectedValue({ code: "existing_team_identity_mismatch" }) });
    const onReadOnlyConnected = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={onReadOnlyConnected} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    await user.click(await screen.findByRole("button", { name: /visualizza annunci in sola lettura/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onReadOnlyConnected).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();
  });

  it("retries a transient read-only failure without falling back to operational attach", async () => {
    const user = userEvent.setup();
    const connectReadOnly = vi.fn().mockRejectedValueOnce({ code: "existing_team_unavailable" }).mockResolvedValueOnce(READONLY_RESULT);
    const native = bridge({ connectReadOnly });
    const onReadOnlyConnected = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={onReadOnlyConnected} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    await user.click(await screen.findByRole("button", { name: /visualizza annunci in sola lettura/i }));
    await user.click(await screen.findByRole("button", { name: /riprova/i }));
    await waitFor(() => expect(onReadOnlyConnected).toHaveBeenCalledOnce());
    expect(connectReadOnly).toHaveBeenCalledTimes(2);
    expect(native.connect).not.toHaveBeenCalled();
  });

  async function toReadOnlyClick(user: ReturnType<typeof userEvent.setup>) {
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    await user.click(await screen.findByRole("button", { name: /visualizza annunci in sola lettura/i }));
  }

  it("with a saved target the read-only connection needs no discovery and registers nothing", async () => {
    const user = userEvent.setup();
    const native = bridge();
    const onReadOnlyConnected = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={onReadOnlyConnected} />);
    await toReadOnlyClick(user);
    await waitFor(() => expect(onReadOnlyConnected).toHaveBeenCalledOnce());
    expect(native.discover).not.toHaveBeenCalled();
    expect(native.register).not.toHaveBeenCalled();
  });

  it("without a saved target it reads what the server declares, saves nothing until confirmed, then opens read only", async () => {
    const user = userEvent.setup();
    const connectReadOnly = vi.fn().mockRejectedValueOnce(CANDIDATE_REQUIRED).mockResolvedValueOnce(READONLY_RESULT);
    const native = bridge({ connectReadOnly });
    const onReadOnlyConnected = vi.fn();
    const onConnected = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={onConnected} onReadOnlyConnected={onReadOnlyConnected} />);
    await toReadOnlyClick(user);

    const receipt = await screen.findByText(/ciò che il server dichiara/i, { selector: "p" });
    const section = receipt.closest("section") as HTMLElement;
    expect(within(section).getByText("team-opaque-0001")).toBeInTheDocument();
    expect(within(section).getByText("host.example.invalid:22")).toBeInTheDocument();
    expect(within(section).getByText("SHA256:synthetic-fingerprint")).toBeInTheDocument();
    expect(within(section).getByText("c0a1c0a1c0a1")).toBeInTheDocument();
    expect(within(section).getByText("non attivo")).toBeInTheDocument();
    // the server's word, never "verified" or "safe"
    expect(section.textContent).not.toMatch(/verificat|sicur/i);
    expect(native.discover).toHaveBeenCalledOnce();
    expect(native.discover).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-opaque-0001" }));
    expect(native.register).not.toHaveBeenCalled();
    expect(onReadOnlyConnected).not.toHaveBeenCalled();

    await user.click(within(section).getByRole("button", { name: /conferma e apri in sola lettura/i }));
    await waitFor(() => expect(onReadOnlyConnected).toHaveBeenCalledOnce());
    expect(native.register).toHaveBeenCalledOnce();
    expect(native.register).toHaveBeenCalledWith(RECEIPT.candidateSha256);
    expect(connectReadOnly).toHaveBeenCalledTimes(2);
    expect(native.connect).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("Annulla on the receipt sends nothing and returns to the fields", async () => {
    const user = userEvent.setup();
    const native = bridge({ connectReadOnly: vi.fn().mockRejectedValue(CANDIDATE_REQUIRED) });
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    await toReadOnlyClick(user);
    await screen.findByText(/ciò che il server dichiara/i, { selector: "p" });
    await user.click(screen.getByRole("button", { name: /^annulla$/i }));
    expect(screen.getByLabelText(/host o indirizzo ip/i)).toHaveValue("host.example.invalid");
    expect(native.register).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();
    expect(native.connectReadOnly).toHaveBeenCalledOnce();
  });

  it("Escape on the receipt also sends nothing", async () => {
    const user = userEvent.setup();
    const native = bridge({ connectReadOnly: vi.fn().mockRejectedValue(CANDIDATE_REQUIRED) });
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    await toReadOnlyClick(user);
    await screen.findByText(/ciò che il server dichiara/i, { selector: "p" });
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText(/host o indirizzo ip/i)).toBeInTheDocument();
    expect(native.register).not.toHaveBeenCalled();
  });

  it("registers once per confirmation even if the button is pressed twice", async () => {
    const user = userEvent.setup();
    let release: (value: { outcome: "registered" }) => void = () => {};
    const register = vi.fn().mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const connectReadOnly = vi.fn().mockRejectedValueOnce(CANDIDATE_REQUIRED).mockResolvedValue(READONLY_RESULT);
    const native = bridge({ connectReadOnly, register });
    const onReadOnlyConnected = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={onReadOnlyConnected} />);
    await toReadOnlyClick(user);
    const confirm = await screen.findByRole("button", { name: /conferma e apri in sola lettura/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(register).toHaveBeenCalledTimes(1);
    release({ outcome: "registered" });
    await waitFor(() => expect(onReadOnlyConnected).toHaveBeenCalledOnce());
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("when a target was saved in the meantime it connects with what the person TYPED and replaces nothing", async () => {
    for (const where of ["discover", "register"] as const) {
      const user = userEvent.setup();
      const exists = { code: "existing_team_runtime_candidate_exists" };
      const connectReadOnly = vi.fn().mockRejectedValueOnce(CANDIDATE_REQUIRED).mockResolvedValue(READONLY_RESULT);
      const native = bridge({
        connectReadOnly,
        ...(where === "discover" ? { discover: vi.fn().mockRejectedValue(exists) } : { register: vi.fn().mockRejectedValue({ code: "existing_team_runtime_candidate_conflict" }) }),
      });
      const onReadOnlyConnected = vi.fn();
      const view = render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={onReadOnlyConnected} />);
      await toReadOnlyClick(user);
      if (where === "register") await user.click(await screen.findByRole("button", { name: /conferma e apri in sola lettura/i }));
      await waitFor(() => expect(onReadOnlyConnected).toHaveBeenCalledOnce());
      expect(connectReadOnly).toHaveBeenLastCalledWith({
        teamId: "team-opaque-0001",
        host: expect.objectContaining({ address: "host.example.invalid", keyPath: "/synthetic/private/id_ed25519" }),
      });
      expect(native.connect).not.toHaveBeenCalled();
      expect("candidate" in native).toBe(false);
      view.unmount();
    }
  });

  it("when the saved target is another team the person sees the mismatch, never that other team", async () => {
    const user = userEvent.setup();
    const connectReadOnly = vi.fn()
      .mockRejectedValueOnce(CANDIDATE_REQUIRED)
      .mockRejectedValueOnce({ code: "existing_team_runtime_candidate_mismatch" });
    const native = bridge({ connectReadOnly, discover: vi.fn().mockRejectedValue({ code: "existing_team_runtime_candidate_exists" }) });
    const onReadOnlyConnected = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={onReadOnlyConnected} />);
    await toReadOnlyClick(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ERROR_CATALOG.existing_team_runtime_candidate_mismatch.text.it);
    expect(onReadOnlyConnected).not.toHaveBeenCalled();
    expect(native.register).not.toHaveBeenCalled();
    expect(connectReadOnly).toHaveBeenCalledTimes(2);
  });

  it("no language of the receipt step calls the data verified, safe or confirmed by the app", () => {
    const banned: Record<string, RegExp> = {
      it: /verificat|sicur/i, en: /verified|\bsafe\b|\bsecure\b/i, de: /verifiziert|geprüft|sicher/i,
      fr: /vérifié|\bsûr/i, es: /verificad|seguro/i, pt: /verificad|seguro/i, hu: /ellenőrzött|biztonságos/i,
    };
    expect(Object.keys(EXISTING_TEAM_RECEIPT_TEXT).sort()).toEqual(Object.keys(banned).sort());
    for (const [locale, text] of Object.entries(EXISTING_TEAM_RECEIPT_TEXT)) {
      for (const [key, value] of Object.entries(text)) expect(value, `${locale}.${key}`).not.toMatch(banned[locale]);
      expect(text.caution, locale).toMatch(/\S/);
    }
    // and the caution never claims "nothing at all happens on the VPS"
    expect(EXISTING_TEAM_RECEIPT_TEXT.it.caution).toMatch(/agenti/i);
    expect(EXISTING_TEAM_RECEIPT_TEXT.en.caution).toMatch(/no agents/i);
  });

  it("tells a refusal of the discovery with the catalog's words and never registers", async () => {
    const user = userEvent.setup();
    const native = bridge({
      connectReadOnly: vi.fn().mockRejectedValue(CANDIDATE_REQUIRED),
      discover: vi.fn().mockRejectedValue({ code: "existing_team_ambiguous", message: "raw docker output" }),
    });
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    await toReadOnlyClick(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ERROR_CATALOG.existing_team_ambiguous.text.it);
    expect(alert).toHaveTextContent(ERROR_CATALOG.existing_team_ambiguous.action.it);
    expect(screen.queryByText(/raw docker output/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /riprova/i })).not.toBeInTheDocument();
    expect(native.register).not.toHaveBeenCalled();
  });

  it("after a registration that worked but a connection that did not, Riprova connects again and never registers twice", async () => {
    const user = userEvent.setup();
    const connectReadOnly = vi.fn()
      .mockRejectedValueOnce(CANDIDATE_REQUIRED)
      .mockRejectedValueOnce({ code: "existing_team_unavailable" })
      .mockResolvedValueOnce(READONLY_RESULT);
    const native = bridge({ connectReadOnly });
    const onReadOnlyConnected = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={onReadOnlyConnected} />);
    await toReadOnlyClick(user);
    await user.click(await screen.findByRole("button", { name: /conferma e apri in sola lettura/i }));
    await user.click(await screen.findByRole("button", { name: /riprova/i }));
    await waitFor(() => expect(onReadOnlyConnected).toHaveBeenCalledOnce());
    expect(native.register).toHaveBeenCalledOnce();
    expect(native.discover).toHaveBeenCalledOnce();
  });

  it("a saved selection that lost its candidate gets it back through the same steps and opens read only", async () => {
    const user = userEvent.setup();
    // what the native side answers for a selection without candidate: the connection
    // asks for a candidate, the discovery reads it, the register restores it
    const connectReadOnly = vi.fn().mockRejectedValueOnce(CANDIDATE_REQUIRED).mockResolvedValueOnce(READONLY_RESULT);
    const native = bridge({ connectReadOnly, register: vi.fn().mockResolvedValue({ outcome: "restored" }) });
    const onReadOnlyConnected = vi.fn();
    const onConnected = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={onConnected} onReadOnlyConnected={onReadOnlyConnected} />);
    await toReadOnlyClick(user);
    await user.click(await screen.findByRole("button", { name: /conferma e apri in sola lettura/i }));
    await waitFor(() => expect(onReadOnlyConnected).toHaveBeenCalledOnce());
    expect(native.register).toHaveBeenCalledOnce();
    expect(native.register).toHaveBeenCalledWith(RECEIPT.candidateSha256);
    expect(native.connect).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("a saved selection for another team or runtime is told with the catalog's words and never retried on its own", async () => {
    const mismatch = { code: "existing_team_saved_selection_mismatch", message: "raw native detail" };
    for (const where of ["discover", "register"] as const) {
      const user = userEvent.setup();
      const native = bridge({
        connectReadOnly: vi.fn().mockRejectedValue(CANDIDATE_REQUIRED),
        ...(where === "discover" ? { discover: vi.fn().mockRejectedValue(mismatch) } : { register: vi.fn().mockRejectedValue(mismatch) }),
      });
      const onReadOnlyConnected = vi.fn();
      const { unmount } = render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={onReadOnlyConnected} />);
      await toReadOnlyClick(user);
      if (where === "register") await user.click(await screen.findByRole("button", { name: /conferma e apri in sola lettura/i }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(ERROR_CATALOG.existing_team_saved_selection_mismatch.text.it);
      expect(alert).toHaveTextContent(ERROR_CATALOG.existing_team_saved_selection_mismatch.action.it);
      expect(screen.queryByText(/raw native detail/i)).not.toBeInTheDocument();
      // no Riprova, and nothing asked again behind the person's back
      expect(screen.queryByRole("button", { name: /riprova/i })).not.toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(native.discover).toHaveBeenCalledOnce();
      expect(native.register).toHaveBeenCalledTimes(where === "register" ? 1 : 0);
      expect(native.connectReadOnly).toHaveBeenCalledOnce();
      expect(onReadOnlyConnected).not.toHaveBeenCalled();
      unmount();
    }
  });

});

describe("«Confirm and connect» on a profile with no saved target", () => {
  async function toFullClick(user: ReturnType<typeof userEvent.setup>) {
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    await user.click(await screen.findByRole("button", { name: /conferma e collega/i }));
  }

  it("reads what the server declares, saves the target only once confirmed, then connects in full", async () => {
    const user = userEvent.setup();
    const connect = vi.fn().mockRejectedValueOnce(CANDIDATE_REQUIRED).mockResolvedValueOnce(RESULT);
    const native = bridge({ connect });
    const onConnected = vi.fn().mockResolvedValue(undefined);
    const onReadOnlyConnected = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={onConnected} onReadOnlyConnected={onReadOnlyConnected} />);
    await toFullClick(user);

    const receipt = await screen.findByText(/ciò che il server dichiara/i, { selector: "p" });
    const section = receipt.closest("section") as HTMLElement;
    expect(within(section).getByText("team-opaque-0001")).toBeInTheDocument();
    // the caution of the full connection, never the read-only one
    expect(section).toHaveTextContent(EXISTING_TEAM_RECEIPT_TEXT.it.cautionFull);
    expect(section).not.toHaveTextContent(EXISTING_TEAM_RECEIPT_TEXT.it.caution);
    expect(within(section).queryByRole("button", { name: /sola lettura/i })).not.toBeInTheDocument();
    expect(native.register).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledOnce();

    await user.click(within(section).getByRole("button", { name: /^conferma e collega$/i }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(RESULT));
    expect(native.register).toHaveBeenCalledWith(RECEIPT.candidateSha256);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(native.connectReadOnly).not.toHaveBeenCalled();
    expect(onReadOnlyConnected).not.toHaveBeenCalled();
  });

  it("with a target saved in the meantime it connects in full and replaces nothing", async () => {
    for (const where of ["discover", "register"] as const) {
      const user = userEvent.setup();
      const connect = vi.fn().mockRejectedValueOnce(CANDIDATE_REQUIRED).mockResolvedValue(RESULT);
      const native = bridge({
        connect,
        ...(where === "discover"
          ? { discover: vi.fn().mockRejectedValue({ code: "existing_team_runtime_candidate_exists" }) }
          : { register: vi.fn().mockRejectedValue({ code: "existing_team_runtime_already_selected" }) }),
      });
      const onConnected = vi.fn().mockResolvedValue(undefined);
      const view = render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={onConnected} onReadOnlyConnected={vi.fn()} />);
      await toFullClick(user);
      if (where === "register") await user.click(await screen.findByRole("button", { name: /^conferma e collega$/i }));
      await waitFor(() => expect(onConnected).toHaveBeenCalledWith(RESULT));
      expect(connect).toHaveBeenCalledTimes(2);
      expect(native.connectReadOnly).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it("any other refusal of the full connection is shown as before, with no discovery", async () => {
    const user = userEvent.setup();
    const native = bridge({ connect: vi.fn().mockRejectedValue({ code: "existing_team_not_active" }) });
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    await toFullClick(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_CATALOG.existing_team_not_active.text.it);
    expect(native.discover).not.toHaveBeenCalled();
    expect(native.register).not.toHaveBeenCalled();
  });

  it("each language says what the full connection does, and that it starts no agent", () => {
    const agents: Record<string, RegExp> = {
      it: /agenti/i, en: /agents/i, de: /Agenten/, fr: /agent/i, es: /agentes/i, pt: /agentes/i, hu: /ügynök/i,
    };
    const lines = new Set<string>();
    for (const [locale, text] of Object.entries(EXISTING_TEAM_RECEIPT_TEXT)) {
      expect(text.cautionFull, locale).toMatch(agents[locale]);
      expect(text.cautionFull, locale).not.toBe(text.caution);
      expect(text.registeringDetailFull, locale).not.toBe(text.registeringDetail);
      lines.add(text.cautionFull);
    }
    expect(lines.size).toBe(Object.keys(EXISTING_TEAM_RECEIPT_TEXT).length);
  });
});
