import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  configureTaskStore, getStoreFilePath, saveTasks, loadTasks,
  hasStoredTasks, saveTasksToPath, loadTasksFromPath,
} from "../../../shared/tasks/task-store.js";
import {
  createTask, clearRegistry, taskCount, listTasks, exportSnapshot,
} from "../../../shared/tasks/task-registry.js";

let tmpDir: string;

beforeEach(() => {
  clearRegistry();
  tmpDir = mkdtempSync(join(tmpdir(), "jht-task-store-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("configureTaskStore", () => {
  it("configura il path e crea la directory", () => {
    const subDir = join(tmpDir, "nested", "store");
    const path = configureTaskStore(subDir);
    expect(path).toContain("tasks.json");
    expect(getStoreFilePath()).toBe(path);
  });

  it("accetta filename personalizzato", () => {
    const path = configureTaskStore(tmpDir, "custom.json");
    expect(path).toContain("custom.json");
  });
});

describe("saveTasks / loadTasks", () => {
  it("salva e ricarica i task dal file", () => {
    configureTaskStore(tmpDir);
    createTask({ runtime: "cli", ownerKey: "u1", task: "test-a" });
    createTask({ runtime: "subagent", ownerKey: "u2", task: "test-b", agentId: "scout" });

    expect(saveTasks()).toBe(true);
    expect(hasStoredTasks()).toBe(true);

    clearRegistry();
    expect(taskCount()).toBe(0);

    expect(loadTasks()).toBe(true);
    expect(taskCount()).toBe(2);

    const tasks = listTasks();
    expect(tasks.some((t) => t.ownerKey === "u1")).toBe(true);
    expect(tasks.some((t) => t.agentId === "scout")).toBe(true);
  });

  it("loadTasks ritorna false se non configurato", () => {
    configureTaskStore(join(tmpDir, "empty"));
    expect(loadTasks()).toBe(false);
  });

  it("file JSON ha struttura corretta con version e updatedAt", () => {
    configureTaskStore(tmpDir);
    createTask({ runtime: "cli", ownerKey: "u1", task: "check" });
    saveTasks();

    const raw = readFileSync(getStoreFilePath()!, "utf-8");
    const data = JSON.parse(raw);
    expect(data.version).toBe(1);
    expect(data.updatedAt).toBeGreaterThan(0);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].task).toBe("check");
  });
});

describe("saveTasksToPath / loadTasksFromPath", () => {
  it("salva e carica da un path arbitrario", () => {
    createTask({ runtime: "cron", ownerKey: "sys", task: "cleanup" });
    createTask({ runtime: "cli", ownerKey: "admin", task: "deploy" });
    const snapshot = exportSnapshot();

    const filePath = join(tmpDir, "backup.json");
    expect(saveTasksToPath(filePath, snapshot)).toBe(true);
    expect(existsSync(filePath)).toBe(true);

    const loaded = loadTasksFromPath(filePath);
    expect(loaded).toHaveLength(2);
    expect(loaded!.some((t) => t.task === "cleanup")).toBe(true);
  });

  it("loadTasksFromPath ritorna null per file inesistente", () => {
    expect(loadTasksFromPath(join(tmpDir, "nope.json"))).toBeNull();
  });

  it("loadTasksFromPath ritorna null per JSON invalido", () => {
    const filePath = join(tmpDir, "bad.json");
    require("node:fs").writeFileSync(filePath, "not json", "utf-8");
    expect(loadTasksFromPath(filePath)).toBeNull();
  });
});

describe("hasStoredTasks", () => {
  it("ritorna false prima del primo salvataggio", () => {
    configureTaskStore(join(tmpDir, "fresh"));
    expect(hasStoredTasks()).toBe(false);
  });

  it("ritorna true dopo il salvataggio", () => {
    configureTaskStore(tmpDir);
    createTask({ runtime: "cli", ownerKey: "u1", task: "t" });
    saveTasks();
    expect(hasStoredTasks()).toBe(true);
  });
});
