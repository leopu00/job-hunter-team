import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError, ERROR_LOCALES } from "../lib/error-catalog";
import { reportVpsRead, startVpsLink, stopVpsLink } from "../lib/vps-link";
import { VPS_LINK_TEXT } from "../lib/vps-link.i18n";
import { VpsLinkBar } from "./VpsLinkBar";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

const REVISION = "a0936ded520cc7c21cc3c1e136ca95b1080274f5";
const DIGEST = `sha256:${"0035".repeat(15)}a4a4`;

function setLocale(locale: string) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/`;
}

beforeEach(() => {
  setLocale("it");
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string) =>
    command === "existing_team_link_identity" ? { ok: true, revision: REVISION, digest: DIGEST } : { ok: true, data: {} });
  startVpsLink(false);
});
afterEach(() => {
  cleanup();
  stopVpsLink();
});

const bar = () => screen.getByTestId("vps-link-bar");
const report = (reply: unknown) => act(() => reportVpsRead(reply));

describe("the header of an existing team's VPS", () => {
  it("connected: the state, the last contact, and the pinned team abbreviated and copyable", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const user = userEvent.setup();
    render(<VpsLinkBar />);
    expect(bar()).toHaveAttribute("data-state", "idle");
    expect(bar()).toHaveTextContent(VPS_LINK_TEXT.it.checking);
    report({ ok: true, data: {} });
    expect(bar()).toHaveAttribute("role", "status");
    expect(bar()).toHaveTextContent(VPS_LINK_TEXT.it.connected);
    expect(screen.getByTestId("vps-link-contact")).toHaveTextContent("ultimo contatto");
    const identity = await screen.findByTestId("vps-link-identity");
    expect(identity).toHaveTextContent("a0936de");
    expect(identity).not.toHaveTextContent(REVISION);
    expect(identity).toHaveTextContent("sha256:0035…a4a4");
    await user.click(within(identity).getByRole("button", { name: VPS_LINK_TEXT.it.copyRevision }));
    await user.click(within(identity).getByRole("button", { name: VPS_LINK_TEXT.it.copyDigest }));
    expect(writeText.mock.calls).toEqual([[REVISION], [DIGEST]]);
    vi.unstubAllGlobals();
  });

  it("network: after its five tries by itself, the catalog's sentence with its code, and «Riprova»", async () => {
    vi.useFakeTimers();
    try {
      native.invoke.mockImplementation(async (command: string) =>
        command === "existing_team_link_identity" ? { ok: false, error: "existing_team_runtime_required" }
          : { ok: false, error: "ssh_unavailable", kind: "network" });
      render(<VpsLinkBar />);
      report({ ok: true, data: {} });
      report({ ok: false, error: "ssh_unavailable", kind: "network" });
      await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
      const stats = native.invoke.mock.calls.filter(([command]) => command === "existing_team_positions_read");
      expect(stats).toHaveLength(5);
      expect(stats.every(([, args]) => JSON.stringify(args) === JSON.stringify({ request: { op: "stats" } }))).toBe(true);
      expect(bar()).toHaveAttribute("data-state", "network");
      expect(bar()).toHaveAttribute("role", "alert");
      const described = describeError("ssh_unavailable", { locale: "it" });
      expect(screen.getByTestId("vps-link-sentence")).toHaveTextContent(`${described.text} ${described.action} (ssh_unavailable)`);
      expect(within(bar()).getByRole("button", { name: VPS_LINK_TEXT.it.retry })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["application", "existing_team_identity_mismatch"],
    ["version", "existing_team_runtime_changed"],
  ])("%s: the catalog's sentence with its code, and «Riprova»", async (kind, code) => {
    render(<VpsLinkBar />);
    report({ ok: true, data: {} });
    report({ ok: false, error: code, kind });
    const described = describeError(code, { locale: "it" });
    expect(described.known).toBe(true);
    expect(bar()).toHaveAttribute("role", "alert");
    expect(bar()).toHaveAttribute("data-state", kind);
    expect(screen.getByTestId("vps-link-sentence")).toHaveTextContent(`${described.text} ${described.action} (${code})`);
    expect(within(bar()).getByRole("button", { name: VPS_LINK_TEXT.it.retry })).toBeInTheDocument();
  });

  it("reconnecting: says when it tries again by itself, never a placeholder, and offers no button", () => {
    render(<VpsLinkBar />);
    report({ ok: true, data: {} });
    report({ ok: false, error: "timeout", kind: "network" });
    expect(bar()).toHaveAttribute("data-state", "reconnecting");
    expect(bar()).toHaveAttribute("role", "status");
    const sentence = screen.getByTestId("vps-link-sentence");
    expect(sentence).toHaveTextContent("riprovo da solo alle");
    expect(sentence).toHaveTextContent(describeError("timeout", { locale: "it" }).text);
    expect(sentence.textContent).not.toMatch(/[{}]/);
    expect(within(bar()).queryByRole("button", { name: VPS_LINK_TEXT.it.retry })).toBeNull();
  });

  it("blocked: the changed-key warning, no «Riprova», and the way back to the setup", async () => {
    const user = userEvent.setup();
    const onCloseReadOnly = vi.fn();
    render(<VpsLinkBar onCloseReadOnly={onCloseReadOnly} />);
    report({ ok: false, error: "host_key_changed", kind: "blocked" });
    expect(screen.getByTestId("vps-link-sentence")).toHaveTextContent(describeError("host_key_changed", { locale: "it" }).text);
    expect(within(bar()).queryByRole("button", { name: VPS_LINK_TEXT.it.retry })).toBeNull();
    await user.click(within(bar()).getByRole("button", { name: VPS_LINK_TEXT.it.reviewKey }));
    expect(onCloseReadOnly).toHaveBeenCalledOnce();
  });

  it.each(ERROR_LOCALES)("%s: speaks the person's language", (locale) => {
    setLocale(locale);
    render(<VpsLinkBar />);
    report({ ok: true, data: {} });
    expect(bar()).toHaveTextContent(VPS_LINK_TEXT[locale].connected);
    report({ ok: false, error: "existing_team_runtime_changed", kind: "version" });
    const described = describeError("existing_team_runtime_changed", { locale });
    expect(described.known).toBe(true);
    expect(bar()).toHaveTextContent(VPS_LINK_TEXT[locale].version);
    expect(bar()).toHaveTextContent(described.text);
    expect(within(bar()).getByRole("button", { name: VPS_LINK_TEXT[locale].retry })).toBeInTheDocument();
    // the version sentence's action names that same button
    expect(described.action).toContain(VPS_LINK_TEXT[locale].retry);
    const waiting = describeError("vps_reconnecting", { locale, resetsAt: Math.ceil((Date.now() + 5_000) / 1000) });
    expect(waiting.known).toBe(true);
    expect(waiting.text).not.toMatch(/[{}]/);
  });

  it("shows no identity it could not read", async () => {
    native.invoke.mockImplementation(async () => { throw new Error("no native bridge"); });
    render(<VpsLinkBar />);
    report({ ok: true, data: {} });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("vps-link-identity")).toBeNull();
  });
});
