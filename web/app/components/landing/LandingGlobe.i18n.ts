// Dizionario di `LandingGlobe.tsx` (vetrina del globo in home).
//
// Chiavi LOCALI al componente; `satisfies Dictionary` obbliga il
// compilatore a pretendere tutte e sette le lingue. La lingua attiva
// arriva dal provider della landing (useLandingI18n), non dal cookie:
// così il selettore lingua della nav traduce anche il contenuto della
// vetrina.
import type { Dictionary } from "@/lib/i18n-dict";

export const T = {
  // Kicker della card: esplicita che le righe rappresentano le opportunità
  // della singola ricerca mostrata in quella città.
  card_kicker: {
    it: "Opportunità per questa ricerca",
    en: "Opportunities for this search",
    hu: "Lehetőségek ehhez a kereséshez",
    es: "Oportunidades para esta búsqueda",
    de: "Chancen für diese Suche",
    fr: "Opportunités pour cette recherche",
    pt: "Oportunidades para esta pesquisa",
  },
  // Nomi dei continenti del tour, mostrati nella card della tappa
  // accanto al paese: rendono leggibile il filo del viaggio (Europa →
  // Americhe → Australia → Asia → Medio Oriente). Le chiavi sono
  // composte a runtime: `continent_${stop.continent}`.
  continent_europe: {
    it: "Europa",
    en: "Europe",
    hu: "Európa",
    es: "Europa",
    de: "Europa",
    fr: "Europe",
    pt: "Europa",
  },
  continent_america: {
    it: "Americhe",
    en: "Americas",
    hu: "Amerika",
    es: "América",
    de: "Amerika",
    fr: "Amériques",
    pt: "Américas",
  },
  continent_australia: {
    it: "Australia",
    en: "Australia",
    hu: "Ausztrália",
    es: "Australia",
    de: "Australien",
    fr: "Australie",
    pt: "Austrália",
  },
  continent_asia: {
    it: "Asia",
    en: "Asia",
    hu: "Ázsia",
    es: "Asia",
    de: "Asien",
    fr: "Asie",
    pt: "Ásia",
  },
  continent_middle_east: {
    it: "Medio Oriente",
    en: "Middle East",
    hu: "Közel-Kelet",
    es: "Oriente Medio",
    de: "Naher Osten",
    fr: "Moyen-Orient",
    pt: "Médio Oriente",
  },
  // Alt dell'immagine statica di ripiego + descrizione accessibile
  // dell'intera vetrina (il globo animato è aria-hidden).
  globe_alt: {
    it: "Globo terrestre delle ricerche di lavoro: fasci di luce sulle città del mondo, alti quanto il punteggio di affinità calcolato dagli agenti.",
    en: "Earth globe of job searches: beams of light over cities around the world, as tall as the match score computed by the agents.",
    hu: "Álláskereséseket bemutató földgömb: fénynyalábok a világ városai fölött, olyan magasak, amekkora az ügynökök által számított pontszám.",
    es: "Globo terráqueo de búsquedas de empleo: haces de luz sobre ciudades del mundo, tan altos como la puntuación de afinidad calculada por los agentes.",
    de: "Erdglobus der Jobsuchen: Lichtsäulen über Städten weltweit, so hoch wie der von den Agenten berechnete Match-Score.",
    fr: "Globe terrestre des recherches d’emploi : des faisceaux de lumière sur les villes du monde, aussi hauts que le score de compatibilité calculé par les agents.",
    pt: "Globo terrestre das pesquisas de emprego: feixes de luz sobre cidades do mundo, tão altos quanto a pontuação de afinidade calculada pelos agentes.",
  },
} as const satisfies Dictionary;
