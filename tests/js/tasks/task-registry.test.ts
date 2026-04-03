import { describe, it, expect, beforeEach } from "vitest";
import {
  createTask, getTaskById, listTasks, listTasksByOwner, listTasksByAgent,
  updateTask, cancelTask, deleteTask, getRegistrySummary,
  exportSnapshot, restoreFromSnapshot, clearRegistry, taskCount,
} from "../../../shared/tasks/task-registry.js";
import { isTerminalStatus, isActiveStatus } from "../../../shared/tasks/types.js";

beforeEach(() => clearRegistry());

describe("createTask", () => {
  it("crea un task con valori di default", () => {
    const task = createTask({ runtime: "subagent", ownerKey: "user-1", task: "scrivi report" });
    expect(task.taskId).toBeTruthy();
    expect(task.runtime).toBe("subagent");
    expect(task.ownerKey).toBe("user-1");
    expect(task.status).toBe("queued");
    expect(task.notifyPolicy).toBe("done_only");
    expect(task.scopeKind).toBe("session");
    expect(task.createdAt).toBeGreaterThan(0);
  });

  it("crea un task con status running e imposta startedAt", () => {
    const task = createTask({ runtime: "cli", ownerKey: "u1", task: "build", status: "running" });
    expect(task.status).toBe("running");
    expect(task.startedAt).toBeDefined();
  });

  it("crea task con agentId e label opzionali", () => {
    const task = createTask({
      runtime: "cron", ownerKey: "sys", task: "cleanup",
      agentId: "scout", label: "Pulizia DB",
    });
    expect(task.agentId).toBe("scout");
    expect(task.label).toBe("Pulizia DB");
  });

  it("trimma ownerKey e agentId", () => {
    const task = createTask({ runtime: "subagent", ownerKey: "  sp  ", task: "t", agentId: "  ag  " });
    expect(task.ownerKey).toBe("sp");  expect(task.agentId).toBe("ag");
  });
});

