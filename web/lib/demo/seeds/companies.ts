// [JHT-WEB-DEMO] Dossier azienda per la modalità demo.
//
// Perché esiste: fino al 2026-07-25 `demoPositionById` ritornava
// `company: null`, quindi la card azienda — logo, verdetto dell'Analista, sede,
// settore, dimensione, shippata il 22/07 — **non compariva mai** in demo. Chi
// valutava il prodotto dalla demo non vedeva una delle superfici principali.
//
// Come è costruito: **derivato**, non scritto a mano. Le aziende demo sono 108
// nomi inventati; inventare 108 dossier a mano avrebbe prodotto testo
// ripetitivo e un fronte di traduzione. Qui ogni campo viene calcolato in modo
// **deterministico** dai dati che il seed già porta (nome, città, famiglia di
// ruolo, score), così:
//   - la stessa azienda mostra sempre lo stesso dossier, in ogni pagina;
//   - non c'è una riga di prosa da localizzare — settore e dimensione sono
//     etichette in inglese come gli annunci (stessa regola del dataset), il
//     verdetto è già un'etichetta invariante del prodotto, sede e rating sono
//     dati.
//
// Cosa NON c'è, di proposito: `logo`. Un'azienda inventata non ha un logo, e
// inventarne uno sarebbe l'unica cosa davvero fuori posto in una demo
// dichiarata. La card lo rende opzionale (`{company.logo && …}`), quindi si
// compone comunque. Niente `culture_notes` e `red_flags`: sono voce
// dell'Analista, cioè prosa da tradurre in 7 lingue — se un giorno servono,
// vanno negli overlay i18n come le note dello Scorer.
import type { Company } from "@/lib/types";
import type { DemoPersonaKey } from "@/lib/demo/data";

// Hash stabile e piccolo: stessa stringa → stesso numero, su ogni macchina e
// build. (djb2 troncato: non serve qualità crittografica, serve stabilità.)
function stableHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

// Fasce di dimensione plausibili per aziende che assumono.
const SIZE_BUCKETS = ["11-50", "51-200", "201-500", "500-1000", "1000+"];

// Settore per persona: l'insieme da cui si pesca in modo deterministico. In
// inglese come i titoli e gli annunci — la regola del dataset è "annunci in
// inglese, voce degli agenti localizzata", e questi sono dati, non voce.
const SECTORS: Record<DemoPersonaKey, string[]> = {
  software: [
    "Cloud infrastructure",
    "B2B SaaS",
    "Fintech",
    "Developer tools",
    "E-commerce platform",
    "Healthtech",
    "Logistics tech",
    "Cybersecurity",
  ],
  marketing: [
    "Digital agency",
    "Consumer goods",
    "Retail & e-commerce",
    "Media & publishing",
    "Travel & hospitality",
    "Food & beverage",
    "Marketing SaaS",
    "Telecommunications",
  ],
  finance: [
    "Investment banking",
    "Asset management",
    "Insurance",
    "Corporate banking",
    "Private equity",
    "Payments",
    "Audit & advisory",
    "Real estate finance",
  ],
  design: [
    "Design studio",
    "Product design consultancy",
    "Consumer app",
    "Fashion & lifestyle",
    "Architecture & interiors",
    "Gaming & entertainment",
    "Design SaaS",
    "Advertising",
  ],
};

/** Ricava il verdetto dell'Analista dallo score, così card e punteggio concordano. */
function verdictFromScore(score: number | null): Company["verdict"] {
  if (score == null) return null; // non ancora analizzata: nessun verdetto
  if (score >= 75) return "GO";
  if (score >= 55) return "CAUTIOUS";
  return "NO_GO";
}

/** Rating Glassdoor plausibile e stabile: 3.3 – 4.7, un decimale. */
function ratingFor(name: string): number {
  return Math.round((3.3 + (stableHash(name) % 15) / 10) * 10) / 10;
}

/** Sito plausibile dal nome: "Northstar Labs" → northstarlabs.example. */
function websiteFor(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  // `.example` è il TLD riservato per la documentazione (RFC 2606): nessuno
  // rischia di finire sul sito di un'azienda reale che si chiama così.
  return `https://${slug}.example`;
}

export type DemoCompanyInput = {
  persona: DemoPersonaKey;
  name: string;
  /** Città + paese della posizione, se nota (es. "Berlin, Germany"). */
  location: string | null;
  /** Score della posizione, per allineare il verdetto a ciò che si vede. */
  score: number | null;
  /** Chi l'ha analizzata, per il campo analyzed_by della card. */
  analyzedBy?: string | null;
  analyzedAt?: string | null;
};

/**
 * Costruisce il dossier demo di un'azienda. Deterministico: stesso input →
 * stesso output, sempre.
 */
export function demoCompanyFor(input: DemoCompanyInput): Company {
  const { persona, name, location, score } = input;
  const h = stableHash(name);
  const sectors = SECTORS[persona];
  return {
    id: `demo-company-${persona}-${h % 100000}`,
    name,
    website: websiteFor(name),
    // Sede = dove sta la posizione: in demo l'azienda non ha una geografia
    // propria, e mostrare una sede in conflitto con la mappa sarebbe peggio
    // che non mostrarla. Full-remote senza sede → nessun HQ dichiarato.
    hq: location,
    sector: sectors[h % sectors.length],
    // `>>>` e non `>>`: lo shift aritmetico lavora su int32 *signed*, quindi
    // con un hash oltre 2^31 dava un indice negativo → `size: undefined`
    // (preso da un test, non da una rilettura).
    size: SIZE_BUCKETS[(h >>> 3) % SIZE_BUCKETS.length],
    glassdoor_rating: ratingFor(name),
    red_flags: null,
    culture_notes: null,
    analyzed_by: input.analyzedBy ?? "analista-1",
    analyzed_at: input.analyzedAt ?? null,
    verdict: verdictFromScore(score),
    // Un'azienda inventata non ha un logo: vedi il commento in testa al file.
    logo: null,
  };
}
