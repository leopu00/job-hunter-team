/**
 * O-42 — niente emoji nella UI di prodotto (direttiva utente del 18/07): gli
 * elementi grafici sono SVG stroke. La superficie /positions era rimasta
 * indietro: le faccine degli attori nella colonna «Aggiornato da», la
 * graffetta degli allegati, l'ingranaggio dei filtri, il triangolo delle red
 * flag e — meno ovvia — la freccia di ordinamento.
 *
 * Il criterio è `Extended_Pictographic`, la proprietà Unicode che dice
 * «questo carattere è un pittogramma»: comprende anche i glifi che oggi, su
 * macOS, escono monocromatici (⚙ ⚠ ↕) ma che su un'altra piattaforma cadono
 * sul font emoji a colori. Misurato nel browser il 2026-08-14 con la
 * font-stack della pagina: la cella mono è 27,6px, ↕ ne misura 31 e 📎 ne
 * misura 46 — cioè la loro larghezza la decide il sistema operativo, e in una
 * tabella a colonne fisse quella larghezza è layout.
 *
 * ✓ (U+2713) e ✕ (U+2715) NON sono pittografici e li disegna il font del
 * sito alla larghezza della cella mono: restano, e questo test li lascia
 * passare di proposito.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const SURFACES = [
  join(ROOT, "web/app/(protected)/positions"),
  join(ROOT, "web/app/components/ActorIcon.tsx"),
];

function sources(entry: string): string[] {
  let stat;
  try {
    stat = readdirSync(entry, { withFileTypes: true });
  } catch {
    return [entry]; // è un file, non una cartella
  }
  return stat.flatMap((e) => {
    const p = join(entry, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Toglie i commenti: quello che conta è ciò che finisce a schermo. */
function code(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const FILES = SURFACES.flatMap(sources);
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

describe("niente emoji sulle superfici /positions", () => {
  it("trova i file da controllare", () => {
    // Una lista vuota renderebbe verde qualunque cosa.
    expect(FILES.length).toBeGreaterThan(15);
  });

  it.each(FILES)("%s non contiene pittogrammi", (file) => {
    const body = code(readFileSync(file, "utf-8"));
    const found = [...body].filter((ch) => PICTOGRAPHIC.test(ch));
    expect(
      [...new Set(found)].join(" "),
      `${relative(ROOT, file)} usa ${[...new Set(found)].join(" ")} — servono SVG stroke (vedi positions/icons.tsx)`,
    ).toBe("");
  });

  it("le icone sostitutive esistono davvero", () => {
    const icons = readFileSync(
      join(ROOT, "web/app/(protected)/positions/icons.tsx"),
      "utf-8",
    );
    for (const name of ["IconFilters", "IconSort", "IconAlert"]) {
      expect(icons).toContain(`export function ${name}`);
    }
    const actor = readFileSync(
      join(ROOT, "web/app/components/ActorIcon.tsx"),
      "utf-8",
    );
    // Un ruolo senza disegno tornerebbe alla faccina: meglio accorgersene qui.
    for (const role of [
      "scout",
      "analista",
      "scorer",
      "scrittore",
      "critico",
      "user",
    ]) {
      expect(actor).toContain(`${role}: (`);
    }
  });
});
