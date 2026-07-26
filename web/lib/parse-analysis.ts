// ── Parser del campo positions.notes ──────────────────────────────────
// L'Analista scrive l'analisi in un formato semi-strutturato che oggi la
// pagina dettaglio mostra come un unico blob di testo illeggibile. Esempio:
//
//   EXPERIENCE_REQUIRED: 7+ years
//   EXPERIENCE_TYPE: mandatory
//   DEGREE: not required
//   LANGUAGE_REQUIRED: English
//   SENIORITY_JD: senior
//   This is a strong adjacent role ... NOTE_MISMATCH: [STACK] the gap is ...
//   NOTE_MISMATCH: [GEO] Hybrid Dublin is EU-compatible but ...
//
// Le posizioni escluse iniziano con `EXCLUDED: [TAG] motivo...`.
// Le chiavi metadato esistono sia in EN (immagine recente) che in IT
// (run più vecchi: ESPERIENZA_RICHIESTA / ESPERIENZA_TIPO / LAUREA / LINGUA).
//
// Questo parser separa i tre livelli — metadato strutturato, marker
// di disallineamento/esclusione, prosa libera — così la UI può renderli
// in modo scansionabile. È puro (nessuna dipendenza): usabile lato server.

export type AnalysisMetaKey =
  | "experience_required"
  | "experience_type"
  | "degree"
  | "language_required"
  | "seniority_jd";

export interface AnalysisMeta {
  key: AnalysisMetaKey;
  value: string;
}

export interface AnalysisTagged {
  tag: string; // STACK | GEO | SENIORITY | SALARY | ... (uppercase, '' se assente)
  text: string;
}

export interface ParsedAnalysis {
  meta: AnalysisMeta[];
  excluded: AnalysisTagged | null;
  mismatches: AnalysisTagged[];
  prose: string;
  // true se il testo non conteneva alcun token strutturato: la UI mostra
  // il testo grezzo così com'è (retro-compatibilità con note libere).
  raw: boolean;
}

// Token sorgente (EN + IT) -> chiave canonica.
const META_ALIASES: Record<string, AnalysisMetaKey> = {
  EXPERIENCE_REQUIRED: "experience_required",
  ESPERIENZA_RICHIESTA: "experience_required",
  EXPERIENCE_TYPE: "experience_type",
  ESPERIENZA_TIPO: "experience_type",
  DEGREE: "degree",
  LAUREA: "degree",
  LANGUAGE_REQUIRED: "language_required",
  LINGUA: "language_required",
  SENIORITY_JD: "seniority_jd",
};

// Ordine di rendering stabile (indipendente dall'ordine nel testo).
const META_ORDER: AnalysisMetaKey[] = [
  "seniority_jd",
  "experience_required",
  "experience_type",
  "degree",
  "language_required",
];

const META_TOKENS = Object.keys(META_ALIASES);
// Alternanza di TUTTI i token noti: serve come "stop" per delimitare il
// testo (potenzialmente multi-frase) di un NOTE_MISMATCH/EXCLUDED.
const ALL_TOKENS = ["NOTE_MISMATCH", "EXCLUDED", ...META_TOKENS];
const STOP = `(?:\\n?\\s*(?:${ALL_TOKENS.join("|")})\\s*:)`;

const TAGGED_RE = new RegExp(
  `(NOTE_MISMATCH|EXCLUDED)\\s*:\\s*(?:\\[([^\\]]+)\\]\\s*)?([\\s\\S]*?)(?=${STOP}|$)`,
  "g",
);

const META_LINE_RE = new RegExp(
  `^\\s*(${META_TOKENS.join("|")})\\s*:\\s*(.+?)\\s*$`,
);

export function parseAnalysisNotes(
  notes: string | null | undefined,
): ParsedAnalysis {
  const empty: ParsedAnalysis = {
    meta: [],
    excluded: null,
    mismatches: [],
    prose: "",
    raw: true,
  };
  if (!notes || !notes.trim()) return empty;

  // Normalizza i newline. Oltre ai veri `\r\n`, converte le sequenze di
  // escape LETTERALI (`\n`, `\r\n`, `\t` come due caratteri backslash+lettera):
  // alcuni run hanno salvato le note con `\n` letterale perché il prompt
  // mostrava `--notes "...\n..."` dentro doppi apici bash (dove `\n` NON è un
  // a-capo). Senza questa conversione i metadati restano saldati su una riga
  // sola ("1 year\nEXPERIENCE_TYPE: ...") e il parser non li separa.
  const text = notes
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");

  // 1) Estrae EXCLUDED / NOTE_MISMATCH (anche inline a metà prosa) e li
  //    rimuove dal testo, sostituendoli con un newline per non saldare parole.
  let excluded: AnalysisTagged | null = null;
  const mismatches: AnalysisTagged[] = [];
  const stripped = text.replace(
    TAGGED_RE,
    (_m, kind: string, tag: string, body: string) => {
      const entry: AnalysisTagged = {
        tag: (tag ?? "").trim().toUpperCase(),
        text: body.trim(),
      };
      if (kind === "EXCLUDED") {
        // Tiene la prima (le successive sono rare); le altre diventano mismatch.
        if (!excluded) excluded = entry;
        else mismatches.push({ ...entry, tag: entry.tag || "EXCLUDED" });
      } else {
        mismatches.push(entry);
      }
      return "\n";
    },
  );

  // 2) Sul residuo, estrae le righe metadato `KEY: value`.
  const metaMap = new Map<AnalysisMetaKey, string>();
  const proseLines: string[] = [];
  for (const line of stripped.split("\n")) {
    const m = line.match(META_LINE_RE);
    if (m) {
      const key = META_ALIASES[m[1].toUpperCase()];
      // Prima occorrenza vince (l'Analista non duplica, ma è difensivo).
      if (key && !metaMap.has(key)) metaMap.set(key, m[2].trim());
    } else {
      proseLines.push(line);
    }
  }

  const meta: AnalysisMeta[] = META_ORDER.filter((k) => metaMap.has(k)).map(
    (k) => ({ key: k, value: metaMap.get(k)! }),
  );

  const prose = proseLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const structured =
    meta.length > 0 || excluded != null || mismatches.length > 0;
  return {
    meta,
    excluded,
    mismatches,
    prose,
    raw: !structured,
  };
}

