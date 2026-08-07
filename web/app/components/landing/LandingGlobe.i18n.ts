// Dizionario di `LandingGlobe.tsx` (vetrina del globo in home).
//
// Chiavi LOCALI al componente; `satisfies Dictionary` obbliga il
// compilatore a pretendere tutte e sette le lingue. La lingua attiva
// arriva dal provider della landing (useLandingI18n), non dal cookie:
// così il selettore lingua della nav traduce anche il contenuto della
// vetrina.
import type { Dictionary } from "@/lib/i18n-dict";

export const T = {
  // Riga sotto al globo. La vetrina mostra città, mestieri e punteggi
  // con la stessa faccia che hanno nell'area riservata: senza una frase
  // che lo dica, un visitatore ha tutto il diritto di credere che il
  // prodotto stia trovando quelle offerte in quel momento. Non è un
  // timbro tecnico appiccicato sopra la scena — è una frase, scritta
  // come si scrive al lettore, che dice cosa sta guardando.
  showcase_note: {
    it: "Le città, i ruoli e i punteggi sul globo sono un esempio: mostrano come la squadra ti presenta ciò che trova, non sono offerte reali.",
    en: "The cities, roles and scores on the globe are an example: they show how the team presents what it finds — they are not real openings.",
    hu: "A földgömbön látható városok, munkakörök és pontszámok példák: azt mutatják, hogyan tárja eléd a csapat, amit talál — nem valódi álláshirdetések.",
    es: "Las ciudades, los puestos y las puntuaciones del globo son un ejemplo: muestran cómo el equipo te presenta lo que encuentra, no son ofertas reales.",
    de: "Die Städte, Rollen und Punktzahlen auf dem Globus sind ein Beispiel: Sie zeigen, wie das Team präsentiert, was es findet — echte Stellenangebote sind das nicht.",
    fr: "Les villes, les métiers et les scores sur le globe sont un exemple : ils montrent comment l’équipe vous présente ce qu’elle trouve, ce ne sont pas de vraies offres.",
    pt: "As cidades, as funções e as pontuações no globo são um exemplo: mostram como a equipa te apresenta o que encontra, não são ofertas reais.",
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
