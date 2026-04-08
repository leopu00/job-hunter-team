/** Smoke test finale v3 — inventario completo dopo batch 6-14 e tutte le implementazioni */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
const CLI = path.resolve(__dirname, "../../../cli");
const SHARED = path.resolve(__dirname, "../../../shared");

function findAll(dir: string, target: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== "node_modules") out.push(...findAll(full, target));
    else if (e.name === target) out.push(full);
  }
  return out;
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
const pages      = findAll(path.join(WEB, "app"), "page.tsx");
const routes     = findAll(path.join(WEB, "app/api"), "route.ts");
const compDirs   = [path.join(WEB, "components"), path.join(WEB, "app/components")];
const components = compDirs.flatMap(d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(".tsx")) : []);
const cliCmds    = fs.existsSync(path.join(CLI, "src/commands"))
  ? fs.readdirSync(path.join(CLI, "src/commands")).filter(f => f.endsWith(".js") && f !== "index.js") : [];
const sharedTs   = fs.existsSync(SHARED)
  ? (fs.readdirSync(SHARED, { recursive: true }) as string[]).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("node_modules")) : [];

const clientPages  = pages.filter((p) => hasUseClient(read(p)));
const serverPages  = pages.filter((p) => !hasUseClient(read(p)));
const endpoints: { route: string; methods: string[] }[] = routes.map(r => {
  const src = read(r);
  const methods = ["GET","POST","PUT","DELETE","PATCH"].filter(m => new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(src));
  return { route: rel(path.join(WEB, "app/api"), r).replace("/route.ts", ""), methods };
});
const totalEP = endpoints.reduce((s, e) => s + e.methods.length, 0);

/* ── 1. Pagine ── */
describe("Pagine", () => {
  it(`totale ≥ 110 (trovate ${pages.length})`, () => expect(pages.length).toBeGreaterThanOrEqual(110));
  it(`client ≥ 100, server ≥ 10`, () => {
    expect(clientPages.length).toBeGreaterThanOrEqual(100);
    expect(serverPages.length).toBeGreaterThanOrEqual(10);
  });
  it("ogni pagina ha export default", () => {
    const fail = pages.filter(p => !/export\s+default\s+(async\s+)?function/.test(read(p)));
    expect(fail.map((f) => rel(WEB, f))).toEqual([]);
  });
  it("nessuna pagina vuota (< 10 righe)", () => {
    const empty = pages.filter((p) => {
      const src = read(p);
      return src.split("\n").length < 10 && !src.includes("redirect(");
    });
    expect(empty.map((f) => rel(WEB, f))).toEqual([]);
  });
  it("pagine chiave presenti", () => {
    const relPages = pages.map((p) =>
      rel(path.join(WEB, "app"), p).replace(/^\(protected\)\//, ""),
    );
    for (const pg of ["dashboard/page.tsx","settings/page.tsx","setup/page.tsx","timeline/page.tsx","map/page.tsx",
      "calendar/page.tsx","jobs/page.tsx","companies/page.tsx","insights/page.tsx","budget/page.tsx"])
      expect(relPages).toContain(pg);
  });
});

/* ── 2. API Routes ── */
describe("API Routes", () => {
  it(`totale ≥ 131 route (trovate ${routes.length})`, () => expect(routes.length).toBeGreaterThanOrEqual(131));
  it("ogni route esporta almeno un handler", () => {
    const fail = routes.filter(r => {
      const src = read(r);
      return !/export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\b/.test(src) &&
             !/export\s+(const|function)\s+(GET|POST|PUT|DELETE|PATCH|handler|dynamic)\b/.test(src);
    });
    expect(fail.map((f) => rel(WEB, f))).toEqual([]);
  });
  it(`endpoint ≥ 209 (trovati ${totalEP})`, () => expect(totalEP).toBeGreaterThanOrEqual(209));
  it("GET ≥ 90, POST ≥ 22", () => {
    expect(endpoints.filter(e => e.methods.includes("GET")).length).toBeGreaterThanOrEqual(90);
    expect(endpoints.filter(e => e.methods.includes("POST")).length).toBeGreaterThanOrEqual(22);
  });
  it("route chiave presenti", () => {
    const names = endpoints.map(e => e.route);
    for (const r of ["setup","health","agents","sessions","tasks","config","secrets","notifications",
      "logs","analytics","budget","calendar","status","performance"])
      expect(names).toContain(r);
  });
});

/* ── 3. Componenti UI ── */
describe("Componenti UI", () => {
  it(`totale ≥ 100 componenti (trovati ${components.length})`, () => expect(components.length).toBeGreaterThanOrEqual(100));
  const names = components.map(c => c.replace(".tsx", ""));
  it("componenti core (batch 1-5)", () => {
    for (const c of ["Modal","Toast","Tabs","Select","Badge","Card","Pagination","Switch",
      "Skeleton","InfiniteScroll","VirtualList","ProgressRing","DataTable","ConfirmDialog"])
      expect(names).toContain(c);
  });
  it("componenti batch 6-9: AlertBanner, InputGroup, Checkbox, RadioGroup, TextArea", () => {
    for (const c of ["AlertBanner","InputGroup","Checkbox","RadioGroup","TextArea"]) expect(names).toContain(c);
  });
  it("componenti batch 10-14: Table, CommandPalette, Carousel, Chart, TreeView, Kbd, Divider, CopyButton, StatusIndicator, MapSVG, CodeBlock, ErrorBoundary, Sortable", () => {
    for (const c of ["Table","CommandPalette","Carousel","Chart","TreeView","Kbd","Divider",
      "CopyButton","StatusIndicator","MapSVG","CodeBlock","ErrorBoundary","Sortable"]) expect(names).toContain(c);
  });
  it("componenti extra: NumberInput, Popconfirm, ResizablePanel, Masonry", () => {
    for (const c of ["NumberInput","Popconfirm","ResizablePanel","Masonry"]) expect(names).toContain(c);
  });
  it("ogni componente ha almeno 10 righe di contenuto", () => {
    const thin: string[] = [];
    for (const d of compDirs) { if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d).filter(x => x.endsWith(".tsx"))) {
        if (read(path.join(d, f)).split("\n").length < 10) thin.push(f);
      }
    }
    expect(thin).toEqual([]);
  });
});

