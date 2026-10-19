// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  ACTION_FRESH_MS, HEARTBEAT_MS, RETRY_DELAYS_MS, createVpsLink, linkAllowsActions, linkReport, retryDelay,
  type LinkReport,
} from "./vps-link";

/** A link on a fake clock: timers run only when the test moves time; probes answer from a script. */
function harness(answers: LinkReport[] = []) {
  let now = 1_000_000;
  let visible = true;
  const timers: Array<{ at: number; run: () => void; id: number }> = [];
  let ids = 0;
  const probe = vi.fn(async (): Promise<LinkReport> => answers.shift() ?? { ok: true });
  const link = createVpsLink({
    now: () => now,
    setTimer: (run, ms) => { const id = ++ids; timers.push({ at: now + ms, run, id }); return id; },
    clearTimer: (id) => { const index = timers.findIndex((timer) => timer.id === id); if (index >= 0) timers.splice(index, 1); },
    visible: () => visible,
    probe,
    random: () => 0.5, // no jitter: the base delays exactly
  });
  async function advance(ms: number) {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > until) break;
      timers.shift();
      now = next.at;
      next.run();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
    now = until;
  }
  return {
    link, probe, advance, pending: () => timers.length,
    hide: () => { visible = false; }, show: () => { visible = true; link.visibilityChanged(); },
    now: () => now,
  };
}

const network = (code = "timeout"): LinkReport => ({ ok: false, kind: "network", code });

