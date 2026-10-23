import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    expect(card).toHaveTextContent("jht cloud enable --token");
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
