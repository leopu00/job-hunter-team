// Ricerche mostrate dal globo della home pubblica.
//
// Ogni tappa rappresenta UNA ricerca di lavoro in una città: le due
// opportunità della card hanno quindi lo stesso titolo e la stessa famiglia
// professionale, ma aziende e punteggi diversi. Non è un campionario di ruoli
// scollegati: il visitatore legge il risultato di una ricerca localizzata.
//
// Le coordinate dei pin sono assolute e curate una a una in quartieri urbani
// sulla terraferma. Non derivano da offset casuali o radiali dal centro città:
// nelle città costiere un offset generico può finire in mare anche se il centro
// è corretto. Tenerle esplicite rende il vincolo controllabile in review.
import type { PositionCoord } from "@/app/components/JobsGlobe";

export type LandingContinentId =
  "europe" | "america" | "australia" | "asia" | "middle_east";

type ShowcaseCity = {
  city: string;
  country: string;
  cc: string;
  lat: number;
  lon: number;
};

type SearchPin = {
  company: string;
  score: number;
  lat: number;
  lon: number;
  remote?: "onsite" | "hybrid" | "full_remote";
};

// Una tappa del tour automatico: continente + città + opportunità della sua
// unica ricerca.
export type LandingTourStop = ShowcaseCity & {
  continent: LandingContinentId;
  positions: PositionCoord[];
};

let seq = 0;

