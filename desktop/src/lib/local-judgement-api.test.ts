import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localJudgementApi, type LocalJudgementNative } from "./local-judgement-api";
import { forgetLocalDeck, getSwipeDecksLocal } from "./local-swipe";
import { setLocalTeamData } from "./local-team-data";

// The verdicts of the Swipe of a local profile: three routes answered by the native command with the token of
// the deck being judged, never by the cloud. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

const TOKEN = "deck-token-one";
const write = vi.fn<LocalJudgementNative["write"]>();
const next = vi.fn(async () => new Response(JSON.stringify({ from: "next" }), { status: 200 }));
const api = localJudgementApi(next, { write }, () => true);

const post = (path: string, body: unknown, method = "POST") =>
  api(`/api/positions/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(async () => {
  write.mockReset();
  next.mockClear();
  native.isTauri.mockReturnValue(true);
  native.invoke.mockResolvedValue({ ok: true, token: TOKEN, pending: [{ id: 7, status: "scored" }], reviewed: [{ row: { id: 9, status: "excluded" }, action: "like", fbScore: null }] });
  setLocalTeamData("local:abc");
  await getSwipeDecksLocal();
});
afterEach(() => {
  forgetLocalDeck();
  setLocalTeamData(null);
});

describe("a verdict of a local profile", () => {
  it("is sent to the native command with the token of the deck, as a closed request, and answered as the page reads it", async () => {
    write.mockResolvedValue({ ok: true, op: "feedback", value: "dislike" });
    const answer = await post("7/feedback", { action: "dislike", score: 2, direction: "less_like_this", reason: "too_senior", note: " mio ", extra: "no" });
    expect(write).toHaveBeenCalledWith({ op: "feedback", id: "7", value: "dislike", score: 2, direction: "less_like_this", reason: "too_senior", note: "mio", token: TOKEN });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ ok: true, legacy_id: "7", action: "dislike", source: "local" });
    expect(next).not.toHaveBeenCalled();
  });

  it("excludes with a reason and puts back, the page reading «excluded» from the answer", async () => {
    write.mockResolvedValue({ ok: true, status: "excluded" });
    const excluded = await post("7/user-exclude", { reason: "wrong_stack", note: "n" });
    expect(write).toHaveBeenLastCalledWith({ op: "exclude", id: "7", reason: "wrong_stack", note: "n", token: TOKEN });
    expect(await excluded.json()).toMatchObject({ ok: true, id: "7", status: "excluded" });
    write.mockResolvedValue({ ok: true, status: "scored" });
    const back = await post("7/user-exclude", undefined, "DELETE");
    expect(write).toHaveBeenLastCalledWith({ op: "restore", id: "7", token: TOKEN });
    expect(await back.json()).toMatchObject({ ok: true, id: "7", status: "scored" });
  });

  it("is refused as an old deck when no deck was read, and nothing is sent", async () => {
    forgetLocalDeck();
    const answer = await post("7/feedback", { action: "like" });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ error: "deck_outdated" });
    expect(write).not.toHaveBeenCalled();
  });

  it("carries the token of the deck its own position was read in, and a position of no deck read here is an old deck", async () => {
    write.mockResolvedValue({ ok: true, op: "feedback", value: "like" });
    await post("9/feedback", { action: "like" });
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ id: "9", token: TOKEN }));
    expect((await post("8/feedback", { action: "like" })).status).toBe(409);
    // a newer read brings another token for the positions it holds, and takes the others away
    native.invoke.mockResolvedValue({ ok: true, token: "deck-token-two", pending: [{ id: 8, status: "scored" }], reviewed: [] });
    await getSwipeDecksLocal();
    await post("8/feedback", { action: "like" });
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ id: "8", token: "deck-token-two" }));
    const before = write.mock.calls.length;
    expect((await post("7/feedback", { action: "like" })).status).toBe(409);
    expect(write.mock.calls.length).toBe(before);
  });

  it("is refused before the native side when the request is not valid", async () => {
    for (const [path, body, error] of [
      ["7/feedback", { action: "love" }, "action_invalid"],
      ["7/feedback", { action: "like", score: 9 }, "score_invalid"],
      ["7/feedback", { action: "like", direction: "up" }, "direction_invalid"],
      ["7/user-exclude", {}, "reason_required"],
    ] as const) {
      const answer = await post(path, body);
      expect(answer.status, path).toBe(400);
      expect(await answer.json()).toEqual({ error });
    }
    expect((await api("/api/positions/7/feedback", { method: "POST", body: "{" })).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });

  it("tells the refusals of the native side with their closed code and the status the web would give", async () => {
    for (const [code, status] of [
      ["deck_outdated", 409], ["position_write_read_only", 403], ["position_write_window_refused", 403], ["account_scope_changed", 403],
      ["reason_invalid", 400], ["note_too_long", 400], ["position_not_found", 404], ["local_team_not_running", 503], ["feedback_refused", 409],
    ] as const) {
      write.mockResolvedValueOnce({ ok: false, error: code });
      const answer = await post("7/feedback", { action: "like" });
      expect(answer.status, code).toBe(status);
      expect(await answer.json()).toEqual({ error: code });
    }
    write.mockResolvedValueOnce({ ok: false, error: "/etc/passwd leaked" });
    expect(await (await post("7/feedback", { action: "like" })).json()).toEqual({ error: "existing_team_unavailable" });
    write.mockRejectedValueOnce(new Error("boom"));
    expect((await post("7/feedback", { action: "like" })).status).toBe(503);
  });

  it("never falls through to the cloud: outside the desktop the route is refused here", async () => {
    const outside = localJudgementApi(next, { write }, () => false);
    const answer = await outside("/api/positions/7/feedback", { method: "POST", body: JSON.stringify({ action: "like" }) });
    expect(answer.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("leaves every other route, and every call when the profile is not local, to the next link", async () => {
    for (const [path, method] of [["7/user-note", "POST"], ["7/write-request", "POST"], ["7/apply-request", "POST"], ["7/feedback", "GET"], ["7/feedback", "DELETE"], ["x/feedback", "POST"]] as const) {
      await post(path, {}, method);
    }
    expect(write).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(6);
    next.mockClear();
    setLocalTeamData(null);
    await post("7/feedback", { action: "like" });
    expect(next).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });
});
