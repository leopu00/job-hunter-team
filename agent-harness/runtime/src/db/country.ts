/**
 * The country of a position, written at the INSERT (`scout_area.derive_country` of the TUI).
 *
 * The Scouts write only the free text of the place; until the Analista read the ad the country stayed empty (26 new positions of 28
 * in the banco of build9). It comes from what the Scout wrote and nothing else: a country the location names, a place written the
 * Italian way (`Bra (CN), Piemonte`), or the country its portal speaks for (`talent-com-it`, `it.talent.com`, `ch.indeed.com`,
 * `randstad.it`). A portal of the world (linkedin) says none, and a city name never implies a country: with nothing that says it
 * the country stays empty.
 *
 * COUNTRY_NAMES is a copy of `country_names` in `shared/skills/scout_coverage_table.json`; a test holds the two equal.
 */

export const COUNTRY_NAMES: Readonly<Record<string, readonly string[]>> = {
  it: ["italy", "italia"],
  se: ["sweden", "sverige", "svezia"],
  dk: ["denmark", "danmark", "danimarca"],
  no: ["norway", "norge", "norvegia"],
  fi: ["finland", "suomi", "finlandia"],
  nl: ["netherlands", "the netherlands", "nederland", "holland", "olanda", "paesi bassi"],
  be: ["belgium", "belgie", "belgique", "belgio"],
  de: ["germany", "deutschland", "germania"],
  at: ["austria", "osterreich"],
  ch: ["switzerland", "schweiz", "suisse", "svizzera"],
  fr: ["france", "francia"],
  es: ["spain", "espana", "spagna"],
  pt: ["portugal", "portogallo"],
  ie: ["ireland", "eire", "irlanda"],
  gb: ["united kingdom", "uk", "great britain", "england", "scotland", "wales", "regno unito", "inghilterra"],
  mt: ["malta"],
  pl: ["poland", "polska", "polonia"],
  cz: ["czech republic", "czechia", "cesko"],
  hu: ["hungary", "magyarorszag", "ungheria"],
  ro: ["romania"],
  gr: ["greece", "grecia"],
  lu: ["luxembourg", "lussemburgo"],
  us: ["united states", "usa", "u.s.", "america", "stati uniti"],
  ca: ["canada"],
  au: ["australia"],
  in: ["india"],
  sg: ["singapore", "singapour"],
  ae: ["united arab emirates", "uae", "emirati arabi"],
  br: ["brazil", "brasil", "brasile"],
  mx: ["mexico", "messico"],
  jp: ["japan", "giappone"],
  cn: ["china", "cina"],
  il: ["israel"],
  tr: ["turkey", "turkiye", "turchia"],
  ua: ["ukraine", "ucraina"],
  bg: ["bulgaria"],
  hr: ["croatia", "croazia"],
  sk: ["slovakia", "slovacchia"],
  si: ["slovenia"],
  ee: ["estonia"],
  lv: ["latvia", "lettonia"],
  lt: ["lithuania", "lituania"],
  is: ["iceland", "islanda"],
};

const ITALIAN_PROVINCES: ReadonlySet<string> = new Set(
  (
    "AG AL AN AO AP AQ AR AT AV BA BG BI BL BN BO BR BS BT BZ CA CB CE CH CL CN CO CR CS CT CZ EN FC FE FG FI FM FR GE GO GR " +
    "IM IS KR LC LE LI LO LT LU MB MC ME MI MN MO MS MT NA NO NU OR PA PC PD PE PG PI PN PO PR PT PU PV PZ RA RC RE RG RI RM " +
    "RN RO SA SI SO SP SR SS SU SV TA TE TN TO TP TR TS TV UD VA VB VC VE VI VR VT VV"
  ).split(" "),
);
const ITALIAN_REGIONS: ReadonlySet<string> = new Set(
  (
    "piemonte piedmont valle d aosta aosta lombardia lombardy trentino alto adige veneto friuli venezia giulia liguria emilia " +
    "romagna toscana tuscany umbria marche lazio abruzzo molise campania puglia apulia basilicata calabria sicilia sicily " +
    "sardegna sardinia"
  ).split(" "),
);
const TLD_COUNTRY: Readonly<Record<string, string>> = { uk: "gb" };
const WORLD_HOSTS = ["linkedin.", "indeed.", "glassdoor.", "greenhouse.", "lever.", "ashbyhq.", "workable.", "smartrecruiters."];

