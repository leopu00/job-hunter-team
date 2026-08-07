/**
 * Test UI batch 13 — CopyButton (Divider/StatusIndicator/MapSVG rimossi:
 * componenti orfani cancellati).
 *
 * Questi test leggono il sorgente come stringa di proposito: typecheck, lint
 * e build non vedono niente di quello che verificano qui. Ma leggerlo come
 * stringa non autorizza ad asserire su QUALSIASI stringa: la versione
 * precedente controllava const private di modulo (ICON_PX, BTN_CLS), la
 * costante 2000 e — sotto il titolo «aria-label 'Copiato!'/'Copia'» — una
 * riga del dizionario, non gli aria-label: cancellarli entrambi la lasciava
 * verde. Qui si assere solo su ciò che è contratto: gli export, le union
 * dichiarate nei props, il legame fra il componente e il dizionario, e la
 * coerenza fra i due file (il modello di profile-schema-crosscheck.test.ts).
 *
 * Un test davvero funzionale (render + click) vorrebbe environment "jsdom",
 * che vitest.config.ts non ha: aggiungerlo per un componente solo non vale
 * il costo, quindi qui ci si ferma al contratto pubblico.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
const readRaw = (rel: string) =>
  fs.readFileSync(path.join(WEB, rel), "utf-8").replace(/\r\n/g, "\n");

/** Sorgente su una riga, apici normalizzati: i match non dipendono da dove Prettier ha spezzato le righe. */
const flatten = (raw: string) =>
  raw.replace(/"/g, "'").replace(/\s+/g, " ").trim();

/** Membri di una union/array di stringhe TS: `'a' | 'b'` → ["a","b"]. */
const stringLiterals = (decl: string) =>
  Array.from(decl.matchAll(/'([^']+)'/g)).map((m) => m[1]);

/* ── CopyButton ── */
describe("CopyButton", () => {
  const raw = readRaw("app/components/CopyButton.tsx");
  const flat = flatten(raw);

  it("superficie pubblica: CopyButton + useCopy + CopyState + CopyButtonProps", () => {
    // Le uniche quattro cose che un chiamante può importare. Icone, mappe di
    // size e nomi delle const sono interni: rinominarli non deve rompere un
    // test che parla di clipboard.
    expect(flat).toMatch(/export function CopyButton\b/);
    expect(flat).toMatch(/export function useCopy\b/);
    expect(flat).toMatch(/export type CopyState\b/);
    expect(flat).toMatch(/export interface CopyButtonProps\b/);
  });

  it("ogni stato di CopyState è prodotto da useCopy e distinto nel render", () => {
    const decl = flat.match(/export type CopyState\s*=\s*([^;]+);/);
    expect(decl).toBeTruthy();
    const states = stringLiterals(decl![1]);
    expect(states.length).toBeGreaterThanOrEqual(2);
    expect(states).toContain("idle"); // stato iniziale del hook

    expect(flat).toContain("useState<CopyState>('idle')");
    for (const s of states) {
      // Prodotto: o è l'iniziale, o qualcuno lo setta.
      if (s !== "idle") expect(flat).toContain(`setState('${s}')`);
      // Osservabile: il render distingue lo stato (icona/colore/etichetta).
      if (s !== "idle") expect(flat).toContain(`state === '${s}'`);
    }
    expect(flat).toContain("navigator.clipboard.writeText(text)");
  });

  it("successDuration è un prop configurabile, non una costante nel codice", () => {
    // Il contratto è «il reset a idle avviene dopo successDuration, e la
    // durata la sceglie il chiamante»: il VALORE di default è una scelta UX
    // e cambiarlo non deve rompere un test.
    expect(flat).toMatch(/successDuration\?:\s*number/);
    expect(flat).toMatch(/export function useCopy\(successDuration = \d+\)/);
    expect(flat).toContain("useCopy(successDuration)");
    expect(flat).toContain(
      "setTimeout(() => setState('idle'), successDuration)",
    );
    expect(flat).toContain("clearTimeout(timer.current)");
  });

  it("ogni size e ogni variant dichiarati nei props sono davvero implementati", () => {
    // Il buco vero: aggiungere 'xl' alla union senza aggiungerlo alle mappe
    // produce className undefined a runtime, e nessun typecheck lo vede
    // (le mappe sono Record<string, …>). Le mappe si trovano per forma, non
    // per nome: rinominare ICON_PX non è una regressione.
    const props = flat.match(/export interface CopyButtonProps \{(.*?)\}/);
    expect(props).toBeTruthy();

    const sizes = stringLiterals(props![1].match(/size\?:\s*([^;]+);/)![1]);
    const variants = stringLiterals(
      props![1].match(/variant\?:\s*([^;]+);/)![1],
    );
    expect(sizes.length).toBeGreaterThan(0);
    expect(variants.length).toBeGreaterThan(0);

    const maps = Array.from(
      raw.matchAll(
        /const\s+\w+\s*:\s*Record<\s*string\s*,[^>]*>\s*=\s*\{([^}]*)\}/g,
      ),
    ).map((m) => Array.from(m[1].matchAll(/(\w+)\s*:/g)).map((k) => k[1]));
    expect(maps.length).toBeGreaterThan(0);
    for (const keys of maps) {
      for (const size of sizes) expect(keys).toContain(size);
    }

    for (const v of variants) {
      // O è il default del prop, o c'è un ramo che lo distingue.
      expect(
        flat.includes(`variant = '${v}'`) ||
          flat.includes(`variant === '${v}'`),
      ).toBe(true);
    }
  });

  it("ogni <button> ha un aria-label, sovrascrivibile da `label` e tradotto", () => {
    // Il test precedente si intitolava così ma asseriva su 'Copiato!', che
    // vive nel dizionario in cima al file: cancellare entrambi gli
    // aria-label lo lasciava verde. Qui si contano.
    const buttons = raw.match(/<button\b/g) ?? [];
    const ariaLabels = raw.match(/aria-label=/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(ariaLabels.length).toBe(buttons.length);

    // `label?: string` è documentato come override dell'aria-label, e il
    // fallback passa dal dizionario: mai una stringa fissa nel markup.
    const exprs = Array.from(
      flat.matchAll(/aria-label=\{([^}]*\}?[^}]*)\}/g),
    ).map((m) => m[1]);
    expect(exprs.length).toBe(buttons.length);
    for (const e of exprs) {
      expect(e).toMatch(/^label \?\?/);
      expect(e).toMatch(/\bt\.\w+/);
    }
  });

  it("il dizionario copre tutte le lingue di i18n/config e tutte le voci lette", () => {
    // Contratto fra due file: la union `Locale` è la fonte, il record T del
    // componente deve seguirla. Il tipo lo pretende già a compile time —
    // questa è la rete che vede anche chi tocca solo config.ts.
    const cfg = flatten(readRaw("i18n/config.ts"));
    const locales = stringLiterals(
      cfg.match(/export const locales:[^=]*=\s*\[([^\]]*)\]/)![1],
    );
    expect(locales.length).toBeGreaterThanOrEqual(7);

    const tBlock = raw.match(
      /const T:\s*Record<\s*Locale\s*,[\s\S]*?=\s*\{([\s\S]*?)\n\};/,
    );
    expect(tBlock).toBeTruthy();
    const entries = new Map(
      Array.from(tBlock![1].matchAll(/(\w+):\s*\{([^}]*)\}/g)).map((m) => [
        m[1],
        Array.from(m[2].matchAll(/(\w+)\s*:/g)).map((k) => k[1]),
      ]),
    );

    // Ogni voce che il componente legge (t.copied, t.copy, …) esiste in
    // ognuna delle lingue dichiarate.
    const used = [
      ...new Set(Array.from(raw.matchAll(/\bt\.(\w+)\b/g)).map((m) => m[1])),
    ];
    expect(used.length).toBeGreaterThan(0);
    for (const loc of locales) {
      expect(entries.has(loc)).toBe(true);
      for (const key of used) expect(entries.get(loc)).toContain(key);
    }
  });
});
