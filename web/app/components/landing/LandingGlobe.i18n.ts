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
  // Etichetta del globo VIVO. Non è l'alt dell'immagine: quella descrive
  // un fermo immagine, questa descrive una scena che si muove e che si
  // può prendere in mano. Chi non vede lo schermo deve sapere entrambe
  // le cose — cosa c'è e cosa può farci.
  globe_live_label: {
    it: "Globo terrestre delle ricerche di lavoro: gira da solo fra le città del mondo e mostra un'opportunità alla volta. Si può girare con il mouse e cliccare un segnaposto per leggerne la scheda.",
    en: "Earth globe of job searches: it turns on its own between cities around the world and shows one opportunity at a time. You can turn it with the mouse and click a pin to read its card.",
    hu: "Álláskereséseket bemutató földgömb: magától forog a világ városai között, és egyszerre egy lehetőséget mutat. Egérrel forgatható, és a jelölőkre kattintva elolvasható a kártyájuk.",
    es: "Globo terráqueo de búsquedas de empleo: gira solo entre ciudades del mundo y muestra una oportunidad cada vez. Puedes girarlo con el ratón y hacer clic en un marcador para leer su ficha.",
    de: "Erdglobus der Jobsuchen: Er dreht sich von selbst zwischen Städten weltweit und zeigt jeweils eine Chance. Mit der Maus lässt er sich drehen, ein Klick auf einen Marker öffnet dessen Karte.",
    fr: "Globe terrestre des recherches d’emploi : il tourne tout seul entre les villes du monde et montre une opportunité à la fois. On peut le faire tourner à la souris et cliquer sur un repère pour lire sa fiche.",
    pt: "Globo terrestre das pesquisas de emprego: roda sozinho entre cidades do mundo e mostra uma oportunidade de cada vez. Podes rodá-lo com o rato e clicar num marcador para ler a sua ficha.",
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
