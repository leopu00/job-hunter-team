// Dati dimostrativi del globo in home page (vetrina pubblica).
//
// Stesso contratto dei pin veri (`PositionCoord`, vedi JobsGlobe) e
// stesso stile dei seed della modalità demo (lib/demo/seeds/*): titoli
// e aziende INVENTATI ma verosimili, presi in prestito dal roster di
// aziende fittizie dei seed. Le famiglie di ruolo coprono le quattro
// personas della demo (software, marketing, finance, design) con le
// loro sotto-famiglie: un visitatore deve capire che il prodotto non
// tratta solo "Software Engineer".
//
// Il dataset è volutamente piccolo (~35 posizioni) e vive in questo
// modulo client: niente import dei seed demo veri (~600 KB) nel bundle
// della landing. Le coordinate sono centro-città + un offset FISSO per
// posizione (uffici sparsi per la città, come i geocode reali): a zoom
// città i pin si separano invece di impilarsi in un fascio unico.
import type { PositionCoord } from "@/app/components/JobsGlobe";

type DemoCity = {
  city: string;
  country: string;
  cc: string;
  lat: number;
  lon: number;
};

// Una tappa del tour automatico: città + le sue posizioni. L'ordine
// dell'array è l'ordine di visita (est → ovest, asseconda la rotazione).
export type LandingTourStop = DemoCity & {
  positions: PositionCoord[];
};

let seq = 0;

// Costruisce un PositionCoord dimostrativo. dLat/dLon: offset fisso
// dal centro città (~1-4 km), deterministico → l'icona dei fasci è
// stabile fra render e la scena è identica per tutti i visitatori.
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
  city: DemoCity,
  positions: (c: DemoCity) => PositionCoord[],
): LandingTourStop {
  return { ...city, positions: positions(city) };
}

const MILANO: DemoCity = {
  city: "Milano",
  country: "Italy",
  cc: "IT",
  lat: 45.4642,
  lon: 9.19,
};
const BERLIN: DemoCity = {
  city: "Berlin",
  country: "Germany",
  cc: "DE",
  lat: 52.52,
  lon: 13.405,
};
const LONDON: DemoCity = {
  city: "London",
  country: "United Kingdom",
  cc: "GB",
  lat: 51.5074,
  lon: -0.1278,
};
const NEW_YORK: DemoCity = {
  city: "New York",
  country: "United States",
  cc: "US",
  lat: 40.7128,
  lon: -74.006,
};
const SAN_FRANCISCO: DemoCity = {
  city: "San Francisco",
  country: "United States",
  cc: "US",
  lat: 37.7749,
  lon: -122.4194,
};
const SAO_PAULO: DemoCity = {
  city: "São Paulo",
  country: "Brazil",
  cc: "BR",
  lat: -23.5505,
  lon: -46.6333,
};
const SINGAPORE: DemoCity = {
  city: "Singapore",
  country: "Singapore",
  cc: "SG",
  lat: 1.3521,
  lon: 103.8198,
};
const SYDNEY: DemoCity = {
  city: "Sydney",
  country: "Australia",
  cc: "AU",
  lat: -33.8688,
  lon: 151.2093,
};

