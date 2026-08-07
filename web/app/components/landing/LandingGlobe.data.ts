// Città e opportunità mostrate dal globo della home pubblica.
//
// Ogni tappa è una città con da 3 a 5 opportunità, e i ruoli sono scelti
// sul CARATTERE REALE di quella città: a Roma archeologia e restauro, a
// Vienna meccanica e ferrovia, a New York gallerie d'arte e aste, a
// Monaco ospitalità di lusso e yacht, a Perth miniere ed energia. Il
// mestiere del prodotto non è cercare sviluppatori: è cercare il lavoro
// di chi lo usa, quindi il globo deve mostrare mestieri diversi e livelli
// diversi — dal primo impiego alla direzione.
//
// Il numero di pin per città non è fisso: si alterna 3 → 4 → 4 → 5 lungo
// il giro, così nessuna tappa somiglia alla precedente.
//
// I titoli e i settori NON stanno qui: stanno in `LandingGlobe.roles.i18n.ts`
// tradotti in tutte e sette le lingue, e vengono risolti al momento in cui
// il dataset viene costruito (la lingua arriva dal selettore della nav).
//
// Le coordinate dei pin sono assolute e curate una a una in quartieri
// urbani sulla terraferma. Non derivano da offset casuali o radiali dal
// centro città: nelle città costiere un offset generico può finire in
// mare anche se il centro è corretto. Tenerle esplicite rende il vincolo
// controllabile in review.
//
// ⚠️ CONTENUTO ILLUSTRATIVO. Aziende e punteggi sono inventati: sono un
// esempio di come il team presenta ciò che trova, non offerte reali. La
// home lo dice a parole sotto al globo (`showcase_note`) — non con un
// timbro tecnico sopra la scena.
import type { PositionCoord } from "@/app/components/JobsGlobe";
import { makeT } from "@/lib/i18n-dict";
import {
  FAMILY_T,
  ROLE_T,
  type FamilyId,
  type RoleId,
} from "./LandingGlobe.roles.i18n";

export type LandingContinentId =
  | "europe"
  | "america"
  | "australia"
  | "asia"
  | "middle_east";

type ShowcaseCity = {
  city: string;
  country: string;
  cc: string;
  lat: number;
  lon: number;
};

type SearchPin = {
  role: RoleId;
  family: FamilyId;
  company: string;
  score: number;
  lat: number;
  lon: number;
  remote?: "onsite" | "hybrid" | "full_remote";
};

// Una tappa del tour automatico: continente + città + le sue opportunità.
export type LandingTourStop = ShowcaseCity & {
  continent: LandingContinentId;
  // Stabile e indipendente dalla lingua: entra negli id delle posizioni,
  // che la card usa per ritrovare la riga giusta anche dopo un cambio di
  // lingua a metà giro.
  slug: string;
  positions: PositionCoord[];
};

// Colore del pallino accanto al settore nella card. Stessa funzione che
// ha la donut delle tipologie nell'area riservata: dare un colore a un
// mestiere lo rende riconoscibile prima ancora di leggerlo.
export const FAMILY_COLORS: Record<FamilyId, string> = {
  art: "#e0754a",
  hospitality: "#d4a24c",
  luxury: "#c46fa8",
  engineering: "#5aa9e6",
  data: "#7c6ce0",
  design: "#e4658f",
  finance: "#3fb8a0",
  marketing: "#e8a13c",
  product: "#8bc34a",
  operations: "#8a97a8",
  health: "#4fc3a1",
  media: "#b98bd9",
  science: "#4dc9d6",
  security: "#e05a5a",
  sustainability: "#5fbf5f",
  sports: "#f0705a",
};

