/**
 * Test unitari — lib/cloud-sync/onboarding-milestones.ts (vitest).
 *
 * [ONBOARDING-STATE-HALF-DEAD] `first_team_run_at` era NULL per ogni account
 * in produzione, anche quelli con migliaia di posizioni: colonna presente
 * dalla migration 011, nessun writer, nessun reader. Adesso che qualcuno la
 * scrive, ci sono due modi di renderla di nuovo inutile — ed è quello che
 * questi test tengono fermo:
 *
 *  · datarla su un evento che NON è il team che lavora (il caricamento del
 *    profilo, per esempio): il numero comparirebbe, credibile e sbagliato;
 *  · riscriverla a ogni push: da milestone diventerebbe un `last_seen`, che
 *    esiste già altrove.
 */
import { describe, it, expect } from "vitest";
import { firstTeamRunPatch, teamProducedWork } from "./onboarding-milestones";

describe("il push dimostra che il team ha lavorato", () => {
  it("una riga qualsiasi prodotta dagli agenti basta", () => {
    expect(teamProducedWork({ positions: 1 })).toBe(true);
    expect(teamProducedWork({ companies: 3 })).toBe(true);
    expect(teamProducedWork({ scores: 2 })).toBe(true);
    expect(teamProducedWork({ applications: 1 })).toBe(true);
    expect(teamProducedWork({ highlights: 5 })).toBe(true);
    expect(teamProducedWork({ positionTransitions: 1 })).toBe(true);
    expect(teamProducedWork({ sentinelTicks: 1 })).toBe(true);
  });

  it("un push a mani vuote non dimostra niente", () => {
    // Il bootstrap push parte anche su un database appena nato: il box è
    // vivo, il team non ha ancora lavorato. Sono due fatti diversi.
    expect(teamProducedWork({})).toBe(false);
    expect(
      teamProducedWork({ positions: 0, companies: 0, sentinelTicks: 0 }),
    ).toBe(false);
  });
});

describe("la milestone si scrive una volta sola", () => {
  const NOW = "2026-08-08T10:00:00.000Z";
  const USER = "11111111-1111-4111-8111-111111111111";

  it("colonna vuota: si segna adesso", () => {
    expect(firstTeamRunPatch(null, USER, NOW)).toEqual({
      user_id: USER,
      first_team_run_at: NOW,
      updated_at: NOW,
    });
    expect(firstTeamRunPatch({ first_team_run_at: null }, USER, NOW)).toEqual({
      user_id: USER,
      first_team_run_at: NOW,
      updated_at: NOW,
    });
  });

  it("già segnata: non si tocca", () => {
    // È la data in cui quel team ha cominciato, non quella dell'ultimo push.
    expect(
      firstTeamRunPatch(
        { first_team_run_at: "2026-06-01T08:00:00.000Z" },
        USER,
        NOW,
      ),
    ).toBeNull();
  });
});
