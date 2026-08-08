/**
 * Test unitari — lib/providers/update-target.ts (vitest).
 *
 * Il difetto che chiudono, nella forma peggiore che può avere un invito
 * all'azione: l'etichetta nominava una versione e il bottone ne installava
 * un'altra. Nato insieme al pin delle versioni dei provider (issue #130) —
 * l'installazione è passata a `provider-versions.json` mentre il badge
 * continuava a leggere l'ultima pubblicata sul registry.
 *
 * Le due proprietà da tenere:
 *  · il numero mostrato è quello che il click porterà sulla macchina;
 *  · si dice «aggiornamento» solo quando lo è davvero.
 */
import { describe, it, expect } from "vitest";
import { resolveUpdateTarget } from "./update-target";

describe("quale versione nomina il badge", () => {
  it("il pin vince sul registry", () => {
    // È la regola dell'installazione (`installSpecFor`), e il badge deve
    // seguirla: altrimenti indica 0.150.0 e il bottone mette 0.147.0.
    expect(
      resolveUpdateTarget({
        pinnedVersion: "0.147.0",
        registryLatest: "0.150.0",
        installedVersion: "0.140.0",
      }).targetVersion,
    ).toBe("0.147.0");
  });

  it("senza pin si ripiega sul registry, che è ciò che verrebbe installato", () => {
    // Pin assente o malformato → `installSpecFor` cade su `@latest`, quindi
    // il registry torna a essere la descrizione esatta dell'azione.
    expect(
      resolveUpdateTarget({
        pinnedVersion: null,
        registryLatest: "0.150.0",
        installedVersion: "0.140.0",
      }).targetVersion,
    ).toBe("0.150.0");
  });

  it("niente pin e niente registry: nessun numero da mostrare", () => {
    expect(
      resolveUpdateTarget({ installedVersion: "1.0.0" }).targetVersion,
    ).toBeNull();
  });
});

describe("quando si propone l'aggiornamento", () => {
  it("bersaglio più nuovo dell'installata: sì", () => {
    expect(
      resolveUpdateTarget({
        pinnedVersion: "0.147.0",
        installedVersion: "0.140.0",
      }).updateAvailable,
    ).toBe(true);
  });

  it("già sulla versione del pin: no", () => {
    expect(
      resolveUpdateTarget({
        pinnedVersion: "0.147.0",
        installedVersion: "0.147.0",
      }).updateAvailable,
    ).toBe(false);
  });

  it("macchina più avanti del pin: nessun invito, il bottone resta", () => {
    // Caso reale al 2026-08-08: kimi è pinnata alla 1.36.0 mentre PyPI
    // pubblica la 1.49.0. Riallineare alla versione della release è
    // legittimo, chiamarlo «aggiornamento» no — e un badge che mente è un
    // badge che si impara a ignorare.
    const r = resolveUpdateTarget({
      pinnedVersion: "1.36.0",
      installedVersion: "1.49.0",
    });
    expect(r.updateAvailable).toBe(false);
    expect(r.targetVersion).toBe("1.36.0");
  });

  it("versioni non confrontabili: silenzio", () => {
    expect(
      resolveUpdateTarget({
        pinnedVersion: "latest",
        installedVersion: "0.140.0",
      }).updateAvailable,
    ).toBe(false);
    expect(
      resolveUpdateTarget({
        pinnedVersion: "0.147.0",
        installedVersion: null,
      }).updateAvailable,
    ).toBe(false);
  });
});
