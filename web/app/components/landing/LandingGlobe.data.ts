// Dati dimostrativi del globo in home page (vetrina pubblica).
//
// Stesso contratto dei pin veri (`PositionCoord`, vedi JobsGlobe) e
// stesso stile dei seed della modalità demo (lib/demo/seeds/*): titoli
// e aziende INVENTATI ma verosimili. Le famiglie di ruolo coprono le
// quattro personas della demo (software, marketing, finance, design)
// con le loro sotto-famiglie: un visitatore deve capire che il prodotto
// non tratta solo "Software Engineer".
//
// Il tour è un VIAGGIO PER CONTINENTI (scelta utente 30/07):
// Europa (capitali) → Americhe (grandi città) → Australia → Asia →
// Medio Oriente, poi da capo. L'ordine dell'array è l'ordine di visita
// ed è tracciato come un itinerario: tappe vicine dentro il continente,
// e il passaggio al continente successivo avviene sul confine più
// naturale (Madrid→New York sull'Atlantico, Buenos Aires→Sydney sul
// Pacifico, Perth→Singapore, Tokyo→Dubai, Tel Aviv→Roma).
//
// OGNI offerta ha la SUA coordinata, tutte distinte: in vetrina
// l'aggregazione paese/città di JobsGlobe è spenta e due offerte sullo
// stesso punto sembrerebbero un pin solo. Le coordinate sono
// centro-città + un offset FISSO per posizione (~1-4 km: uffici in
// quartieri diversi, come i geocode reali), deterministico → la scena è
// identica per tutti i visitatori.
import type { PositionCoord } from "@/app/components/JobsGlobe";

export type LandingContinentId =
  | "europe"
  | "america"
  | "australia"
  | "asia"
  | "middle_east";

type DemoCity = {
  city: string;
  country: string;
  cc: string;
  lat: number;
  lon: number;
};

// Una tappa del tour automatico: continente + città + le sue posizioni.
export type LandingTourStop = DemoCity & {
  continent: LandingContinentId;
  positions: PositionCoord[];
};

let seq = 0;

// Costruisce un PositionCoord dimostrativo. dLat/dLon: offset fisso
// dal centro città (~1-4 km) — MAI (0,0) e mai ripetuto dentro la
// stessa tappa, così nessun pin ne copre un altro.
function pos(
  city: DemoCity,
  dLat: number,
  dLon: number,
  title: string,
  company: string,
  family: string,
  score: number,
  remote: "onsite" | "hybrid" | "full_remote" = "onsite",
): PositionCoord {
  seq += 1;
  return {
    id: `landing-demo-${String(seq).padStart(3, "0")}`,
    title,
    company,
    status: "scored",
    role_family: family,
    score,
    lat: Number((city.lat + dLat).toFixed(4)),
    lon: Number((city.lon + dLon).toFixed(4)),
    is_remote: remote === "full_remote",
    remote_type: remote,
    location: `${city.city}, ${city.cc}`,
    loc_country: city.country,
    loc_city: city.city,
    office_address: null,
    created_at: null,
  };
}

function stop(
  continent: LandingContinentId,
  city: DemoCity,
  positions: (c: DemoCity) => PositionCoord[],
): LandingTourStop {
  return { ...city, continent, positions: positions(city) };
}

