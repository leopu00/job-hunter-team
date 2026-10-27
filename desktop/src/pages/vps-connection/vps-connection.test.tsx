import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectTeamContext, type ConnectTeamEntry } from "../../lib/connect-team";
import { describeError } from "../../lib/error-catalog";
import { vpsLinkStatusBridge } from "../../lib/vps-link-status";
import { VpsConnectionScreen, maskAddress, shortDeclaration } from "./index";

vi.mock("../../lib/vps-link-status", () => ({
  vpsLinkStatusBridge: { status: vi.fn(), unlink: vi.fn() },
}));

const status = {
  addressMasked: "203.0.113.42",
  user: "jht",
  fingerprint: "SHA256:short-pinned-fingerprint",
  state: "unreachable" as const,
  lastOkAt: 1_700_000_000,
  lastErrorCode: "ssh_unavailable",
  mode: "read" as const,
  container: "job-hunter-team",
  image: "registry.example/jht@sha256:shortdigest",
  revision: "a1b2c3d4",
  chatReady: false,
};

const connectTeam: ConnectTeamEntry = { open: vi.fn(), reopen: vi.fn(), unlinked: vi.fn() };

function renderPage(entry: ConnectTeamEntry | null = connectTeam) {
  return render(<ConnectTeamContext.Provider value={entry}><VpsConnectionScreen /></ConnectTeamContext.Provider>);
}

beforeEach(() => {
  localStorage.setItem("jht-lang", "en");
  vi.mocked(vpsLinkStatusBridge.status).mockResolvedValue(status);
});
afterEach(() => {
  localStorage.removeItem("jht-lang");
  vi.clearAllMocks();
});

describe("VPS connection settings", () => {
  it("shows a whole SSH fingerprint: it is what the person compares", async () => {
    const whole = "SHA256:" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/AbCdE".slice(0, 43);
    vi.mocked(vpsLinkStatusBridge.status).mockResolvedValue({ ...status, fingerprint: whole });
    renderPage();
    expect(await screen.findByTestId("vps-connection-fingerprint")).toHaveTextContent(whole);
    expect(whole.length).toBe(50);
  });

  it("shows the declared connection status without exposing a whole address", async () => {
    const { container } = renderPage();
    expect(await screen.findByTestId("vps-connection-address")).toHaveTextContent("203.0.xxx.xxx");
    expect(container.textContent).not.toContain("203.0.113.42");
    expect(screen.getByTestId("vps-connection-state")).toHaveTextContent("Unreachable");
    expect(screen.getByTestId("vps-connection-mode")).toHaveTextContent("Read only");
    expect(screen.getByTestId("vps-connection-chat")).toHaveTextContent("Direct chat not ready");
    expect(screen.getByTestId("vps-connection-error")).toHaveTextContent("ssh_unavailable");
    expect(screen.getByTestId("vps-connection-error")).toHaveTextContent(describeError("ssh_unavailable", { locale: "en" }).text);
  });

  it("masks every kind of address and bounds declared values", () => {
    expect(maskAddress("203.0.113.42")).toBe("203.0.xxx.xxx");
    expect(maskAddress("vps.example.test")).toBe("v…t");
    expect(shortDeclaration("a".repeat(70))).toHaveLength(48);
  });

  it("reopens read-only access before refreshing the status", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("vps-connection-address");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(connectTeam.reopen).toHaveBeenCalledOnce());
    await waitFor(() => expect(vpsLinkStatusBridge.status).toHaveBeenCalledTimes(2));
    expect(vi.mocked(connectTeam.reopen).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(vpsLinkStatusBridge.status).mock.invocationCallOrder[1]);
  });

  it("does not reopen a team connected in full: reopening is the read-only view and takes the write access away", async () => {
    vi.mocked(vpsLinkStatusBridge.status).mockResolvedValue({ ...status, mode: "full" });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("vps-connection-address");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(vpsLinkStatusBridge.status).toHaveBeenCalledTimes(2));
    expect(connectTeam.reopen).not.toHaveBeenCalled();
    expect(screen.getByTestId("vps-connection-mode")).not.toHaveTextContent("Read only");
  });

  it("opens the reconnect dialog and unlinks only after explicit confirmation", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("vps-connection-address");
    await user.click(screen.getByRole("button", { name: "Reconnect the team" }));
    expect(connectTeam.open).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Unlink" }));
    expect(vpsLinkStatusBridge.unlink).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Unlink the team" }));
    await waitFor(() => expect(vpsLinkStatusBridge.unlink).toHaveBeenCalledOnce());
    expect(connectTeam.unlinked).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("The team was unlinked from this computer.");
  });

  it("still shows the saved status without an in-app reconnect entry", async () => {
    renderPage(null);
    await screen.findByTestId("vps-connection-address");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
  });
});
