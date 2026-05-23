// Aggregatore della distribuzione "Types" della dashboard.
//
// NIENTE classificazione qui dentro. La colonna `positions.role_family` (text)
// e' la fonte di verita': popolata dal team analyst o da una pipeline LLM,
// letta dal DB e raggruppata. Questo modulo offre solo:
//   - il tipo `RoleFamilyCount` consumato dalla UI
//   - `aggregateRoleFamilies()`: somma counts/score/critic per family
//   - `colorForFamily()`: colore deterministico HSL dal nome family (palette
//     non hardcoded — qualunque nuova family inventata dall'analista riceve
//     subito un colore distinto, senza modifiche al codice)
//
// Storia: prima qui c'era una lista di regex priority-list per dedurre la
// categoria dal title. Era hardcoded e tarata sui profili dev, dava 81%
// "Other" sui profili non-dev (technical writer/CAD/translator). Migrata
// a colonna DB + lettura data-driven il 2026-05-23. Roadmap per la pipeline
// LLM in `docs/internal/2026-05-23-position-classifier-llm-roadmap.md`.

export const UNCATEGORIZED_LABEL = "Da categorizzare";

export type RoleFamilyCount = {
  family: string; // valore della colonna positions.role_family (o UNCATEGORIZED_LABEL)
  count: number;
  color: string;
  // Media degli score (0-100) per le sole posizioni di questa family che hanno
  // uno score numerico. null se nessuna è stata scorata.
  avgScore: number | null;
  // Media del voto critico (0-10), null se nessuna è stata revisionata.
  avgCritic: number | null;
};

// Hash deterministico: stesso input → stesso colore. Output stabile tra
// reload, indipendente dall'ordine delle family in input.
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0; // forza a int32
  }
  return Math.abs(h);
}

export function colorForFamily(name: string): string {
  // "Other" e "Da categorizzare" tinta dimmed: stesso slot visivo del resto
  // ma de-enfatizzato, segnala che non e' una categoria semantica vera.
  if (!name || name === "Other" || name === UNCATEGORIZED_LABEL) {
    return "var(--color-dim)";
  }
  // HSL con saturazione/luminosita' calibrate sul tema scuro: tinte
  // sufficientemente distinte tra family senza spegnersi sullo sfondo
  // (--color-card e' ~#13161b).
  const hue = hashString(name) % 360;
  return `hsl(${hue}, 42%, 60%)`;
}

export function aggregateRoleFamilies(
  rows: Array<{
    role_family: string | null | undefined;
    score: number | null | undefined;
    critic: number | null | undefined;
  }>,
): RoleFamilyCount[] {
  const counts = new Map<string, number>();
  const scoreSum = new Map<string, number>();
  const scoreN = new Map<string, number>();
  const criticSum = new Map<string, number>();
  const criticN = new Map<string, number>();

  for (const r of rows) {
    const family = (r.role_family ?? "").trim() || UNCATEGORIZED_LABEL;
    counts.set(family, (counts.get(family) ?? 0) + 1);
    if (typeof r.score === "number" && Number.isFinite(r.score)) {
      scoreSum.set(family, (scoreSum.get(family) ?? 0) + r.score);
      scoreN.set(family, (scoreN.get(family) ?? 0) + 1);
    }
    if (typeof r.critic === "number" && Number.isFinite(r.critic)) {
      criticSum.set(family, (criticSum.get(family) ?? 0) + r.critic);
      criticN.set(family, (criticN.get(family) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([family, count]) => {
      const sN = scoreN.get(family) ?? 0;
      const cN = criticN.get(family) ?? 0;
      return {
        family,
        count,
        color: colorForFamily(family),
        avgScore: sN > 0 ? (scoreSum.get(family) ?? 0) / sN : null,
        avgCritic: cN > 0 ? (criticSum.get(family) ?? 0) / cN : null,
      };
    })
    .sort((a, b) => b.count - a.count);
}
