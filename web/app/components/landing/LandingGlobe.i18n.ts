// Dizionario di `LandingGlobe.tsx` (vetrina del globo in home).
//
// Chiavi LOCALI al componente; `satisfies Dictionary` obbliga il
// compilatore a pretendere tutte e sette le lingue. La lingua attiva
// arriva dal provider della landing (useLandingI18n), non dal cookie:
// così il badge segue il selettore lingua della nav come il resto
// della pagina.
import type { Dictionary } from "@/lib/i18n-dict";

export const T = {
  // Dicitura sobria ma sempre visibile: i punteggi mostrati sono un
  // esempio, non risultati reali di qualcuno.
  demo_badge: {
    it: "Dati dimostrativi",
    en: "Sample data",
    hu: "Bemutató adatok",
    es: "Datos de demostración",
    de: "Beispieldaten",
    fr: "Données de démonstration",
    pt: "Dados de demonstração",
  },
  // Kicker della card che appare quando l'autopilota si ferma su una
  // città: dice in tre parole cosa fa il prodotto.
  card_kicker: {
    it: "Trovate dal team",
    en: "Found by the team",
    hu: "A csapat találatai",
    es: "Encontradas por el equipo",
    de: "Vom Team gefunden",
    fr: "Trouvées par l'équipe",
    pt: "Encontradas pela equipa",
  },
  // Alt dell'immagine statica di ripiego + descrizione accessibile
  // dell'intera vetrina (il globo animato è aria-hidden).
  globe_alt: {
    it: "Globo terrestre con posizioni di esempio trovate dal team: fasci di luce sulle città del mondo, alti quanto il punteggio di affinità calcolato dagli agenti.",
    en: "Earth globe with sample positions found by the team: beams of light over cities around the world, as tall as the match score computed by the agents.",
    hu: "Földgömb a csapat által talált minta-pozíciókkal: fénynyalábok a világ városai fölött, olyan magasak, amekkora az ügynökök által számított pontszám.",
    es: "Globo terráqueo con puestos de ejemplo encontrados por el equipo: haces de luz sobre ciudades del mundo, tan altos como la puntuación de afinidad calculada por los agentes.",
    de: "Erdglobus mit Beispiel-Stellen, die das Team gefunden hat: Lichtsäulen über Städten weltweit, so hoch wie der von den Agenten berechnete Match-Score.",
    fr: "Globe terrestre avec des postes d'exemple trouvés par l'équipe : des faisceaux de lumière sur les villes du monde, aussi hauts que le score de compatibilité calculé par les agents.",
    pt: "Globo terrestre com vagas de exemplo encontradas pela equipa: feixes de luz sobre cidades do mundo, tão altos quanto a pontuação de afinidade calculada pelos agentes.",
  },
} as const satisfies Dictionary;
