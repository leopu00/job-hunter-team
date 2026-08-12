/**
 * Rete di sicurezza per le traduzioni.
 *
 * Il web parla sette lingue e non aveva nulla che lo verificasse: una voce
 * a cui manca il tedesco arriva in produzione e mostra l'inglese a un
 * utente tedesco, senza che niente si lamenti. È già successo — gli
 * overlay della landing hanno buchi che nessuno ha notato per settimane.
 *
 * Tre controlli, dal più forte al più debole:
 *
 *   1. dizionari ESTRATTI (`*.i18n.ts`) — importati davvero e verificati.
 *      Robusto: nessun parsing di sorgente, se il modulo cambia forma il
 *      test se ne accorge.
 *   2. overlay della landing — le quattro lingue "aggiunte" devono coprire
 *      le stesse chiavi della base it/en/hu.
 *   3. dizionari ancora INLINE nei componenti — controllo di transizione,
 *      per forza a colpi di regex finché non sono estratti. Questo blocco
 *      si restringe da solo man mano che l'estrazione procede, e sparirà.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../../web");

const LOCALES = ["it", "en", "es", "fr", "de", "pt", "hu"] as const;
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "dist", ".git"]);

/** Budget dei test che IMPORTANO un dizionario, misurato — non il default.
 *
 * Il controllo forte del blocco 1 è proprio l'import vero del modulo, e ogni
 * import paga il transform TypeScript del file: 100–690ms a macchina scarica
 * (--reporter=verbose, 2026-08-12; team-gmail 690ms, critico 611ms). Sotto
 * contesa — la suite gira con 13 worker che transformano tutti insieme — quel
 * costo si gonfia oltre il default di 5000ms: questo file è caduto con «Test
 * timed out in 5000ms» in una run normale della suite (DashboardLinkedCharts)
 * e in entrambe le run sotto saturazione, sempre verde rieseguito da solo. Il
 * rosso misurava la macchina, non il codice. Stessa famiglia e stessa cura di
 * daemon.test.ts e cloud-bootstrap-restore.test.ts: 15s, la cifra già usata
 * dai file fratelli. I test che NON importano (regex su sorgenti già letti,
 * 0–1ms) restano al default: un budget largo dove non è motivato è solo un
 * modo di non guardare. */
const IMPORT_TEST_TIMEOUT_MS = 15_000;

/** Tutti i file sotto `web/` che corrispondono al filtro. */
function walk(dir: string, keep: (f: string) => boolean, acc: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), keep, acc);
    } else if (keep(entry.name)) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

const rel = (p: string) => path.relative(WEB, p);

// ───────────────────────────────────────────────────────────────────────
// 1. Dizionari estratti — importati, non letti come testo
// ───────────────────────────────────────────────────────────────────────
// `*.i18n.ts` è la convenzione nuova; `*-i18n.ts` sono i due dizionari
// che erano già in un file a parte prima dell'estrazione.
//
// `.i18n.tsx` non è un caso di bordo: le guide `email-forwarding` e
// `team-gmail` hanno voci che contengono JSX (link, `<code>`), quindi il
// dizionario deve stare in un `.tsx`. Sono i due file più grandi del
// repo e restavano fuori dalla rete — protetti dal solo `tsc`, che
// verifica il tipo `Record<Locale, …>` ma non che le voci ci siano
// davvero tutte.
const extracted = walk(
  WEB,
  (f) =>
    f.endsWith(".i18n.ts") ||
    f.endsWith(".i18n.tsx") ||
    f.endsWith("-i18n.ts"),
);

