import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickCloudSync, readExistingTeamCloudSync } from "../../lib/existing-team-cloud-sync";
import { CLOUD_SYNC_CARD_TEXT } from "./cloud-sync-card.i18n";

// The team page says how the box's push to the website is going (T126): on 23/10 a box had been
// refused by the website for 16 days and the app said nothing. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

import { CloudSyncCard } from "./cloud-sync-card";

const t = CLOUD_SYNC_CARD_TEXT.en;
const synced = (data: unknown) => ({ ok: true, data });
const okState = (status: string, failures = 0, lastSuccess: string | null = "2026-10-07T12:12:46.425Z") => ({
  state: "ok", status, last_success_at: lastSuccess, last_attempt_at: "2026-10-23T17:00:00.000Z", consecutive_failures: failures,
});

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=en";
  native.invoke.mockReset();
});
afterEach(cleanup);

describe("the reply of the team", () => {
  it("takes the closed shapes and nothing else", () => {
    expect(pickCloudSync({ state: "absent" })).toEqual({ state: "absent" });
    expect(pickCloudSync(okState("auth_failed", 45012))).toEqual({
      state: "ok", status: "auth_failed", lastSuccessAt: "2026-10-07T12:12:46.425Z",
      lastAttemptAt: "2026-10-23T17:00:00.000Z", consecutiveFailures: 45012,
    });
    for (const broken of [
      null, [], { state: "absent", extra: 1 }, { ...okState("exploded") }, { ...okState("idle"), token: "x" },
      { ...okState("idle"), consecutive_failures: -1 }, { ...okState("idle"), consecutive_failures: 1.5 },
      { ...okState("idle"), last_success_at: 7 },
    ]) {
      expect(pickCloudSync(broken)).toBeNull();
    }
  });

  it("asks the reader its closed op, and a bad reply is a bad reply", async () => {
    native.invoke.mockResolvedValueOnce(synced({ state: "absent" }));
    expect(await readExistingTeamCloudSync(undefined, () => 1)).toEqual({ kind: "read", at: 1, sync: { state: "absent" } });
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "cloud_sync" } });
    expect(await readExistingTeamCloudSync(async () => synced({ state: "weird" }), () => 2)).toEqual({ kind: "error", at: 2, code: "desktop_bad_reply" });
  });
});

describe("the card", () => {
  it("says in red that the website refuses the token, and how to renew it", async () => {
    native.invoke.mockResolvedValue(synced(okState("auth_failed", 45012)));
    render(<CloudSyncCard />);
    const card = await screen.findByRole("alert");
    expect(card).toHaveTextContent(t.refused);
    expect(card).toHaveTextContent(t.refusedAction);
    // the way back is in the app, never a command on the box
    expect(card.textContent).not.toMatch(/jht cloud|terminal|--token/i);
    expect(screen.getByTestId("cloud-token-renew")).toBeInTheDocument();
    expect(card).toHaveTextContent(/Last push that went through/);
  });

  it("says when pushes keep failing for another reason, and when all is well", async () => {
    native.invoke.mockResolvedValueOnce(synced(okState("timeout", 3)));
    const first = render(<CloudSyncCard />);
    await waitFor(() => expect(screen.getByTestId("cloud-sync-card")).toHaveTextContent("(3 in a row)"));
    expect(screen.queryByRole("alert")).toBeNull();
    first.unmount();

    native.invoke.mockResolvedValueOnce(synced(okState("completed")));
    render(<CloudSyncCard />);
    await waitFor(() => expect(screen.getByTestId("cloud-sync-card")).toHaveTextContent(/^Sync with the websiteWorking: last push/));
  });

  it("a team that does not sync, and a read that failed, say so", async () => {
    native.invoke.mockResolvedValueOnce(synced({ state: "absent" }));
    const first = render(<CloudSyncCard />);
    await waitFor(() => expect(screen.getByTestId("cloud-sync-card")).toHaveTextContent(t.absent));
    first.unmount();
    native.invoke.mockRejectedValueOnce({ code: "existing_team_unavailable" });
    render(<CloudSyncCard />);
    await waitFor(() => expect(screen.getByTestId("cloud-sync-card")).toHaveTextContent("existing_team_unavailable"));
  });
});