describe("the link to an existing team's VPS", () => {
  it("a ssh timeout is the network: 5 retries at 5 s, 15 s, 45 s, 2 min and 5 min, then «Riprova» and nothing more", async () => {
    const h = harness([network(), network(), network(), network(), network()]);
    h.link.start(true);
    h.link.report(network());
    expect(h.link.state()).toMatchObject({ status: "reconnecting", code: "timeout", nextAt: h.now() + 5_000 });
    const at: number[] = [];
    h.probe.mockImplementation(async () => { at.push(h.now()); return network(); });
    const start = h.now();
    await h.advance(30 * 60_000);
    expect(at.map((t) => t - start)).toEqual([5_000, 20_000, 65_000, 185_000, 485_000]);
    expect(h.link.state()).toMatchObject({ status: "network", code: "timeout", nextAt: null });
    expect(h.pending()).toBe(0);
    expect(RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(8.5 * 60_000);
  });

  it("an exit 72 is the application: no backoff, no timer, not even the heartbeat", async () => {
    const h = harness();
    h.link.start(true);
    h.link.report({ ok: false, kind: "application", code: "existing_team_identity_mismatch" });
    expect(h.link.state()).toMatchObject({ status: "application", code: "existing_team_identity_mismatch" });
    expect(h.pending()).toBe(0);
    await h.advance(60 * 60_000);
    expect(h.probe).not.toHaveBeenCalled();
  });

  it("a changed SSH key blocks: never retried, and «Riprova» does nothing", async () => {
    const h = harness();
    h.link.start(true);
    h.link.report({ ok: false, kind: "blocked", code: "host_key_changed" });
    expect(h.link.state()).toMatchObject({ status: "blocked", code: "host_key_changed" });
    h.link.retry();
    await h.advance(60 * 60_000);
    expect(h.probe).not.toHaveBeenCalled();
    expect(h.link.state().status).toBe("blocked");
  });

  it("a version mismatch is not retried either", async () => {
    const h = harness();
    h.link.start(true);
    h.link.report({ ok: false, kind: "version", code: "existing_team_runtime_changed" });
    await h.advance(60 * 60_000);
    expect(h.probe).not.toHaveBeenCalled();
  });

  it("a working read is a contact: connected, and one light read only after a minute without reads", async () => {
    const h = harness();
    h.link.start(false);
    expect(h.link.state().status).toBe("idle");
    h.link.report({ ok: true });
    expect(h.link.state()).toMatchObject({ status: "connected", lastContact: h.now() });
    await h.advance(HEARTBEAT_MS - 1);
    h.link.report({ ok: true }); // a page read: the heartbeat moves on
    await h.advance(HEARTBEAT_MS - 1);
    expect(h.probe).not.toHaveBeenCalled();
    await h.advance(1);
    expect(h.probe).toHaveBeenCalledTimes(1);
  });

  it("with the window hidden nothing is tried; back in view, one try and not the whole series", async () => {
    const h = harness([network()]);
    h.link.start(true);
    h.link.report(network());
    h.hide();
    await h.advance(10 * 60_000);
    expect(h.probe).not.toHaveBeenCalled();
    h.show();
    await h.advance(0);
    expect(h.probe).toHaveBeenCalledTimes(1);
    expect(h.link.state()).toMatchObject({ status: "reconnecting", nextAt: h.now() + 15_000 });
  });

  it("one series, one probe: pages failing meanwhile add no timer, and a retry in flight is not doubled", async () => {
    let release!: (value: LinkReport) => void;
    const h = harness();
    h.link.start(true);
    h.link.report(network());
    h.link.report(network("ssh_unavailable"));
    expect(h.pending()).toBe(1);
    h.probe.mockImplementation(() => new Promise<LinkReport>((resolve) => { release = resolve; }));
    await h.advance(5_000);
    h.link.retry();
    h.link.retry();
    expect(h.probe).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await h.advance(0);
    expect(h.link.state().status).toBe("connected");
  });

  it("«Riprova» after the tries are over starts a new series from 5 s", async () => {
    const h = harness();
    h.link.start(true);
    h.link.report(network());
    h.probe.mockImplementation(async () => network());
    await h.advance(30 * 60_000);
    expect(h.link.state().status).toBe("network");
    h.link.retry();
    await h.advance(0);
    expect(h.link.state()).toMatchObject({ status: "reconnecting", nextAt: h.now() + 5_000 });
  });

  it("stops everything when the view closes", async () => {
    const h = harness();
    h.link.start(true);
    h.link.report(network());
    h.link.stop();
    expect(h.link.state().status).toBe("idle");
    expect(h.pending()).toBe(0);
    h.link.report({ ok: true });
    expect(h.link.state().status).toBe("idle");
  });

  it("reads the core's reply: a kind it does not know is the application's", () => {
    expect(linkReport({ ok: true, data: {} })).toEqual({ ok: true });
    expect(linkReport({ ok: false, error: "timeout", kind: "network" })).toEqual(network());
    expect(linkReport({ ok: false, error: "positions_unavailable" })).toEqual({ ok: false, kind: "application", code: "positions_unavailable" });
    expect(linkReport({ ok: false, error: "Bad Code", kind: "network" })).toEqual({ ok: false, kind: "network", code: "positions_unavailable" });
    expect(linkReport({ ok: false, error: "x_y", kind: "elsewhere" })).toEqual({ ok: false, kind: "application", code: "x_y" });
    expect(linkReport(null)).toEqual({ ok: false, kind: "application", code: "desktop_bad_reply" });
  });

  it("lets actions run only on a contact younger than two minutes", () => {
    const connected = { status: "connected" as const, code: null, lastContact: 0, nextAt: null };
    expect(linkAllowsActions(connected, ACTION_FRESH_MS - 1)).toBe(true);
    expect(linkAllowsActions(connected, ACTION_FRESH_MS)).toBe(false);
    expect(linkAllowsActions({ ...connected, status: "reconnecting" }, 1)).toBe(false);
    expect(linkAllowsActions({ ...connected, status: "idle", lastContact: null }, 1)).toBe(false);
    expect(retryDelay(0, () => 0)).toBe(4_000);
    expect(retryDelay(0, () => 1)).toBe(6_000);
    expect(retryDelay(RETRY_DELAYS_MS.length)).toBeNull();
  });
});