describe("dizionari estratti (*.i18n.ts)", () => {
  it("ne esiste almeno uno (altrimenti questo blocco non prova nulla)", () => {
    expect(extracted.length).toBeGreaterThan(0);
  });

  for (const file of extracted) {
    it(`${rel(file)}: ogni voce ha tutte e 7 le lingue, non vuote`, async () => {
      const mod = await import(pathToFileURL(file).href);
      const dicts = Object.entries(mod).filter(
        ([, v]) => v && typeof v === "object",
      );
      expect(
        dicts.length,
        `${rel(file)} non esporta nessun dizionario`,
      ).toBeGreaterThan(0);

      const problemi: string[] = [];
      for (const [exportName, dict] of dicts) {
        const top = dict as Record<string, unknown>;
        // Due forme in circolazione. Per chiave: `{ saluto: { it, en, … } }`.
        // Per lingua: `{ it: { saluto, … }, en: { … } }` — quella di
        // dashboard-i18n. Si distinguono da cosa c'è al primo livello: la
        // seconda ha SOLO codici lingua.
        //
        // Il riconoscimento non può pretendere che i sette ci siano già,
        // com'era prima: se ne manca uno la forma non viene più
        // riconosciuta, il dizionario scivola nel ramo "per chiave", lì
        // nessuna voce ha una proprietà `en` e il controllo esce verde.
        // Togliere una lingua intera — l'errore che questo test esiste per
        // vedere — passava così inosservato.
        const chiaviTop = Object.keys(top);
        const soloLingue =
          chiaviTop.length > 0 &&
          chiaviTop.every((k) => (LOCALES as readonly string[]).includes(k));
        if (soloLingue) {
          const mancanti = LOCALES.filter((l) => !(l in top));
          if (mancanti.length) {
            problemi.push(
              `${exportName}: manca del tutto ${mancanti.join(", ")}`,
            );
            continue;
          }
          // Per lingua ha due sotto-forme. Piatta: `{ it: "…", en: "…" }`,
          // una sola frase per lingua (il `DESKTOP_SOON` delle guide).
          // Annidata: `{ it: { saluto, … } }`. Distinguerle serve, perché
          // `Object.keys()` su una stringa restituisce gli indici dei
          // caratteri: la forma piatta finirebbe a confrontare lunghezze
          // di frasi e a dichiarare "manca la chiave 109" sulla lingua
          // che traduce più corto dell'inglese.
          const piatta = LOCALES.every((l) => typeof top[l] === "string");
          if (piatta) {
            for (const loc of LOCALES) {
              const s = top[loc] as string;
              if (!s.trim()) problemi.push(`${exportName}.${loc}: è vuota`);
            }
            continue;
          }
          const riferimento = Object.keys(top.en as object).sort();
          for (const loc of LOCALES) {
            const chiavi = Object.keys(top[loc] as object).sort();
            for (const k of riferimento)
              if (!chiavi.includes(k))
                problemi.push(`${exportName}.${loc}: manca la chiave "${k}"`);
          }
          continue;
        }
        for (const [key, value] of Object.entries(top)) {
          // Una voce è {locale: stringa}. Tutto il resto (funzioni,
          // costanti d'appoggio) non è materia di questo controllo.
          if (!value || typeof value !== "object") continue;
          const langs = value as Record<string, unknown>;
          if (!("en" in langs)) continue;
          for (const loc of LOCALES) {
            const s = langs[loc];
            if (typeof s !== "string")
              problemi.push(`${exportName}.${key}: manca "${loc}"`);
            else if (!s.trim())
              problemi.push(`${exportName}.${key}: "${loc}" è vuota`);
          }
        }
      }
      expect(problemi, problemi.join("\n")).toEqual([]);
    }, IMPORT_TEST_TIMEOUT_MS);
  }
});

