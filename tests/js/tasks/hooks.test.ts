/** Test unitari — shared/hooks (vitest): registry, triggering, resolution, loader, precedence. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  registerHook, unregisterHook, clearAllHooks,
  hasListeners, getRegisteredEvents, getHandlerCount,
  triggerHook, createHookEvent,
  resolveHookEntries, filterEligibleHooks,
} from "../../../shared/hooks/registry.js";
import { discoverHooksInDir, loadHooksFromWorkspace } from "../../../shared/hooks/loader.js";
import { HOOK_SOURCE_PRECEDENCE } from "../../../shared/hooks/types.js";
import type { HookEntry, HookEvent, HookSource } from "../../../shared/hooks/types.js";

beforeEach(() => { clearAllHooks(); });

function mkEntry(name: string, source: HookSource, events: string[], enabled = true, envReqs?: string[]): HookEntry {
  return {
    hook: { name, description: `hook ${name}`, source, baseDir: "/tmp", handlerPath: "/tmp/h.js" },
    metadata: { events, ...(envReqs ? { requires: { env: envReqs } } : {}) },
    enabled,
  };
}

describe("hook registry — registrazione e query", () => {
  it("HOOK_SOURCE_PRECEDENCE: bundled(10) < plugin(20) < managed(30) < workspace(40)", () => {
    expect(HOOK_SOURCE_PRECEDENCE.bundled).toBe(10);
    expect(HOOK_SOURCE_PRECEDENCE.workspace).toBe(40);
    expect(HOOK_SOURCE_PRECEDENCE.bundled).toBeLessThan(HOOK_SOURCE_PRECEDENCE.workspace);
  });
  it("registerHook + hasListeners per tipo e tipo:action", () => {
    registerHook("message", "hook1", vi.fn());
    registerHook("message:received", "hook2", vi.fn());
    expect(hasListeners("message")).toBe(true);
    expect(hasListeners("message", "received")).toBe(true);
    expect(hasListeners("session")).toBe(false);
  });
  it("unregisterHook rimuove handler specifico", () => {
    registerHook("agent", "h1", vi.fn());
    registerHook("agent", "h2", vi.fn());
    expect(getHandlerCount("agent")).toBe(2);
    unregisterHook("agent", "h1");
    expect(getHandlerCount("agent")).toBe(1);
  });
  it("unregisterHook ultimo handler elimina evento dalla mappa", () => {
    registerHook("gateway", "solo", vi.fn());
    unregisterHook("gateway", "solo");
    expect(hasListeners("gateway")).toBe(false);
    expect(getRegisteredEvents()).not.toContain("gateway");
  });
  it("clearAllHooks svuota tutto", () => {
    registerHook("a", "h1", vi.fn());
    registerHook("b", "h2", vi.fn());
    clearAllHooks();
    expect(getHandlerCount()).toBe(0);
    expect(getRegisteredEvents()).toHaveLength(0);
  });
  it("getRegisteredEvents elenca tutti gli eventi", () => {
    registerHook("command", "c1", vi.fn());
    registerHook("session:start", "s1", vi.fn());
    expect(getRegisteredEvents()).toContain("command");
    expect(getRegisteredEvents()).toContain("session:start");
  });
  it("getHandlerCount totale e per evento", () => {
    registerHook("a", "h1", vi.fn());
    registerHook("a", "h2", vi.fn());
    registerHook("b", "h3", vi.fn());
    expect(getHandlerCount("a")).toBe(2);
    expect(getHandlerCount("b")).toBe(1);
    expect(getHandlerCount()).toBe(3);
  });
});

describe("triggerHook — esecuzione handler", () => {
  it("esegue handler registrati con evento corretto", async () => {
    const fn = vi.fn();
    registerHook("message", "test-hook", fn);
    const event = createHookEvent("message", "received", { data: "x" });
    await triggerHook(event);
    expect(fn).toHaveBeenCalledWith(event);
  });
  it("esegue tipo generico + specifico tipo:action", async () => {
    const generic = vi.fn();
    const specific = vi.fn();
    registerHook("agent", "gen", generic);
    registerHook("agent:start", "spec", specific);
    const event = createHookEvent("agent", "start");
    await triggerHook(event);
    expect(generic).toHaveBeenCalledOnce();
    expect(specific).toHaveBeenCalledOnce();
  });
  it("errore in un handler non blocca gli altri", async () => {
    const bad = vi.fn(() => { throw new Error("boom"); });
    const good = vi.fn();
    registerHook("session", "bad-hook", bad);
    registerHook("session", "good-hook", good);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await triggerHook(createHookEvent("session", "end"));
    expect(good).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
  it("nessun handler → noop senza errori", async () => {
    await expect(triggerHook(createHookEvent("command", "run"))).resolves.toBeUndefined();
  });
});

describe("createHookEvent — factory", () => {
  it("crea evento con timestamp, context, messages; senza context → vuoto", () => {
    const e = createHookEvent("gateway", "route", { path: "/api" });
    expect(e.type).toBe("gateway");
    expect(e.action).toBe("route");
    expect(e.timestamp).toBeGreaterThan(0);
    expect(e.context).toEqual({ path: "/api" });
    expect(e.messages).toEqual([]);
    expect(createHookEvent("message", "send").context).toEqual({});
  });
});

describe("resolveHookEntries — risoluzione collisioni per precedenza", () => {
  it("workspace (40) vince su bundled (10) per stesso nome", () => {
    const entries = [
      mkEntry("my-hook", "bundled", ["agent:start"]),
      mkEntry("my-hook", "workspace", ["agent:start"]),
    ];
    const resolved = resolveHookEntries(entries, HOOK_SOURCE_PRECEDENCE);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].hook.source).toBe("workspace");
  });
  it("nomi diversi non collidono", () => {
    const entries = [
      mkEntry("hook-a", "bundled", ["agent:start"]),
      mkEntry("hook-b", "plugin", ["session:end"]),
    ];
    expect(resolveHookEntries(entries, HOOK_SOURCE_PRECEDENCE)).toHaveLength(2);
  });
});

describe("filterEligibleHooks — config e requirements", () => {
  it("config.enabled=false → nessun hook", () => {
    const entries = [mkEntry("h1", "bundled", ["message"])];
    expect(filterEligibleHooks(entries, { enabled: false })).toHaveLength(0);
  });
  it("entry.enabled=false → filtrato", () => {
    const entries = [mkEntry("h1", "bundled", ["message"], false)];
    expect(filterEligibleHooks(entries)).toHaveLength(0);
  });
  it("config.entries[name].enabled=false → filtrato specifico", () => {
    const entries = [mkEntry("h1", "bundled", ["a"]), mkEntry("h2", "bundled", ["b"])];
    const result = filterEligibleHooks(entries, { entries: { h1: { enabled: false } } });
    expect(result).toHaveLength(1);
    expect(result[0].hook.name).toBe("h2");
  });
  it("env requirement mancante → filtrato", () => {
    const entries = [mkEntry("h1", "bundled", ["a"], true, ["MISSING_VAR_XYZ"])];
    expect(filterEligibleHooks(entries)).toHaveLength(0);
  });
  it("env requirement presente → incluso", () => {
    process.env.__TEST_HOOK_VAR = "1";
    const entries = [mkEntry("h1", "bundled", ["a"], true, ["__TEST_HOOK_VAR"])];
    expect(filterEligibleHooks(entries)).toHaveLength(1);
    delete process.env.__TEST_HOOK_VAR;
  });
});

describe("loader — discoverHooksInDir e loadHooksFromWorkspace", () => {
  it("directory inesistente → array vuoto", () => {
    expect(discoverHooksInDir("/tmp/nonexistent-hooks-dir-xyz", "workspace")).toEqual([]);
  });
  it("directory con hook valido → scopre entry", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-"));
    const hookDir = path.join(tmp, "my-hook");
    fs.mkdirSync(hookDir);
    fs.writeFileSync(path.join(hookDir, "HOOK.md"), "---\nevents:\n  - \"message:received\"\n---\nDescrizione");
    fs.writeFileSync(path.join(hookDir, "handler.js"), "module.exports = () => {}");
    const entries = discoverHooksInDir(tmp, "workspace");
    expect(entries).toHaveLength(1);
    expect(entries[0].hook.name).toBe("my-hook");
    expect(entries[0].metadata.events).toContain("message:received");
    expect(entries[0].enabled).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("sottocartella senza HOOK.md → ignorata", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-"));
    fs.mkdirSync(path.join(tmp, "no-hook-md"));
    fs.writeFileSync(path.join(tmp, "no-hook-md", "handler.js"), "");
    expect(discoverHooksInDir(tmp, "bundled")).toHaveLength(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("loadHooksFromWorkspace con dir vuota → 0", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-ws-"));
    expect(await loadHooksFromWorkspace(tmp)).toBe(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
