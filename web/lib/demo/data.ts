// [JHT-WEB-DEMO] Dataset statico per la modalità demo dell'area riservata
// cloud (onboarding utenti nuovi, 22/07). Quattro "personas" — una per
// categoria di lavoro scelta nel wizard /welcome — ognuna con 56 posizioni
// complete di tutti i campi consumati da dashboard, /positions (lista +
// dettaglio), /map (globo + tree località) e /swipe. Nessuna riga tocca il
// database: i dati vivono qui e le query li servono quando il cookie
// jht_demo_persona è attivo (vedi lib/demo/mode.ts + hook in lib/queries.ts).
// Gli annunci sono volutamente in inglese (come gli annunci reali); l'UI
// intorno resta localizzata.
import type {
  Position,
  PositionHighlight,
  PositionStatus,
  Score,
} from "@/lib/types";
import type { Locale } from "@/i18n/config";
import { SOFTWARE } from "./seeds/software";
import { MARKETING } from "./seeds/marketing";
import { FINANCE } from "./seeds/finance";
import { DESIGN } from "./seeds/design";
import { DEMO_I18N } from "./seeds/i18n";

export type DemoPersonaKey = "software" | "marketing" | "finance" | "design";

export const DEMO_PERSONA_KEYS: DemoPersonaKey[] = [
  "software",
  "marketing",
  "finance",
  "design",
];

export function isDemoPersonaKey(v: unknown): v is DemoPersonaKey {
  return (
    typeof v === "string" && DEMO_PERSONA_KEYS.includes(v as DemoPersonaKey)
  );
}

// Riconoscimento id demo nelle API route: le posizioni demo hanno id
// "demo-<persona>-NNN" e legacy_id nel range 9000-9399.
export function isDemoPositionId(id: string): boolean {
  return id.startsWith("demo-");
}
export function isDemoLegacyId(legacyId: number | string): boolean {
  const n = typeof legacyId === "string" ? Number(legacyId) : legacyId;
  return Number.isFinite(n) && n >= 9000 && n < 9400;
}

type City = {
  city: string;
  country: string;
  cc: string;
  lat: number;
  lon: number;
};