// ── Città del tour ──────────────────────────────────────────────────
// Europa: solo capitali (Monaco è un principato, quindi capitale di sé
// stesso: la regola regge), da sud-est verso ovest.
const ROME: ShowcaseCity = {
  city: "Rome",
  country: "Italy",
  cc: "IT",
  lat: 41.9028,
  lon: 12.4964,
};
const VIENNA: ShowcaseCity = {
  city: "Vienna",
  country: "Austria",
  cc: "AT",
  lat: 48.2082,
  lon: 16.3738,
};
const BERLIN: ShowcaseCity = {
  city: "Berlin",
  country: "Germany",
  cc: "DE",
  lat: 52.52,
  lon: 13.405,
};
const AMSTERDAM: ShowcaseCity = {
  city: "Amsterdam",
  country: "Netherlands",
  cc: "NL",
  lat: 52.3676,
  lon: 4.9041,
};
const PARIS: ShowcaseCity = {
  city: "Paris",
  country: "France",
  cc: "FR",
  lat: 48.8566,
  lon: 2.3522,
};
const MONACO: ShowcaseCity = {
  city: "Monaco",
  country: "Monaco",
  cc: "MC",
  lat: 43.7384,
  lon: 7.4246,
};
const MADRID: ShowcaseCity = {
  city: "Madrid",
  country: "Spain",
  cc: "ES",
  lat: 40.4168,
  lon: -3.7038,
};
const NEW_YORK: ShowcaseCity = {
  city: "New York",
  country: "United States",
  cc: "US",
  lat: 40.7128,
  lon: -74.006,
};
const TORONTO: ShowcaseCity = {
  city: "Toronto",
  country: "Canada",
  cc: "CA",
  lat: 43.6532,
  lon: -79.3832,
};
const CHICAGO: ShowcaseCity = {
  city: "Chicago",
  country: "United States",
  cc: "US",
  lat: 41.8781,
  lon: -87.6298,
};
const SAN_FRANCISCO: ShowcaseCity = {
  city: "San Francisco",
  country: "United States",
  cc: "US",
  lat: 37.7749,
  lon: -122.4194,
};
const MEXICO_CITY: ShowcaseCity = {
  city: "Mexico City",
  country: "Mexico",
  cc: "MX",
  lat: 19.4326,
  lon: -99.1332,
};
const SAO_PAULO: ShowcaseCity = {
  city: "São Paulo",
  country: "Brazil",
  cc: "BR",
  lat: -23.5505,
  lon: -46.6333,
};
const BUENOS_AIRES: ShowcaseCity = {
  city: "Buenos Aires",
  country: "Argentina",
  cc: "AR",
  lat: -34.6037,
  lon: -58.3816,
};
const SYDNEY: ShowcaseCity = {
  city: "Sydney",
  country: "Australia",
  cc: "AU",
  lat: -33.8688,
  lon: 151.2093,
};
const MELBOURNE: ShowcaseCity = {
  city: "Melbourne",
  country: "Australia",
  cc: "AU",
  lat: -37.8136,
  lon: 144.9631,
};
const PERTH: ShowcaseCity = {
  city: "Perth",
  country: "Australia",
  cc: "AU",
  lat: -31.9505,
  lon: 115.8605,
};
const SINGAPORE: ShowcaseCity = {
  city: "Singapore",
  country: "Singapore",
  cc: "SG",
  lat: 1.3521,
  lon: 103.8198,
};
const HONG_KONG: ShowcaseCity = {
  city: "Hong Kong",
  country: "Hong Kong",
  cc: "HK",
  lat: 22.3193,
  lon: 114.1694,
};
const SHANGHAI: ShowcaseCity = {
  city: "Shanghai",
  country: "China",
  cc: "CN",
  lat: 31.2304,
  lon: 121.4737,
};
const SEOUL: ShowcaseCity = {
  city: "Seoul",
  country: "South Korea",
  cc: "KR",
  lat: 37.5665,
  lon: 126.978,
};
const TOKYO: ShowcaseCity = {
  city: "Tokyo",
  country: "Japan",
  cc: "JP",
  lat: 35.6762,
  lon: 139.6503,
};
const DUBAI: ShowcaseCity = {
  city: "Dubai",
  country: "United Arab Emirates",
  cc: "AE",
  lat: 25.2048,
  lon: 55.2708,
};
const DOHA: ShowcaseCity = {
  city: "Doha",
  country: "Qatar",
  cc: "QA",
  lat: 25.2854,
  lon: 51.531,
};
const RIYADH: ShowcaseCity = {
  city: "Riyadh",
  country: "Saudi Arabia",
  cc: "SA",
  lat: 24.7136,
  lon: 46.6753,
};
const TEL_AVIV: ShowcaseCity = {
  city: "Tel Aviv",
  country: "Israel",
  cc: "IL",
  lat: 32.0853,
  lon: 34.7818,
};

