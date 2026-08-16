/**
 * O-78 — le regole dei campi devono stare DENTRO un layer.
 *
 * Una regola di ELEMENTO fuori da ogni `@layer` batte ogni utility Tailwind,
 * a parità di specificity e senza `!important`: è la cascata a layer, non un
 * dettaglio di stile. Finché `input, textarea, select` è stata fuori,
 * `text-[11px]`, `px-3`, `bg-transparent` scritte su un campo erano codice
 * morto — non «poco efficaci»: ignorate. Il campo di ricerca di /positions
 * veniva 44px dentro un contenitore da 37 e usciva dal suo bordo, ma il costo
 * vero era il prossimo: ogni classe scritta su un input da lì in avanti
 * sarebbe sparita senza spiegazione, e si sarebbe finito ad aggirarla con
 * `!important` o con uno style inline.
 *
 * Questo test non guarda com'è disegnato un campo: guarda CHI VINCE. La prova
 * visiva (una utility che batte davvero il default nel browser) sta in
 * `e2e/tests/40-form-cascade.spec.ts`, che gira su una pagina pubblica.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const CSS = "web/app/globals.css";

/** Selettori di elemento che, se non layerizzati, mangiano le utility. */
const FORM_ELEMENTS = /(^|,)\s*(input|textarea|select)\b/;

type Rule = { selector: string; layers: string[] };

/**
 * Regole del file con il loro contesto di at-rule: si cammina il CSS
 * tenendo la pila dei blocchi aperti, così «dentro @layer» è un fatto
 * misurato e non una ricerca di stringhe vicine.
 */
function rulesOf(css: string): Rule[] {
  const out: Rule[] = [];
  const stack: string[] = [];
  let buf = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      // I commenti si tolgono PRIMA del trim: qui sopra ce n'è uno lungo,
      // e lasciarlo attaccato faceva sembrare `@layer base` un selettore
      // qualsiasi (il test passava per il motivo sbagliato, in rosso).
      const opener = buf
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .trim();
      out.push({
        selector: opener,
        layers: stack.filter((s) => s.startsWith("@layer")),
      });
      stack.push(opener);
      buf = "";
    } else if (ch === "}") {
      stack.pop();
      buf = "";
    } else {
      buf += ch;
    }
  }
  return out;
}

describe("globals.css — i default dei campi non scavalcano le utility", () => {
  const rules = rulesOf(readFileSync(resolve(ROOT, CSS), "utf8"));
  const formRules = rules.filter((r) => FORM_ELEMENTS.test(r.selector));

  it("le regole su input/textarea/select esistono e stanno in @layer", () => {
    // Se un giorno sparissero del tutto, questo test resterebbe verde a
    // vuoto: il conteggio lo impedisce.
    expect(
      formRules.length,
      "nessuna regola sui campi in globals.css",
    ).toBeGreaterThan(0);
    const unlayered = formRules.filter((r) => r.layers.length === 0);
    expect(
      unlayered.map((r) => r.selector.replace(/\s+/g, " ")),
      "regola di elemento sui campi fuori da ogni @layer: batterebbe le utility",
    ).toEqual([]);
  });

  it("stanno nel layer base, dove vive un default", () => {
    // `base` e non `components`/`utilities`: sono i valori di partenza
    // dell'elemento, e devono perdere contro chi scrive una classe.
    for (const rule of formRules) {
      expect(rule.layers, rule.selector.replace(/\s+/g, " ")).toContain(
        "@layer base",
      );
    }
  });

  it("i titoli restano layerizzati come li aveva messi #case-studies", () => {
    // Stessa proprietà, già risolta una volta per i titoli: se qualcuno li
    // tirasse fuori dal layer, `text-slate-900` sulla pagina chiara
    // tornerebbe a non funzionare.
    const headings = rules.filter((r) => /(^|,)\s*h[1-6]\b/.test(r.selector));
    expect(headings.length).toBeGreaterThan(0);
    for (const rule of headings) {
      expect(rule.layers).toContain("@layer base");
    }
  });
});
