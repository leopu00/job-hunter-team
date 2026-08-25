import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Regressione live del 24/08: col bump a MapLibre 6 il worker è diventato un
// file separato che di default si risolve con `new URL(..., import.meta.url)`.
// Nel bundle di produzione di Next quel valore non è un URL http(s), la
// risoluzione torna vuota e il worker importa la home del sito: muore in
// silenzio e ogni mappa resta senza tile né pin (in home il globo era una
// sfera vuota). Questi test inchiodano le quattro parti del rimedio: l'URL
// fissato via setWorkerUrl, la chiamata PRIMA di ogni `new Map`, la copia
// postinstall dei due file in public/, e il matcher del middleware che tiene
// la CSP delle pagine fuori dalla risposta del worker.

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

const workerLib = read("web/lib/maplibre-worker.ts");
const jobsGlobe = read("web/app/components/JobsGlobe.tsx");
const positionMap = read(
  "web/app/(protected)/positions/[id]/PositionMapCard.tsx",
);
const copyScript = read("web/scripts/copy-maplibre-worker.mjs");
const middleware = read("web/middleware.ts");
const pkg = JSON.parse(read("web/package.json"));

describe("worker MapLibre servito same-origin", () => {
  it("fissa l'URL del worker sulla copia in public/maplibre/", () => {
    expect(workerLib).toContain('from "maplibre-gl"');
    expect(workerLib).toContain(
      'setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")',
    );
  });

  it("ogni costruttore di Map chiama prima ensureMaplibreWorkerUrl", () => {
    // Il default di MapLibre si decide alla PRIMA Map: chiamare l'ensure
    // dopo (o in un solo componente) rimette in produzione il worker morto.
    for (const [name, source] of [
      ["JobsGlobe", jobsGlobe],
      ["PositionMapCard", positionMap],
    ] as const) {
      const call = source.indexOf("ensureMaplibreWorkerUrl()");
      const ctor = source.indexOf("new maplibregl.Map(");
      expect(call, `${name}: manca la chiamata`).toBeGreaterThan(-1);
      expect(ctor, `${name}: manca il costruttore`).toBeGreaterThan(-1);
      expect(call, `${name}: ensure dopo il costruttore`).toBeLessThan(ctor);
    }
  });

  it("il postinstall copia worker E modulo condiviso, e la copia non si committa", () => {
    expect(pkg.scripts.postinstall).toBe(
      "node scripts/copy-maplibre-worker.mjs",
    );
    // Il worker importa `./maplibre-gl-shared.mjs`: senza il secondo file la
    // mappa muore identica al bug originale, solo un 404 più avanti.
    expect(copyScript).toContain('"maplibre-gl-worker.mjs"');
    expect(copyScript).toContain('"maplibre-gl-shared.mjs"');
    expect(read("web/.gitignore")).toContain("/public/maplibre/");
  });

  it("il middleware non applica la CSP delle pagine ai .mjs statici", () => {
    // Un worker caricato da URL usa la CSP della sua risposta: quella delle
    // pagine (script-src 'strict-dynamic') renderebbe l'import interno di
    // maplibre-gl-shared.mjs dipendente dal browser.
    const matcher = middleware.match(/matcher:\s*\[\s*"([^"]+)"/)?.[1];
    expect(matcher).toBeTruthy();
    expect(matcher).toContain("mjs");
  });
});