// ── Città del tour ──────────────────────────────────────────────────
// Europa: SOLO capitali (richiesta esplicita dell'utente).
const ROME: DemoCity = {
  city: "Rome",
  country: "Italy",
  cc: "IT",
  lat: 41.9028,
  lon: 12.4964,
};
const VIENNA: DemoCity = {
  city: "Vienna",
  country: "Austria",
  cc: "AT",
  lat: 48.2082,
  lon: 16.3738,
};
const BERLIN: DemoCity = {
  city: "Berlin",
  country: "Germany",
  cc: "DE",
  lat: 52.52,
  lon: 13.405,
};
const AMSTERDAM: DemoCity = {
  city: "Amsterdam",
  country: "Netherlands",
  cc: "NL",
  lat: 52.3676,
  lon: 4.9041,
};
const PARIS: DemoCity = {
  city: "Paris",
  country: "France",
  cc: "FR",
  lat: 48.8566,
  lon: 2.3522,
};
const MADRID: DemoCity = {
  city: "Madrid",
  country: "Spain",
  cc: "ES",
  lat: 40.4168,
  lon: -3.7038,
};
const NEW_YORK: DemoCity = {
  city: "New York",
  country: "United States",
  cc: "US",
  lat: 40.7128,
  lon: -74.006,
};
const TORONTO: DemoCity = {
  city: "Toronto",
  country: "Canada",
  cc: "CA",
  lat: 43.6532,
  lon: -79.3832,
};
const CHICAGO: DemoCity = {
  city: "Chicago",
  country: "United States",
  cc: "US",
  lat: 41.8781,
  lon: -87.6298,
};
const SAN_FRANCISCO: DemoCity = {
  city: "San Francisco",
  country: "United States",
  cc: "US",
  lat: 37.7749,
  lon: -122.4194,
};
const MEXICO_CITY: DemoCity = {
  city: "Mexico City",
  country: "Mexico",
  cc: "MX",
  lat: 19.4326,
  lon: -99.1332,
};
const SAO_PAULO: DemoCity = {
  city: "São Paulo",
  country: "Brazil",
  cc: "BR",
  lat: -23.5505,
  lon: -46.6333,
};
const BUENOS_AIRES: DemoCity = {
  city: "Buenos Aires",
  country: "Argentina",
  cc: "AR",
  lat: -34.6037,
  lon: -58.3816,
};
const SYDNEY: DemoCity = {
  city: "Sydney",
  country: "Australia",
  cc: "AU",
  lat: -33.8688,
  lon: 151.2093,
};
const MELBOURNE: DemoCity = {
  city: "Melbourne",
  country: "Australia",
  cc: "AU",
  lat: -37.8136,
  lon: 144.9631,
};
const PERTH: DemoCity = {
  city: "Perth",
  country: "Australia",
  cc: "AU",
  lat: -31.9505,
  lon: 115.8605,
};
const SINGAPORE: DemoCity = {
  city: "Singapore",
  country: "Singapore",
  cc: "SG",
  lat: 1.3521,
  lon: 103.8198,
};
const HONG_KONG: DemoCity = {
  city: "Hong Kong",
  country: "Hong Kong",
  cc: "HK",
  lat: 22.3193,
  lon: 114.1694,
};
const SHANGHAI: DemoCity = {
  city: "Shanghai",
  country: "China",
  cc: "CN",
  lat: 31.2304,
  lon: 121.4737,
};
const SEOUL: DemoCity = {
  city: "Seoul",
  country: "South Korea",
  cc: "KR",
  lat: 37.5665,
  lon: 126.978,
};
const TOKYO: DemoCity = {
  city: "Tokyo",
  country: "Japan",
  cc: "JP",
  lat: 35.6762,
  lon: 139.6503,
};
const DUBAI: DemoCity = {
  city: "Dubai",
  country: "United Arab Emirates",
  cc: "AE",
  lat: 25.2048,
  lon: 55.2708,
};
const DOHA: DemoCity = {
  city: "Doha",
  country: "Qatar",
  cc: "QA",
  lat: 25.2854,
  lon: 51.531,
};
const RIYADH: DemoCity = {
  city: "Riyadh",
  country: "Saudi Arabia",
  cc: "SA",
  lat: 24.7136,
  lon: 46.6753,
};
const TEL_AVIV: DemoCity = {
  city: "Tel Aviv",
  country: "Israel",
  cc: "IL",
  lat: 32.0853,
  lon: 34.7818,
};

