import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  ExistingTeamBridge,
  ExistingTeamConnectionResult,
  SshHostKeyProbe,
} from "../lib/existing-team";
import ExistingTeamConnectModal from "./ExistingTeamConnectModal";
import { ERROR_CATALOG } from "../lib/error-catalog";

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
    ...overrides,
  };
}

async function fillHost(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/host o indirizzo ip/i), "host.example.invalid");
  await user.click(screen.getByRole("button", { name: /scegli chiave ssh/i }));
}

describe("ExistingTeamConnectModal", () => {
  it("keeps host data local and does nothing before the user starts the probe", async () => {
    const native = bridge();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: /hai già un team attivo su vps/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /vps proietta l’ufficio/i }))
      .toHaveAttribute("src", "/onboarding/environment-vps-v2.webp");
    expect(screen.getByLabelText(/utente ssh/i)).toHaveValue("root");
    expect(screen.getByLabelText(/porta ssh/i)).toHaveValue(22);
    expect(native.probe).not.toHaveBeenCalled();
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();
  });

  it("probes first, shows only the fingerprint and attaches after explicit confirmation", async () => {
    const user = userEvent.setup();
    const native = bridge();
    const onConnected = vi.fn().mockResolvedValue(undefined);
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={onConnected} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));

    expect(await screen.findByText(PROBE.fingerprint)).toBeInTheDocument();
    expect(native.probe).toHaveBeenCalledWith(expect.objectContaining({
      kind: "vps",
      address: "host.example.invalid",
      user: "root",
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
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} />);
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
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} />);
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
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={native} onCancel={vi.fn()} onConnected={vi.fn()} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    await user.click(await screen.findByRole("button", { name: /conferma e collega/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_CATALOG.host_key_changed.text.it);
    expect(screen.getByRole("alert")).toHaveTextContent(ERROR_CATALOG.host_key_changed.action.it);
    expect(screen.queryByText(/raw secret/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /riprova/i })).not.toBeInTheDocument();
    expect(native.connect).not.toHaveBeenCalled();
  });

  it("never renders the full key path and keeps cancel explicit", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={bridge()} onCancel={onCancel} onConnected={vi.fn()} />);
    await fillHost(user);

    expect(screen.getByText("id_ed25519")).toBeInTheDocument();
    expect(screen.queryByText("/synthetic/private/id_ed25519")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /configura un nuovo team/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("moves focus to confirmation and Escape returns to fields without closing", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ExistingTeamConnectModal teamId="team-opaque-0001" bridge={bridge()} onCancel={onCancel} onConnected={vi.fn()} />);
    await fillHost(user);
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    expect(await screen.findByRole("heading", { name: /hai già un team attivo su vps/i })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText(/host o indirizzo ip/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