describe("an older team", () => {
  it("whose reader does not know the op is a version to update, not a broken link", async () => {
    native.invoke.mockResolvedValueOnce({ ok: false, error: "positions_request_invalid" });
    expect(await readExistingTeamCloudSync(undefined, () => 3)).toEqual({ kind: "unsupported", at: 3 });
    native.invoke.mockResolvedValueOnce({ ok: false, error: "positions_request_invalid" });
    render(<CloudSyncCard />);
    await waitFor(() => expect(screen.getByTestId("cloud-sync-card")).toHaveTextContent(t.unsupported));
  });
});

// T126: the way back from a refused or expiring token is in the app. The native side is a router by
// command: the reader of the push state, the box's view of its token, the connection key, the renewal.
const SECRET = "jht_sync_SENTINELLA-token-privato_7f3a9c";
const IN_FULL = { ok: true, connectionKey: "k1" };

function team(routes: Record<string, unknown | ((args?: Record<string, unknown>) => unknown)>) {
  native.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    const route = routes[command];
    if (route === undefined) throw new Error(`unexpected ${command}`);
    return typeof route === "function" ? (route as (a?: Record<string, unknown>) => unknown)(args) : route;
  });
}

const checkReply = (state: string, extra: Record<string, unknown> = {}) => ({ ok: true, op: "check", state, expires_at: null, days_left: null, ...extra });