// ───────────────────────────────────────────────────────────────────────
// 2. Overlay della landing — es/fr/de/pt sopra la base it/en/hu
// ───────────────────────────────────────────────────────────────────────
describe("overlay della landing", () => {
  const LANDING = path.join(WEB, "app/components/landing");
  const baseSrc = fs.readFileSync(
    path.join(LANDING, "LandingI18n.tsx"),
    "utf8",
  );
  // Le voci della base sono `  chiave: { it: …` a due spazi d'indentazione.
  const baseKeys = new Set(
    [...baseSrc.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*):\s*\{/gm)].map(
      (m) => m[1],
    ),
  );

  it("la base espone un numero plausibile di chiavi", () => {
    expect(baseKeys.size).toBeGreaterThan(50);
  });

  for (const loc of ["es", "fr", "de", "pt"]) {
    it(`${loc}.ts copre tutte le chiavi della base`, async () => {
      const mod = await import(
        pathToFileURL(path.join(LANDING, "i18n", `${loc}.ts`)).href
      );
      const overlay = mod[loc] as Record<string, string>;
      const mancanti = [...baseKeys].filter((k) => !(k in overlay)).sort();
      expect(
        mancanti,
        `${loc}.ts non traduce: ${mancanti.join(", ")}\n` +
          `Se il valore inglese va bene anche in questa lingua, dichiaralo ` +
          `comunque: così resta una decisione e non una dimenticanza.`,
      ).toEqual([]);
    }, IMPORT_TEST_TIMEOUT_MS);

    it(`${loc}.ts non ha chiavi che la base non conosce`, async () => {
      const mod = await import(
        pathToFileURL(path.join(LANDING, "i18n", `${loc}.ts`)).href
      );
      const orfane = Object.keys(mod[loc]).filter((k) => !baseKeys.has(k));
      expect(orfane, `chiavi orfane in ${loc}.ts: ${orfane.join(", ")}`).toEqual(
        [],
      );
    }, IMPORT_TEST_TIMEOUT_MS);
  }
});

// ───────────────────────────────────────────────────────────────────────
// 3. Dizionari ancora inline — transitorio, si restringe con l'estrazione
// ───────────────────────────────────────────────────────────────────────
/**
 * Estrae le voci `chiave: { it: "…", en: "…" }` da un sorgente.
 *
 * Bilancia le graffe invece di affidarsi a una regex sul blocco: i valori
 * tradotti contengono graffe di interpolazione (`"min {n}h"`) e apostrofi,
 * che a una regex ingenua spezzano il match.
 */
function inlineEntries(src: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const keyRe = /(?:^|[\s{,])(["']?)([A-Za-z_][A-Za-z0-9_]*)\1\s*:\s*\{/g;
  for (const m of src.matchAll(keyRe)) {
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    let i = open;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    if (depth !== 0) continue;
    const body = src.slice(open + 1, i);
    const langs = new Set(
      [...body.matchAll(/\b(it|en|es|fr|de|pt|hu)\s*:\s*["'`]/g)].map(
        (x) => x[1],
      ),
    );
    // Almeno 4 lingue su 7: sotto quella soglia non è un dizionario ma un
    // oggetto qualsiasi che per caso ha una proprietà chiamata `it`.
    if (langs.size >= 4) out.set(m[2], langs);
  }
  return out;
}

const componentFiles = walk(
  WEB,
  (f) =>
    (f.endsWith(".ts") || f.endsWith(".tsx")) &&
    !f.endsWith(".i18n.ts") &&
    !f.endsWith(".test.ts"),
).filter((f) => fs.readFileSync(f, "utf8").includes("it:"));

describe("dizionari ancora inline nei componenti", () => {
  const conDizionario = componentFiles
    .map((f) => [f, inlineEntries(fs.readFileSync(f, "utf8"))] as const)
    .filter(([, d]) => d.size > 0);

  for (const [file, dict] of conDizionario) {
    it(`${rel(file)}: le ${dict.size} voci hanno tutte e 7 le lingue`, () => {
      const problemi: string[] = [];
      for (const [key, langs] of dict) {
        const mancanti = LOCALES.filter((l) => !langs.has(l));
        if (mancanti.length) problemi.push(`${key}: manca ${mancanti.join(",")}`);
      }
      expect(problemi, problemi.join("\n")).toEqual([]);
    });
  }
});