// ── Tour: 25 tappe in 5 continenti, 2-3 posizioni ciascuna ──────────
// Ogni tappa mescola famiglie diverse (tech, marketing, finance,
// design): la card della landing le elenca col punteggio.
export const LANDING_TOUR: LandingTourStop[] = [
  // ── Europa (capitali), da sud-est verso ovest ────────────────────
  stop("europe", ROME, (c) => [
    pos(
      c,
      0.02,
      -0.026,
      "Backend Engineer, Public APIs",
      "Tiberline",
      "Backend",
      88,
    ),
    pos(
      c,
      -0.014,
      0.022,
      "Brand Designer",
      "Clearcut Studio",
      "Brand & Graphic",
      76,
      "hybrid",
    ),
    pos(c, 0.006, 0.034, "Payroll Specialist", "Crestfield", "Payroll", 69),
  ]),
  stop("europe", VIENNA, (c) => [
    pos(
      c,
      0.016,
      -0.024,
      "Data Analyst, Business Intelligence",
      "Databay",
      "Data",
      84,
    ),
    pos(
      c,
      -0.012,
      0.028,
      "CRM & Email Marketing Specialist",
      "Farview",
      "CRM & Email",
      72,
      "hybrid",
    ),
  ]),
  stop("europe", BERLIN, (c) => [
    pos(
      c,
      0.02,
      -0.028,
      "Machine Learning Engineer",
      "Databridge",
      "AI / ML",
      91,
      "hybrid",
    ),
    pos(
      c,
      -0.014,
      0.022,
      "DevOps Engineer, Kubernetes",
      "Cobalt Loop",
      "DevOps / Cloud",
      82,
    ),
    pos(
      c,
      0.008,
      0.034,
      "Product Marketing Lead",
      "Brightline",
      "Product Marketing",
      74,
    ),
  ]),
  stop("europe", AMSTERDAM, (c) => [
    pos(
      c,
      0.014,
      -0.03,
      "Product Designer, SaaS",
      "Ampersand Labs",
      "Product Design",
      86,
      "hybrid",
    ),
    pos(c, -0.016, 0.024, "Treasury Analyst", "Anchorpoint", "Treasury", 78),
  ]),
  stop("europe", PARIS, (c) => [
    pos(
      c,
      0.018,
      -0.026,
      "Frontend Engineer, Design Systems",
      "Foxglove Labs",
      "Design Systems",
      89,
      "hybrid",
    ),
    pos(c, -0.012, 0.02, "Growth Marketing Manager", "Amberlane", "Growth", 77),
    pos(c, 0.006, 0.036, "M&A Analyst", "Larkspur Capital", "M&A / Deals", 81),
  ]),
  stop("europe", MADRID, (c) => [
    pos(
      c,
      0.016,
      -0.028,
      "Mobile Engineer, Android",
      "Cinderpath",
      "Mobile",
      83,
    ),
    pos(
      c,
      -0.014,
      0.024,
      "Content Strategist",
      "Bluewire",
      "Content",
      70,
      "hybrid",
    ),
  ]),

  // ── Americhe (grandi città), nord → sud ──────────────────────────
  stop("america", NEW_YORK, (c) => [
    pos(
      c,
      0.02,
      -0.022,
      "Data Engineer, Analytics Platform",
      "Driftwood Analytics",
      "Data",
      90,
    ),
    pos(
      c,
      -0.014,
      0.018,
      "Risk & Audit Associate",
      "Alpine Risk Partners",
      "Risk & Audit",
      79,
    ),
    pos(
      c,
      0.006,
      0.03,
      "Motion Designer",
      "Cinder Works",
      "Motion & Video",
      73,
      "hybrid",
    ),
  ]),
  stop("america", TORONTO, (c) => [
    pos(c, 0.014, -0.026, "Data Scientist, NLP", "Databay", "AI / ML", 85),
    pos(
      c,
      -0.012,
      0.022,
      "Accounting Specialist",
      "Crestfield",
      "Accounting",
      71,
    ),
  ]),
  stop("america", CHICAGO, (c) => [
    pos(c, 0.018, -0.024, "QA Automation Engineer", "Fieldstone", "QA", 80),
    pos(
      c,
      -0.012,
      0.026,
      "Performance Ads Specialist",
      "BrightAxis",
      "Performance Ads",
      68,
    ),
  ]),
  stop("america", SAN_FRANCISCO, (c) => [
    pos(
      c,
      0.016,
      -0.024,
      "Senior Frontend Engineer, React",
      "Bramble Tech",
      "Frontend",
      93,
      "hybrid",
    ),
    pos(c, -0.012, 0.02, "UX Researcher", "Fernbridge", "UX Research", 81),
    pos(
      c,
      0.005,
      0.032,
      "Site Reliability Engineer",
      "Fluxwave",
      "DevOps / Cloud",
      76,
    ),
  ]),
  stop("america", MEXICO_CITY, (c) => [
    pos(
      c,
      0.016,
      -0.022,
      "Full-stack Engineer, Marketplace",
      "Cargolane",
      "Full-stack",
      82,
    ),
    pos(
      c,
      -0.012,
      0.024,
      "Marketing Automation Specialist",
      "AgencyOne",
      "CRM & Email",
      67,
    ),
  ]),
  stop("america", SAO_PAULO, (c) => [
    pos(
      c,
      0.018,
      -0.024,
      "Backend Engineer, Payments",
      "FinPilot",
      "Backend",
      87,
    ),
    pos(c, -0.014, 0.018, "FP&A Analyst", "Cascade Finance", "FP&A", 78),
    pos(
      c,
      0.006,
      0.032,
      "Social Media Manager",
      "Palmgrove",
      "Social",
      70,
      "hybrid",
    ),
  ]),
  stop("america", BUENOS_AIRES, (c) => [
    pos(
      c,
      0.014,
      -0.022,
      "Frontend Engineer, Vue",
      "Cobalt Yard",
      "Frontend",
      79,
      "full_remote",
    ),
    pos(
      c,
      -0.012,
      0.026,
      "Business Analyst",
      "Brightpeak Advisory",
      "Business Analysis",
      72,
    ),
  ]),

  // ── Australia, costa est → ovest ─────────────────────────────────
  stop("australia", SYDNEY, (c) => [
    pos(c, 0.014, -0.022, "Mobile Engineer, iOS", "Cedarwave", "Mobile", 84),
    pos(
      c,
      -0.018,
      0.016,
      "Financial Controller",
      "Fernwood Analytics",
      "Controlling",
      77,
    ),
    pos(
      c,
      0.006,
      0.03,
      "Sales Development Representative",
      "Cobblestone",
      "Sales",
      69,
      "hybrid",
    ),
  ]),
  stop("australia", MELBOURNE, (c) => [
    pos(c, 0.014, -0.024, "Data Engineer, Streaming", "Harborline", "Data", 81),
    pos(
      c,
      -0.012,
      0.02,
      "Content Designer",
      "Driftwave",
      "Content Design",
      75,
      "hybrid",
    ),
  ]),
  stop("australia", PERTH, (c) => [
    pos(
      c,
      0.014,
      -0.02,
      "DevOps Engineer, AWS",
      "Ironbark Systems",
      "DevOps / Cloud",
      74,
    ),
    pos(c, -0.012, 0.024, "Junior Accountant", "Quillstone", "Accounting", 66),
  ]),

  // ── Asia, risalendo la costa est ─────────────────────────────────
  stop("asia", SINGAPORE, (c) => [
    pos(c, 0.016, 0.02, "Treasury Analyst", "Anchorpoint", "Treasury", 86),
    pos(c, -0.012, -0.024, "Platform Engineer", "Cedarwave", "Backend", 85),
    pos(
      c,
      0.004,
      -0.006,
      "Regional Growth Lead",
      "Lanternway",
      "Growth",
      78,
      "hybrid",
    ),
  ]),
  stop("asia", HONG_KONG, (c) => [
    pos(
      c,
      0.014,
      -0.02,
      "Risk Analyst, Markets",
      "Alpine Risk Partners",
      "Risk & Audit",
      82,
    ),
    pos(
      c,
      -0.012,
      0.024,
      "Product Designer, Fintech App",
      "Glasswing",
      "Product Design",
      80,
      "hybrid",
    ),
  ]),
  stop("asia", SHANGHAI, (c) => [
    pos(
      c,
      0.016,
      -0.024,
      "Data Scientist, Forecasting",
      "Nimbus Metrics",
      "AI / ML",
      79,
    ),
    pos(
      c,
      -0.012,
      0.022,
      "Performance Ads Manager",
      "Quaywest",
      "Performance Ads",
      71,
    ),
  ]),
  stop("asia", SEOUL, (c) => [
    pos(
      c,
      0.014,
      -0.022,
      "Frontend Engineer, TypeScript",
      "Papermoon Labs",
      "Frontend",
      84,
    ),
    pos(
      c,
      -0.012,
      0.024,
      "Content Marketing Specialist",
      "Bluewire",
      "Content",
      69,
      "hybrid",
    ),
  ]),
  stop("asia", TOKYO, (c) => [
    pos(c, 0.014, -0.024, "Backend Engineer, Go", "Driftline", "Backend", 88),
    pos(
      c,
      -0.014,
      0.02,
      "Visual Designer",
      "Inkfeather",
      "Brand & Graphic",
      77,
    ),
    pos(
      c,
      0.005,
      0.032,
      "FP&A Senior Analyst",
      "Cascade Finance",
      "FP&A",
      80,
      "hybrid",
    ),
  ]),

  // ── Medio Oriente, dal Golfo verso il Mediterraneo ───────────────
  stop("middle_east", DUBAI, (c) => [
    pos(
      c,
      0.014,
      0.02,
      "Full-stack Engineer, Travel Platform",
      "Cargolane",
      "Full-stack",
      85,
    ),
    pos(c, -0.012, -0.022, "Treasury Manager", "Anchorpoint", "Treasury", 83),
    pos(
      c,
      0.005,
      0.034,
      "Lifecycle Marketing Manager",
      "Farview",
      "CRM & Email",
      76,
      "hybrid",
    ),
  ]),
  stop("middle_east", DOHA, (c) => [
    pos(
      c,
      0.014,
      -0.02,
      "Business Analyst, Operations",
      "Brightpeak Advisory",
      "Business Analysis",
      75,
    ),
    pos(
      c,
      -0.012,
      0.022,
      "Motion Designer",
      "Cinder Works",
      "Motion & Video",
      71,
      "hybrid",
    ),
  ]),
  stop("middle_east", RIYADH, (c) => [
    pos(
      c,
      0.014,
      -0.022,
      "DevOps Engineer, Azure",
      "Cobalt Loop",
      "DevOps / Cloud",
      77,
    ),
    pos(
      c,
      -0.012,
      0.024,
      "Senior Accountant",
      "Duneline Advisory",
      "Accounting",
      73,
    ),
  ]),
  stop("middle_east", TEL_AVIV, (c) => [
    pos(c, 0.014, -0.018, "Security Engineer", "Nightglass", "Security", 89),
    pos(
      c,
      -0.012,
      0.022,
      "Product Designer, Mobile",
      "Glasswing",
      "Product Design",
      82,
      "hybrid",
    ),
  ]),
];

