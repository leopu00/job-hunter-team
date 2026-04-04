/** Test unitari — shared/scheduler (vitest): coda prioritaria, deps, cicli, timeout, cancel. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  configureScheduler, enqueue, cancel, getTask,
  listTasks, getStats, hasCyclicDeps, resetScheduler,
} from "../../../shared/scheduler/index.js";
import { PRIORITY_WEIGHT, DEFAULT_SCHEDULER_CONFIG } from "../../../shared/scheduler/types.js";

function wait(ms = 50): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

beforeEach(() => { resetScheduler(); });

describe("scheduler types", () => {
  it("PRIORITY_WEIGHT e DEFAULT_SCHEDULER_CONFIG valori corretti", () => {
    expect(PRIORITY_WEIGHT.critical).toBe(0);
    expect(PRIORITY_WEIGHT.high).toBe(1);
    expect(PRIORITY_WEIGHT.normal).toBe(2);
    expect(PRIORITY_WEIGHT.low).toBe(3);
    expect(DEFAULT_SCHEDULER_CONFIG.concurrency).toBe(3);
    expect(DEFAULT_SCHEDULER_CONFIG.defaultTimeoutMs).toBe(60000);
  });
});

describe("enqueue / getTask / listTasks", () => {
  it("enqueue crea task con defaults corretti", () => {
    const t = enqueue("t1", "test", async () => "ok");
    expect(t.id).toBe("t1");
    expect(t.name).toBe("test");
    expect(t.priority).toBe("normal");
    expect(t.dependsOn).toEqual([]);
    expect(t.createdAt).toBeGreaterThan(0);
  });
  it("enqueue con opzioni: priority, dependsOn, timeoutMs", () => {
    enqueue("dep", "dep", async () => "x");
    const t = enqueue("t2", "task2", async () => "ok", { priority: "high", dependsOn: ["dep"], timeoutMs: 5000 });
    expect(t.priority).toBe("high");
    expect(t.dependsOn).toEqual(["dep"]);
    expect(t.timeoutMs).toBe(5000);
  });
  it("enqueue id duplicato → throw", () => {
    enqueue("dup", "first", async () => 1);
    expect(() => enqueue("dup", "second", async () => 2)).toThrow("gia' in coda");
  });
  it("getTask per id e listTasks filtrato", async () => {
    enqueue("x", "X", async () => 1);
    enqueue("y", "Y", async () => 2);
    expect(getTask("x")!.name).toBe("X");
    expect(getTask("nope")).toBeUndefined();
    await wait();
    expect(listTasks().length).toBeGreaterThanOrEqual(2);
    expect(listTasks("completed").every(t => t.status === "completed")).toBe(true);
  });
});
describe("esecuzione — task completato con risultato", () => {
  it("task eseguito → status completed, result valorizzato", async () => {
    enqueue("ok", "success", async () => 42);
    await wait();
    const t = getTask("ok")!;
    expect(t.status).toBe("completed");
    expect(t.result).toBe(42);
    expect(t.startedAt).toBeGreaterThan(0);
    expect(t.completedAt).toBeGreaterThanOrEqual(t.startedAt!);
  });
  it("task che lancia errore → status failed, error message", async () => {
    enqueue("fail", "error-task", async () => { throw new Error("crash"); });
    await wait();
    const t = getTask("fail")!;
    expect(t.status).toBe("failed");
    expect(t.error).toContain("crash");
  });
});

describe("priorità — ordinamento esecuzione", () => {
  it("critical eseguito prima di low quando concurrency=1", async () => {
    configureScheduler({ concurrency: 1 });
    const order: string[] = [];
    let unblock!: () => void;
    const blocker = new Promise<void>(r => { unblock = r; });
    enqueue("block", "blocker", () => blocker);
    enqueue("low1", "low", async () => { order.push("low"); }, { priority: "low" });
    enqueue("crit1", "crit", async () => { order.push("crit"); }, { priority: "critical" });
    unblock();
    await wait(100);
    expect(order).toEqual(["crit", "low"]);
  });
  it("stessa priorità: FIFO per createdAt", async () => {
    configureScheduler({ concurrency: 1 });
    const order: string[] = [];
    let unblock!: () => void;
    const blocker = new Promise<void>(r => { unblock = r; });
    enqueue("block", "blocker", () => blocker);
    enqueue("a", "first", async () => { order.push("a"); });
    enqueue("b", "second", async () => { order.push("b"); });
    unblock();
    await wait(100);
    expect(order).toEqual(["a", "b"]);
  });
});

describe("cancel — annullamento task", () => {
  it("cancel task pendente → true, status cancelled", async () => {
    configureScheduler({ concurrency: 1 });
    let unblock!: () => void;
    enqueue("block", "b", () => new Promise<void>(r => { unblock = r; }));
    enqueue("victim", "v", async () => "x");
    expect(cancel("victim")).toBe(true);
    expect(getTask("victim")!.status).toBe("cancelled");
    unblock();
    await wait();
  });
  it("cancel task running → false", async () => {
    enqueue("run", "r", () => new Promise(r => setTimeout(r, 500)));
    await wait(10);
    expect(getTask("run")!.status).toBe("running");
    expect(cancel("run")).toBe(false);
  });
  it("cancel task inesistente → false", () => { expect(cancel("nope")).toBe(false); });
});

describe("dipendenze — risoluzione e attesa", () => {
  it("task con dep aspetta completamento dep", async () => {
    let unblock!: () => void;
    enqueue("dep", "dependency", () => new Promise<void>(r => { unblock = r; }));
    enqueue("child", "dependent", async () => "done", { dependsOn: ["dep"] });
    await wait(10);
    expect(getTask("child")!.status).toBe("pending");
    unblock();
    await wait(100);
    expect(getTask("child")!.status).toBe("completed");
  });
  it("dep non esistente → task resta pending", async () => {
    enqueue("orphan", "no-dep", async () => 1, { dependsOn: ["ghost"] });
    await wait();
    expect(getTask("orphan")!.status).toBe("pending");
  });
  it("catena A→B→C eseguita in ordine", async () => {
    const order: string[] = [];
    enqueue("a", "A", async () => { order.push("a"); });
    enqueue("b", "B", async () => { order.push("b"); }, { dependsOn: ["a"] });
    enqueue("c", "C", async () => { order.push("c"); }, { dependsOn: ["b"] });
    await wait(200);
    expect(order).toEqual(["a", "b", "c"]);
  });
});

describe("hasCyclicDeps — rilevamento cicli", () => {
  it("ciclo A↔B → true", () => {
    enqueue("x", "X", async () => 1, { dependsOn: ["y"] });
    enqueue("y", "Y", async () => 2, { dependsOn: ["x"] });
    expect(hasCyclicDeps("x")).toBe(true);
    expect(hasCyclicDeps("y")).toBe(true);
  });
  it("catena lineare e task senza deps → false", () => {
    enqueue("a", "A", async () => 1);
    enqueue("b", "B", async () => 2, { dependsOn: ["a"] });
    enqueue("c", "C", async () => 3, { dependsOn: ["b"] });
    expect(hasCyclicDeps("c")).toBe(false);
    resetScheduler();
    enqueue("solo", "S", async () => 1);
    expect(hasCyclicDeps("solo")).toBe(false);
  });
});

describe("timeout e callbacks", () => {
  it("task oltre timeoutMs → status timeout", async () => {
    enqueue("slow", "timeout-task", () => new Promise(r => setTimeout(r, 500)), { timeoutMs: 20 });
    await wait(100);
    expect(getTask("slow")!.status).toBe("timeout");
    expect(getTask("slow")!.error).toContain("Timeout");
  });
  it("onTaskComplete chiamato su successo", async () => {
    const cb = vi.fn();
    configureScheduler({ onTaskComplete: cb });
    enqueue("ok", "success", async () => "v");
    await wait(100);
    expect(cb).toHaveBeenCalled();
    expect(cb.mock.calls.some((c: any) => c[0].id === "ok")).toBe(true);
  });
  it("onTaskError chiamato su errore", async () => {
    const cb = vi.fn();
    configureScheduler({ onTaskError: cb });
    enqueue("bad", "fail", async () => { throw new Error("err"); });
    await wait(100);
    expect(cb).toHaveBeenCalled();
    expect(cb.mock.calls.some((c: any) => c[0].id === "bad")).toBe(true);
  });
});

describe("getStats e resetScheduler", () => {
  it("getStats conta per status, resetScheduler svuota tutto", async () => {
    enqueue("ok", "A", async () => 1);
    enqueue("ko", "B", async () => { throw new Error("x"); });
    await wait();
    expect(getStats().completed).toBe(1);
    expect(getStats().failed).toBe(1);
    resetScheduler();
    expect(listTasks()).toHaveLength(0);
    expect(getStats().completed).toBe(0);
  });
});
