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
  "found_at",
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
  "written_at",
  "applied_at",
] as const;

export type PositionsColumnKey = (typeof POSITIONS_COLUMNS)[number];

// Chiave del dizionario che dà l'intestazione di ogni colonna. Serve a
// calcolare le larghezze minime dalla traduzione PIÙ LUNGA (O-39): senza
// questa mappa il legame colonna → etichetta esiste solo dentro il JSX di
// `page.tsx`, dove un test non può leggerlo. `null` = intestazione letterale
// non tradotta (l'ID è "ID" in tutte le lingue).
// Il test `positions-column-widths` verifica che `page.tsx` usi davvero
// queste chiavi, così un rename non lascia la mappa a mentire.
export const POSITIONS_COL_LABEL_KEY: Record<
  PositionsColumnKey,
  string | null
> = {
  id: null,
  last_action_at: "col_updated",
  found_at: "col_found_at",
  title: "col_title",
  company: "col_company",
  role_family: "col_category",
  loc_country: "col_country",
  loc_city: "col_city",
  remote: "col_remote",
  score: "col_score",
  monthly: "col_monthly",
  source: "col_source",
  last_action_by: "col_updated_by",
  critic: "col_voto",
  status: "col_status",
  written_at: "col_written_at",
  applied_at: "col_applied_at",
};

// Allineamento di UNA colonna: vale per l'intestazione E per le celle.
//
// ⚠️ Perché una mappa e non due classi scritte a mano nel JSX: fino a O-40
// l'allineamento dell'header stava in un flag (`center: true`) dentro
// l'array delle intestazioni, e quello delle celle in una classe Tailwind
// scritta riga per riga trecento righe più sotto. Le due liste si sono
// separate: «LORDO/MESE» era intestazione a sinistra sopra numeri allineati
// a destra (34px di scarto, e cresce con la colonna), e lo SCORE aveva
// l'etichetta centrata sulla colonna mentre il numero — l'unica cosa che si
// legge — restava 28px più a sinistra, perché a essere centrato era il
// gruppo numero+barra. Misurato nel browser, non dedotto.
//
// Con una mappa sola l'etichetta non può più scollarsi dal suo dato: header
// e cella leggono la stessa voce, e `positions-column-alignment.test.ts`
// fallisce se qualcuno torna a scrivere l'allineamento a mano nel JSX.
export type PositionsColumnAlign = "left" | "center" | "right";

export const POSITIONS_COL_ALIGN: Record<
  PositionsColumnKey,
  PositionsColumnAlign
> = {
  id: "left",
  last_action_at: "left",
  found_at: "left",
  title: "left",
  company: "left",
  role_family: "left",
  loc_country: "left",
  loc_city: "left",
  remote: "left",
  // A sinistra, non al centro: la cella è numero + barra, e centrare il
  // GRUPPO sposta il numero fuori dall'etichetta. Ancorati a sinistra,
  // "SCORE" sta esattamente sopra il punteggio a ogni larghezza e in tutte
  // e sette le lingue; la barra lo segue.
  score: "left",
  // Importi: si leggono incolonnati a destra, e l'intestazione ci va sopra.
  monthly: "right",
  source: "left",
  last_action_by: "center",
  critic: "center",
  status: "center",
  written_at: "center",
  applied_at: "center",
};

const TEXT_ALIGN_CLASS: Record<PositionsColumnAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const FLEX_ALIGN_CLASS: Record<PositionsColumnAlign, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
};

/** Classe di allineamento per l'intestazione e per la cella: la stessa. */
export function columnAlignClass(col: PositionsColumnKey): string {
  return TEXT_ALIGN_CLASS[POSITIONS_COL_ALIGN[col]];
}

/** Come sopra, per le celle il cui contenuto è una riga flex (es. lo score). */
export function columnFlexAlignClass(col: PositionsColumnKey): string {
  return FLEX_ALIGN_CLASS[POSITIONS_COL_ALIGN[col]];
}

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
//
// ⚠️ O-39 — L'INTESTAZIONE VA MISURATA IN TUTTE E SETTE LE LINGUE, non in
// italiano. Il tedesco e l'ungherese sono quasi sempre più lunghi: SEI
// colonne su diciassette uscivano troncate, e nessuna delle sei si vedeva
// dalla versione italiana ("VOTO FINALE" sta in 80px, "KRITIKUS PONTSZÁM"
// ne chiede 171). Chi guarda solo la propria lingua non trova il difetto:
// è così che sono passati i due troncamenti scoperti a schermo in O-34.
//
// La soglia sotto la quale una label si tronca è
//   HEADER_MIN_WIDTH(label) = 32 (padding cella) + 16 (freccia + gap)
//                             + 7.2 px × caratteri
// misurata nel browser il 2026-08-10 su tutte le 7 lingue × 17 colonne (238
// campioni, JetBrains Mono 9.5px uppercase, tracking 0.15em) e arrotondata
// per eccesso: nessun campione la supera. Vive in `header-width.ts` ed è
// verificata da `tests/js/tasks/positions-column-widths.test.ts`, che
// ricalcola i minimi dal DIZIONARIO — così una traduzione nuova o più lunga
// fa fallire il test invece di arrivare tagliata in produzione.
// Se cambia il font o la dimensione dell'header, quei numeri vanno rimisurati.
export const POSITIONS_COL_MIN_WIDTH: Record<PositionsColumnKey, number> = {
  id: 78,
  // "AKTUALISIERT" (de) chiede 135.
  last_action_at: 135,
  // Quando lo Scout l'ha trovata. Ordinata crescente dice quali sono ferme
  // in coda da più tempo — la domanda che si fa filtrando per stato.
  found_at: 122,
  title: 260,
  company: 190,
  role_family: 150,
  loc_country: 104,
  loc_city: 104,
  // "MODALIDADE" (pt) chiede 120: era 92.
  remote: 120,
  score: 124,
  // "BRUTTO/MON." (de) chiede 128: era 100, ed è il troncamento di O-39.
  monthly: 128,
  source: 108,
  // "AKTUALISIERT VON" (de) chiede 164.
  last_action_by: 164,
  // "KRITIKUS PONTSZÁM" (hu) chiede 171. È il salto più grosso — la colonna
  // mostra un numero di tre caratteri e la larghezza la detta l'etichetta.
  critic: 171,
  // Stato e indicatore ticket sono due segnali distinti, impilati.
  status: 170,
  // Quando lo Scrittore ha prodotto il CV. Accanto ad `applied_at` racconta
  // la coda: scritto il 3, ancora non inviato.
  // 178 e non 122 come le altre date: "ÖNÉLETRAJZ MEGÍRVA" (hu) è
  // l'intestazione più lunga della tabella. In italiano bastavano 168 — la
  // prova che O-34 aveva guardato una lingua sola.
  written_at: 178,
  // Data + ora, come `last_action_at`: la richiesta era l'orario ESATTO, non
  // un "2 giorni fa" che a colpo d'occhio non dice a quali si è già scritto.
  // 150 e non 122: con le colonne di O-34 accese la tabella arriva ai minimi
  // e a 122 l'intestazione "CANDIDATURA" usciva tagliata.
  applied_at: 150,
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