// ── Tappe, in ordine di viaggio ─────────────────────────────────────
// Il numero di pin segue il ciclo 3 → 4 → 4 → 5 lungo tutta la lista.
type CityStop = {
  continent: LandingContinentId;
  slug: string;
  city: ShowcaseCity;
  pins: readonly SearchPin[];
};

const STOPS: readonly CityStop[] = [
  {
    continent: "europe",
    slug: "rome",
    city: ROME,
    pins: [
      {
        role: "rome_site_curator",
        family: "art",
        company: "Foro Antico Trust",
        score: 86,
        lat: 41.8902,
        lon: 12.4922,
      },
      {
        role: "rome_heritage_tourism",
        family: "hospitality",
        company: "Settecolli Journeys",
        score: 79,
        lat: 41.9022,
        lon: 12.4796,
      },
      {
        role: "rome_junior_restorer",
        family: "art",
        company: "Bottega Travertino",
        score: 72,
        lat: 41.913,
        lon: 12.472,
      },
    ],
  },
  {
    continent: "europe",
    slug: "vienna",
    city: VIENNA,
    pins: [
      {
        role: "vienna_mechanical_design",
        family: "engineering",
        company: "Donauwerk Technik",
        score: 88,
        lat: 48.198,
        lon: 16.369,
      },
      {
        role: "vienna_rail_systems",
        family: "engineering",
        company: "Nordbahn Systeme",
        score: 82,
        lat: 48.1855,
        lon: 16.3775,
      },
      {
        role: "vienna_opera_technician",
        family: "art",
        company: "Ringtheater Bühnen",
        score: 75,
        lat: 48.2033,
        lon: 16.369,
      },
      {
        role: "vienna_junior_process",
        family: "engineering",
        company: "Alpenglas Industrie",
        score: 70,
        lat: 48.22,
        lon: 16.359,
        remote: "hybrid",
      },
    ],
  },
  {
    continent: "europe",
    slug: "berlin",
    city: BERLIN,
    pins: [
      {
        role: "berlin_ml_engineer",
        family: "data",
        company: "Databridge",
        score: 91,
        lat: 52.53,
        lon: 13.385,
        remote: "hybrid",
      },
      {
        role: "berlin_climate_analyst",
        family: "sustainability",
        company: "Nordlicht Institut",
        score: 84,
        lat: 52.517,
        lon: 13.378,
      },
      {
        role: "berlin_label_ar",
        family: "media",
        company: "Kanalgrund Records",
        score: 78,
        lat: 52.5,
        lon: 13.438,
      },
      {
        role: "berlin_junior_frontend",
        family: "engineering",
        company: "Cobalt Loop",
        score: 73,
        lat: 52.5085,
        lon: 13.395,
      },
    ],
  },
  {
    continent: "europe",
    slug: "amsterdam",
    city: AMSTERDAM,
    pins: [
      {
        role: "amsterdam_product_designer",
        family: "design",
        company: "Ampersand Labs",
        score: 86,
        lat: 52.373,
        lon: 4.893,
        remote: "hybrid",
      },
      {
        role: "amsterdam_water_engineer",
        family: "engineering",
        company: "Deltawerken Advies",
        score: 83,
        lat: 52.355,
        lon: 4.916,
      },
      {
        role: "amsterdam_payments_compliance",
        family: "finance",
        company: "Zuidas Clearing",
        score: 80,
        lat: 52.338,
        lon: 4.872,
      },
      {
        role: "amsterdam_cycling_planner",
        family: "sustainability",
        company: "Stadswegen Bureau",
        score: 74,
        lat: 52.379,
        lon: 4.901,
      },
      {
        role: "amsterdam_junior_growth",
        family: "marketing",
        company: "Canalworks",
        score: 69,
        lat: 52.365,
        lon: 4.882,
        remote: "full_remote",
      },
    ],
  },
  {
    continent: "europe",
    slug: "paris",
    city: PARIS,
    pins: [
      {
        role: "paris_couture_atelier",
        family: "luxury",
        company: "Maison Verrier",
        score: 89,
        lat: 48.87,
        lon: 2.306,
      },
      {
        role: "paris_fragrance_chemist",
        family: "science",
        company: "Grasse & Fils",
        score: 81,
        lat: 48.849,
        lon: 2.339,
      },
      {
        role: "paris_junior_gallery",
        family: "art",
        company: "Galerie Sainte-Croix",
        score: 70,
        lat: 48.859,
        lon: 2.366,
      },
    ],
  },
  {
    continent: "europe",
    slug: "monaco",
    city: MONACO,
    pins: [
      {
        role: "monaco_hotel_gm",
        family: "hospitality",
        company: "Hôtel Belrive",
        score: 91,
        lat: 43.7396,
        lon: 7.4275,
      },
      {
        role: "monaco_yacht_broker",
        family: "luxury",
        company: "Cap Ferrat Charters",
        score: 83,
        lat: 43.7358,
        lon: 7.421,
      },
      {
        role: "monaco_sommelier",
        family: "hospitality",
        company: "Table du Rocher",
        score: 77,
        lat: 43.7408,
        lon: 7.4288,
      },
      {
        role: "monaco_junior_concierge",
        family: "hospitality",
        company: "Résidence Larvotto",
        score: 68,
        lat: 43.73,
        lon: 7.4185,
      },
    ],
  },
  {
    continent: "europe",
    slug: "madrid",
    city: MADRID,
    pins: [
      {
        role: "madrid_solar_operations",
        family: "sustainability",
        company: "Solana Ibérica",
        score: 85,
        lat: 40.44,
        lon: -3.69,
      },
      {
        role: "madrid_football_analyst",
        family: "sports",
        company: "Club Atlético Ribera",
        score: 78,
        lat: 40.453,
        lon: -3.6883,
      },
      {
        role: "madrid_revenue_manager",
        family: "hospitality",
        company: "Hoteles Mirasierra",
        score: 76,
        lat: 40.42,
        lon: -3.705,
      },
      {
        role: "madrid_junior_backend",
        family: "engineering",
        company: "Cinderpath",
        score: 71,
        lat: 40.405,
        lon: -3.695,
        remote: "hybrid",
      },
    ],
  },

  {
    continent: "america",
    slug: "newyork",
    city: NEW_YORK,
    pins: [
      {
        role: "newyork_gallery_director",
        family: "art",
        company: "Halden & Roe Gallery",
        score: 92,
        lat: 40.748,
        lon: -74.006,
      },
      {
        role: "newyork_auction_specialist",
        family: "luxury",
        company: "Marlowe Auction House",
        score: 85,
        lat: 40.766,
        lon: -73.96,
      },
      {
        role: "newyork_equity_research",
        family: "finance",
        company: "Driftwood Analytics",
        score: 83,
        lat: 40.7061,
        lon: -74.0087,
      },
      {
        role: "newyork_stage_manager",
        family: "art",
        company: "Lyric Row Theatre",
        score: 76,
        lat: 40.759,
        lon: -73.9855,
      },
      {
        role: "newyork_junior_buyer",
        family: "luxury",
        company: "Ninth Avenue Atelier",
        score: 72,
        lat: 40.743,
        lon: -73.9925,
      },
    ],
  },
  {
    continent: "america",
    slug: "toronto",
    city: TORONTO,
    pins: [
      {
        role: "toronto_ai_researcher",
        family: "data",
        company: "Maple Signals",
        score: 88,
        lat: 43.66,
        lon: -79.395,
      },
      {
        role: "toronto_nurse_practitioner",
        family: "health",
        company: "Lakeshore Health Network",
        score: 81,
        lat: 43.658,
        lon: -79.387,
      },
      {
        role: "toronto_junior_data_analyst",
        family: "data",
        company: "Databay",
        score: 70,
        lat: 43.647,
        lon: -79.381,
        remote: "hybrid",
      },
    ],
  },
  {
    continent: "america",
    slug: "chicago",
    city: CHICAGO,
    pins: [
      {
        role: "chicago_structural_architect",
        family: "engineering",
        company: "Fieldstone Architects",
        score: 84,
        lat: 41.885,
        lon: -87.63,
      },
      {
        role: "chicago_commodities_analyst",
        family: "finance",
        company: "Prairie Grain Trading",
        score: 80,
        lat: 41.878,
        lon: -87.6335,
      },
      {
        role: "chicago_jazz_programmer",
        family: "art",
        company: "The Blue Cellar",
        score: 74,
        lat: 41.872,
        lon: -87.627,
      },
      {
        role: "chicago_junior_supply_chain",
        family: "operations",
        company: "Lakefront Logistics",
        score: 71,
        lat: 41.89,
        lon: -87.644,
      },
    ],
  },
  {
    continent: "america",
    slug: "sanfrancisco",
    city: SAN_FRANCISCO,
    pins: [
      {
        role: "sanfrancisco_staff_engineer",
        family: "engineering",
        company: "Bramble Tech",
        score: 93,
        lat: 37.785,
        lon: -122.4,
        remote: "hybrid",
      },
      {
        role: "sanfrancisco_ai_pm",
        family: "product",
        company: "Mission Interface",
        score: 87,
        lat: 37.782,
        lon: -122.409,
      },
      {
        role: "sanfrancisco_devrel",
        family: "marketing",
        company: "Foxglove Labs",
        score: 78,
        lat: 37.762,
        lon: -122.42,
        remote: "full_remote",
      },
      {
        role: "sanfrancisco_junior_qa",
        family: "engineering",
        company: "Presidio Quality",
        score: 70,
        lat: 37.791,
        lon: -122.403,
      },
    ],
  },
  {
    continent: "america",
    slug: "mexicocity",
    city: MEXICO_CITY,
    pins: [
      {
        role: "mexico_executive_chef",
        family: "hospitality",
        company: "Cocina Amaranto",
        score: 82,
        lat: 19.431,
        lon: -99.19,
      },
      {
        role: "mexico_automotive_quality",
        family: "engineering",
        company: "Cargolane Motores",
        score: 77,
        lat: 19.39,
        lon: -99.15,
      },
      {
        role: "mexico_customer_success",
        family: "operations",
        company: "Plaza Stack",
        score: 75,
        lat: 19.42,
        lon: -99.17,
        remote: "hybrid",
      },
      {
        role: "mexico_mural_restoration",
        family: "art",
        company: "Taller Cal y Canto",
        score: 74,
        lat: 19.4352,
        lon: -99.141,
      },
      {
        role: "mexico_junior_fullstack",
        family: "engineering",
        company: "Nopal Digital",
        score: 69,
        lat: 19.445,
        lon: -99.155,
      },
    ],
  },
  {
    continent: "america",
    slug: "saopaulo",
    city: SAO_PAULO,
    pins: [
      {
        role: "saopaulo_fintech_risk",
        family: "finance",
        company: "Banco Palmgrove",
        score: 86,
        lat: -23.587,
        lon: -46.682,
      },
      {
        role: "saopaulo_art_director",
        family: "design",
        company: "Viva Studio",
        score: 83,
        lat: -23.561,
        lon: -46.656,
        remote: "hybrid",
      },
      {
        role: "saopaulo_junior_ux",
        family: "design",
        company: "Ateliê Vermelho",
        score: 68,
        lat: -23.545,
        lon: -46.642,
      },
    ],
  },
  {
    continent: "america",
    slug: "buenosaires",
    city: BUENOS_AIRES,
    pins: [
      {
        role: "buenosaires_wine_export",
        family: "luxury",
        company: "Bodega Cerro Azul",
        score: 80,
        lat: -34.595,
        lon: -58.398,
      },
      {
        role: "buenosaires_lighting_designer",
        family: "art",
        company: "Teatro Pampa",
        score: 76,
        lat: -34.601,
        lon: -58.387,
      },
      {
        role: "buenosaires_export_quality",
        family: "operations",
        company: "Alimentos del Plata",
        score: 74,
        lat: -34.618,
        lon: -58.373,
      },
      {
        role: "buenosaires_junior_writer",
        family: "media",
        company: "Cobalt Yard",
        score: 70,
        lat: -34.588,
        lon: -58.396,
        remote: "full_remote",
      },
    ],
  },

  {
    continent: "australia",
    slug: "sydney",
    city: SYDNEY,
    pins: [
      {
        role: "sydney_marine_biologist",
        family: "science",
        company: "Coralwatch Institute",
        score: 83,
        lat: -33.888,
        lon: 151.193,
      },
      {
        role: "sydney_wealth_advisor",
        family: "finance",
        company: "Cedarwave Partners",
        score: 81,
        lat: -33.865,
        lon: 151.209,
      },
      {
        role: "sydney_cyber_analyst",
        family: "security",
        company: "Harbour Shield",
        score: 79,
        lat: -33.873,
        lon: 151.207,
        remote: "hybrid",
      },
      {
        role: "sydney_junior_events",
        family: "hospitality",
        company: "Bennelong Events",
        score: 70,
        lat: -33.879,
        lon: 151.205,
      },
    ],
  },
  {
    continent: "australia",
    slug: "melbourne",
    city: MELBOURNE,
    pins: [
      {
        role: "melbourne_physiotherapist",
        family: "health",
        company: "Yarra Sports Clinic",
        score: 82,
        lat: -37.82,
        lon: 144.983,
      },
      {
        role: "melbourne_coffee_roaster",
        family: "hospitality",
        company: "Ironbark Roastery",
        score: 77,
        lat: -37.8,
        lon: 144.978,
      },
      {
        role: "melbourne_transit_planner",
        family: "operations",
        company: "Harborline Transit",
        score: 76,
        lat: -37.818,
        lon: 144.956,
      },
      {
        role: "melbourne_festival_producer",
        family: "art",
        company: "Laneway Collective",
        score: 74,
        lat: -37.811,
        lon: 144.968,
      },
      {
        role: "melbourne_junior_data_engineer",
        family: "data",
        company: "Yarra Data",
        score: 71,
        lat: -37.825,
        lon: 144.954,
        remote: "hybrid",
      },
    ],
  },
  {
    continent: "australia",
    slug: "perth",
    city: PERTH,
    pins: [
      {
        role: "perth_mining_superintendent",
        family: "engineering",
        company: "Ironbark Systems",
        score: 85,
        lat: -31.95,
        lon: 115.858,
      },
      {
        role: "perth_renewables_pm",
        family: "sustainability",
        company: "Swan Cloud Energy",
        score: 82,
        lat: -31.943,
        lon: 115.862,
      },
      {
        role: "perth_junior_drafter",
        family: "engineering",
        company: "Kalgoorlie Drafting",
        score: 69,
        lat: -31.956,
        lon: 115.848,
      },
    ],
  },

  {
    continent: "asia",
    slug: "singapore",
    city: SINGAPORE,
    pins: [
      {
        role: "singapore_treasury_manager",
        family: "finance",
        company: "Lion City Treasury",
        score: 87,
        lat: 1.283,
        lon: 103.851,
      },
      {
        role: "singapore_port_automation",
        family: "engineering",
        company: "Cedarwave Ports",
        score: 84,
        lat: 1.272,
        lon: 103.821,
      },
      {
        role: "singapore_biotech_scientist",
        family: "science",
        company: "Nimbus Biosciences",
        score: 81,
        lat: 1.305,
        lon: 103.788,
      },
      {
        role: "singapore_junior_trade",
        family: "operations",
        company: "Straits Compliance",
        score: 71,
        lat: 1.32,
        lon: 103.85,
      },
    ],
  },
  {
    continent: "asia",
    slug: "hongkong",
    city: HONG_KONG,
    pins: [
      {
        role: "hongkong_private_banker",
        family: "finance",
        company: "Alpine Risk Partners",
        score: 88,
        lat: 22.282,
        lon: 114.158,
      },
      {
        role: "hongkong_watch_retail",
        family: "luxury",
        company: "Peak & Meridian",
        score: 82,
        lat: 22.298,
        lon: 114.172,
      },
      {
        role: "hongkong_shipping_operations",
        family: "operations",
        company: "Kowloon Maritime",
        score: 77,
        lat: 22.312,
        lon: 114.225,
      },
      {
        role: "hongkong_junior_risk",
        family: "finance",
        company: "Kowloon Audit",
        score: 70,
        lat: 22.279,
        lon: 114.173,
      },
    ],
  },
  {
    continent: "asia",
    slug: "shanghai",
    city: SHANGHAI,
    pins: [
      {
        role: "shanghai_ev_battery",
        family: "engineering",
        company: "Bund Powercell",
        score: 86,
        lat: 31.2,
        lon: 121.44,
      },
      {
        role: "shanghai_luxury_store",
        family: "luxury",
        company: "Maison Verrier Shanghai",
        score: 81,
        lat: 31.228,
        lon: 121.475,
      },
      {
        role: "shanghai_ecommerce_category",
        family: "marketing",
        company: "Nimbus Commerce",
        score: 79,
        lat: 31.205,
        lon: 121.59,
      },
      {
        role: "shanghai_industrial_designer",
        family: "design",
        company: "Jade Loop Design",
        score: 77,
        lat: 31.243,
        lon: 121.459,
      },
      {
        role: "shanghai_junior_localization",
        family: "media",
        company: "Papermoon Labs",
        score: 69,
        lat: 31.217,
        lon: 121.431,
        remote: "hybrid",
      },
    ],
  },
  {
    continent: "asia",
    slug: "seoul",
    city: SEOUL,
    pins: [
      {
        role: "seoul_semiconductor",
        family: "engineering",
        company: "Hanbit Semiconductor",
        score: 90,
        lat: 37.5,
        lon: 127.035,
      },
      {
        role: "seoul_technical_artist",
        family: "design",
        company: "Papermoon Studio",
        score: 84,
        lat: 37.479,
        lon: 127.04,
      },
      {
        role: "seoul_junior_mobile",
        family: "engineering",
        company: "Han River Interface",
        score: 71,
        lat: 37.556,
        lon: 126.937,
      },
    ],
  },
  {
    continent: "asia",
    slug: "tokyo",
    city: TOKYO,
    pins: [
      {
        role: "tokyo_robotics_engineer",
        family: "engineering",
        company: "Driftline Robotics",
        score: 89,
        lat: 35.71,
        lon: 139.777,
      },
      {
        role: "tokyo_optics_technician",
        family: "engineering",
        company: "Shibuya Systems",
        score: 80,
        lat: 35.658,
        lon: 139.701,
      },
      {
        role: "tokyo_ryokan_manager",
        family: "hospitality",
        company: "Asakusa Kiri Ryokan",
        score: 78,
        lat: 35.7148,
        lon: 139.7967,
      },
      {
        role: "tokyo_junior_manga_editor",
        family: "media",
        company: "Kanda Shobō",
        score: 73,
        lat: 35.702,
        lon: 139.753,
      },
    ],
  },

  {
    continent: "middle_east",
    slug: "dubai",
    city: DUBAI,
    pins: [
      {
        role: "dubai_real_estate",
        family: "luxury",
        company: "Desert Stack Realty",
        score: 85,
        lat: 25.1972,
        lon: 55.2744,
      },
      {
        role: "dubai_fnb_director",
        family: "hospitality",
        company: "Cargolane Hotels",
        score: 82,
        lat: 25.21,
        lon: 55.28,
      },
      {
        role: "dubai_cabin_trainer",
        family: "operations",
        company: "Falcon Wing Academy",
        score: 78,
        lat: 25.253,
        lon: 55.365,
      },
      {
        role: "dubai_junior_events_marketing",
        family: "marketing",
        company: "Marina Live Events",
        score: 69,
        lat: 25.228,
        lon: 55.288,
      },
    ],
  },
  {
    continent: "middle_east",
    slug: "doha",
    city: DOHA,
    pins: [
      {
        role: "doha_lng_engineer",
        family: "engineering",
        company: "Corniche Energy",
        score: 84,
        lat: 25.279,
        lon: 51.518,
      },
      {
        role: "doha_museum_curator",
        family: "art",
        company: "Dar al-Hikma Museum",
        score: 80,
        lat: 25.295,
        lon: 51.539,
      },
      {
        role: "doha_stadium_facilities",
        family: "operations",
        company: "Al Rayyan Facilities",
        score: 77,
        lat: 25.244,
        lon: 51.488,
      },
      {
        role: "doha_sports_logistics",
        family: "sports",
        company: "Brightpeak Advisory",
        score: 75,
        lat: 25.318,
        lon: 51.51,
      },
      {
        role: "doha_junior_civil",
        family: "engineering",
        company: "Lusail Site Works",
        score: 70,
        lat: 25.268,
        lon: 51.501,
      },
    ],
  },
  {
    continent: "middle_east",
    slug: "riyadh",
    city: RIYADH,
    pins: [
      {
        role: "riyadh_urban_director",
        family: "engineering",
        company: "Najd Urban Works",
        score: 87,
        lat: 24.744,
        lon: 46.641,
      },
      {
        role: "riyadh_arabic_nlp",
        family: "data",
        company: "Cobalt Loop Arabia",
        score: 81,
        lat: 24.725,
        lon: 46.682,
        remote: "hybrid",
      },
      {
        role: "riyadh_junior_hr",
        family: "operations",
        company: "Sahara People Group",
        score: 68,
        lat: 24.69,
        lon: 46.696,
      },
    ],
  },
  {
    continent: "middle_east",
    slug: "telaviv",
    city: TEL_AVIV,
    pins: [
      {
        role: "telaviv_security_lead",
        family: "security",
        company: "Nightglass",
        score: 90,
        lat: 32.07,
        lon: 34.794,
      },
      {
        role: "telaviv_medical_device",
        family: "health",
        company: "Coastal Medtech",
        score: 84,
        lat: 32.1,
        lon: 34.804,
      },
      {
        role: "telaviv_vc_associate",
        family: "finance",
        company: "Rothschild Row Ventures",
        score: 79,
        lat: 32.067,
        lon: 34.778,
      },
      {
        role: "telaviv_junior_devops",
        family: "engineering",
        company: "Sandstorm Cloud",
        score: 72,
        lat: 32.079,
        lon: 34.788,
        remote: "hybrid",
      },
    ],
  },
];

