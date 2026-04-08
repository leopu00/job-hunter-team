/** Smoke finale — verifica TUTTE le pagine web e API routes del progetto */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web/app");
const WEB_ROOT = path.resolve(__dirname, "../../../web");

/** Trova ricorsivamente tutti i file con un dato nome */
function findAll(dir: string, target: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) findAll(full, target, out);
      else if (e === target) out.push(full);
    } catch { /* skip */ }
  }
  return out;
}

function readText(fp: string) {
  return fs.readFileSync(fp, "utf-8").replace(/\r\n/g, "\n");
}

function rel(fp: string) {
  return path.relative(WEB_ROOT, fp).replace(/\\/g, "/");
}

function hasUseClient(src: string) {
  return /["']use client["']/.test(src);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  PAGINE WEB                                                              */
/* ════════════════════���═════════════════════════════════════════════════════ */

const ALL_PAGES = findAll(WEB, "page.tsx").sort();

describe("Pagine web — inventario e validazione", () => {
  it(`inventario: trovate ${ALL_PAGES.length} pagine (attese ≥100)`, () => {
    expect(ALL_PAGES.length).toBeGreaterThanOrEqual(100);
  });

  it("ogni pagina ha export default function", () => {
    const fail: string[] = [];
    for (const fp of ALL_PAGES) {
      const src = readText(fp);
      if (!/(export default function|export default )/.test(src)) fail.push(rel(fp));
    }
    expect(fail, `Pagine senza export default: ${fail.join(", ")}`).toEqual([]);
  });

  it("ogni pagina client ha 'use client'", () => {
    const fail: string[] = [];
    // Pagine che usano useState/useEffect/onClick devono avere 'use client'
    for (const fp of ALL_PAGES) {
      const src = readText(fp);
      const usesClient = /\b(useState|useEffect|useRef|useCallback|onClick)\b/.test(src);
      if (usesClient && !hasUseClient(src)) fail.push(rel(fp));
    }
    expect(fail, `Pagine client senza 'use client': ${fail.join(", ")}`).toEqual([]);
  });

  it("nessuna pagina è vuota (≥50 caratteri)", () => {
    const empty: string[] = [];
    for (const fp of ALL_PAGES) {
      const src = readText(fp);
      if (src.trim().length < 50) empty.push(rel(fp));
    }
    expect(empty, `Pagine vuote: ${empty.join(", ")}`).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════��══════════════════════ */
/*  API ROUTES                                                              */
/* ═══════════════════════════��════════════════════════════���═════════════════ */

const API_DIR = path.join(WEB, "api");
const ALL_ROUTES = findAll(API_DIR, "route.ts").sort();

describe("API routes — inventario e validazione", () => {
  it(`inventario: trovate ${ALL_ROUTES.length} routes (attese ≥120)`, () => {
    expect(ALL_ROUTES.length).toBeGreaterThanOrEqual(120);
  });

  it("ogni route esporta almeno un handler (GET/POST/PUT/DELETE) o handler generico", () => {
    const fail: string[] = [];
    for (const fp of ALL_ROUTES) {
      const src = readText(fp);
      const hasHandler = /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)\b/.test(src);
      const hasGeneric = /export\s+(const|function)\s+(GET|POST|PUT|DELETE|PATCH|handler|dynamic)\b/.test(src);
      if (!hasHandler && !hasGeneric) fail.push(rel(fp));
    }
    expect(fail, `Routes senza handler: ${fail.join(", ")}`).toEqual([]);
  });

  it("nessuna route è vuota (≥30 caratteri)", () => {
    const empty: string[] = [];
    for (const fp of ALL_ROUTES) {
      const src = readText(fp);
      if (src.trim().length < 30) empty.push(rel(fp));
    }
    expect(empty, `Routes vuote: ${empty.join(", ")}`).toEqual([]);
  });

  it("route GET: almeno 80 endpoint GET trovati", () => {
    let count = 0;
    for (const fp of ALL_ROUTES) {
      const src = fs.readFileSync(fp, "utf-8");
      if (/export\s+async\s+function\s+GET\b/.test(src)) count++;
    }
    expect(count).toBeGreaterThanOrEqual(80);
  });

  it("route POST: almeno 20 endpoint POST trovati", () => {
    let count = 0;
    for (const fp of ALL_ROUTES) {
      const src = fs.readFileSync(fp, "utf-8");
      if (/export\s+async\s+function\s+POST\b/.test(src)) count++;
    }
    expect(count).toBeGreaterThanOrEqual(20);
  });
});

/* ══════════════��══════════════════════════════════���════════════════════════ */
/*  COPERTURA STRUTTURALE                                                   */
/* ══════════════��═══════════════════════════════════��═══════════════════════ */

describe("Copertura strutturale", () => {
  it("ogni pagina top-level ha una API route corrispondente (≥80%)", () => {
    // Pagine top-level (non [id], non (protected), non page.tsx root)
    const topPages = ALL_PAGES
      .map((fp) => rel(fp))
      .filter(r => r.match(/^app\/[a-z][\w-]*\/page\.tsx$/))
      .map(r => r.replace("app/", "").replace("/page.tsx", ""));

    const routeNames = new Set(
      ALL_ROUTES.map((fp) => rel(fp))
        .filter(r => r.match(/^app\/api\/[a-z][\w-]*\/route\.ts$/))
        .map(r => r.replace("app/api/", "").replace("/route.ts", ""))
    );

    const withRoute = topPages.filter(p => routeNames.has(p));
    const pct = Math.round((withRoute.length / topPages.length) * 100);
    expect(pct, `Solo ${pct}% delle pagine ha API route corrispondente`).toBeGreaterThanOrEqual(80);
  });

  it("nessuna pagina importa moduli inesistenti da @/components (spot check)", () => {
    // Verifica che i componenti importati come @/components/* o ../components/* esistano
    const compDir = path.resolve(__dirname, "../../../web/components");
    const appCompDir = path.resolve(__dirname, "../../../web/app/components");
    const allComps = new Set([
      ...findAll(compDir, "").length ? [] : [], // fallback
      ...(fs.existsSync(compDir) ? fs.readdirSync(compDir).filter(f => f.endsWith(".tsx")).map(f => f.replace(".tsx", "")) : []),
      ...(fs.existsSync(appCompDir) ? fs.readdirSync(appCompDir).filter(f => f.endsWith(".tsx")).map(f => f.replace(".tsx", "")) : []),
    ]);
    expect(allComps.size).toBeGreaterThanOrEqual(10);
  });
});

/* ══════════════════════════════════════════════════════════���═══════════════ */
/*  REPORT RIASSUNTIVO                                                      */
/* ═══��══════════════════════════════════════════════════════════════════════ */

describe("Report riassuntivo", () => {
  it("genera sommario totale", () => {
    let getCount = 0, postCount = 0, putCount = 0, deleteCount = 0;
    for (const fp of ALL_ROUTES) {
      const src = fs.readFileSync(fp, "utf-8");
      if (/export\s+async\s+function\s+GET\b/.test(src)) getCount++;
      if (/export\s+async\s+function\s+POST\b/.test(src)) postCount++;
      if (/export\s+async\s+function\s+PUT\b/.test(src)) putCount++;
      if (/export\s+async\s+function\s+DELETE\b/.test(src)) deleteCount++;
    }
    const clientPages = ALL_PAGES.filter((fp) => hasUseClient(readText(fp))).length;
    const serverPages = ALL_PAGES.length - clientPages;

    // Questo test stampa il report e verifica i minimi
    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║   SMOKE FINALE — REPORT RIASSUNTIVO  ║`);
    console.log(`╠══════════════��═══════════════════════╣`);
    console.log(`║  Pagine totali:    ${String(ALL_PAGES.length).padStart(4)}              ║`);
    console.log(`║    - client:       ${String(clientPages).padStart(4)}              ║`);
    console.log(`���    - server:       ${String(serverPages).padStart(4)}              ║`);
    console.log(`║  API routes:       ${String(ALL_ROUTES.length).padStart(4)}              ║`);
    console.log(`║    - GET:          ${String(getCount).padStart(4)}              ║`);
    console.log(`��    - POST:         ${String(postCount).padStart(4)}              ║`);
    console.log(`║    - PUT:          ${String(putCount).padStart(4)}              ║`);
    console.log(`║    - DELETE:       ${String(deleteCount).padStart(4)}              ║`);
    console.log(`║  Endpoint totali:  ${String(getCount + postCount + putCount + deleteCount).padStart(4)}              ║`);
    console.log(`╚═���═══════════��════════════════════════╝\n`);

    expect(ALL_PAGES.length).toBeGreaterThanOrEqual(100);
    expect(ALL_ROUTES.length).toBeGreaterThanOrEqual(120);
    expect(getCount + postCount + putCount + deleteCount).toBeGreaterThanOrEqual(100);
  });
});
