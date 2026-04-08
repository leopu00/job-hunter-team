/** Smoke test finale v2 — inventario completo pagine, API, componenti, CLI, shared dopo tutte le implementazioni */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
const CLI = path.resolve(__dirname, "../../../cli");
const SHARED = path.resolve(__dirname, "../../../shared");

function findAll(dir: string, target: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") results.push(...findAll(full, target));
    else if (entry.name === target) results.push(full);
  }
  return results;
}

function read(f: string) {
  return fs.readFileSync(f, "utf-8").replace(/\r\n/g, "\n");
}

function rel(base: string, target: string) {
  return path.relative(base, target).replace(/\\/g, "/");
}

function hasUseClient(src: string) {
  return /["']use client["']/.test(src);
}

/* ── Inventario ── */
const pages = findAll(path.join(WEB, "app"), "page.tsx");
const routes = findAll(path.join(WEB, "app/api"), "route.ts");
const componentDirs = [path.join(WEB, "components"), path.join(WEB, "app/components")];
const components = componentDirs.flatMap(d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(".tsx")) : []);
const cliCommands = fs.existsSync(path.join(CLI, "src/commands"))
  ? fs.readdirSync(path.join(CLI, "src/commands")).filter(f => f.endsWith(".js") && f !== "index.js")
  : [];
const sharedModules = findAll(SHARED, "").length > 0
  ? fs.readdirSync(SHARED, { recursive: true }).filter((f: any) => typeof f === "string" && f.endsWith(".ts"))
  : [];

/* ── Conteggi ── */
const clientPages = pages.filter((p) => hasUseClient(read(p)));
const serverPages = pages.filter((p) => !hasUseClient(read(p)));
const endpoints: { route: string; methods: string[] }[] = routes.map(r => {
  const src = read(r);
  const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"].filter(m => new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(src));
  const relPath = rel(path.join(WEB, "app/api"), r).replace("/route.ts", "");
  return { route: relPath, methods };
});
const totalEndpoints = endpoints.reduce((s, e) => s + e.methods.length, 0);

/* ── Test pagine ── */
describe("Pagine", () => {
  it(`totale ≥ 108 pagine (trovate ${pages.length})`, () => {
    expect(pages.length).toBeGreaterThanOrEqual(108);
  });
  it("ogni pagina ha export default", () => {
    const fail: string[] = [];
    for (const p of pages) {
      if (!/export\s+default\s+(async\s+)?function/.test(read(p))) fail.push(rel(WEB, p));
    }
    expect(fail).toEqual([]);
  });
  it(`client pages ≥ 98 (trovate ${clientPages.length})`, () => {
    expect(clientPages.length).toBeGreaterThanOrEqual(98);
  });
  it("nessuna pagina vuota (< 10 righe)", () => {
    const empty = pages.filter((p) => {
      const src = read(p);
      return src.split("\n").length < 10 && !src.includes("redirect(");
    });
    expect(empty.map((p) => rel(WEB, p))).toEqual([]);
  });
  it("nuove pagine /setup, /import, /export, /archive, /timeline presenti", () => {
    const names = pages.map((p) => rel(path.join(WEB, "app"), p));
    for (const pg of ["setup/page.tsx", "import/page.tsx", "export/page.tsx", "archive/page.tsx", "timeline/page.tsx"])
      expect(names).toContain(pg);
  });
});

/* ── Test API route ── */
describe("API Routes", () => {
  it(`totale ≥ 129 route (trovate ${routes.length})`, () => {
    expect(routes.length).toBeGreaterThanOrEqual(129);
  });
  it("ogni route esporta almeno un handler", () => {
    const fail: string[] = [];
    for (const r of routes) {
      const src = read(r);
      const hasHandler = /export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\b/.test(src);
      const hasGeneric = /export\s+(const|function)\s+(GET|POST|PUT|DELETE|PATCH|handler|dynamic)\b/.test(src);
      if (!hasHandler && !hasGeneric) fail.push(rel(WEB, r));
    }
    expect(fail).toEqual([]);
  });
  it(`totale endpoint ≥ 195 (trovati ${totalEndpoints})`, () => {
    expect(totalEndpoints).toBeGreaterThanOrEqual(195);
  });
  it("GET endpoint ≥ 90", () => {
    const gets = endpoints.filter(e => e.methods.includes("GET")).length;
    expect(gets).toBeGreaterThanOrEqual(90);
  });
  it("POST endpoint ≥ 22", () => {
    const posts = endpoints.filter(e => e.methods.includes("POST")).length;
    expect(posts).toBeGreaterThanOrEqual(22);
  });
  it("nuove route /setup, /import, /export, /archive, /timeline, /map presenti", () => {
    const names = endpoints.map(e => e.route);
    for (const r of ["setup", "import", "export", "archive", "timeline", "map"])
      expect(names).toContain(r);
  });
});

/* ── Componenti ── */
describe("Componenti UI", () => {
  it(`totale ≥ 40 componenti (trovati ${components.length})`, () => {
    expect(components.length).toBeGreaterThanOrEqual(40);
  });
  it("componenti chiave presenti", () => {
    const names = components.map(c => c.replace(".tsx", ""));
    for (const c of ["FloatingChat", "Badge", "Toast", "Modal", "Tabs", "Pagination", "Select", "Switch",
      "ConfirmDialog", "Skeleton", "InfiniteScroll", "VirtualList", "ProgressRing", "DataTable"])
      expect(names).toContain(c);
  });
});

/* ── CLI commands ── */
describe("CLI commands", () => {
  it(`totale ≥ 20 comandi CLI (trovati ${cliCommands.length})`, () => {
    expect(cliCommands.length).toBeGreaterThanOrEqual(20);
  });
  it("comandi chiave: setup, doctor, reset, config, secrets, export, import", () => {
    const names = cliCommands.map(c => c.replace(".js", ""));
    for (const c of ["setup", "doctor", "reset", "config", "secrets", "export", "import"])
      expect(names).toContain(c);
  });
});

/* ── Shared modules ── */
describe("Shared modules", () => {
  it("secret-ref.ts presente e esporta resolveSecret + createSecretRef + describeSecret", () => {
    const src = read(path.join(SHARED, "config/secret-ref.ts"));
    expect(src).toContain("export function resolveSecret");
    expect(src).toContain("export function createSecretRef");
    expect(src).toContain("export function describeSecret");
  });
});

/* ── Report finale ── */
describe("Report v2", () => {
  it("stampa riepilogo totale", () => {
    const report = [
      `\n══════════════════════════════════════════`,
      `  SMOKE TEST FINALE v2 — REPORT`,
      `══════════════════════════════════════════`,
      `  Pagine:      ${pages.length} (${clientPages.length} client, ${serverPages.length} server)`,
      `  API Routes:  ${routes.length}`,
      `  Endpoints:   ${totalEndpoints}`,
      `  Componenti:  ${components.length}`,
      `  CLI cmds:    ${cliCommands.length}`,
      `══════════════════════════════════════════\n`,
    ].join("\n");
    console.log(report);
    expect(pages.length + routes.length + components.length).toBeGreaterThan(250);
  });
});