describe("getTaskById", () => {
  it("ritorna il task se esiste", () => {
    const created = createTask({ runtime: "cli", ownerKey: "u1", task: "test" });
    const found = getTaskById(created.taskId);
    expect(found).toBeDefined();
    expect(found!.taskId).toBe(created.taskId);
  });

  it("ritorna undefined se non esiste", () => {
    expect(getTaskById("non-esiste")).toBeUndefined();
  });

  it("ritorna una copia, non il riferimento originale", () => {
    const created = createTask({ runtime: "cli", ownerKey: "u1", task: "test" });
    const a = getTaskById(created.taskId);
    const b = getTaskById(created.taskId);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("listTasks", () => {
  it("ritorna lista vuota se nessun task", () => {
    expect(listTasks()).toEqual([]);
  });

  it("ritorna tutti i task creati", () => {
    createTask({ runtime: "cli", ownerKey: "u1", task: "a" });
    createTask({ runtime: "cli", ownerKey: "u2", task: "b" });
    expect(listTasks()).toHaveLength(2);
  });
});

describe("indici ownerKey e agentId", () => {
  it("listTasksByOwner filtra per ownerKey", () => {
    createTask({ runtime: "cli", ownerKey: "alice", task: "a" });
    createTask({ runtime: "cli", ownerKey: "bob", task: "b" });
    createTask({ runtime: "cli", ownerKey: "alice", task: "c" });
    expect(listTasksByOwner("alice")).toHaveLength(2);
    expect(listTasksByOwner("bob")).toHaveLength(1);
    expect(listTasksByOwner("charlie")).toHaveLength(0);
  });

  it("listTasksByAgent filtra per agentId", () => {
    createTask({ runtime: "subagent", ownerKey: "u1", task: "a", agentId: "scout" });
    createTask({ runtime: "subagent", ownerKey: "u1", task: "b", agentId: "writer" });
    createTask({ runtime: "subagent", ownerKey: "u1", task: "c", agentId: "scout" });
    expect(listTasksByAgent("scout")).toHaveLength(2);
    expect(listTasksByAgent("writer")).toHaveLength(1);
  });
});

describe("updateTask", () => {
  it("aggiorna lo status a running e imposta startedAt", () => {
    const task = createTask({ runtime: "cli", ownerKey: "u1", task: "build" });
    const updated = updateTask(task.taskId, { status: "running" });
    expect(updated!.status).toBe("running");
    expect(updated!.startedAt).toBeDefined();
  });

  it("aggiorna a status terminale e imposta endedAt", () => {
    const task = createTask({ runtime: "cli", ownerKey: "u1", task: "build", status: "running" });
    const updated = updateTask(task.taskId, { status: "succeeded", terminalSummary: "OK" });
    expect(updated!.status).toBe("succeeded");
    expect(updated!.endedAt).toBeDefined();
    expect(updated!.terminalSummary).toBe("OK");
  });

  it("aggiorna progressSummary e error", () => {
    const task = createTask({ runtime: "cli", ownerKey: "u1", task: "t" });
    const updated = updateTask(task.taskId, { progressSummary: "50%", error: "timeout" });
    expect(updated!.progressSummary).toBe("50%");
    expect(updated!.error).toBe("timeout");
  });

  it("ritorna undefined per task inesistente", () => {
    expect(updateTask("fake-id", { status: "running" })).toBeUndefined();
  });
});

describe("cancelTask", () => {
  it("cancella un task attivo", () => {
    const task = createTask({ runtime: "cli", ownerKey: "u1", task: "t" });
    const cancelled = cancelTask(task.taskId);
    expect(cancelled!.status).toBe("cancelled");
  });

  it("non cancella un task già terminale", () => {
    const task = createTask({ runtime: "cli", ownerKey: "u1", task: "t" });
    updateTask(task.taskId, { status: "succeeded" });
    expect(cancelTask(task.taskId)).toBeUndefined();
  });
});

describe("deleteTask", () => {
  it("elimina un task e aggiorna gli indici", () => {
    const task = createTask({ runtime: "cli", ownerKey: "alice", task: "t", agentId: "scout" });
    expect(deleteTask(task.taskId)).toBe(true);
    expect(getTaskById(task.taskId)).toBeUndefined();
    expect(listTasksByOwner("alice")).toHaveLength(0);
    expect(listTasksByAgent("scout")).toHaveLength(0);
  });

  it("ritorna false per task inesistente", () => {
    expect(deleteTask("fake")).toBe(false);
  });
});

describe("getRegistrySummary", () => {
  it("conteggi corretti per status e runtime", () => {
    createTask({ runtime: "cli", ownerKey: "u1", task: "a" });
    createTask({ runtime: "subagent", ownerKey: "u1", task: "b", status: "running" });
    const t3 = createTask({ runtime: "cron", ownerKey: "u1", task: "c" });
    updateTask(t3.taskId, { status: "failed", error: "boom" });

    const summary = getRegistrySummary();
    expect(summary.total).toBe(3);
    expect(summary.active).toBe(2);
    expect(summary.terminal).toBe(1);
    expect(summary.failures).toBe(1);
    expect(summary.byStatus.queued).toBe(1);
    expect(summary.byStatus.running).toBe(1);
    expect(summary.byStatus.failed).toBe(1);
    expect(summary.byRuntime.cli).toBe(1);
    expect(summary.byRuntime.subagent).toBe(1);
    expect(summary.byRuntime.cron).toBe(1);
  });
});

describe("snapshot export/restore", () => {
  it("export e restore mantengono i dati", () => {
    createTask({ runtime: "cli", ownerKey: "u1", task: "a", agentId: "scout" });
    createTask({ runtime: "cron", ownerKey: "u2", task: "b" });
    const snapshot = exportSnapshot();
    expect(snapshot).toHaveLength(2);

    clearRegistry();
    expect(taskCount()).toBe(0);

    restoreFromSnapshot(snapshot);
    expect(taskCount()).toBe(2);
    expect(listTasksByOwner("u1")).toHaveLength(1);
    expect(listTasksByAgent("scout")).toHaveLength(1);
  });
});

describe("helpers isTerminalStatus / isActiveStatus", () => {
  it("classifica correttamente gli status", () => {
    for (const s of ["succeeded", "failed", "timed_out", "cancelled", "lost"] as const) {
      expect(isTerminalStatus(s)).toBe(true);
    }
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isActiveStatus("queued")).toBe(true);
    expect(isActiveStatus("running")).toBe(true);
    expect(isActiveStatus("succeeded")).toBe(false);
  });
});
