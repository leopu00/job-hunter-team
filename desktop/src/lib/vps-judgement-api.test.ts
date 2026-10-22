import { describe, expect, it, vi } from "vitest";
import { vpsJudgementApi, type VpsJudgementNative } from "./vps-judgement-api";

const KEY = "k-7f3a";

function setup(options: { target?: unknown; reply?: (request: Record<string, unknown>) => unknown; desktop?: boolean } = {}) {
  const writes: Record<string, unknown>[] = [];
  const native: VpsJudgementNative = {
    target: vi.fn(async () => options.target ?? { ok: true, connectionKey: KEY }),
    write: vi.fn(async (request) => {
      writes.push(request);
      return options.reply ? options.reply(request) : { ok: true, op: request.op, id: Number(request.id) };
    }),
  };
  const next = vi.fn(async () => new Response(JSON.stringify({ from: "next" }), { status: 200 }));
  const api = vpsJudgementApi(next, native, () => options.desktop ?? true);
  const call = async (path: string, method: string, body?: unknown) => {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await api(`${window.location.origin}${path}`, init);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { native, next, writes, call };
}

describe("the six judgement routes go to the VPS of a team connected in full", () => {
  it("feedback: the verdict, its score and direction, the reason and the note", async () => {
    const { call, writes, next } = setup();
    const out = await call("/api/positions/12/feedback", "POST", {
      action: "star", score: 5, direction: "more_like_this", reason: "great_fit", note: " a note ",
    });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, legacy_id: "12", source: "vps" });
    expect(writes).toEqual([{
      op: "feedback", id: "12", value: "star", score: 5, direction: "more_like_this", reason: "great_fit", note: "a note", connectionKey: KEY,
    }]);
    expect(next).not.toHaveBeenCalled();
  });

  it("user-exclude: the exclusion with its reason, and its undo", async () => {
    const { call, writes } = setup({
      reply: (r) => (r.op === "exclude"
        ? { ok: true, status: "excluded", previous_status: "scored", reason: "too_senior" }
        : { ok: true, status: "scored", previous_status: "excluded" }),
    });
    const excluded = await call("/api/positions/9/user-exclude", "POST", { reason: "too_senior", note: "no" });
    // the page reads `status` to know the exclusion went through
    expect(excluded.body).toMatchObject({ ok: true, status: "excluded", source: "vps" });
    const restored = await call("/api/positions/9/user-exclude", "DELETE");
    expect(restored.body).toMatchObject({ ok: true, status: "scored" });
    expect(writes).toEqual([
      { op: "exclude", id: "9", reason: "too_senior", note: "no", connectionKey: KEY },
      { op: "restore", id: "9", connectionKey: KEY },
    ]);
  });

  it("user-note: the private note, and clearing it", async () => {
    const { call, writes } = setup();
    expect((await call("/api/positions/3/user-note", "POST", { note: " call back " })).body).toMatchObject({ note: "call back" });
    expect((await call("/api/positions/3/user-note", "DELETE")).body).toMatchObject({ note: null });
    expect(writes).toEqual([
      { op: "note", id: "3", text: "call back", connectionKey: KEY },
      { op: "note", id: "3", text: "", connectionKey: KEY },
    ]);
    const { call: again, writes: none } = setup();
    expect((await again("/api/positions/3/user-note", "POST", { note: "  " })).status).toBe(400);
    expect(none).toEqual([]);
  });

  it("write-request: the CV and the cover letter, as the two buttons read the answer", async () => {
    const { call, writes } = setup({
      reply: (r) => ({ ok: true, write_requested: r.on === true, write_request_kind: r.on ? r.kind : null }),
    });
    const cv = await call("/api/positions/4/write-request", "POST");
    expect((cv.body.position as Record<string, unknown>).write_requested).toBe(true);
    const letter = await call("/api/positions/4/write-request", "POST", { kind: "cover_letter" });
    expect((letter.body.position as Record<string, unknown>).write_request_kind).toBe("cover_letter");
    const off = await call("/api/positions/4/write-request", "DELETE", { kind: "cover_letter" });
    expect(off.body.position).toEqual({ id: "4", write_requested: false, write_request_kind: null });
    expect(writes.map((w) => [w.op, w.on, w.kind])).toEqual([
      ["write_request", true, "cv"], ["write_request", true, "cover_letter"], ["write_request", false, "cover_letter"],
    ]);
    const { call: bad, writes: none } = setup();
    expect((await bad("/api/positions/4/write-request", "POST", { kind: "poem" })).body.error).toBe("request_kind_invalid");
    expect(none).toEqual([]);
  });

  it("apply-request: only with the dialog's confirmation; withdrawing needs none", async () => {
    const { call, writes } = setup();
    const unconfirmed = await call("/api/positions/5/apply-request", "POST");
    expect(unconfirmed).toEqual({ status: 400, body: { error: "position_write_not_confirmed" } });
    expect(writes).toEqual([]);
    const authorised = await call("/api/positions/5/apply-request", "POST", { confirmed: true });
    expect(authorised.body).toMatchObject({ apply_requested: true, source: "vps" });
    const withdrawn = await call("/api/positions/5/apply-request", "DELETE");
    expect(withdrawn.body).toMatchObject({ apply_requested: false });
    expect(writes).toEqual([
      { op: "apply_request", id: "5", on: true, confirmed: true, connectionKey: KEY },
      { op: "apply_request", id: "5", on: false, confirmed: false, connectionKey: KEY },
    ]);
  });

  it("recheck-request: ask for a new analysis, and withdraw it", async () => {
    const { call, writes } = setup();
    expect((await call("/api/positions/6/recheck-request", "POST")).body).toMatchObject({ recheck_requested: true });
    expect((await call("/api/positions/6/recheck-request", "DELETE")).body).toMatchObject({ recheck_requested: false });
    expect(writes.map((w) => [w.op, w.on])).toEqual([["recheck", true], ["recheck", false]]);
  });
});