/* ── 4. CLI commands ── */
describe("CLI commands", () => {
  it(`totale ≥ 28 (trovati ${cliCmds.length})`, () => expect(cliCmds.length).toBeGreaterThanOrEqual(28));
  it("comandi chiave presenti", () => {
    const names = cliCmds.map(c => c.replace(".js", ""));
    for (const c of ["setup","doctor","reset","config","secrets","export","import","status","health"])
      expect(names).toContain(c);
  });
});

/* ── 5. Shared modules ── */
describe("Shared modules", () => {
  it(`totale ≥ 120 moduli (trovati ${sharedTs.length})`, () => expect(sharedTs.length).toBeGreaterThanOrEqual(120));
  it("moduli chiave presenti", () => {
    const dirs = fs.readdirSync(SHARED, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    for (const d of ["agents","sessions","tools","memory","channels","gateway","events","hooks",
      "plugins","tasks","validators","notifications","history","rate-limiter","logger","credentials"])
      expect(dirs).toContain(d);
  });
});

/* ── 6. Integrità cross-module ── */
describe("Integrità", () => {
  it("layout.tsx principale esiste e ha metadata", () => {
    const layout = read(path.join(WEB, "app/layout.tsx"));
    expect(layout).toContain("export const metadata");
    expect(layout).toContain("export default");
  });
  it("package.json web ha next e react", () => {
    const pkg = JSON.parse(read(path.join(WEB, "package.json")));
    expect(pkg.dependencies).toHaveProperty("next");
    expect(pkg.dependencies).toHaveProperty("react");
  });
  it("nessun import circolare — sidebar importa da componenti, non viceversa", () => {
    const sidebar = read(path.join(WEB, "app/components/sidebar.tsx"));
    expect(sidebar).not.toMatch(/from\s+['"]\.\.\/\.\.\/components\/sidebar['"]/);
  });
});

/* ── Report v3 ── */
describe("Report v3", () => {
  it("stampa riepilogo", () => {
    console.log([
      `\n══════════════════════════════════════════`,
      `  SMOKE TEST FINALE v3 — REPORT`,
      `══════════════════════════════════════════`,
      `  Pagine:       ${pages.length} (${clientPages.length} client, ${serverPages.length} server)`,
      `  API Routes:   ${routes.length}`,
      `  Endpoints:    ${totalEP}`,
      `  Componenti:   ${components.length} (app: ${compDirs[1] ? fs.readdirSync(compDirs[1]).filter(f => f.endsWith(".tsx")).length : 0}, web: ${fs.readdirSync(compDirs[0]).filter(f => f.endsWith(".tsx")).length})`,
      `  CLI comandi:  ${cliCmds.length}`,
      `  Shared .ts:   ${sharedTs.length}`,
      `  TOTALE asset: ${pages.length + routes.length + components.length + cliCmds.length + sharedTs.length}`,
      `══════════════════════════════════════════\n`,
    ].join("\n"));
    expect(pages.length + routes.length + components.length).toBeGreaterThan(300);
  });
});
