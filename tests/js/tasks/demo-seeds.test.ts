/**
 * [JHT-WEB-DEMO] Contratto dei seed della demo mode.
 *
 * La demo cloud (4 personas × 56 posizioni × 7 lingue) alimenta dashboard,
 * /positions, dettaglio, /map e /swipe con un dataset statico. Il rischio
 * strutturale, registrato nel BACKLOG dopo l'audit del 2026-07-25: un campo
 * nuovo consumato dalle pagine, non aggiunto ai seed, produce un **buco
 * silenzioso** nella demo — nessun errore, solo un dato che manca sotto gli
 * occhi di chi sta valutando il prodotto.
 *
 * Questo test fissa i campi che le pagine leggono e la copertura delle
 * traduzioni. Non verifica il *contenuto* (è finto per definizione): verifica
 * che ci sia, che sia coerente e che sia tradotto dove serve.
 *
 * Design record: docs/internal/architecture/2026-07-22-web-demo-mode-and-welcome.md
 */
import { describe, it, expect } from "vitest";
import {
  DEMO_PERSONA_KEYS,
  getDemoPositionsData,
  isDemoLegacyId,
  isDemoPositionId,
  type DemoPersonaKey,
} from "@/lib/demo/data";
import { DEMO_I18N } from "@/lib/demo/seeds/i18n";
import { SOFTWARE } from "@/lib/demo/seeds/software";
import { MARKETING } from "@/lib/demo/seeds/marketing";
import { FINANCE } from "@/lib/demo/seeds/finance";
import { DESIGN } from "@/lib/demo/seeds/design";
import type { Locale } from "@/i18n/config";

// I seed grezzi, per verificare la copertura degli overlay indice per indice.
const RAW: Record<DemoPersonaKey, unknown[]> = {
  software: SOFTWARE,
  marketing: MARKETING,
  finance: FINANCE,
  design: DESIGN,
};

// `it` è la lingua base dei seed: gli overlay coprono le altre sei.
const OVERLAY_LOCALES: Locale[] = ["en", "es", "fr", "de", "hu", "pt"];

// Campi della "voce degli agenti" — gli unici che vanno tradotti (gli annunci
// restano in inglese, come gli annunci reali).
type TranslatableSeed = {
  notes?: string;
  scoreNotes?: string;
  criticNotes?: string;
  pros?: string[];
  cons?: string[];
};

function hasTranslatableText(s: TranslatableSeed): boolean {
  return Boolean(
    s.notes ||
    s.scoreNotes ||
    s.criticNotes ||
    s.pros?.length ||
    s.cons?.length,
  );
}

