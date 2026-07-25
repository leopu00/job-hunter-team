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
// LLM in `docs/internal/roadmap/2026-05-23-position-classifier-llm-roadmap.md`.

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
  // Score grezzi (0-100) di tutte le posizioni di questo tipo che
  // hanno uno score numerico. Usato per filtrare la distribuzione
  // score per tipo (interazione donut → histogram in /map). Optional
  // per retro-compatibilità con sorgenti locali.
  scores?: number[];
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

// Etichetta del gruppo che raccoglie la coda lunga del donut. Non è una
// categoria del DB: nasce e muore nella UI.
export const OTHER_GROUP_LABEL = "__other__";

export type RoleFamilyGroup = RoleFamilyCount & {
  // role_family reali che questo spicchio rappresenta. Per un macro-gruppo
  // sono i suoi sotto-tipi ("Front Office / Reception", "…/ Supervision"),
  // per la coda lunga sono le famiglie sotto soglia. Il cross-filter
  // seleziona TUTTI i membri quando si clicca lo spicchio.
  members: string[];
};

// Le role_family scritte dagli agenti hanno già una gerarchia implicita nel
// nome, "Macro / Micro" (es. "F&B / Hostess"). Il donut aggrega sul primo
// livello — così F&B non si spezza in quattro spicchi da 3% — e manda sotto
// un'unica voce "Altre" tutto ciò che resta sotto `minShare`. Nessuna lista
// hardcoded: i gruppi emergono dai dati esattamente come le famiglie.
export function groupRoleFamilies(
  families: RoleFamilyCount[],
  minShare = 0.03,
  maxSlices = 10,
): RoleFamilyGroup[] {
  const total = families.reduce((a, f) => a + f.count, 0);
  if (total === 0) return [];

  const macroOf = (family: string) => {
    const head = family.split("/")[0]?.trim();
    return head && head.length > 0 ? head : family;
  };

  // 1) somma per macro-categoria, tenendo traccia dei membri e degli score
  //    grezzi (servono all'istogramma collegato).
  const byMacro = new Map<string, RoleFamilyGroup>();
  for (const f of families) {
    const macro = macroOf(f.family);
    const cur = byMacro.get(macro);
    if (!cur) {
      byMacro.set(macro, {
        family: macro,
        count: f.count,
        color: colorForFamily(macro),
        avgScore: f.avgScore,
        avgCritic: f.avgCritic,
        scores: [...(f.scores ?? [])],
        members: [f.family],
      });
      continue;
    }
    cur.scores = [...(cur.scores ?? []), ...(f.scores ?? [])];
    cur.members.push(f.family);
    cur.count += f.count;
  }

  // 2) le medie vanno ricalcolate sugli score del gruppo, non ereditate dal
  //    primo membro incontrato. Il voto critico non è disponibile qui per
  //    posizione, quindi resta quello del membro maggiore (best effort).
  //
  //    Il nome si accorcia al macro SOLO se quel macro raccoglie davvero più
  //    famiglie. Non ovunque la barra è una gerarchia: in un profilo finance
  //    "Infrastructure / Real Assets Investment" è una coppia di sinonimi, e
  //    troncarla a "Infrastructure" perderebbe senso senza aggregare niente.
  for (const g of byMacro.values()) {
    const s = g.scores ?? [];
    g.avgScore = s.length > 0 ? s.reduce((a, v) => a + v, 0) / s.length : null;
    if (g.members.length === 1) {
      g.family = g.members[0];
      g.color = colorForFamily(g.family);
    }
  }

  // 3) coda lunga → "Altre": sotto soglia, oppure oltre il tetto di spicchi
  //    (un profilo può avere tante categorie tutte legittime e sopra soglia,
  //    ma un donut con quindici fette non si legge). Un solo gruppo in coda
  //    non vale l'aggregazione: resta com'è.
  const groups = Array.from(byMacro.values()).sort((a, b) => b.count - a.count);
  const keep = groups.filter(
    (g, i) => g.count / total >= minShare && i < maxSlices - 1,
  );
  const tail = groups.filter((g) => !keep.includes(g));
  if (tail.length < 2) return groups;

  const head = keep;
  const other: RoleFamilyGroup = {
    family: OTHER_GROUP_LABEL,
    count: tail.reduce((a, g) => a + g.count, 0),
    color: "var(--color-dim)",
    avgScore: null,
    avgCritic: null,
    scores: tail.flatMap((g) => g.scores ?? []),
    members: tail.flatMap((g) => g.members),
  };
  const s = other.scores ?? [];
  other.avgScore =
    s.length > 0 ? s.reduce((a, v) => a + v, 0) / s.length : null;
  return [...head, other];
}

export function aggregateRoleFamilies(
  rows: Array<{
    role_family: string | null | undefined;
    score: number | null | undefined;
    critic: number | null | undefined;
  }>,
): RoleFamilyCount[] {
  // Mappe data-driven (dev2 refactor 2026-05-23): qualunque valore di
  // role_family scritto dal Analista LLM finisce qui senza modifiche
  // di codice. Il vecchio enum PositionType (master) è stato eliminato
  // perché dava 81% "Other" sui profili non-dev. dev1 components
  // (MapCharts, PositionTypesDonut) adattati a RoleFamilyCount.
  const counts = new Map<string, number>();
  const scoreSum = new Map<string, number>();
  const scoreN = new Map<string, number>();
  const criticSum = new Map<string, number>();
  const criticN = new Map<string, number>();
  const scoresByFamily = new Map<string, number[]>();

  for (const r of rows) {
    const family = (r.role_family ?? "").trim() || UNCATEGORIZED_LABEL;
    counts.set(family, (counts.get(family) ?? 0) + 1);
    if (typeof r.score === "number" && Number.isFinite(r.score)) {
      scoreSum.set(family, (scoreSum.get(family) ?? 0) + r.score);
      scoreN.set(family, (scoreN.get(family) ?? 0) + 1);
      const arr = scoresByFamily.get(family) ?? [];
      arr.push(r.score);
      scoresByFamily.set(family, arr);
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
        scores: scoresByFamily.get(family) ?? [],
      };
    })
    .sort((a, b) => b.count - a.count);
}
