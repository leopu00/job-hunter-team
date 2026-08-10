import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { salaryPreference } from "../../../web/lib/salary-source";

/**
 * O-32 — quando una posizione ha SIA lo stipendio dichiarato SIA la stima del
 * team, il web mostrava la stima. Misurato sul dato vero: un annuncio che
 * dichiara 12.000-24.000 veniva presentato come 35.000-60.000, tre volte
 * tanto. Non è un difetto estetico: l'utente sceglie a quali offerte
 * candidarsi guardando quel numero, e un numero sembra un fatto — nessuno va
 * a controllare l'annuncio.
 *
 * La regola giusta esisteva già nel prodotto
 * (`shared/skills/generate_dashboard.py`: has_declared prima di
 * has_estimated). Qui si difende che il web la applichi, e che la applichi in
 * TUTTI i punti: lista, dashboard e swipe, ramo cloud e ramo locale.
 */
const ROOT = resolve(__dirname, "../../..");
const CLOUD = readFileSync(resolve(ROOT, "web/lib/queries.ts"), "utf-8");
const LOCAL = readFileSync(resolve(ROOT, "web/lib/local-queries.ts"), "utf-8");
const DETAIL = readFileSync(
  resolve(ROOT, "web/app/(protected)/positions/[id]/page.tsx"),
  "utf-8",
);

describe("quale stipendio vince", () => {
  it("il dichiarato, quando ci sono entrambi", () => {
    // Il caso reale che ha fatto aprire il ticket.
    const pick = salaryPreference({
      salary_declared_min: 12000,
      salary_declared_max: 24000,
      salary_declared_currency: "EUR",
      salary_estimated_min: 35000,
      salary_estimated_max: 60000,
      salary_estimated_currency: "EUR",
    });
    expect(pick.min).toBe(12000);
    expect(pick.max).toBe(24000);
    expect(pick.declared).toBe(true);
  });

  it("la stima, quando il dichiarato manca — non sparisce niente", () => {
    const pick = salaryPreference({
      salary_declared_min: null,
      salary_declared_max: null,
      salary_estimated_min: 35000,
      salary_estimated_max: 60000,
      salary_estimated_currency: "USD",
    });
    expect(pick.min).toBe(35000);
    expect(pick.max).toBe(60000);
    expect(pick.currency).toBe("USD");
    expect(pick.declared).toBe(false);
  });

  it("basta un estremo dichiarato perché il dichiarato vinca", () => {
    // "da 30.000 in su" è comunque un fatto scritto nell'annuncio, e vale
    // più di una forbice inventata a tavolino.
    const pick = salaryPreference({
      salary_declared_min: 30000,
      salary_declared_max: null,
      salary_estimated_min: 50000,
      salary_estimated_max: 70000,
    });
    expect(pick.min).toBe(30000);
    expect(pick.max).toBeNull();
    expect(pick.declared).toBe(true);
  });

  it("min, max e valuta vengono dalla STESSA fonte", () => {
    // Mescolarle mostrerebbe un minimo in una valuta e un massimo in
    // un'altra: due numeri veri e una forbice falsa.
    const pick = salaryPreference({
      salary_declared_min: 12000,
      salary_declared_max: 24000,
      salary_declared_currency: "EUR",
      salary_estimated_min: 35000,
      salary_estimated_max: 60000,
      salary_estimated_currency: "USD",
    });
    expect(pick).toMatchObject({ min: 12000, max: 24000, currency: "EUR" });
  });

  it("niente stipendio → niente numero inventato", () => {
    const pick = salaryPreference({});
    expect(pick.min).toBeNull();
    expect(pick.max).toBeNull();
  });
});

describe("la regola è applicata dappertutto", () => {
  it("non resta un solo punto che preferisce la stima", () => {
    // `useEst` era il nome della preferenza rovesciata: se ricompare, da
    // qualche parte è tornata la vecchia regola.
    expect(CLOUD).not.toContain("useEst");
    expect(LOCAL).not.toContain("useEst");
  });

  it("lista, dashboard e swipe la prendono dalla stessa funzione", () => {
    // Tre punti sul cloud (getPositions, swipe, dashboard), due in locale
    // (lista, dashboard): la dashboard e lo swipe leggono lo stesso
    // salary_min, quindi il difetto era su tre schermate, non su una.
    expect(CLOUD.match(/salaryPreference\(/g)?.length).toBeGreaterThanOrEqual(
      3,
    );
    expect(LOCAL.match(/salaryPreference\(/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("il ramo cloud NON è dimenticato", () => {
    // O-31 è stata consegnata a metà proprio così: corretto il ramo locale,
    // lasciato indietro quello dove l'utente guarda davvero.
    expect(CLOUD).toContain('from "@/lib/salary-source"');
    expect(LOCAL).toContain('from "./salary-source"');
  });
});

describe("la card Panoramica del dettaglio", () => {
  it("mostra il dichiarato quando c'è, la stima solo in fallback", () => {
    expect(DETAIL).toContain("{(salaryDecl || salaryEst) && (");
    expect(DETAIL).toContain("{(salaryDecl ?? salaryEst)!}");
  });

  it("l'etichetta segue il valore mostrato", () => {
    // Un valore dichiarato sotto l'etichetta "stipendio stimato" sarebbe lo
    // stesso difetto al contrario.
    const row = DETAIL.slice(
      DETAIL.indexOf("{(salaryDecl || salaryEst) && ("),
      DETAIL.indexOf("{position.remote_type && ("),
    );
    expect(row).toContain(
      'salaryDecl ? "d_salary_declared" : "d_salary_estimated"',
    );
  });
});