const CITIES = {
  milano: {
    city: "Milano",
    country: "Italy",
    cc: "IT",
    lat: 45.4642,
    lon: 9.19,
  },
  roma: {
    city: "Roma",
    country: "Italy",
    cc: "IT",
    lat: 41.9028,
    lon: 12.4964,
  },
  torino: {
    city: "Torino",
    country: "Italy",
    cc: "IT",
    lat: 45.0703,
    lon: 7.6869,
  },
  bologna: {
    city: "Bologna",
    country: "Italy",
    cc: "IT",
    lat: 44.4949,
    lon: 11.3426,
  },
  firenze: {
    city: "Firenze",
    country: "Italy",
    cc: "IT",
    lat: 43.7696,
    lon: 11.2558,
  },
  berlin: {
    city: "Berlin",
    country: "Germany",
    cc: "DE",
    lat: 52.52,
    lon: 13.405,
  },
  munich: {
    city: "Munich",
    country: "Germany",
    cc: "DE",
    lat: 48.1351,
    lon: 11.582,
  },
  hamburg: {
    city: "Hamburg",
    country: "Germany",
    cc: "DE",
    lat: 53.5511,
    lon: 9.9937,
  },
  amsterdam: {
    city: "Amsterdam",
    country: "Netherlands",
    cc: "NL",
    lat: 52.3676,
    lon: 4.9041,
  },
  paris: {
    city: "Paris",
    country: "France",
    cc: "FR",
    lat: 48.8566,
    lon: 2.3522,
  },
  barcelona: {
    city: "Barcelona",
    country: "Spain",
    cc: "ES",
    lat: 41.3874,
    lon: 2.1686,
  },
  madrid: {
    city: "Madrid",
    country: "Spain",
    cc: "ES",
    lat: 40.4168,
    lon: -3.7038,
  },
  london: {
    city: "London",
    country: "United Kingdom",
    cc: "GB",
    lat: 51.5074,
    lon: -0.1278,
  },
  dublin: {
    city: "Dublin",
    country: "Ireland",
    cc: "IE",
    lat: 53.3498,
    lon: -6.2603,
  },
  zurich: {
    city: "Zurich",
    country: "Switzerland",
    cc: "CH",
    lat: 47.3769,
    lon: 8.5417,
  },
  vienna: {
    city: "Vienna",
    country: "Austria",
    cc: "AT",
    lat: 48.2082,
    lon: 16.3738,
  },
  lisbon: {
    city: "Lisbon",
    country: "Portugal",
    cc: "PT",
    lat: 38.7223,
    lon: -9.1393,
  },
  copenhagen: {
    city: "Copenhagen",
    country: "Denmark",
    cc: "DK",
    lat: 55.6761,
    lon: 12.5683,
  },
  stockholm: {
    city: "Stockholm",
    country: "Sweden",
    cc: "SE",
    lat: 59.3293,
    lon: 18.0686,
  },
  prague: {
    city: "Prague",
    country: "Czechia",
    cc: "CZ",
    lat: 50.0755,
    lon: 14.4378,
  },
  lyon: {
    city: "Lyon",
    country: "France",
    cc: "FR",
    lat: 45.764,
    lon: 4.8357,
  },
  rotterdam: {
    city: "Rotterdam",
    country: "Netherlands",
    cc: "NL",
    lat: 51.9244,
    lon: 4.4777,
  },
  frankfurt: {
    city: "Frankfurt",
    country: "Germany",
    cc: "DE",
    lat: 50.1109,
    lon: 8.6821,
  },
  cologne: {
    city: "Cologne",
    country: "Germany",
    cc: "DE",
    lat: 50.9375,
    lon: 6.9603,
  },
  warsaw: {
    city: "Warsaw",
    country: "Poland",
    cc: "PL",
    lat: 52.2297,
    lon: 21.0122,
  },
  krakow: {
    city: "Krakow",
    country: "Poland",
    cc: "PL",
    lat: 50.0647,
    lon: 19.945,
  },
  budapest: {
    city: "Budapest",
    country: "Hungary",
    cc: "HU",
    lat: 47.4979,
    lon: 19.0402,
  },
  oslo: {
    city: "Oslo",
    country: "Norway",
    cc: "NO",
    lat: 59.9139,
    lon: 10.7522,
  },
  helsinki: {
    city: "Helsinki",
    country: "Finland",
    cc: "FI",
    lat: 60.1699,
    lon: 24.9384,
  },
  valencia: {
    city: "Valencia",
    country: "Spain",
    cc: "ES",
    lat: 39.4699,
    lon: -0.3763,
  },
  porto: {
    city: "Porto",
    country: "Portugal",
    cc: "PT",
    lat: 41.1579,
    lon: -8.6291,
  },
  tallinn: {
    city: "Tallinn",
    country: "Estonia",
    cc: "EE",
    lat: 59.437,
    lon: 24.7536,
  },
} satisfies Record<string, City>;

type CityKey = keyof typeof CITIES;

export type Seed = {
  title: string;
  company: string;
  // assente = remote puro senza sede; "napoli_x" = città senza coordinate
  // note → entrambe finiscono nel bucket "senza coordinate" della mappa.
  city?: CityKey | "napoli_x";
  remote: NonNullable<Position["remote_type"]>;
  sal?: [number, number, string];
  source: string;
  status: PositionStatus;
  score?: number;
  family: string;
  h: number; // trovata N ore fa
  wr?: boolean; // write_requested (selezionata per il CV)
  critic?: [number, "PASS" | "NEEDS_WORK" | "REJECT"];
  jd?: string; // jd_summary (sintesi dell'Analista)
  jdFull?: string; // jd_text (annuncio originale integrale)
  req?: string[];
  pros?: string[];
  cons?: string[];
  // Analisi dell'Analista nel formato semi-strutturato di parse-analysis.ts
  // (SENIORITY_JD:/EXPERIENCE_REQUIRED:/... + prosa + NOTE_MISMATCH/EXCLUDED).
  notes?: string;
  scoreNotes?: string; // nota dello Scorer (Score.notes)
  criticNotes?: string; // feedback del Critico (Application.critic_notes)
  addr?: string; // office_address (con civico: il dettaglio lo mostra se contiene cifre)
};