/** `_plain`: casefolded, accents removed, only `[a-z0-9.]` runs, joined by one space. */
function plain(text: string): string {
  const folded = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ß/g, "ss");
  return (folded.match(/[a-z0-9.]+/g) ?? []).join(" ");
}

function buildNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const [code, listed] of Object.entries(COUNTRY_NAMES)) {
    names.set(code, code);
    for (const name of listed) names.set(plain(name), code);
  }
  return names;
}
const NAMES = buildNames();
const CODES = new Set(Object.keys(COUNTRY_NAMES));

const isUpper = (text: string): boolean => text === text.toUpperCase() && text !== text.toLowerCase();

function saysItaly(parts: readonly string[]): boolean {
  for (const part of parts) {
    const raw = part.trim();
    const p = plain(raw);
    if (!p) continue;
    if (ITALIAN_REGIONS.has(p) || p.split(" ").some((word) => ITALIAN_REGIONS.has(word))) return true;
    if (NAMES.get(p) === "it" && (p.length > 2 || isUpper(raw))) return true;
  }
  return false;
}

/** `scout_area.country_of`: the country code a location names, or null. */
export function countryOf(location: unknown): string | null {
  if (typeof location !== "string" || !location.trim()) return null;
  const parts = location.split(/[,;/|()\-–]+/);
  const italian = saysItaly(parts);
  const bracketed = new Set(
    [...location.matchAll(/\(\s*([A-Za-z]{2})\s*\)/g)].map((m) => m[1]!.toUpperCase()).filter((code) => ITALIAN_PROVINCES.has(code)),
  );
  const found: string[] = [];
  for (const part of parts) {
    const raw = part.trim();
    if (!raw) continue;
    if (raw.length === 2 && isUpper(raw) && ITALIAN_PROVINCES.has(raw) && (italian || bracketed.has(raw))) continue;
    const p = plain(raw);
    const named = NAMES.get(p);
    if (named !== undefined && (!CODES.has(p) || isUpper(raw) || p.length > 2)) {
      found.push(named);
    } else if (raw.length === 2 && isUpper(raw) && CODES.has(raw.toLowerCase())) {
      found.push(raw.toLowerCase());
    } else {
      for (const word of p.split(" ")) {
        const w = NAMES.get(word);
        if (w !== undefined && word.length > 3) found.push(w);
      }
    }
  }
  return found.length ? found[found.length - 1]! : null;
}

/** `_country_of_source`: the country a portal speaks for, from its slug or from its host. */
function countryOfSource(source: string | null | undefined, url: string | null | undefined): string | null {
  const candidates: string[] = [];
  const slug = String(source ?? "").trim().toLowerCase();
  if (slug) {
    const parts = slug.split(/[^a-z0-9]+/).filter(Boolean);
    if (parts.length > 1) candidates.push(parts[parts.length - 1]!, parts[0]!);
  }
  let host = "";
  if (typeof url === "string") host = /^https?:\/\/([^/\s?#]+)/i.exec(url.trim())?.[1]?.toLowerCase() ?? "";
  if (host) {
    const labels = host.split(".");
    const world = labels.some((label) => WORLD_HOSTS.includes(`${label}.`));
    if (labels.length > 2) candidates.push(labels[0]!);
    if (!world) candidates.push(labels[labels.length - 1]!);
  }
  for (let cand of candidates) {
    cand = TLD_COUNTRY[cand] ?? cand;
    if (cand.length === 2 && CODES.has(cand)) return cand;
  }
  return null;
}

/** `scout_area.derive_country`: the country code of a position from what the Scout wrote, or null. */
export function deriveCountry(location: unknown, source?: string | null, url?: string | null): string | null {
  try {
    const found = countryOf(location);
    if (found) return found;
    if (typeof location === "string" && location.trim()) {
      const parts = location.split(/[,;/|()\-–]+/);
      const bracketed = [...location.matchAll(/\(\s*([A-Za-z]{2})\s*\)/g)].some((m) => {
        const code = m[1]!;
        return code === code.toUpperCase() && ITALIAN_PROVINCES.has(code);
      });
      if (saysItaly(parts) || bracketed) return "it";
    }
    return countryOfSource(source, url);
  } catch {
    return null;
  }
}

/** `scout_area.country_name`: the English name a code stands for (`it` → `Italy`), or the code. */
export function countryName(code: string): string {
  const listed = COUNTRY_NAMES[code.toLowerCase()];
  if (!listed || !listed.length) return code.toUpperCase();
  // Python's str.title(): every word capitalised, the rest lowercase (`u.s.` is not a first name, and the first name is a real one).
  return listed[0]!.replace(/[A-Za-z]+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