// ── Tour: 8 città visitate dall'autopilota, 3 posizioni ciascuna ────
// Ogni tappa mescola famiglie diverse (tech, marketing, finance,
// design): la card della landing le elenca col punteggio.
export const LANDING_TOUR: LandingTourStop[] = [
  stop(SYDNEY, (c) => [
    pos(c, 0.014, -0.022, "QA Automation Engineer", "Fieldstone", "QA", 84),
    pos(
      c,
      -0.018,
      0.016,
      "Business Analyst",
      "Brightpeak Advisory",
      "Business Analysis",
      78,
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
  stop(SINGAPORE, (c) => [
    pos(c, 0.016, 0.02, "Treasury Analyst", "Anchorpoint", "Treasury", 86),
    pos(
      c,
      -0.012,
      -0.024,
      "Mobile Engineer, iOS",
      "Cedarwave",
      "Mobile",
      83,
      "full_remote",
    ),
    pos(
      c,
      0.004,
      -0.006,
      "CRM & Email Marketing Manager",
      "Farview",
      "CRM & Email",
      75,
      "hybrid",
    ),
  ]),
  stop(BERLIN, (c) => [
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
  stop(MILANO, (c) => [
    pos(
      c,
      0.016,
      -0.02,
      "Product Designer, Fintech App",
      "Glasswing",
      "Product Design",
      88,
      "hybrid",
    ),
    pos(
      c,
      -0.012,
      0.018,
      "Backend Engineer, Payments",
      "FinPilot",
      "Backend",
      84,
    ),
    pos(
      c,
      0.005,
      0.03,
      "Growth Marketing Manager",
      "Amberlane",
      "Growth",
      76,
      "hybrid",
    ),
  ]),
  stop(LONDON, (c) => [
    pos(c, 0.018, -0.026, "FP&A Analyst", "Cascade Finance", "FP&A", 87),
    pos(
      c,
      -0.012,
      0.02,
      "Frontend Engineer, Design Systems",
      "Foxglove Labs",
      "Design Systems",
      83,
      "hybrid",
    ),
    pos(
      c,
      0.006,
      0.032,
      "Brand Designer",
      "Clearcut Studio",
      "Brand & Graphic",
      71,
    ),
  ]),
  stop(SAO_PAULO, (c) => [
    pos(
      c,
      0.018,
      -0.024,
      "Full-stack Engineer, Marketplace",
      "Cargolane",
      "Full-stack",
      85,
    ),
    pos(
      c,
      -0.014,
      0.018,
      "Accounting Specialist",
      "Crestfield",
      "Accounting",
      77,
    ),
    pos(
      c,
      0.006,
      0.03,
      "Motion Designer",
      "Cinder Works",
      "Motion & Video",
      72,
      "hybrid",
    ),
  ]),
  stop(NEW_YORK, (c) => [
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
      0.016,
      "Risk & Audit Associate",
      "Alpine Risk Partners",
      "Risk & Audit",
      79,
    ),
    pos(
      c,
      0.006,
      0.028,
      "Content Strategist",
      "Bluewire",
      "Content",
      73,
      "hybrid",
    ),
  ]),
  stop(SAN_FRANCISCO, (c) => [
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
      "Performance Ads Specialist",
      "BrightAxis",
      "Performance Ads",
      70,
    ),
  ]),
];

// ── Città "ambiente": mai visitate, ma popolano il globo in rotazione ─
const AMBIENT: PositionCoord[] = [
  pos(
    {
      city: "Toronto",
      country: "Canada",
      cc: "CA",
      lat: 43.6532,
      lon: -79.3832,
    },
    0.01,
    -0.014,
    "Data Scientist, NLP",
    "Databay",
    "AI / ML",
    80,
  ),
  pos(
    {
      city: "Austin",
      country: "United States",
      cc: "US",
      lat: 30.2672,
      lon: -97.7431,
    },
    -0.012,
    0.016,
    "Site Reliability Engineer",
    "Fluxwave",
    "DevOps / Cloud",
    76,
  ),
  pos(
    { city: "Tokyo", country: "Japan", cc: "JP", lat: 35.6762, lon: 139.6503 },
    0.012,
    -0.018,
    "Backend Engineer, Go",
    "Driftline",
    "Backend",
    82,
  ),
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
      city: "Dubai",
      country: "United Arab Emirates",
      cc: "AE",
      lat: 25.2048,
      lon: 55.2708,
    },
    0.01,
    0.018,
    "Financial Controller",
    "Fernwood Analytics",
    "Accounting",
    71,
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
      city: "Stockholm",
      country: "Sweden",
      cc: "SE",
      lat: 59.3293,
      lon: 18.0686,
    },
    0.01,
    -0.016,
    "Product Designer, SaaS",
    "Ampersand Labs",
    "Product Design",
    79,
  ),
  pos(
    { city: "Warsaw", country: "Poland", cc: "PL", lat: 52.2297, lon: 21.0122 },
    -0.01,
    0.016,
    "M&A Analyst",
    "AtlasCare",
    "M&A / Deals",
    73,
  ),
  pos(
    {
      city: "Mexico City",
      country: "Mexico",
      cc: "MX",
      lat: 19.4326,
      lon: -99.1332,
    },
    0.012,
    0.014,
    "Marketing Automation Specialist",
    "AgencyOne",
    "CRM & Email",
    66,
  ),
  pos(
    {
      city: "Seoul",
      country: "South Korea",
      cc: "KR",
      lat: 37.5665,
      lon: 126.978,
    },
    -0.012,
    -0.016,
    "Frontend Engineer, Vue",
    "Cobalt Yard",
    "Frontend",
    77,
    "hybrid",
  ),
];

// Tutti i pin del globo (tappe + ambiente), nel contratto dei pin veri.
export const LANDING_GLOBE_POSITIONS: PositionCoord[] = [
  ...LANDING_TOUR.flatMap((s) => s.positions),
  ...AMBIENT,
];