// Overlay di traduzione della "voce degli agenti" (notes/scoreNotes/
// criticNotes/pros/cons): la base nei seed è in italiano, gli overlay in
// seeds/i18n/<persona>.<locale>.ts la sostituiscono per le altre lingue.
// Annunci (title/jd/jdFull/req) restano in inglese per tutte le lingue,
// come gli annunci reali.
export type SeedI18nOverlay = {
  i: number; // indice della posizione nell'array seed della persona
  notes?: string;
  scoreNotes?: string;
  criticNotes?: string;
  pros?: string[];
  cons?: string[];
};

function applyOverlay(s: Seed, o: SeedI18nOverlay): Seed {
  return {
    ...s,
    ...(o.notes != null ? { notes: o.notes } : null),
    ...(o.scoreNotes != null ? { scoreNotes: o.scoreNotes } : null),
    ...(o.criticNotes != null ? { criticNotes: o.criticNotes } : null),
    ...(o.pros != null ? { pros: o.pros } : null),
    ...(o.cons != null ? { cons: o.cons } : null),
  };
}

// ── Seed per persona ────────────────────────────────────────────────
// I seed vivono in ./seeds/<persona>.ts (56 posizioni ciascuno, generati
// dal run di arricchimento del 23/07 su pattern dei dati reali).
// Distribuzione status per persona: 7 new, 7 checked, 17 scored, 4 writing,
// 4 review, 8 ready, 4 applied, 2 response, 3 excluded — ogni box della
// pipeline e ogni grafico ha dati.
// "napoli_x" = città volutamente NON presente in CITIES: quelle posizioni
// finiscono nel bucket "senza coordinate" della mappa (widget "+N"), così
// anche quella parte della UI è dimostrabile.
const SEEDS: Record<DemoPersonaKey, Seed[]> = {
  software: SOFTWARE,
  marketing: MARKETING,
  finance: FINANCE,
  design: DESIGN,
};

const LEGACY_BASE: Record<DemoPersonaKey, number> = {
  software: 9000,
  marketing: 9100,
  finance: 9200,
  design: 9300,
};

// ── Espansione seed → entità complete ──────────────────────────────

export type DemoPosition = Position & {
  score: number | null;
  critic_score: number | null;
  critic_verdict: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  lat: number | null;
  lon: number | null;
  last_action_at: string;
  last_action_by: string;
  last_action_actor: string;
  demo_score_row: Score | null;
  demo_highlights: PositionHighlight[];
  demo_critic_notes: string | null;
};

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

// Deriva un sub-score plausibile dal totale, deterministico per posizione.
function sub(total: number, salt: number, n: number): number {
  const jitter = ((salt * 7 + n * 13) % 11) - 5;
  return Math.max(10, Math.min(100, total + jitter));
}

const STATUS_RANK: Record<string, number> = {
  new: 0,
  checked: 1,
  scored: 2,
  writing: 3,
  review: 4,
  ready: 5,
  applied: 6,
  response: 7,
  excluded: 2,
};