describe("what the link does not do", () => {
  it("with no existing team here the page writes as it always did", async () => {
    for (const error of ["existing_team_runtime_required", "existing_team_runtime_selection_required"]) {
      const { call, next, native } = setup({ target: { ok: false, error } });
      expect((await call("/api/positions/1/recheck-request", "POST")).body).toEqual({ from: "next" });
      expect(next).toHaveBeenCalledTimes(1);
      expect(native.write).not.toHaveBeenCalled();
    }
  });

  it("an existing team not connected in full is refused, and never written to the cloud instead", async () => {
    const { call, next, native } = setup({ target: { ok: false, error: "position_write_read_only" } });
    expect(await call("/api/positions/1/feedback", "POST", { action: "like" })).toEqual({
      status: 403, body: { error: "position_write_read_only" },
    });
    expect(next).not.toHaveBeenCalled();
    expect(native.write).not.toHaveBeenCalled();
  });

  it("a refusal of the VPS keeps its code; one that is not a code is not shown", async () => {
    const { call } = setup({ reply: () => ({ ok: false, error: "already_submitted" }) });
    expect(await call("/api/positions/1/apply-request", "POST", { confirmed: true })).toEqual({
      status: 409, body: { error: "already_submitted" },
    });
    const { call: odd } = setup({ reply: () => ({ ok: false, error: "<b>no</b>" }) });
    expect((await odd("/api/positions/1/recheck-request", "POST")).body.error).toBe("existing_team_unavailable");
    const { call: gone } = setup({ reply: () => ({ ok: false, error: "existing_team_runtime_target_changed" }) });
    expect((await gone("/api/positions/1/recheck-request", "POST")).status).toBe(409);
  });

  it("other routes, other methods and the web are not touched, and the target is not even asked", async () => {
    for (const [path, method, desktop] of [
      ["/api/positions/1/mark-applied", "POST", true],
      ["/api/positions/1/feedback", "GET", true],
      ["/api/positions/1/feedback", "POST", false],
    ] as const) {
      const { call, next, native } = setup({ desktop });
      expect((await call(path, method, method === "GET" ? undefined : { action: "like" })).body).toEqual({ from: "next" });
      expect(native.target).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it("a body that is not JSON is refused before the VPS", async () => {
    const { native, next } = setup();
    const api = vpsJudgementApi(next, native, () => true);
    const res = await api(`${window.location.origin}/api/positions/1/feedback`, { method: "POST", body: "{nope" });
    expect(res.status).toBe(400);
    expect(native.write).not.toHaveBeenCalled();
  });
});