function research(
  continent: LandingContinentId,
  city: ShowcaseCity,
  title: string,
  family: string,
  pins: readonly SearchPin[],
): LandingTourStop {
  const positions = pins.map((pin) => {
    seq += 1;
    const remote = pin.remote ?? "onsite";
    return {
      id: `landing-search-${String(seq).padStart(3, "0")}`,
      title,
      company: pin.company,
      status: "scored",
      role_family: family,
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
  });
  return { ...city, continent, positions };
}

// ── Città del tour ──────────────────────────────────────────────────
// Europa: solo capitali, da sud-est verso ovest.
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

// ── Tour: una ricerca per ciascuna delle 25 città ───────────────────
export const LANDING_TOUR: LandingTourStop[] = [
  research("europe", ROME, "Backend Engineer", "Backend", [
    { company: "Tiberline", score: 88, lat: 41.9007, lon: 12.4828 },
    { company: "Portico Systems", score: 81, lat: 41.9095, lon: 12.498 },
  ]),
  research("europe", VIENNA, "Data Analyst", "Data", [
    { company: "Databay", score: 84, lat: 48.2105, lon: 16.3655 },
    {
      company: "Northstar Metrics",
      score: 78,
      lat: 48.202,
      lon: 16.3785,
      remote: "hybrid",
    },
  ]),
  research("europe", BERLIN, "Machine Learning Engineer", "AI / ML", [
    {
      company: "Databridge",
      score: 91,
      lat: 52.525,
      lon: 13.39,
      remote: "hybrid",
    },
    { company: "Cobalt Loop", score: 82, lat: 52.515, lon: 13.41 },
  ]),
  research("europe", AMSTERDAM, "Product Designer", "Product Design", [
    {
      company: "Ampersand Labs",
      score: 86,
      lat: 52.37,
      lon: 4.89,
      remote: "hybrid",
    },
    { company: "Canalworks", score: 79, lat: 52.36, lon: 4.905 },
  ]),
  research("europe", PARIS, "Frontend Engineer", "Frontend", [
    {
      company: "Foxglove Labs",
      score: 89,
      lat: 48.864,
      lon: 2.34,
      remote: "hybrid",
    },
    { company: "Lumen Studio", score: 81, lat: 48.85, lon: 2.36 },
  ]),
  research("europe", MADRID, "Mobile Engineer", "Mobile", [
    { company: "Cinderpath", score: 83, lat: 40.425, lon: -3.71 },
    {
      company: "Iberia Mobile",
      score: 76,
      lat: 40.408,
      lon: -3.69,
      remote: "hybrid",
    },
  ]),

  research("america", NEW_YORK, "Data Engineer", "Data", [
    { company: "Driftwood Analytics", score: 90, lat: 40.73, lon: -74.0 },
    { company: "Hudson Data", score: 83, lat: 40.706, lon: -74.01 },
  ]),
  research("america", TORONTO, "Data Scientist", "AI / ML", [
    { company: "Databay", score: 85, lat: 43.66, lon: -79.39 },
    { company: "Maple Signals", score: 78, lat: 43.651, lon: -79.377 },
  ]),
  research("america", CHICAGO, "QA Automation Engineer", "QA", [
    { company: "Fieldstone", score: 80, lat: 41.886, lon: -87.64 },
    { company: "Lakefront Quality", score: 74, lat: 41.87, lon: -87.63 },
  ]),
  research("america", SAN_FRANCISCO, "Frontend Engineer", "Frontend", [
    {
      company: "Bramble Tech",
      score: 93,
      lat: 37.785,
      lon: -122.43,
      remote: "hybrid",
    },
    { company: "Mission Interface", score: 85, lat: 37.77, lon: -122.42 },
  ]),
  research("america", MEXICO_CITY, "Full-stack Engineer", "Full-stack", [
    { company: "Cargolane", score: 82, lat: 19.445, lon: -99.145 },
    { company: "Plaza Stack", score: 75, lat: 19.425, lon: -99.12 },
  ]),
  research("america", SAO_PAULO, "Social Media Designer", "Social", [
    {
      company: "Palmgrove",
      score: 87,
      lat: -23.545,
      lon: -46.64,
      remote: "hybrid",
    },
    { company: "Viva Studio", score: 79, lat: -23.56, lon: -46.65 },
  ]),
  research("america", BUENOS_AIRES, "Frontend Engineer", "Frontend", [
    {
      company: "Cobalt Yard",
      score: 79,
      lat: -34.6,
      lon: -58.395,
      remote: "full_remote",
    },
    { company: "Pampa Interface", score: 73, lat: -34.61, lon: -58.385 },
  ]),

  research("australia", SYDNEY, "Mobile Engineer", "Mobile", [
    { company: "Cedarwave", score: 84, lat: -33.875, lon: 151.195 },
    {
      company: "Harbour Mobile",
      score: 77,
      lat: -33.855,
      lon: 151.205,
      remote: "hybrid",
    },
  ]),
  research("australia", MELBOURNE, "Data Engineer", "Data", [
    { company: "Harborline", score: 81, lat: -37.805, lon: 144.955 },
    {
      company: "Yarra Data",
      score: 75,
      lat: -37.825,
      lon: 144.97,
      remote: "hybrid",
    },
  ]),
  research("australia", PERTH, "DevOps Engineer", "DevOps / Cloud", [
    { company: "Ironbark Systems", score: 74, lat: -31.94, lon: 115.85 },
    { company: "Swan Cloud", score: 70, lat: -31.96, lon: 115.84 },
  ]),

  research("asia", SINGAPORE, "Platform Engineer", "Backend", [
    { company: "Cedarwave", score: 85, lat: 1.35, lon: 103.83 },
    { company: "Lion City Platform", score: 80, lat: 1.365, lon: 103.82 },
  ]),
  research("asia", HONG_KONG, "Risk Analyst", "Risk & Audit", [
    { company: "Alpine Risk Partners", score: 82, lat: 22.325, lon: 114.16 },
    { company: "Kowloon Audit", score: 76, lat: 22.31, lon: 114.175 },
  ]),
  research("asia", SHANGHAI, "Data Scientist", "AI / ML", [
    { company: "Nimbus Metrics", score: 79, lat: 31.23, lon: 121.455 },
    { company: "Bund Signals", score: 73, lat: 31.245, lon: 121.47 },
  ]),
  research("asia", SEOUL, "Frontend Engineer", "Frontend", [
    { company: "Papermoon Labs", score: 84, lat: 37.57, lon: 126.97 },
    { company: "Han River Interface", score: 77, lat: 37.555, lon: 126.985 },
  ]),
  research("asia", TOKYO, "Backend Engineer", "Backend", [
    { company: "Driftline", score: 88, lat: 35.68, lon: 139.735 },
    {
      company: "Shibuya Systems",
      score: 82,
      lat: 35.67,
      lon: 139.75,
      remote: "hybrid",
    },
  ]),

  research("middle_east", DUBAI, "Full-stack Engineer", "Full-stack", [
    { company: "Cargolane", score: 85, lat: 25.215, lon: 55.285 },
    { company: "Desert Stack", score: 79, lat: 25.19, lon: 55.27 },
  ]),
  research("middle_east", DOHA, "Business Analyst", "Business Analysis", [
    { company: "Brightpeak Advisory", score: 75, lat: 25.3, lon: 51.515 },
    { company: "Corniche Operations", score: 71, lat: 25.275, lon: 51.52 },
  ]),
  research("middle_east", RIYADH, "DevOps Engineer", "DevOps / Cloud", [
    { company: "Cobalt Loop", score: 77, lat: 24.725, lon: 46.66 },
    { company: "Najd Cloud", score: 72, lat: 24.7, lon: 46.69 },
  ]),
  research("middle_east", TEL_AVIV, "Security Engineer", "Security", [
    { company: "Nightglass", score: 89, lat: 32.09, lon: 34.79 },
    {
      company: "Coastal Security",
      score: 82,
      lat: 32.075,
      lon: 34.785,
      remote: "hybrid",
    },
  ]),
];

// Dataset per la vetrina. Il profilo medio disegna una sola opportunità per
// città; il tour e la card ricevono gli stessi elementi, quindi non possono
// mai raccontare una cosa diversa da quella visibile sul globo.
export function landingShowcaseData(lean: boolean): {
  tour: LandingTourStop[];
  positions: PositionCoord[];
} {
  const tour = lean
    ? LANDING_TOUR.map((stop) => ({
        ...stop,
        positions: stop.positions.slice(0, 1),
      }))
    : LANDING_TOUR;
  return { tour, positions: tour.flatMap((stop) => stop.positions) };
}