function expand(
  key: DemoPersonaKey,
  seeds: Seed[],
  locale: Locale,
): DemoPosition[] {
  const base = LEGACY_BASE[key];
  const ov = locale === "it" ? undefined : DEMO_I18N[key]?.[locale];
  const ovMap = ov ? new Map(ov.map((o) => [o.i, o])) : undefined;
  return seeds.map((raw, i) => {
    const s = ovMap?.has(i) ? applyOverlay(raw, ovMap.get(i)!) : raw;
    const n = i + 1;
    const legacy = base + n;
    const id = `demo-${key}-${String(n).padStart(3, "0")}`;
    const city: City | null =
      s.city && s.city in CITIES ? CITIES[s.city as CityKey] : null;
    const cityName = city?.city ?? (s.city ? "Napoli" : null);
    const country = city?.country ?? (s.city ? "Italy" : null);
    const cc = city?.cc ?? (s.city ? "IT" : null);
    const rank = STATUS_RANK[s.status] ?? 0;
    const found = hoursAgo(s.h);
    // Ultima azione: più lo status è avanti nella pipeline, più recente
    // dell'arrivo. Attore coerente con lo stadio.
    const lastAt = hoursAgo(Math.max(1, s.h - rank * Math.min(8, s.h / 8)));
    const actorByRank = [
      "scout",
      "analista",
      "scorer",
      "scrittore",
      "critico",
      "critico",
      "user",
      "user",
    ];
    const by = actorByRank[Math.min(rank, actorByRank.length - 1)];
    const scoredAt = s.score != null ? hoursAgo(Math.max(1, s.h - 6)) : null;
    const scoreRow: Score | null =
      s.score != null
        ? {
            id: `demo-score-${key}-${n}`,
            position_id: id,
            total_score: s.score,
            stack_match: sub(s.score, legacy, 1),
            remote_fit: sub(s.score, legacy, 2),
            salary_fit: sub(s.score, legacy, 3),
            experience_fit: sub(s.score, legacy, 4),
            strategic_fit: sub(s.score, legacy, 5),
            breakdown: null,
            notes: s.scoreNotes ?? null,
            scored_by: `scorer-${(legacy % 2) + 1}`,
            scored_at: scoredAt ?? found,
          }
        : null;
    const highlights: PositionHighlight[] = [
      ...(s.pros ?? []).map((text, j) => ({
        id: `demo-hl-${key}-${n}-p${j}`,
        position_id: id,
        type: "pro" as const,
        text,
      })),
      ...(s.cons ?? []).map((text, j) => ({
        id: `demo-hl-${key}-${n}-c${j}`,
        position_id: id,
        type: "con" as const,
        text,
      })),
    ];
    return {
      id,
      legacy_id: legacy,
      title: s.title,
      company: s.company,
      company_id: null,
      location: cityName
        ? `${cityName}, ${cc}`
        : s.remote === "full_remote"
          ? "Remote"
          : null,
      remote_type: s.remote,
      salary_declared_min: s.sal?.[0] ?? null,
      salary_declared_max: s.sal?.[1] ?? null,
      salary_declared_currency: s.sal?.[2] ?? null,
      salary_estimated_min: null,
      salary_estimated_max: null,
      salary_estimated_currency: null,
      salary_estimated_source: null,
      url: `https://example.com/demo-jobs/${legacy}`,
      source: s.source,
      jd_text: s.jdFull ?? null,
      jd_summary: s.jd ?? null,
      requirements: s.req ? s.req.map((r) => `- ${r}`).join("\n") : null,
      found_by: `scout-${(legacy % 3) + 1}`,
      found_at: found,
      deadline: null,
      status: s.status,
      notes: s.notes ?? null,
      last_checked: rank >= 1 ? hoursAgo(Math.max(1, s.h - 3)) : null,
      is_open: true,
      role_family: s.family,
      loc_country: country,
      loc_city: cityName,
      loc_country_code: cc,
      write_requested: !!s.wr || rank >= 3,
      office_lat: city?.lat ?? null,
      office_lon: city?.lon ?? null,
      office_address: s.addr ?? null,
      score: s.score ?? null,
      critic_score: s.critic?.[0] ?? null,
      critic_verdict: s.critic?.[1] ?? null,
      salary_min: s.sal?.[0] ?? null,
      salary_max: s.sal?.[1] ?? null,
      salary_currency: s.sal?.[2] ?? "EUR",
      lat: city?.lat ?? null,
      lon: city?.lon ?? null,
      last_action_at: lastAt,
      last_action_by: by,
      last_action_actor: by === "scout" ? `scout-${(legacy % 3) + 1}` : by,
      demo_score_row: scoreRow,
      demo_highlights: highlights,
      demo_critic_notes: s.criticNotes ?? null,
    };
  });
}

const cache = new Map<string, DemoPosition[]>();

export function getDemoPositionsData(
  key: DemoPersonaKey,
  locale: Locale = "it",
): DemoPosition[] {
  const ck = `${key}:${locale}`;
  let v = cache.get(ck);
  if (!v) {
    v = expand(key, SEEDS[key], locale);
    cache.set(ck, v);
  }
  return v;
}

export function findDemoPositionById(id: string): DemoPosition | null {
  for (const key of DEMO_PERSONA_KEYS) {
    const hit = getDemoPositionsData(key).find((p) => p.id === id);
    if (hit) return hit;
  }
  return null;
}

export function findDemoPositionByLegacyId(
  legacyId: number,
): DemoPosition | null {
  for (const key of DEMO_PERSONA_KEYS) {
    const hit = getDemoPositionsData(key).find((p) => p.legacy_id === legacyId);
    if (hit) return hit;
  }
  return null;
}
