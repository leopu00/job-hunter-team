// Colonne configurabili della tabella /positions.
//
// La preferenza vive in un COOKIE (non localStorage) perché la tabella è
// un server component: il server legge il cookie e renderizza solo le
// colonne scelte — niente flash di colonne che spariscono al mount e
// niente conversione client del tablone. Il picker (ColumnsPicker)
// scrive il cookie e fa router.refresh().

// Ordine fisso di render della tabella: il picker mostra e salva le
// colonne in quest'ordine, qualunque sia l'ordine dei click.
export const POSITIONS_COLUMNS = [
  "id",
  "last_action_at",
  "title",
  "company",
  "role_family",
  "loc_country",
  "loc_city",
  "remote",
  "score",
  "monthly",
  "source",
  "last_action_by",
  "critic",
  "status",
  "applied_at",
] as const;

export type PositionsColumnKey = (typeof POSITIONS_COLUMNS)[number];

// Larghezza MINIMA leggibile (px) per colonna. La tabella /positions usa
// `table-fixed` con un <colgroup> le cui larghezze sono percentuali
// PROPORZIONALI a questi minimi, e un `min-width` di tabella pari alla loro
// somma. Effetto:
//   • contenitore ≥ somma dei minimi → la tabella riempie il 100%: le colonne
//     crescono in proporzione (titolo/azienda si prendono lo spazio in più) e
//     il testo lungo viene troncato con l'ellissi → NIENTE scroll orizzontale;
//   • contenitore < somma (troppe colonne aggiunte) → il min-width forza la
//     tabella oltre il contenitore: ogni colonna resta al suo minimo leggibile
//     e compare lo scroll orizzontale (gestito da TableScrollSync).
// I valori tengono conto sia dell'header (label + freccia sort) sia del
// contenuto tipico della cella.
export const POSITIONS_COL_MIN_WIDTH: Record<PositionsColumnKey, number> = {
  id: 78,
  last_action_at: 122,
  title: 260,
  company: 190,
  role_family: 150,
  loc_country: 104,
  loc_city: 104,
  remote: 92,
  score: 124,
  monthly: 100,
  source: 108,
  last_action_by: 134,
  critic: 80,
  status: 104,
  // Data + ora, come `last_action_at`: la richiesta era l'orario ESATTO, non
  // un "2 giorni fa" che a colpo d'occhio non dice a quali si è già scritto.
  applied_at: 122,
};

// Default = le 6 colonne della tabella dashboard ("Le Migliori
// Posizioni") + le due più utili in una vista-elenco completa: stato
// pipeline e ultima attività.
export const DEFAULT_POSITIONS_COLUMNS: PositionsColumnKey[] = [
  "id",
  "last_action_at",
  "title",
  "company",
  "loc_country",
  "loc_city",
  "score",
  "status",
];

export const POSITIONS_COLS_COOKIE = "jht_positions_cols";

// Cookie → set di colonne visibili. Chiavi ignote (versioni vecchie,
// manomissioni) vengono scartate; il titolo è il link alla posizione e
// resta sempre visibile; cookie assente/vuoto → default.
export function parseColumnsCookie(
  raw: string | undefined,
): Set<PositionsColumnKey> {
  if (!raw) return new Set(DEFAULT_POSITIONS_COLUMNS);
  const valid = decodeURIComponent(raw)
    .split(",")
    .filter((k): k is PositionsColumnKey =>
      (POSITIONS_COLUMNS as readonly string[]).includes(k),
    );
  if (!valid.length) return new Set(DEFAULT_POSITIONS_COLUMNS);
  const set = new Set(valid);
  set.add("title");
  return set;
}
