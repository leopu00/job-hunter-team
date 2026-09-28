// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { endedFromOutside, exitCodeOf, superviseDevServer } from "./dev-server.mjs";

/** A fake Vite: `end(code, signal)` is how it ends; kill() ends it by that signal. */
function fakeChildren() {
  const children = [];
  const start = () => {
    const child = Object.assign(new EventEmitter(), {
      killed: null,
      kill(signal) {
        child.killed = signal;
        child.emit("exit", null, signal);
      },
      end(code, signal = null) {
        child.emit("exit", code, signal);
      },
    });
    children.push(child);
    return child;
  };
  return { children, start };
}

function supervisor(options = {}) {
  const { children, start } = fakeChildren();
  const exit = vi.fn();
  const log = vi.fn();
  let clock = 0;
  const timers = [];
  const s = superviseDevServer({
    start,
    exit,
    log,
    now: () => clock,
    setTimer: (fn) => timers.push(fn),
    ...options,
  });
  const flush = () => timers.splice(0).forEach((fn) => fn());
  return { s, children, exit, log, flush, tick: (ms) => (clock += ms) };
}

describe("the dev server's supervisor", () => {
  it("someone else's pkill (SIGTERM, which Vite turns into code 143): Vite starts again, and nothing ends", () => {
    const { children, exit, log, flush } = supervisor();
    children[0].end(143);
    flush();
    expect(children).toHaveLength(2);
    expect(exit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("starting it again"));
    children[1].end(null, "SIGKILL");
    flush();
    expect(children).toHaveLength(3);
    expect(exit).not.toHaveBeenCalled();
  });

  it("Vite's own end (an error, the port taken, stdin closed) ends the supervisor with its code", () => {
    for (const code of [1, 0]) {
      const { children, exit, flush } = supervisor();
      children[0].end(code);
      flush();
      expect(children).toHaveLength(1);
      expect(exit).toHaveBeenCalledWith(code);
    }
  });

  it("asked to stop (tauri dev closing, Ctrl-C): Vite stops and does not start again", () => {
    const { s, children, exit, flush } = supervisor();
    s.stop("SIGTERM");
    flush();
    expect(children[0].killed).toBe("SIGTERM");
    expect(children).toHaveLength(1);
    expect(exit).toHaveBeenCalledWith(143);
  });

  it("tauri dev kills the whole tree at once: a stop that arrives while Vite is being started again still stops", () => {
    const { s, children, exit, flush } = supervisor();
    children[0].end(143);
    s.stop("SIGTERM");
    flush();
    expect(children).toHaveLength(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("ended from outside over and over: it gives up after the limit, and says so", () => {
    const { children, exit, log, flush, tick } = supervisor({ maxRestarts: 2, windowMs: 60_000 });
    for (let i = 0; i < 2; i++) {
      children.at(-1).end(143);
      flush();
      tick(1_000);
    }
    expect(children).toHaveLength(3);
    children.at(-1).end(143);
    flush();
    expect(children).toHaveLength(3);
    expect(exit).toHaveBeenCalledWith(143);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining("not starting it again"));
  });

  it("the limit is per window: ends far apart are each started again", () => {
    const { children, exit, flush, tick } = supervisor({ maxRestarts: 2, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      children.at(-1).end(143);
      flush();
      tick(61_000);
    }
    expect(children).toHaveLength(6);
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("how a child ended", () => {
  it("from outside: SIGTERM, SIGKILL, SIGHUP, or the codes a handler of them exits with; not Ctrl-C, not an error", () => {
    expect(endedFromOutside(null, "SIGTERM")).toBe(true);
    expect(endedFromOutside(null, "SIGKILL")).toBe(true);
    expect(endedFromOutside(null, "SIGHUP")).toBe(true);
    expect(endedFromOutside(143, null)).toBe(true);
    expect(endedFromOutside(137, null)).toBe(true);
    expect(endedFromOutside(129, null)).toBe(true);
    expect(endedFromOutside(null, "SIGINT")).toBe(false);
    expect(endedFromOutside(130, null)).toBe(false);
    expect(endedFromOutside(1, null)).toBe(false);
    expect(endedFromOutside(0, null)).toBe(false);
  });

  it("its code as a shell reports it", () => {
    expect(exitCodeOf(1, null)).toBe(1);
    expect(exitCodeOf(null, "SIGTERM")).toBe(143);
    expect(exitCodeOf(null, "SIGKILL")).toBe(137);
  });
});
