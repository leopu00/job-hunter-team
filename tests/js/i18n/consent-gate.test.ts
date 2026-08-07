/**
 * Il consenso deve governare davvero la misurazione.
 *
 * Prima di questi test `Analytics` e `SpeedInsights` erano montati nel
 * layout radice senza condizioni: partivano al primo render, cioè prima
 * ancora che l'utente vedesse il banner, mentre il banner offriva «Solo
 * necessari». La scelta esisteva a schermo e non esisteva nel codice.
 *
 * Sono controlli sul SORGENTE, non sul comportamento: verificano che il
 * layout non torni a importare direttamente i due componenti. È il tipo di
 * regressione che nessun type-check e nessun test di rendering vedrebbe —
 * reimportare `Analytics` nel layout compila benissimo.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../../web");

const layout = fs.readFileSync(path.join(WEB, "app/layout.tsx"), "utf8");
const gate = fs.readFileSync(
  path.join(WEB, "app/components/ConsentedAnalytics.tsx"),
  "utf8",
);
const banner = fs.readFileSync(
  path.join(WEB, "app/components/landing/CookieConsent.tsx"),
  "utf8",
);

describe("consenso e misurazione", () => {
  it("il layout non monta la misurazione senza passare dal gate", () => {
    expect(
      layout.includes("@vercel/analytics"),
      "layout.tsx importa di nuovo Analytics: la misurazione partirebbe prima del consenso",
    ).toBe(false);
    expect(
      layout.includes("@vercel/speed-insights"),
      "layout.tsx importa di nuovo SpeedInsights: la misurazione partirebbe prima del consenso",
    ).toBe(false);
    expect(layout).toContain("<ConsentedAnalytics />");
  });

  it("il gate accende solo con un consenso esplicito", () => {
    // Il confronto deve essere con "accepted". Un controllo di sola
    // presenza della chiave accenderebbe anche per chi ha risposto
    // «Solo necessari» — cioè per chi ha rifiutato.
    expect(gate).toContain('=== "accepted"');
    expect(gate).toMatch(/if\s*\(!accepted\)\s*return null/);
  });

  it("il banner avvisa il gate quando l'utente sceglie", () => {
    // Senza l'evento la scelta varrebbe solo dal caricamento successivo:
    // chi accetta non verrebbe misurato subito e — molto peggio — chi
    // rifiuta continuerebbe a esserlo per il resto della visita.
    expect(banner).toContain("CONSENT_EVENT");
    expect(banner).toContain("dispatchEvent");
  });

  it("la chiave del consenso è una sola, importata e non ricopiata", () => {
    // Due costanti uguali in due file si slegano al primo rename, e il
    // consenso smetterebbe di essere letto senza rompere nulla di visibile.
    expect(banner).toContain("CONSENT_STORAGE_KEY");
    const hardcoded = banner.match(/"jht:cookie-consent"/g) ?? [];
    expect(
      hardcoded.length,
      "il banner ridichiara la chiave invece di importarla",
    ).toBe(0);
  });
});