// ── Parser del campo scores.breakdown ─────────────────────────────────
// Lo Scorer (RULE-09, 2026-07-23) scrive il "perché" di ogni dimensione
// dello score, una riga per chiave canonica:
//
//   STACK: quasi identico al profilo, manca solo Redux
//   REMOTE: ibrido 3 giorni, non full remote
//   ...
//
// Le chiavi sono EN canoniche (stabili cross-locale), il testo è nella
// lingua dell'utente e può proseguire su più righe fino alla chiave
// successiva. La UI mostra ogni voce sotto la barra corrispondente.
//
// LEGACY: prima della regola il campo conteneva altro — l'aritmetica dello
// score ("36+7+24+16+13=96, penalità -15 = 81") o un riepilogo in prosa
// ("0-100 formula: stack 32/35, experience 18/25 … Very strong credit fit:
// …"). Sono 611 record su 2745, e buttarli via significherebbe far sparire
// testo che l'utente vedeva. Quel che non è attribuibile a una dimensione
// finisce quindi in `rest`, che la pagina mostra sotto le barre insieme
// alle note: le posizioni vecchie restano leggibili, le nuove guadagnano
// il dettaglio espandibile. I due casi convivono anche nello stesso record
// (preambolo + chiavi).

export type ScoreDimensionKey =
  "stack" | "remote" | "salary" | "experience" | "strategic";

export interface ParsedScoreBreakdown {
  // Razionale per dimensione: alimenta il dropdown sotto ogni barra.
  perDimension: Partial<Record<ScoreDimensionKey, string>>;
  // Testo non attribuibile a una dimensione (formati legacy, preamboli).
  rest: string;
}

const BREAKDOWN_KEYS = [
  "STACK",
  "REMOTE",
  "SALARY",
  "EXPERIENCE",
  "STRATEGIC",
] as const;

const BREAKDOWN_RE = new RegExp(
  `(${BREAKDOWN_KEYS.join("|")})\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${BREAKDOWN_KEYS.join("|")})\\s*:|$)`,
  "g",
);

export function parseScoreBreakdown(
  breakdown: string | null | undefined,
): ParsedScoreBreakdown {
  const perDimension: Partial<Record<ScoreDimensionKey, string>> = {};
  if (!breakdown || !breakdown.trim()) return { perDimension, rest: "" };

  // Stessa normalizzazione di parseAnalysisNotes: alcuni run salvano `\n`
  // LETTERALE (backslash+n) invece del vero a-capo.
  const text = breakdown
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n");

  // Offset della prima chiave riconosciuta: tutto ciò che la precede è
  // preambolo (o, se non c'è nessuna chiave, l'intero campo legacy).
  let firstKeyAt = -1;
  for (const m of text.matchAll(BREAKDOWN_RE)) {
    if (firstKeyAt < 0) firstKeyAt = m.index ?? 0;
    const key = m[1].toLowerCase() as ScoreDimensionKey;
    const value = m[2].trim();
    // Prima occorrenza vince; ignora i placeholder vuoti ("...").
    if (value && value !== "..." && !(key in perDimension))
      perDimension[key] = value;
  }

  const rest = (firstKeyAt < 0 ? text : text.slice(0, firstKeyAt)).trim();
  return { perDimension, rest };
}

// Palette per il tag del disallineamento. Default neutro per tag ignoti.
export function tagColor(tag: string): string {
  switch (tag.toUpperCase()) {
    case "STACK":
      return "var(--color-purple)";
    case "GEO":
      return "var(--color-blue)";
    case "SENIORITY":
      return "var(--color-orange)";
    case "SALARY":
      return "var(--color-yellow)";
    case "LANGUAGE":
    case "LINGUA":
      return "var(--color-green)";
    default:
      return "var(--color-muted)";
  }
}