/** Le tappe con titoli e settori risolti nella lingua richiesta. */
export function landingTour(lang: string): LandingTourStop[] {
  const role = makeT(ROLE_T, lang);
  const family = makeT(FAMILY_T, lang);
  return STOPS.map(({ continent, slug, city, pins }) => ({
    ...city,
    continent,
    slug,
    positions: pins.map((pin, i) => {
      const remote = pin.remote ?? "onsite";
      return {
        // Stabile fra le lingue: la card aperta non si chiude quando
        // l'utente cambia lingua a metà giro.
        id: `landing-${slug}-${i + 1}`,
        title: role(pin.role),
        company: pin.company,
        status: "scored",
        role_family: family(pin.family),
        score: pin.score,
        lat: pin.lat,
        lon: pin.lon,
        is_remote: remote === "full_remote",
        remote_type: remote,
        location: `${city.city}, ${city.cc}`,
        loc_country: city.country,
        loc_city: city.city,
        office_address: null,
        created_at: null,
      } satisfies PositionCoord;
    }),
  }));
}

/** Colori del pallino settore, indicizzati dall'etichetta tradotta. */
export function landingFamilyColors(lang: string): Record<string, string> {
  const family = makeT(FAMILY_T, lang);
  const out: Record<string, string> = {};
  for (const key of Object.keys(FAMILY_T) as FamilyId[]) {
    out[family(key)] = FAMILY_COLORS[key];
  }
  return out;
}

// Dataset per la vetrina. Il profilo grafico ridotto tiene solo le prime
// due opportunità di ogni città: meno pin da disegnare a ogni frame, ma
// il tour e le card ricevono gli STESSI elementi, quindi non possono mai
// raccontare una cosa diversa da quella visibile sul globo.
export function landingShowcaseData(
  lean: boolean,
  lang: string,
): {
  tour: LandingTourStop[];
  positions: PositionCoord[];
} {
  const full = landingTour(lang);
  const tour = lean
    ? full.map((stop) => ({ ...stop, positions: stop.positions.slice(0, 2) }))
    : full;
  return { tour, positions: tour.flatMap((stop) => stop.positions) };
}
