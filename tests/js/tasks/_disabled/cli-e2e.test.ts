/** Test E2E CLI — jht setup, status, export/import, health, team list (vitest). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI = path.resolve(__dirname, "../../../cli/bin/jht.js");
const CLI_VERSION = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../cli/package.json"), "utf-8")
).version as string;
const cmd = (args: string, env?: Record<string, string>) =>
  execSync(`node "${CLI}" ${args}`, {
    encoding: "utf-8", timeout: 10000,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

function tryCmd(args: string, env?: Record<string, string>): { code: number; out: string } {
  try { return { code: 0, out: cmd(args, env) }; }
  catch (e: any) { return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") }; }
}

let tmpDir: string;
let jhtDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-e2e-"));
  jhtDir = path.join(tmpDir, ".jht");
  fs.mkdirSync(path.join(jhtDir, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(jhtDir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(jhtDir, "jht.config.json"), JSON.stringify({ version: 1, active_provider: "claude" }));
  fs.writeFileSync(path.join(jhtDir, "sessions", "sessions.json"), JSON.stringify({ version: 1, sessions: [{ id: "s1", channelId: "web", state: "active", chatType: "direct", createdAtMs: 1, updatedAtMs: 1, messageCount: 0 }] }));
  fs.writeFileSync(path.join(jhtDir, "tasks", "tasks.json"), JSON.stringify({ version: 1, updatedAt: 0, tasks: [{ taskId: "t1", status: "queued", task: "test", createdAt: Date.now(), runtime: "cli", ownerKey: "web" }] }));
});
afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("CLI — versione e help", () => {
  it("--version mostra la versione del package CLI", () => {
    const out = cmd("--version");
    expect(out.trim()).toBe(CLI_VERSION);
  });

  it("--help mostra comandi principali", () => {
    const out = cmd("--help");
    expect(out).toContain("setup");
    expect(out).toContain("status");
    expect(out).toContain("health");
    expect(out).toContain("export");
    expect(out).toContain("import");
    expect(out).toContain("team");
  });
});

describe("CLI — status", () => {
  it("jht status mostra stato sistema senza crash", () => {
    const r = tryCmd("status", { HOME: tmpDir });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Stato Sistema");
  });
});

describe("CLI — health", () => {
  it("jht health mostra health check con moduli", () => {
    const r = tryCmd("health", { HOME: tmpDir });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Health Check");
    expect(r.out).toContain("Config");
  });
});

describe("CLI — team list", () => {
  it("jht team list mostra agenti disponibili", () => {
    const r = tryCmd("team list");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Agenti disponibili");
    expect(r.out).toContain("capitano");
    expect(r.out).toContain("scout");
  });
});

describe("CLI — export", () => {
  it("export sorgente invalida mostra errore", () => {
    const r = tryCmd("export nope", { HOME: tmpDir });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Sorgente non valida");
  });

  it("export sessions produce file JSON", () => {
    const outFile = path.join(tmpDir, "export-sessions.json");
    const r = tryCmd(`export sessions -o "${outFile}"`, { HOME: tmpDir });
    expect(r.code).toBe(0);
    expect(fs.existsSync(outFile)).toBe(true);
    const data = JSON.parse(fs.readFileSync(outFile, "utf-8"));
    expect(data.source).toBe("sessions");
    expect(data.data).toHaveLength(1);
  });

  it("export tasks produce file JSON con task", () => {
    const outFile = path.join(tmpDir, "export-tasks.json");
    const r = tryCmd(`export tasks -o "${outFile}"`, { HOME: tmpDir });
    expect(r.code).toBe(0);
    const data = JSON.parse(fs.readFileSync(outFile, "utf-8"));
    expect(data.data[0].taskId).toBe("t1");
  });
});

describe("CLI — import", () => {
  it("import senza --target mostra errore", () => {
    const r = tryCmd(`import "${path.join(tmpDir, "export-sessions.json")}"`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("target");
  });

  it("import file inesistente mostra errore", () => {
    const r = tryCmd('import "/tmp/nonexistent.json" -t sessions');
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("non trovato");
  });

  it("import --dry-run valida senza modificare", () => {
    const outFile = path.join(tmpDir, "export-sessions.json");
    const r = tryCmd(`import "${outFile}" -t sessions --dry-run`, { HOME: tmpDir });
    expect(r.code).toBe(0);
    expect(r.out).toContain("dry-run");
  });
});

describe("CLI — export/import round-trip", () => {
  it("export → import round-trip mantiene i dati", () => {
    const exportFile = path.join(tmpDir, "roundtrip.json");
    tryCmd(`export tasks -o "${exportFile}"`, { HOME: tmpDir });
    expect(fs.existsSync(exportFile)).toBe(true);
    const r = tryCmd(`import "${exportFile}" -t tasks --replace`, { HOME: tmpDir });
    expect(r.code).toBe(0);
    const store = JSON.parse(fs.readFileSync(path.join(jhtDir, "tasks", "tasks.json"), "utf-8"));
    expect(store.tasks.some((t: any) => t.taskId === "t1")).toBe(true);
  });
});
