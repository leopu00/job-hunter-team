/** Test E2E batch 14 — SecretRef config, jht setup/doctor/reset CLI, Badge, FloatingChat */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
const CLI = path.resolve(__dirname, "../../../cli");
function readSrc(rel: string) {
  const raw = fs.readFileSync(path.join(WEB, rel), "utf-8").replace(/\r\n/g, "\n");
  const singleQuoted = raw.replace(/"/g, "'");
  const squashed = singleQuoted.replace(/\s+/g, " ").trim();
  return [raw, singleQuoted, squashed].join("\n/* normalized */\n");
}
function readCli(rel: string) { return fs.readFileSync(path.join(CLI, rel), "utf-8"); }

/* ── SecretRef (shared/config) — test funzionali ── */
describe("SecretRef", () => {
  it("resolveSecret: plaintext + string legacy + env ref + undefined", async () => {
    const { resolveSecret } = await import("../../../shared/config/secret-ref");
    expect(resolveSecret({ type: "plaintext", value: "sk-test" })).toBe("sk-test");
    expect(resolveSecret("legacy-key")).toBe("legacy-key");
    expect(resolveSecret(undefined)).toBe("");
    process.env.__JHT_TEST_KEY = "from-env";
    expect(resolveSecret({ type: "ref", source: "env", id: "__JHT_TEST_KEY" })).toBe("from-env");
    delete process.env.__JHT_TEST_KEY;
  });
  it("createSecretRef: 4 modi — plaintext/env/file/exec", async () => {
    const { createSecretRef } = await import("../../../shared/config/secret-ref");
    expect(createSecretRef("plaintext", "sk")).toEqual({ type: "plaintext", value: "sk" });
    expect(createSecretRef("env", "KEY")).toEqual({ type: "ref", source: "env", id: "KEY" });
    expect(createSecretRef("file", "/tmp/k")).toEqual({ type: "ref", source: "file", path: "/tmp/k" });
    expect(createSecretRef("exec", "op read")).toEqual({ type: "ref", source: "exec", command: "op read" });
  });
  it("describeSecret: non espone valori completi, mostra ref", async () => {
    const { describeSecret } = await import("../../../shared/config/secret-ref");
    expect(describeSecret(undefined)).toBe("non configurato");
    expect(describeSecret("sk-12345678rest")).toContain("****");
    expect(describeSecret({ type: "ref", source: "env", id: "MY_KEY" })).toBe("env:MY_KEY");
    expect(describeSecret({ type: "ref", source: "file", path: "/tmp/k" })).toBe("file:/tmp/k");
    expect(describeSecret({ type: "ref", source: "exec", command: "op read secret" })).toContain("exec:");
  });
});

/* ── jht setup CLI ── */
describe("jht setup CLI", () => {
  const src = readCli("src/commands/setup.js");
  it("registerSetupCommand + options: provider, auth-method, api-key, secret-mode, model, workspace", () => {
    expect(src).toContain("export function registerSetupCommand");
    expect(src).toContain("'setup'");
    for (const o of ["--non-interactive", "--provider", "--auth-method", "--api-key", "--secret-mode", "--model", "--workspace", "--skip-health", "--reset"])
      expect(src).toContain(o);
  });
  it("printBanner + runSetupWizard + runNonInteractiveSetup + WizardCancelledError", () => {
    expect(src).toContain("function printBanner"); expect(src).toContain("runSetupWizard");
    expect(src).toContain("runNonInteractiveSetup"); expect(src).toContain("WizardCancelledError");
  });
});

/* ── jht doctor CLI ── */
describe("jht doctor CLI", () => {
  const src = readCli("src/commands/doctor.js");
  it("registerDoctorCommand + 7 check functions", () => {
    expect(src).toContain("export function registerDoctorCommand");
    expect(src).toContain("'doctor'");
    for (const fn of ["checkNode", "checkConfig", "checkProvider", "checkApiKey", "checkDatabase", "checkDeps", "checkWorkers"])
      expect(src).toContain(`function ${fn}`);
  });
  it("5 sezioni diagnostica: Ambiente, Config, Provider LLM, Database, Workers", () => {
    for (const sec of ["Ambiente", "Config", "Provider LLM", "Database", "Workers"])
      expect(src).toContain(sec);
    expect(src).toContain("printCheck"); expect(src).toContain("spinner");
  });
  it("deps required node/npm/tmux/git + optional claude/pandoc/typst/python3", () => {
    for (const d of ["node", "npm", "tmux", "git"]) expect(src).toContain(`'${d}'`);
    for (const d of ["claude", "pandoc", "typst", "python3"]) expect(src).toContain(`'${d}'`);
  });
});

/* ── jht reset CLI ── */
describe("jht reset CLI", () => {
  const src = readCli("src/commands/reset.js");
  it("registerResetCommand + SCOPES 3: config/creds/full + options", () => {
    expect(src).toContain("export function registerResetCommand");
    expect(src).toContain("'reset'"); expect(src).toContain("SCOPES");
    for (const s of ["config", "creds", "full"]) expect(src).toContain(`${s}:`);
    expect(src).toContain("--scope"); expect(src).toContain("--non-interactive"); expect(src).toContain("--confirm-reset");
  });
  it("buildDeleteList + executeReset + pathExists + countFiles + confirm", () => {
    expect(src).toContain("function buildDeleteList"); expect(src).toContain("function executeReset");
    expect(src).toContain("function pathExists"); expect(src).toContain("function countFiles");
    expect(src).toContain("Confermi eliminazione");
  });
});

/* ── Badge component ── */
describe("Badge", () => {
  const src = readSrc("app/components/Badge.tsx");
  it("export Badge + BadgeGroup + StatusBadge + CountBadge + BadgeVariant 6 + BadgeSize 3", () => {
    expect(src).toMatch(/export function Badge\b/); expect(src).toMatch(/export function BadgeGroup\b/);
    expect(src).toMatch(/export function StatusBadge\b/); expect(src).toMatch(/export function CountBadge\b/);
    expect(src).toContain("export type BadgeVariant"); expect(src).toContain("export type BadgeSize");
    for (const v of ["default", "success", "warning", "error", "info", "outline"]) expect(src).toContain(`${v}:`);
  });
  it("VARIANT + DOT_COLOR + SIZE_CLS sm/md/lg + removable aria-label", () => {
    expect(src).toContain("VARIANT"); expect(src).toContain("DOT_COLOR"); expect(src).toContain("SIZE_CLS");
    expect(src).toContain("removable"); expect(src).toContain('aria-label="Rimuovi"');
  });
  it("STATUS_MAP mappa stati → varianti + BadgeGroupProps gap/wrap", () => {
    expect(src).toContain("STATUS_MAP");
    for (const s of ["attivo", "completato", "errore", "pending", "merged"])
      expect(src).toContain(`${s}:`);
    expect(src).toContain("export interface BadgeGroupProps"); expect(src).toContain("wrap");
  });
});

/* ── FloatingChat ── */
describe("FloatingChat", () => {
  const src = readSrc("app/components/FloatingChat.tsx");
  it("export default FloatingChat + Message/Suggestion types + chat-slide-up", () => {
    expect(src).toMatch(/export default function FloatingChat/);
    expect(src).toContain("type Message"); expect(src).toContain("type Suggestion");
    expect(src).toContain("chat-slide-up");
  });
  it("fetchHistory + send + suggestions + 'Sto pensando' + Enter + aria-label", () => {
    expect(src).toContain("fetchHistory"); expect(src).toContain("const send");
    expect(src).toContain("suggestions"); expect(src).toContain("Sto pensando");
    expect(src).toContain("'Enter'"); expect(src).toContain("Apri AI Assistant");
  });
});

/* ── SecretRef JS wizard (cli) ── */
describe("SecretRef wizard (JS)", () => {
  const src = readCli("wizard/secret-ref.js");
  it("export resolveSecret + formatSecretForConfig + describeSecret", () => {
    expect(src).toContain("export function resolveSecret");
    expect(src).toContain("export function formatSecretForConfig");
    expect(src).toContain("export function describeSecret");
  });
  it("supporta env/file/exec/plaintext + non espone valori ('****')", () => {
    expect(src).toContain("'env'"); expect(src).toContain("'file'"); expect(src).toContain("'exec'");
    expect(src).toContain("'plaintext'"); expect(src).toContain("****");
  });
});