// ── Città "ambiente": mai visitate, ma popolano il globo in rotazione ─
// Poche di proposito (il tour copre già mezzo mondo): riempiono i vuoti
// visivi — Africa, Oceania orientale, subcontinente indiano.
const AMBIENT: PositionCoord[] = [
  pos(
    {
      city: "Bangalore",
      country: "India",
      cc: "IN",
      lat: 12.9716,
      lon: 77.5946,
    },
    -0.01,
    0.014,
    "Android Engineer",
    "Cinderpath",
    "Mobile",
    74,
  ),
  pos(
    {
      city: "Cape Town",
      country: "South Africa",
      cc: "ZA",
      lat: -33.9249,
      lon: 18.4241,
    },
    -0.012,
    -0.014,
    "Content Designer",
    "Driftwave",
    "Content Design",
    68,
    "hybrid",
  ),
  pos(
    {
      city: "Nairobi",
      country: "Kenya",
      cc: "KE",
      lat: -1.2921,
      lon: 36.8219,
    },
    0.012,
    0.016,
    "Digital Marketing Specialist",
    "Kitewind",
    "Growth",
    67,
  ),
  pos(
    {
      city: "Auckland",
      country: "New Zealand",
      cc: "NZ",
      lat: -36.8509,
      lon: 174.7645,
    },
    0.01,
    -0.016,
    "QA Engineer, Mobile",
    "Fieldstone",
    "QA",
    70,
  ),
];

// Dataset per la vetrina. `lean` = profilo grafico ridotto (tier
// "medium" di map-perf): meno elementi da disegnare — si tengono le 2
// posizioni migliori per tappa e si lasciano a casa le città ambiente.
// Le tappe restituite sono le STESSE che pilotano la card: ciò che la
// card elenca coincide sempre con i pin davvero sul globo.
export function landingShowcaseData(lean: boolean): {
  tour: LandingTourStop[];
  positions: PositionCoord[];
} {
  const tour = lean
    ? LANDING_TOUR.map((s) => ({
        ...s,
        positions: [...s.positions]
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 2),
      }))
    : LANDING_TOUR;
  const positions = [
    ...tour.flatMap((s) => s.positions),
    ...(lean ? [] : AMBIENT),
  ];
  return { tour, positions };
}