describe("the renewal, in the app", () => {
  it("a refused token is renewed by pasting the new one: the box gets it once, on the closed command", async () => {
    const apply = vi.fn(() => ({ ok: true, op: "apply", expires_at: null, days_left: null }));
    team({
      existing_team_positions_read: synced(okState("auth_failed", 45012)),
      existing_team_cloud_token: (args?: Record<string, unknown>) => ((args?.request as { op: string }).op === "check" ? checkReply("expired") : apply()),
      existing_team_position_write_target: IN_FULL,
    });
    render(<CloudSyncCard />);
    const form = await screen.findByTestId("cloud-token-renew");
    const field = screen.getByLabelText(t.tokenLabel) as HTMLInputElement;
    expect(field.type).toBe("password");
    const submit = screen.getByRole("button", { name: t.renew });
    expect(submit).toBeDisabled();
    fireEvent.change(field, { target: { value: "not a token" } });
    expect(submit).toBeDisabled();
    fireEvent.change(field, { target: { value: SECRET } });
    expect(submit).toBeEnabled();
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByTestId("cloud-token-outcome")).toHaveTextContent(t.renewed));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_cloud_token", {
      request: { op: "apply", token: SECRET, connectionKey: "k1" },
    });
    expect(field.value).toBe(""); // the box has it: the field lets go of it
    expect(document.body.textContent).not.toContain("SENTINELLA");
  });

  it("an expired token, with a push state that is still fine, is said refused all the same", async () => {
    team({
      existing_team_positions_read: synced(okState("completed")),
      existing_team_cloud_token: checkReply("expired"),
    });
    render(<CloudSyncCard />);
    expect(await screen.findByRole("alert")).toHaveTextContent(t.refused);
    expect(screen.getByTestId("cloud-token-renew")).toBeInTheDocument();
  });

  it("a token about to expire is said before it does, in yellow, with the same renewal", async () => {
    team({
      existing_team_positions_read: synced(okState("completed")),
      existing_team_cloud_token: checkReply("expiring", { expires_at: "2026-11-01T00:00:00.000Z", days_left: 9 }),
    });
    render(<CloudSyncCard />);
    const form = await screen.findByTestId("cloud-token-renew");
    expect(screen.getByTestId("cloud-sync-card")).toHaveTextContent("expires in 9 days");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(form).toBeInTheDocument();
  });

  it("a token that is fine, or that the box cannot say, shows no renewal", async () => {
    for (const reply of [checkReply("active", { days_left: 60 }), checkReply("none"), { ok: false, error: "existing_team_runtime_outdated" }]) {
      team({ existing_team_positions_read: synced(okState("completed")), existing_team_cloud_token: reply });
      const view = render(<CloudSyncCard />);
      await waitFor(() => expect(screen.getByTestId("cloud-sync-card")).toHaveTextContent(/Working: last push/));
      await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("existing_team_cloud_token", { request: { op: "check" } }));
      expect(screen.queryByTestId("cloud-token-renew")).toBeNull();
      view.unmount();
      native.invoke.mockReset();
    }
  });

  it("once the renewal went through but the push has not run, the old refusal is not shown again in red", async () => {
    team({
      existing_team_positions_read: synced(okState("auth_failed", 45012)),
      existing_team_cloud_token: checkReply("active", { days_left: 90 }),
    });
    render(<CloudSyncCard />);
    await waitFor(() => expect(screen.getByTestId("cloud-sync-card")).toHaveTextContent(t.renewed));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a team not connected in full, a wrong token and an unreachable website each say their own thing, and the token stays out of the text", async () => {
    const cases: [Record<string, unknown>, unknown, string][] = [
      [{ existing_team_position_write_target: { ok: false, error: "position_write_read_only" } }, undefined, t.renewFailures.cloud_token_read_only],
      [{ existing_team_position_write_target: IN_FULL }, { ok: false, error: "token_rejected" }, t.renewFailures.token_rejected],
      [{ existing_team_position_write_target: IN_FULL }, { ok: false, error: "token_other_account" }, t.renewFailures.token_other_account],
      [{ existing_team_position_write_target: IN_FULL }, { ok: false, error: "cloud_unreachable" }, t.renewFailures.cloud_unreachable],
      [{ existing_team_position_write_target: IN_FULL }, { ok: false, error: "something_new_<b>" }, t.renewFailures.other],
    ];
    for (const [target, applied, text] of cases) {
      team({
        existing_team_positions_read: synced(okState("auth_failed", 3)),
        existing_team_cloud_token: (args?: Record<string, unknown>) => ((args?.request as { op: string }).op === "check" ? checkReply("expired") : applied),
        ...target,
      });
      const view = render(<CloudSyncCard />);
      await screen.findByTestId("cloud-token-renew");
      fireEvent.change(screen.getByLabelText(t.tokenLabel), { target: { value: SECRET } });
      fireEvent.submit(screen.getByTestId("cloud-token-renew"));
      await waitFor(() => expect(screen.getByTestId("cloud-token-outcome")).toHaveTextContent(text));
      expect(document.body.textContent).not.toContain("SENTINELLA");
      expect((screen.getByLabelText(t.tokenLabel) as HTMLInputElement).value).toBe(SECRET); // kept: the person can fix it
      view.unmount();
    }
  });

  it("«Open the website» asks the native side for the fixed page and names no address", async () => {
    team({
      existing_team_positions_read: synced(okState("auth_failed", 3)),
      existing_team_cloud_token: checkReply("expired"),
      existing_team_cloud_token_open_site: { ok: true },
    });
    render(<CloudSyncCard />);
    fireEvent.click(await screen.findByRole("button", { name: t.openSite }));
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("existing_team_cloud_token_open_site"));
    expect(JSON.stringify(native.invoke.mock.calls)).not.toMatch(/https?:/);
  });

  it("says in every language how to renew, never with a command", () => {
    for (const [locale, text] of Object.entries(CLOUD_SYNC_CARD_TEXT)) {
      for (const sentence of [text.refusedAction, text.refused, ...Object.values(text.renewFailures)]) {
        expect(sentence, locale).not.toMatch(/jht cloud|--token/);
      }
      expect(Object.keys(text.renewFailures).sort(), locale).toEqual(Object.keys(t.renewFailures).sort());
      expect(text.expiring, locale).toContain("{days}");
      expect(text.openSite.trim() && text.renew.trim() && text.tokenLabel.trim(), locale).toBeTruthy();
    }
  });
});
