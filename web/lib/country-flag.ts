// Bandierina del paese per la card Località della pagina posizione.
//
// Fonte primaria: `loc_country_code` (ISO-3166 alpha-2, scritto dall'Analista
// dalla skill location-enrichment). Fallback: il NOME inglese del paese
// (`loc_country`) via tabella — le righe pre-enrichment non hanno il codice.
// La bandiera è la coppia di Regional Indicator derivata dal codice: rende
// su tutti gli OS senza asset. Se non risolvibile → null (nessuna bandiera).

const NAME_TO_ISO: Record<string, string> = {
  germany: "DE",
  italy: "IT",
  spain: "ES",
  france: "FR",
  portugal: "PT",
  hungary: "HU",
  poland: "PL",
  austria: "AT",
  denmark: "DK",
  switzerland: "CH",
  sweden: "SE",
  norway: "NO",
  finland: "FI",
  netherlands: "NL",
  "the netherlands": "NL",
  belgium: "BE",
  luxembourg: "LU",
  ireland: "IE",
  "united kingdom": "GB",
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  "czech republic": "CZ",
  czechia: "CZ",
  slovakia: "SK",
  slovenia: "SI",
  croatia: "HR",
  romania: "RO",
  bulgaria: "BG",
  greece: "GR",
  estonia: "EE",
  latvia: "LV",
  lithuania: "LT",
  malta: "MT",
  cyprus: "CY",
  iceland: "IS",
  ukraine: "UA",
  serbia: "RS",
  albania: "AL",
  "north macedonia": "MK",
  montenegro: "ME",
  "bosnia and herzegovina": "BA",
  turkey: "TR",
  türkiye: "TR",
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  canada: "CA",
  mexico: "MX",
  brazil: "BR",
  argentina: "AR",
  chile: "CL",
  colombia: "CO",
  india: "IN",
  china: "CN",
  japan: "JP",
  "south korea": "KR",
  singapore: "SG",
  "hong kong": "HK",
  taiwan: "TW",
  vietnam: "VN",
  thailand: "TH",
  indonesia: "ID",
  malaysia: "MY",
  philippines: "PH",
  australia: "AU",
  "new zealand": "NZ",
  israel: "IL",
  "united arab emirates": "AE",
  uae: "AE",
  qatar: "QA",
  "saudi arabia": "SA",
  kuwait: "KW",
  bahrain: "BH",
  oman: "OM",
  egypt: "EG",
  "south africa": "ZA",
  morocco: "MA",
  tunisia: "TN",
  kenya: "KE",
  nigeria: "NG",
};

export function countryFlag(
  code?: string | null,
  name?: string | null,
): string | null {
  let iso = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) {
    iso = NAME_TO_ISO[(name ?? "").trim().toLowerCase()] ?? "";
  }
  if (!/^[A-Z]{2}$/.test(iso)) return null;
  return String.fromCodePoint(
    ...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}
