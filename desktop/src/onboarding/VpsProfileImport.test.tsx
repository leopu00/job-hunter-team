import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProfileImportBridge, ProfileImportSnapshot } from "../lib/profile-import";
import type { SshHostKeyProbe } from "../lib/onboarding-runtime";
import VpsProfileImport from "./VpsProfileImport";
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

const VERIFIED: ProfileImportSnapshot = {
  sourceValid: true,
  reviewClear: true,
  sourceStable: true,
  targetWasAbsent: true,
  targetValid: true,
  receiptVerified: true,
};

function bridge(overrides: Partial<ProfileImportBridge> = {}): ProfileImportBridge {
  return {
    probe: vi.fn().mockResolvedValue(PROBE),
    confirm: vi.fn().mockResolvedValue(undefined),
    importProfile: vi.fn().mockResolvedValue(VERIFIED),
    ...overrides,
  };
}

async function openAndFill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /importa profilo/i }));
  await user.type(screen.getByLabelText(/host o indirizzo ip/i), " host.example.invalid ");
  await user.click(screen.getByRole("button", { name: /scegli chiave ssh/i }));
}

describe("VpsProfileImport", () => {
  it("does nothing before the explicit gesture and cancel keeps the bridge untouched", async () => {
    const user = userEvent.setup();
    const native = bridge();
    render(<VpsProfileImport bridge={native} />);

    expect(native.probe).not.toHaveBeenCalled();
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.importProfile).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /importa profilo/i }));
    await user.click(screen.getByRole("button", { name: /annulla/i }));
    expect(screen.getByRole("button", { name: /importa profilo/i })).toBeInTheDocument();
    expect(native.probe).not.toHaveBeenCalled();
  });

  it("blocks a changed server key with its own message and no way to retry", async () => {
    const user = userEvent.setup();
    const native = bridge({ probe: vi.fn().mockRejectedValue({ code: "host_key_mismatch" }) });
    render(<VpsProfileImport bridge={native} />);
    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /verifica e importa/i }));

    expect(await screen.findByText(ERROR_CATALOG.host_key_mismatch.text.it)).toBeInTheDocument();
    expect(screen.getByText(ERROR_CATALOG.host_key_mismatch.action.it)).toBeInTheDocument();
    expect(screen.queryByText(/Non è stato possibile importare il profilo/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /modifica e riprova/i })).not.toBeInTheDocument();
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.importProfile).not.toHaveBeenCalled();
  });

  it("probes, requires fingerprint confirmation, then imports and verifies the receipt", async () => {
    const user = userEvent.setup();
    const native = bridge();
    render(<VpsProfileImport bridge={native} />);
    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /verifica e importa/i }));

    expect(await screen.findByText(PROBE.fingerprint)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /riusa il profilo/i })).toHaveFocus();
    expect(native.probe).toHaveBeenCalledWith({
      kind: "vps", address: "host.example.invalid", user: "root", port: 22,
      keyPath: "/synthetic/private/id_ed25519",
    });
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.importProfile).not.toHaveBeenCalled();
    expect(screen.queryByText("host.example.invalid")).not.toBeInTheDocument();
    expect(screen.queryByText("/synthetic/private/id_ed25519")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /conferma e importa/i }));
    await waitFor(() => expect(native.confirm).toHaveBeenCalledWith(expect.any(Object), PROBE));
    expect(native.importProfile).toHaveBeenCalledWith(expect.objectContaining({ address: "host.example.invalid" }));
    expect(await screen.findByRole("heading", { name: "Profilo importato." })).toHaveFocus();
  });

  it("uses an already pinned fingerprint without a second confirmation", async () => {
    const user = userEvent.setup();
    const native = bridge({ probe: vi.fn().mockResolvedValue({ ...PROBE, status: "pinned" }) });
    render(<VpsProfileImport bridge={native} />);
    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /verifica e importa/i }));

    expect(await screen.findByText("Profilo importato.")).toBeInTheDocument();
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.importProfile).toHaveBeenCalledOnce();
  });

  it("fails closed on terminal errors and never renders native raw messages", async () => {
    const user = userEvent.setup();
    const native = bridge({
      importProfile: vi.fn().mockRejectedValue({ code: "target_profile_exists", message: "raw private path" }),
      probe: vi.fn().mockResolvedValue({ ...PROBE, status: "pinned" }),
    });
    render(<VpsProfileImport bridge={native} />);
    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /verifica e importa/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_CATALOG.target_profile_exists.text.it);
    expect(screen.queryByText(/raw private path/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /modifica e riprova/i })).not.toBeInTheDocument();
  });

  it("rejects a native response until every verification boolean is true", async () => {
    const user = userEvent.setup();
    const native = bridge({
      importProfile: vi.fn().mockResolvedValue({ ...VERIFIED, receiptVerified: false }),
      probe: vi.fn().mockResolvedValue({ ...PROBE, status: "pinned" }),
    });
    render(<VpsProfileImport bridge={native} />);
    await openAndFill(user);
    await user.click(screen.getByRole("button", { name: /verifica e importa/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_CATALOG.receipt_unverified.text.it);
    expect(screen.queryByText("Profilo importato.")).not.toBeInTheDocument();
  });

  it("blocks duplicate submission while the SSH probe is pending", async () => {
    const user = userEvent.setup();
    let resolveProbe!: (value: typeof PROBE) => void;
    const probe = vi.fn(() => new Promise<typeof PROBE>((resolve) => { resolveProbe = resolve; }));
    const native = bridge({ probe });
    render(<VpsProfileImport bridge={native} />);
    await openAndFill(user);
    const submit = screen.getByRole("button", { name: /verifica e importa/i });

    await user.click(submit);
    expect(screen.getByRole("button", { name: /verifica in corso/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /verifica in corso/i }));
    expect(probe).toHaveBeenCalledOnce();
    resolveProbe(PROBE);
    expect(await screen.findByText(PROBE.fingerprint)).toBeInTheDocument();
    expect(native.importProfile).not.toHaveBeenCalled();
  });
});