describe("demo seeds — struttura", () => {
  it("ogni persona ha lo stesso numero di posizioni dei suoi seed", () => {
    for (const key of DEMO_PERSONA_KEYS) {
      expect(getDemoPositionsData(key, "it")).toHaveLength(RAW[key].length);
    }
  });

  it("le 4 personas sono tutte popolate e con lo stesso peso", () => {
    const sizes = DEMO_PERSONA_KEYS.map(
      (k) => getDemoPositionsData(k, "it").length,
    );
    expect(sizes.every((n) => n > 0)).toBe(true);
    // Un dataset molto più povero degli altri renderebbe una persona una
    // demo di serie B: se cambia il numero, cambialo per tutte.
    expect(new Set(sizes).size).toBe(1);
  });

  it("gli id rispettano il formato riconosciuto dalle write-API", () => {
    for (const key of DEMO_PERSONA_KEYS) {
      for (const p of getDemoPositionsData(key, "it")) {
        expect(p.id).toMatch(new RegExp(`^demo-${key}-\\d{3}$`));
        expect(isDemoPositionId(p.id)).toBe(true);
        expect(isDemoLegacyId(p.legacy_id as number)).toBe(true);
      }
    }
  });

  it("i legacy_id sono unici su tutte le personas (nessuna collisione)", () => {
    const all = DEMO_PERSONA_KEYS.flatMap((k) =>
      getDemoPositionsData(k, "it").map((p) => p.legacy_id as number),
    );
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("demo seeds — campi consumati dalle pagine", () => {
  // Se una pagina inizia a leggere un campo nuovo, aggiungilo qui: il test
  // diventa il posto in cui il contratto è scritto.
  const REQUIRED = [
    "title",
    "company",
    "url",
    "source",
    "status",
    "found_at",
    "remote_type",
  ] as const;

  it("ogni posizione ha i campi base non vuoti", () => {
    for (const key of DEMO_PERSONA_KEYS) {
      for (const p of getDemoPositionsData(key, "it")) {
        for (const field of REQUIRED) {
          const v = (p as unknown as Record<string, unknown>)[field];
          expect(
            typeof v === "string" ? v.trim().length > 0 : v != null,
            `${p.id} · campo "${field}" vuoto`,
          ).toBe(true);
        }
      }
    }
  });

  it("chi ha uno score ha anche il breakdown per dimensione", () => {
    // La card del punteggio mostra il rationale per-dimensione (contratto
    // agenti del 2026-07-23): senza le dimensioni la card resta muta.
    const DIMS = [
      "stack_match",
      "remote_fit",
      "salary_fit",
      "experience_fit",
      "strategic_fit",
    ] as const;
    let scored = 0;
    for (const key of DEMO_PERSONA_KEYS) {
      for (const p of getDemoPositionsData(key, "it")) {
        if (p.score == null) continue;
        scored++;
        expect(p.demo_score_row, `${p.id} · score senza riga score`).not.toBe(
          null,
        );
        const row = p.demo_score_row as unknown as Record<string, unknown>;
        expect(row.total_score).toBe(p.score);
        for (const d of DIMS) {
          expect(
            typeof row[d] === "number",
            `${p.id} · dimensione "${d}" mancante`,
          ).toBe(true);
          expect(row[d] as number).toBeGreaterThanOrEqual(0);
          expect(row[d] as number).toBeLessThanOrEqual(100);
        }
      }
    }
    // Guardia sul dataset: una demo senza posizioni scorate non mostra nulla
    // di ciò che il prodotto fa.
    expect(scored).toBeGreaterThan(0);
  });

  it("le coordinate ci sono a coppie e sono plausibili", () => {
    // Chi non ha coordinate finisce nella griglia nord della mappa: è
    // previsto. Ciò che non deve capitare è mezza coppia.
    for (const key of DEMO_PERSONA_KEYS) {
      for (const p of getDemoPositionsData(key, "it")) {
        expect(
          (p.lat == null) === (p.lon == null),
          `${p.id} · mezza coppia di coordinate`,
        ).toBe(true);
        if (p.lat != null && p.lon != null) {
          expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
          expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
        }
      }
    }
  });

  it("il verdetto del Critico è uno di quelli che la UI sa rendere", () => {
    const OK = new Set(["PASS", "NEEDS_WORK", "REJECT"]);
    for (const key of DEMO_PERSONA_KEYS) {
      for (const p of getDemoPositionsData(key, "it")) {
        if (p.critic_verdict == null) continue;
        expect(OK.has(p.critic_verdict), `${p.id} · ${p.critic_verdict}`).toBe(
          true,
        );
        expect(typeof p.critic_score).toBe("number");
      }
    }
  });
});

describe("demo seeds — localizzazione della voce degli agenti", () => {
  it("ogni seed con testo traducibile ha l'overlay in tutte e 6 le lingue", () => {
    // È il buco silenzioso da intercettare: aggiungo una posizione con le
    // note dello Scorer e mi dimentico dei 6 overlay → quella posizione resta
    // in italiano per chi guarda la demo in tedesco.
    const gaps: string[] = [];
    for (const key of DEMO_PERSONA_KEYS) {
      const seeds = RAW[key] as TranslatableSeed[];
      for (const locale of OVERLAY_LOCALES) {
        const covered = new Set(
          (DEMO_I18N[key]?.[locale] ?? []).map((o) => o.i),
        );
        seeds.forEach((s, i) => {
          if (hasTranslatableText(s) && !covered.has(i)) {
            gaps.push(`${key}/${locale} · indice ${i}`);
          }
        });
      }
    }
    expect(gaps, `overlay mancanti:\n${gaps.join("\n")}`).toEqual([]);
  });

  it("gli overlay non puntano a indici inesistenti né si ripetono", () => {
    for (const key of DEMO_PERSONA_KEYS) {
      const n = RAW[key].length;
      for (const locale of OVERLAY_LOCALES) {
        const idx = (DEMO_I18N[key]?.[locale] ?? []).map((o) => o.i);
        expect(new Set(idx).size, `${key}/${locale} · indici duplicati`).toBe(
          idx.length,
        );
        for (const i of idx) {
          expect(i, `${key}/${locale} · indice fuori range`).toBeLessThan(n);
          expect(i).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("l'overlay viene davvero applicato (en ≠ it dove c'è testo)", () => {
    for (const key of DEMO_PERSONA_KEYS) {
      const it = getDemoPositionsData(key, "it");
      const en = getDemoPositionsData(key, "en");
      const translated = it.filter((p, i) => {
        const a = p.demo_score_row?.notes ?? null;
        const b = en[i].demo_score_row?.notes ?? null;
        return a && b && a !== b;
      });
      expect(
        translated.length,
        `${key} · nessuna nota Scorer tradotta in EN`,
      ).toBeGreaterThan(0);
    }
  });

  it("tutte e 7 le lingue producono lo stesso numero di posizioni", () => {
    for (const key of DEMO_PERSONA_KEYS) {
      const counts = (["it", ...OVERLAY_LOCALES] as Locale[]).map(
        (l) => getDemoPositionsData(key, l).length,
      );
      expect(new Set(counts).size).toBe(1);
    }
  });
});
