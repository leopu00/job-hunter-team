// Pagina principale /case-studies — landing della sezione.
//
// Spiega cos'è (dati reali e anonimi di team in esecuzione su profili veri),
// elenca i case study disponibili come card (→ /case-studies/[id]) e incentiva
// gli utenti a contribuire i propri dati, referenziando i doc GitHub.
// È pensata per crescere: col tempo accoglierà il monitoraggio di più team.

import Link from "next/link";
import { LandingI18nProvider } from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import {
  CASE_STUDIES,
  CONTRIBUTE_LINKS,
  caseRunInfo,
  localizeCaseStudy,
} from "@/lib/case-studies";
import ProviderStats from "./ProviderStats";
import { getRequestLocale } from "@/lib/request-locale";
import type { Locale } from "@/i18n/config";
import { intlTag } from "@/lib/locale-tag";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Case studies · Job Hunter Team",
  description:
    "Dati reali e anonimi di team di agenti Job Hunter Team in esecuzione su profili veri. Guarda i risultati, e contribuisci con i tuoi dati.",
};

const T: Record<
  Locale,
  {
    metaTitle: string;
    metaDescription: string;
    heroKicker: string;
    heroTitlePre: string;
    heroTitleEmph: string;
    heroTitlePost: string;
    heroLeadPre: string;
    heroLeadStrong: string;
    heroLeadPost: string;
    heroSub: string;
    positions: string;
    avgMatch: string;
    strongMatch: string;
    cardDays: string;
    cumTitle: string;
    cumLead: string;
    cumDays: string;
    cumCases: string;
    cumPositions: string;
    cumScoreTitle: string;
    cumScoreEmpty: string;
    cumFunnelTitle: string;
    priceTitle: string;
    priceEstimate: string;
    priceLead: string;
    pricePosition: string;
    priceScored: string;
    priceStrong: string;
    priceExcellent: string;
    priceChartTitle: string;
    priceCaption: string;
    dailyTitle: string;
    dailyLead: string;
    dailyAvgStrong: string;
    dailyAvgExcellent: string;
    dailyChartTitle: string;
    dailyUnit: string;
    dailyCaption: string;
    dashTitle: string;
    dashLead: string;
    dashExcellent: string;
    dashCostExcellent: string;
    dashPositions: string;
    dashCaption: string;
    tierTitle: string;
    tierLead: string;
    matchDayCardTitle: string;
    matchDayCaption: string;
    costCardTitle: string;
    costCaption: string;
    moreComingTitle: string;
    moreComingSub: string;
    contributeTitle: string;
    contributeLead: string;
    betaTitle: string;
    betaBody: string;
    selfHostTitle: string;
    selfHostBody: string;
    repository: string;
    footer: string;
  }
> = {
  it: {
    metaTitle: "Case studies · Job Hunter Team",
    metaDescription:
      "Dati reali e anonimi di team di agenti Job Hunter Team in esecuzione su profili veri. Guarda i risultati, e contribuisci con i tuoi dati.",
    heroKicker: "Case studies · dati di campo reali e anonimi",
    heroTitlePre: "Cosa fa ",
    heroTitleEmph: "davvero",
    heroTitlePost: " un team Job Hunter",
    heroLeadPre:
      "Questa pagina raccoglie i risultati reali dei team Job Hunter messi al lavoro su ",
    heroLeadStrong: "profili candidato veri",
    heroLeadPost:
      " — quante posizioni trovano, con che qualità di match e a che costo. Dati aggregati e anonimi, da run reali, senza alcuna informazione personale.",
    heroSub:
      "È una pagina viva: cresce a ogni nuovo team monitorato. Scegli un case study qui sotto per vedere tutti i risultati.",
    positions: "posizioni",
    avgMatch: "match medio",
    strongMatch: "match forti",
    cardDays: "giorni lavorati",
    cumTitle: "In media, per case study",
    cumLead:
      "Non la somma, ma la MEDIA sui case study monitorati: cosa produce una run tipo. Le run hanno durate diverse, quindi è un valore indicativo — per dati mensili accurati servono run da un mese intero.",
    cumDays: "giorni / studio",
    cumCases: "case study",
    cumPositions: "posizioni / studio",
    cumScoreTitle: "Distribuzione dei match · tutti i profili",
    cumScoreEmpty: "Ancora nessuno score",
    cumFunnelTitle: "Dal trovato al match forte · media per studio",
    priceTitle: "Prezzo medio per risultato",
    priceEstimate: "stima",
    priceLead:
      "Media del costo per risultato sui case study (canone mensile ÷ output del mese). Mescola abbonamenti da €100 (Codex) e €40 (Kimi) ed è in gran parte stimata (solo finance è ~un mese reale) → valore indicativo.",
    pricePosition: "per posizione trovata",
    priceScored: "per posizione valutata",
    priceStrong: "per match forte ≥70",
    priceExcellent: "per match eccellente ≥80",
    priceChartTitle: "Prezzo medio per risultato · per livello di qualità",
    priceCaption:
      "Più alto è il livello di qualità richiesto, più sale il costo per singolo risultato.",
    dailyTitle: "Match ad alto score al giorno",
    dailyLead:
      "In media, quante posizioni ad alto score (≥70) ed eccellente (≥80) produce il team al giorno — distribuendo l'output sul budget di un mese, così le run brevi che hanno bruciato una settimana di budget in pochi giorni non risultano gonfiate.",
    dailyAvgStrong: "≥70 / giorno (media)",
    dailyAvgExcellent: "≥80 / giorno (media)",
    dailyChartTitle: "Media al giorno · per profilo",
    dailyUnit: "giorno",
    dailyCaption:
      "Ritmo sostenibile: output mensile stimato ÷ giorni del mese, esclusa la sessione free-run senza monitor (troppo breve per essere rappresentativa); la quota ≥80 è evidenziata in verde vivo.",
    dashTitle: "La media, per utente",
    dashLead:
      "I numeri distillati per un mese di abbonamento: l'output di ogni caso proiettato su un mese in base al budget consumato — così una run breve non abbassa la media, né una intensiva la gonfia. Esclude il free-run.",
    dashExcellent: "match eccellenti ≥80 / giorno",
    dashCostExcellent: "costo / match eccellente ≥80",
    dashPositions: "posizioni / mese",
    dashCaption:
      "Proiezione a un mese in base al budget consumato da ogni run (escluso il free-run); conteggi arrotondati, costo per match eccellente.",
    tierTitle: "Resa e prezzo per livello di qualità",
    tierLead:
      "Quanti match al giorno il team produce a ogni livello e quanto costa in media ogni singolo risultato. Media sui tre casi, proiettata su un mese di budget (free-run escluso).",
    matchDayCardTitle: "📈 Match al giorno · per livello",
    matchDayCaption:
      "Match/giorno in media, proiettati su un mese di budget. La riga ≥80 coincide con gli eccellenti/giorno del riepilogo qui sopra.",
    costCardTitle: "💶 Prezzo medio per risultato · per livello di qualità",
    costCaption:
      "Più alto è il livello di qualità richiesto, più sale il costo per singolo risultato. La riga ≥80 coincide con il costo per eccellente del riepilogo qui sopra.",
    moreComingTitle: "Altri case study in arrivo",
    moreComingSub: "il tuo potrebbe essere il prossimo",
    contributeTitle: "Contribuisci con i tuoi dati",
    contributeLead:
      "Più profili reali raccogliamo, più questa pagina diventa utile a chi cerca lavoro. Fai girare Job Hunter Team sulla tua ricerca e condividi i risultati: aggregati e anonimi, possono diventare il prossimo case study.",
    betaTitle: "Diventa un case study",
    betaBody:
      "Fai girare il team sulla tua ricerca e condividi i risultati: ti guidiamo noi, non serve essere tecnici. Pubblichiamo solo dati aggregati e anonimi.",
    selfHostTitle: "Self-host & contribuisci",
    selfHostBody:
      "Installa Job Hunter in locale o sul tuo VPS, usalo sulla tua ricerca e apri una PR con i tuoi dati. Tutto open source.",
    repository: "Repository:",
    footer:
      "Dati anonimi da run reali del team · snapshot committati, nessuna informazione personale del candidato.",
  },
  en: {
    metaTitle: "Case studies · Job Hunter Team",
    metaDescription:
      "Real, anonymous data from Job Hunter Team agent teams running on real profiles. See the results, and contribute your own data.",
    heroKicker: "Case studies · real, anonymous field data",
    heroTitlePre: "What a Job Hunter team ",
    heroTitleEmph: "really",
    heroTitlePost: " does",
    heroLeadPre:
      "This page collects the real results of Job Hunter teams put to work on ",
    heroLeadStrong: "real candidate profiles",
    heroLeadPost:
      " — how many positions they find, at what match quality and at what cost. Aggregated, anonymous data from real runs, no personal information.",
    heroSub:
      "It's a living page: it grows with every new team we monitor. Pick a case study below to see all the results.",
    positions: "positions",
    avgMatch: "average match",
    strongMatch: "strong matches",
    cardDays: "working days",
    cumTitle: "On average, per case study",
    cumLead:
      "Not the sum, but the AVERAGE across the monitored case studies: what a typical run produces. Runs have different lengths, so it's indicative — accurate monthly figures need full-month runs.",
    cumDays: "days / study",
    cumCases: "case studies",
    cumPositions: "positions / study",
    cumScoreTitle: "Match distribution · all profiles",
    cumScoreEmpty: "No scores yet",
    cumFunnelTitle: "From found to strong match · average per study",
    priceTitle: "Average price per result",
    priceEstimate: "estimate",
    priceLead:
      "Average cost per result across the case studies (monthly fee ÷ the month's output). It blends €100 (Codex) and €40 (Kimi) subscriptions and is mostly estimated (only finance is ~a real month) → indicative.",
    pricePosition: "per position found",
    priceScored: "per position scored",
    priceStrong: "per strong match ≥70",
    priceExcellent: "per excellent match ≥80",
    priceChartTitle: "Average price per result · by quality tier",
    priceCaption:
      "The higher the quality bar, the higher the cost per single result.",
    dailyTitle: "High-score matches per day",
    dailyLead:
      "On average, how many high-score (≥70) and excellent (≥80) positions the team produces per day — spreading the output over a month of budget, so short runs that burned a week of budget in a few days aren't inflated.",
    dailyAvgStrong: "≥70 / day (avg)",
    dailyAvgExcellent: "≥80 / day (avg)",
    dailyChartTitle: "Average per day · by profile",
    dailyUnit: "day",
    dailyCaption:
      "Sustainable pace: estimated monthly output ÷ days in a month, excluding the unmonitored free-run session (too short to be representative); the ≥80 share is highlighted in bright green.",
    dashTitle: "On average, per user",
    dashLead:
      "The numbers distilled for one month of subscription: each case's output projected over a month based on the budget it used — so a short run doesn't drag the average down, nor an intensive one inflate it. Free-run excluded.",
    dashExcellent: "excellent ≥80 matches / day",
    dashCostExcellent: "cost / excellent ≥80 match",
    dashPositions: "positions / month",
    dashCaption:
      "Projected to a month from the budget each run used (free-run excluded); counts rounded, cost per excellent match.",
    tierTitle: "Yield and price per quality level",
    tierLead:
      "How many matches per day the team produces at each level, and how much each single result costs on average. Averaged over the three cases, projected over a month of budget (free-run excluded).",
    matchDayCardTitle: "📈 Matches per day · by level",
    matchDayCaption:
      "Matches/day on average, projected over a month of budget. The ≥80 row equals the excellent/day figure in the summary above.",
    costCardTitle: "💶 Average price per result · by quality level",
    costCaption:
      "The higher the quality bar, the higher the cost per single result. The ≥80 row equals the cost per excellent in the summary above.",
    moreComingTitle: "More case studies coming",
    moreComingSub: "yours could be next",
    contributeTitle: "Contribute your data",
    contributeLead:
      "The more real profiles we collect, the more useful this page becomes for job seekers. Run Job Hunter on your search and share the results (aggregated and anonymous): it only takes a few steps.",
    betaTitle: "Become a beta tester",
    betaBody:
      "Run the team for a few weeks on your search and share the results: we'll help you with the setup. Guide and data model on GitHub.",
    selfHostTitle: "Self-host & contribute",
    selfHostBody:
      "Install Job Hunter locally or on your VPS, use it on your search and open a PR with your data. Fully open source.",
    repository: "Repository:",
    footer:
      "Anonymous data from real team runs · committed snapshots, no personal information about the candidate.",
  },
  es: {
    metaTitle: "Casos de estudio · Job Hunter Team",
    metaDescription:
      "Datos reales y anónimos de equipos de agentes Job Hunter Team ejecutándose sobre perfiles reales. Mira los resultados y contribuye con tus datos.",
    heroKicker: "Casos de estudio · datos de campo reales y anónimos",
    heroTitlePre: "Lo que ",
    heroTitleEmph: "realmente",
    heroTitlePost: " hace un equipo Job Hunter",
    heroLeadPre:
      "Esta página recoge los resultados reales de los equipos Job Hunter puestos a trabajar sobre ",
    heroLeadStrong: "perfiles de candidato reales",
    heroLeadPost:
      " — cuántos puestos encuentran, con qué grado de coincidencia y a qué coste. Datos agregados y anónimos, de ejecuciones reales, sin ninguna información personal.",
    heroSub:
      "Es una página viva: crece con cada nuevo equipo monitorizado. Elige un caso de estudio abajo para ver todos los resultados.",
    positions: "puestos",
    avgMatch: "coincidencia media",
    strongMatch: "coincidencias fuertes",
    cardDays: "días trabajados",
    cumTitle: "En promedio, por caso de estudio",
    cumLead:
      "No la suma, sino el PROMEDIO de los casos de estudio monitorizados: lo que produce una ejecución típica. Las ejecuciones tienen duraciones distintas, así que es indicativo — para datos mensuales precisos hacen falta ejecuciones de un mes completo.",
    cumDays: "días / estudio",
    cumCases: "casos de estudio",
    cumPositions: "posiciones / estudio",
    cumScoreTitle: "Distribución de match · todos los perfiles",
    cumScoreEmpty: "Aún no hay puntuaciones",
    cumFunnelTitle: "De encontrada a match fuerte · promedio por estudio",
    priceTitle: "Precio medio por resultado",
    priceEstimate: "estimación",
    priceLead:
      "Coste medio por resultado en los casos de estudio (cuota mensual ÷ output del mes). Mezcla suscripciones de €100 (Codex) y €40 (Kimi) y es en gran parte estimado (solo finance es ~un mes real) → indicativo.",
    pricePosition: "por posición encontrada",
    priceScored: "por posición evaluada",
    priceStrong: "por match fuerte ≥70",
    priceExcellent: "por match excelente ≥80",
    priceChartTitle: "Precio medio por resultado · por nivel de calidad",
    priceCaption:
      "Cuanto mayor es el nivel de calidad exigido, más sube el coste por resultado.",
    dailyTitle: "Match de score alto al día",
    dailyLead:
      "De media, cuántas posiciones de score alto (≥70) y excelente (≥80) produce el equipo al día — repartiendo el output sobre un mes de presupuesto, para que las ejecuciones cortas que gastaron una semana de presupuesto en pocos días no salgan infladas.",
    dailyAvgStrong: "≥70 / día (media)",
    dailyAvgExcellent: "≥80 / día (media)",
    dailyChartTitle: "Media al día · por perfil",
    dailyUnit: "día",
    dailyCaption:
      "Ritmo sostenible: output mensual estimado ÷ días del mes, excluida la sesión free-run sin monitor (demasiado corta para ser representativa); la cuota ≥80 está resaltada en verde vivo.",
    dashTitle: "En promedio, por usuario",
    dashLead:
      "Los números destilados para un mes de suscripción: el output de cada caso proyectado sobre un mes según el presupuesto usado — así una ejecución corta no baja la media, ni una intensiva la infla. Free-run excluido.",
    dashExcellent: "match excelentes ≥80 / día",
    dashCostExcellent: "coste / match excelente ≥80",
    dashPositions: "posiciones / mes",
    dashCaption:
      "Proyección a un mes según el presupuesto usado por cada ejecución (free-run excluido); conteos redondeados, coste por match excelente.",
    tierTitle: "Rendimiento y precio por nivel de calidad",
    tierLead:
      "Cuántos match al día produce el equipo en cada nivel y cuánto cuesta de media cada resultado. Media sobre los tres casos, proyectada sobre un mes de presupuesto (sin el free-run).",
    matchDayCardTitle: "📈 Match al día · por nivel",
    matchDayCaption:
      "Match/día de media, proyectados sobre un mes de presupuesto. La fila ≥80 coincide con los excelentes/día del resumen de arriba.",
    costCardTitle: "💶 Precio medio por resultado · por nivel de calidad",
    costCaption:
      "Cuanto más alto es el nivel de calidad exigido, más sube el coste por resultado. La fila ≥80 coincide con el coste por excelente del resumen de arriba.",
    moreComingTitle: "Más casos de estudio en camino",
    moreComingSub: "el tuyo podría ser el próximo",
    contributeTitle: "Contribuye con tus datos",
    contributeLead:
      "Cuantos más perfiles reales recopilemos, más útil será esta página para quien busca trabajo. Ejecuta Job Hunter en tu búsqueda y comparte los resultados (agregados y anónimos): bastan unos pocos pasos.",
    betaTitle: "Conviértete en beta tester",
    betaBody:
      "Ejecuta el equipo durante unas semanas en tu búsqueda y comparte los resultados: te ayudamos con la configuración. Guía y modelo de datos en GitHub.",
    selfHostTitle: "Auto-aloja y contribuye",
    selfHostBody:
      "Instala Job Hunter en local o en tu VPS, úsalo en tu búsqueda y abre una PR con tus datos. Todo open source.",
    repository: "Repositorio:",
    footer:
      "Datos anónimos de ejecuciones reales del equipo · snapshots versionados, sin información personal del candidato.",
  },
  fr: {
    metaTitle: "Études de cas · Job Hunter Team",
    metaDescription:
      "Données réelles et anonymes d'équipes d'agents Job Hunter Team exécutées sur de vrais profils. Voyez les résultats et contribuez avec vos données.",
    heroKicker: "Études de cas · données de terrain réelles et anonymes",
    heroTitlePre: "Ce qu'une équipe Job Hunter fait ",
    heroTitleEmph: "vraiment",
    heroTitlePost: "",
    heroLeadPre:
      "Cette page rassemble les résultats réels des équipes Job Hunter à l'œuvre sur ",
    heroLeadStrong: "de vrais profils de candidat",
    heroLeadPost:
      " — combien de postes elles trouvent, avec quelle qualité de match et à quel coût. Données agrégées et anonymes, issues de runs réels, sans aucune information personnelle.",
    heroSub:
      "C'est une page vivante : elle grandit à chaque nouvelle équipe suivie. Choisis une étude de cas ci-dessous pour voir tous les résultats.",
    positions: "postes",
    avgMatch: "correspondance moyenne",
    strongMatch: "correspondances fortes",
    cardDays: "jours travaillés",
    cumTitle: "En moyenne, par étude de cas",
    cumLead:
      "Non pas la somme, mais la MOYENNE sur les études de cas suivies : ce que produit un run type. Les runs ont des durées différentes, c'est donc indicatif — des chiffres mensuels précis nécessitent des runs d'un mois entier.",
    cumDays: "jours / étude",
    cumCases: "études de cas",
    cumPositions: "postes / étude",
    cumScoreTitle: "Distribution des matchs · tous les profils",
    cumScoreEmpty: "Pas encore de score",
    cumFunnelTitle: "De trouvée à match fort · moyenne par étude",
    priceTitle: "Prix moyen par résultat",
    priceEstimate: "estimation",
    priceLead:
      "Coût moyen par résultat sur les études de cas (abonnement mensuel ÷ output du mois). Il mêle des abonnements à €100 (Codex) et €40 (Kimi) et est en grande partie estimé (seul finance est ~un mois réel) → indicatif.",
    pricePosition: "par poste trouvé",
    priceScored: "par poste évalué",
    priceStrong: "par match fort ≥70",
    priceExcellent: "par match excellent ≥80",
    priceChartTitle: "Prix moyen par résultat · par niveau de qualité",
    priceCaption:
      "Plus le niveau de qualité exigé est élevé, plus le coût par résultat augmente.",
    dailyTitle: "Matchs à score élevé par jour",
    dailyLead:
      "En moyenne, combien de postes à score élevé (≥70) et excellent (≥80) l'équipe produit par jour — en répartissant l'output sur un mois de budget, pour que les runs courts ayant consommé une semaine de budget en quelques jours ne soient pas gonflés.",
    dailyAvgStrong: "≥70 / jour (moy.)",
    dailyAvgExcellent: "≥80 / jour (moy.)",
    dailyChartTitle: "Moyenne par jour · par profil",
    dailyUnit: "jour",
    dailyCaption:
      "Rythme soutenable : output mensuel estimé ÷ jours du mois, hors session free-run sans monitor (trop courte pour être représentative) ; la part ≥80 est mise en évidence en vert vif.",
    dashTitle: "En moyenne, par utilisateur",
    dashLead:
      "Les chiffres distillés pour un mois d'abonnement : l'output de chaque cas projeté sur un mois selon le budget consommé — ainsi un run court ne fait pas baisser la moyenne, ni un run intensif ne la gonfle. Free-run exclu.",
    dashExcellent: "matchs excellents ≥80 / jour",
    dashCostExcellent: "coût / match excellent ≥80",
    dashPositions: "postes / mois",
    dashCaption:
      "Projeté sur un mois selon le budget consommé par chaque run (free-run exclu) ; comptes arrondis, coût par match excellent.",
    tierTitle: "Rendement et prix par niveau de qualité",
    tierLead:
      "Combien de matchs par jour l'équipe produit à chaque niveau, et combien coûte en moyenne chaque résultat. Moyenne sur les trois cas, projetée sur un mois de budget (free-run exclu).",
    matchDayCardTitle: "📈 Matchs par jour · par niveau",
    matchDayCaption:
      "Matchs/jour en moyenne, projetés sur un mois de budget. La ligne ≥80 correspond aux excellents/jour du récapitulatif ci-dessus.",
    costCardTitle: "💶 Prix moyen par résultat · par niveau de qualité",
    costCaption:
      "Plus le niveau de qualité exigé est élevé, plus le coût par résultat augmente. La ligne ≥80 correspond au coût par excellent du récapitulatif ci-dessus.",
    moreComingTitle: "D'autres études de cas à venir",
    moreComingSub: "la tienne pourrait être la prochaine",
    contributeTitle: "Contribue avec tes données",
    contributeLead:
      "Plus nous recueillons de profils réels, plus cette page devient utile pour qui cherche du travail. Lance Job Hunter sur ta recherche et partage les résultats (agrégés et anonymes) : il suffit de quelques étapes.",
    betaTitle: "Deviens testeur beta",
    betaBody:
      "Lance l'équipe pendant quelques semaines sur ta recherche et partage les résultats : on t'aide pour la configuration. Guide et modèle de données sur GitHub.",
    selfHostTitle: "Auto-héberge & contribue",
    selfHostBody:
      "Installe Job Hunter en local ou sur ton VPS, utilise-le sur ta recherche et ouvre une PR avec tes données. Tout en open source.",
    repository: "Dépôt :",
    footer:
      "Données anonymes issues de runs réels de l'équipe · snapshots versionnés, aucune information personnelle du candidat.",
  },
  de: {
    metaTitle: "Fallstudien · Job Hunter Team",
    metaDescription:
      "Echte, anonyme Daten von Job-Hunter-Team-Agententeams, die auf echten Profilen laufen. Sieh dir die Ergebnisse an und steuere deine eigenen Daten bei.",
    heroKicker: "Fallstudien · echte, anonyme Felddaten",
    heroTitlePre: "Was ein Job Hunter-Team ",
    heroTitleEmph: "wirklich",
    heroTitlePost: " leistet",
    heroLeadPre:
      "Diese Seite sammelt die realen Ergebnisse der Job Hunter-Teams, die auf ",
    heroLeadStrong: "echten Kandidatenprofilen",
    heroLeadPost:
      " zum Einsatz kamen — wie viele Stellen sie finden, mit welcher Match-Qualität und zu welchen Kosten. Aggregierte, anonyme Daten aus echten Runs, ohne jede persönliche Information.",
    heroSub:
      "Es ist eine lebendige Seite: Sie wächst mit jedem neu beobachteten Team. Wähle unten eine Fallstudie, um alle Ergebnisse zu sehen.",
    positions: "Stellen",
    avgMatch: "durchschnittlicher Match",
    strongMatch: "starke Matches",
    cardDays: "Arbeitstage",
    cumTitle: "Im Schnitt, pro Fallstudie",
    cumLead:
      "Nicht die Summe, sondern der DURCHSCHNITT über die beobachteten Fallstudien: was ein typischer Lauf produziert. Läufe haben unterschiedliche Längen, daher ist es indikativ — genaue Monatszahlen brauchen Läufe über einen vollen Monat.",
    cumDays: "Tage / Studie",
    cumCases: "Fallstudien",
    cumPositions: "Stellen / Studie",
    cumScoreTitle: "Match-Verteilung · alle Profile",
    cumScoreEmpty: "Noch keine Scores",
    cumFunnelTitle: "Von gefunden zu starkem Match · Schnitt pro Studie",
    priceTitle: "Durchschnittspreis pro Ergebnis",
    priceEstimate: "Schätzung",
    priceLead:
      "Durchschnittliche Kosten pro Ergebnis über die Fallstudien (Monatsgebühr ÷ Monats-Output). Mischt Abos zu €100 (Codex) und €40 (Kimi) und ist überwiegend geschätzt (nur Finance ist ~ein echter Monat) → indikativ.",
    pricePosition: "pro gefundener Stelle",
    priceScored: "pro bewerteter Stelle",
    priceStrong: "pro starkem Match ≥70",
    priceExcellent: "pro exzellentem Match ≥80",
    priceChartTitle: "Durchschnittspreis pro Ergebnis · nach Qualitätsstufe",
    priceCaption:
      "Je höher die geforderte Qualität, desto höher die Kosten pro einzelnem Ergebnis.",
    dailyTitle: "Hoch bewertete Matches pro Tag",
    dailyLead:
      "Im Schnitt, wie viele hoch (≥70) und exzellent (≥80) bewertete Positionen das Team pro Tag produziert — verteilt über einen Monat Budget, damit kurze Läufe, die eine Budgetwoche in wenigen Tagen verbraucht haben, nicht überhöht wirken.",
    dailyAvgStrong: "≥70 / Tag (Ø)",
    dailyAvgExcellent: "≥80 / Tag (Ø)",
    dailyChartTitle: "Durchschnitt pro Tag · je Profil",
    dailyUnit: "Tag",
    dailyCaption:
      "Nachhaltiges Tempo: geschätzter Monats-Output ÷ Tage im Monat, ohne die unüberwachte Free-Run-Session (zu kurz, um repräsentativ zu sein); der ≥80-Anteil ist in kräftigem Grün hervorgehoben.",
    dashTitle: "Im Schnitt, pro Nutzer",
    dashLead:
      "Die Zahlen destilliert für einen Abo-Monat: der Output jedes Falls auf einen Monat projiziert anhand des verbrauchten Budgets — so drückt ein kurzer Lauf den Schnitt nicht und ein intensiver bläht ihn nicht auf. Free-Run ausgeschlossen.",
    dashExcellent: "exzellente ≥80 Matches / Tag",
    dashCostExcellent: "Kosten / exzellenter ≥80 Match",
    dashPositions: "Stellen / Monat",
    dashCaption:
      "Auf einen Monat projiziert anhand des von jedem Lauf verbrauchten Budgets (Free-Run ausgeschlossen); Zahlen gerundet, Kosten pro exzellentem Match.",
    tierTitle: "Ertrag und Preis je Qualitätsstufe",
    tierLead:
      "Wie viele Matches pro Tag das Team je Stufe produziert und was jedes einzelne Ergebnis im Schnitt kostet. Gemittelt über die drei Fälle, auf einen Monat Budget projiziert (ohne Free-Run).",
    matchDayCardTitle: "📈 Matches pro Tag · nach Stufe",
    matchDayCaption:
      "Matches/Tag im Schnitt, auf einen Monat Budget projiziert. Die Zeile ≥80 entspricht den exzellenten/Tag in der Übersicht oben.",
    costCardTitle: "💶 Durchschnittspreis pro Ergebnis · nach Qualitätsstufe",
    costCaption:
      "Je höher die geforderte Qualität, desto höher die Kosten pro Ergebnis. Die Zeile ≥80 entspricht den Kosten je exzellentem Match in der Übersicht oben.",
    moreComingTitle: "Weitere Fallstudien folgen",
    moreComingSub: "deine könnte die nächste sein",
    contributeTitle: "Steuere deine Daten bei",
    contributeLead:
      "Je mehr echte Profile wir sammeln, desto nützlicher wird diese Seite für Jobsuchende. Lass Job Hunter auf deiner Suche laufen und teile die Ergebnisse (aggregiert und anonym): Es sind nur wenige Schritte.",
    betaTitle: "Werde Beta-Tester",
    betaBody:
      "Lass das Team ein paar Wochen auf deiner Suche laufen und teile die Ergebnisse: Wir helfen dir beim Setup. Anleitung und Datenmodell auf GitHub.",
    selfHostTitle: "Selbst hosten & beitragen",
    selfHostBody:
      "Installiere Job Hunter lokal oder auf deinem VPS, nutze es für deine Suche und öffne einen PR mit deinen Daten. Komplett Open Source.",
    repository: "Repository:",
    footer:
      "Anonyme Daten aus echten Team-Runs · versionierte Snapshots, keine persönlichen Informationen des Kandidaten.",
  },
  hu: {
    metaTitle: "Esettanulmányok · Job Hunter Team",
    metaDescription:
      "Valós, anonim adatok valódi profilokon futó Job Hunter Team ügynökcsapatoktól. Nézd meg az eredményeket, és járulj hozzá a saját adataiddal.",
    heroKicker: "Esettanulmányok · valós, anonim terepadatok",
    heroTitlePre: "Mit csinál ",
    heroTitleEmph: "valójában",
    heroTitlePost: " egy Job Hunter csapat",
    heroLeadPre: "Ez az oldal a ",
    heroLeadStrong: "valódi jelölti profilokon",
    heroLeadPost:
      " munkára fogott Job Hunter csapatok valós eredményeit gyűjti össze — hány pozíciót találnak, milyen match-minőséggel és mennyiért. Összesített, anonim adatok valós futásokból, semmilyen személyes információ.",
    heroSub:
      "Ez egy élő oldal: minden új megfigyelt csapattal bővül. Válassz egy esettanulmányt alább az összes eredmény megtekintéséhez.",
    positions: "pozíció",
    avgMatch: "átlagos egyezés",
    strongMatch: "erős egyezések",
    cardDays: "munkanap",
    cumTitle: "Átlagosan, esettanulmányonként",
    cumLead:
      "Nem az összeg, hanem az ÁTLAG a megfigyelt esettanulmányokon: mit produkál egy tipikus futás. A futások eltérő hosszúságúak, ezért ez irányadó — pontos havi adatokhoz teljes hónapos futások kellenek.",
    cumDays: "nap / tanulmány",
    cumCases: "esettanulmány",
    cumPositions: "pozíció / tanulmány",
    cumScoreTitle: "Match-eloszlás · minden profil",
    cumScoreEmpty: "Még nincs pontszám",
    cumFunnelTitle: "A találattól az erős matchig · átlag tanulmányonként",
    priceTitle: "Átlagár eredményenként",
    priceEstimate: "becslés",
    priceLead:
      "Az eredményenkénti költség átlaga az esettanulmányokon (havi díj ÷ havi output). Vegyíti a €100 (Codex) és €40 (Kimi) előfizetéseket, és nagyrészt becsült (csak a finance ~egy valós hónap) → irányadó.",
    pricePosition: "talált pozíciónként",
    priceScored: "értékelt pozíciónként",
    priceStrong: "erős match ≥70",
    priceExcellent: "kiváló match ≥80",
    priceChartTitle: "Átlagár eredményenként · minőségi szint szerint",
    priceCaption:
      "Minél magasabb a megkövetelt minőség, annál nagyobb az egy eredményre jutó költség.",
    dailyTitle: "Magas pontszámú találatok naponta",
    dailyLead:
      "Átlagosan hány magas (≥70) és kiváló (≥80) pontszámú pozíciót termel a csapat naponta — az outputot egy havi budgetre elosztva, hogy a rövid futások (amelyek egy heti budgetet néhány nap alatt égettek el) ne tűnjenek felfújtnak.",
    dailyAvgStrong: "≥70 / nap (átlag)",
    dailyAvgExcellent: "≥80 / nap (átlag)",
    dailyChartTitle: "Napi átlag · profilonként",
    dailyUnit: "nap",
    dailyCaption:
      "Fenntartható tempó: becsült havi output ÷ a hónap napjai, a monitor nélküli free-run munkamenet kizárva (túl rövid ahhoz, hogy reprezentatív legyen); a ≥80 hányad élénkzölddel kiemelve.",
    dashTitle: "Átlagosan, felhasználónként",
    dashLead:
      "A számok egy előfizetési hónapra desztillálva: minden eset outputja egy hónapra vetítve az elhasznált budget alapján — így egy rövid futás nem húzza le az átlagot, egy intenzív pedig nem fújja fel. A free-run kizárva.",
    dashExcellent: "kiváló ≥80 találat / nap",
    dashCostExcellent: "költség / kiváló ≥80 találat",
    dashPositions: "pozíció / hó",
    dashCaption:
      "Egy hónapra vetítve az egyes futások elhasznált budgetje alapján (free-run kizárva); a számok kerekítve, költség kiváló találatonként.",
    tierTitle: "Hozam és ár minőségi szintenként",
    tierLead:
      "Hány találatot termel a csapat naponta az egyes szinteken, és mennyibe kerül átlagosan egy-egy eredmény. A három eset átlaga, egy hónap budgetre vetítve (free-run nélkül).",
    matchDayCardTitle: "📈 Találatok naponta · szintenként",
    matchDayCaption:
      "Találat/nap átlagosan, egy hónap budgetre vetítve. A ≥80 sor megegyezik a fenti összegzés kiváló/nap értékével.",
    costCardTitle: "💶 Átlagár eredményenként · minőségi szintenként",
    costCaption:
      "Minél magasabb az elvárt minőség, annál nagyobb az egy eredményre jutó költség. A ≥80 sor megegyezik a fenti összegzés kiváló találat költségével.",
    moreComingTitle: "További esettanulmányok érkeznek",
    moreComingSub: "a tiéd lehet a következő",
    contributeTitle: "Járulj hozzá az adataiddal",
    contributeLead:
      "Minél több valódi profilt gyűjtünk, annál hasznosabb lesz ez az oldal az álláskeresőknek. Futtasd a Job Huntert a saját keresésedre, és oszd meg az eredményeket (összesítve és anonim módon): csak néhány lépés.",
    betaTitle: "Legyél béta tesztelő",
    betaBody:
      "Futtasd a csapatot néhány hétig a saját keresésedre, és oszd meg az eredményeket: segítünk a beállításban. Útmutató és adatmodell a GitHubon.",
    selfHostTitle: "Önkiszolgáló üzemeltetés & hozzájárulás",
    selfHostBody:
      "Telepítsd a Job Huntert helyben vagy a saját VPS-eden, használd a keresésedre, és nyiss egy PR-t az adataiddal. Teljesen nyílt forráskódú.",
    repository: "Repository:",
    footer:
      "Anonim adatok valódi csapatfutásokból · verziózott pillanatképek, semmilyen személyes információ a jelöltről.",
  },
  pt: {
    metaTitle: "Estudos de caso · Job Hunter Team",
    metaDescription:
      "Dados reais e anónimos de equipas de agentes Job Hunter Team a correr sobre perfis reais. Veja os resultados e contribua com os seus dados.",
    heroKicker: "Estudos de caso · dados de campo reais e anónimos",
    heroTitlePre: "O que uma equipa Job Hunter ",
    heroTitleEmph: "realmente",
    heroTitlePost: " faz",
    heroLeadPre:
      "Esta página reúne os resultados reais das equipas Job Hunter postas a trabalhar sobre ",
    heroLeadStrong: "perfis de candidato reais",
    heroLeadPost:
      " — quantas posições encontram, com que qualidade de correspondência e a que custo. Dados agregados e anónimos, de execuções reais, sem qualquer informação pessoal.",
    heroSub:
      "É uma página viva: cresce a cada nova equipa monitorizada. Escolhe um estudo de caso abaixo para ver todos os resultados.",
    positions: "posições",
    avgMatch: "correspondência média",
    strongMatch: "correspondências fortes",
    cardDays: "dias trabalhados",
    cumTitle: "Em média, por estudo de caso",
    cumLead:
      "Não a soma, mas a MÉDIA dos estudos de caso monitorizados: o que produz uma execução típica. As execuções têm durações diferentes, por isso é indicativo — dados mensais precisos exigem execuções de um mês inteiro.",
    cumDays: "dias / estudo",
    cumCases: "estudos de caso",
    cumPositions: "posições / estudo",
    cumScoreTitle: "Distribuição de match · todos os perfis",
    cumScoreEmpty: "Ainda sem pontuações",
    cumFunnelTitle: "De encontrada a match forte · média por estudo",
    priceTitle: "Preço médio por resultado",
    priceEstimate: "estimativa",
    priceLead:
      "Custo médio por resultado nos estudos de caso (mensalidade ÷ output do mês). Mistura subscrições de €100 (Codex) e €40 (Kimi) e é em grande parte estimado (só finance é ~um mês real) → indicativo.",
    pricePosition: "por posição encontrada",
    priceScored: "por posição avaliada",
    priceStrong: "por match forte ≥70",
    priceExcellent: "por match excelente ≥80",
    priceChartTitle: "Preço médio por resultado · por nível de qualidade",
    priceCaption:
      "Quanto maior o nível de qualidade exigido, maior o custo por resultado.",
    dailyTitle: "Matches de score alto por dia",
    dailyLead:
      "Em média, quantas posições de score alto (≥70) e excelente (≥80) a equipa produz por dia — distribuindo o output por um mês de orçamento, para que execuções curtas que gastaram uma semana de orçamento em poucos dias não fiquem infladas.",
    dailyAvgStrong: "≥70 / dia (média)",
    dailyAvgExcellent: "≥80 / dia (média)",
    dailyChartTitle: "Média por dia · por perfil",
    dailyUnit: "dia",
    dailyCaption:
      "Ritmo sustentável: output mensal estimado ÷ dias do mês, excluída a sessão free-run sem monitor (demasiado curta para ser representativa); a quota ≥80 está destacada em verde vivo.",
    dashTitle: "Em média, por utilizador",
    dashLead:
      "Os números destilados para um mês de subscrição: o output de cada caso projetado sobre um mês com base no orçamento usado — assim uma execução curta não baixa a média, nem uma intensiva a infla. Free-run excluído.",
    dashExcellent: "matches excelentes ≥80 / dia",
    dashCostExcellent: "custo / match excelente ≥80",
    dashPositions: "posições / mês",
    dashCaption:
      "Projetado para um mês com base no orçamento usado por cada execução (free-run excluído); contagens arredondadas, custo por match excelente.",
    tierTitle: "Rendimento e preço por nível de qualidade",
    tierLead:
      "Quantos matches por dia a equipa produz em cada nível e quanto custa em média cada resultado. Média sobre os três casos, projetada sobre um mês de orçamento (sem o free-run).",
    matchDayCardTitle: "📈 Matches por dia · por nível",
    matchDayCaption:
      "Matches/dia em média, projetados sobre um mês de orçamento. A linha ≥80 coincide com os excelentes/dia do resumo acima.",
    costCardTitle: "💶 Preço médio por resultado · por nível de qualidade",
    costCaption:
      "Quanto mais alto o nível de qualidade exigido, mais sobe o custo por resultado. A linha ≥80 coincide com o custo por excelente do resumo acima.",
    moreComingTitle: "Mais estudos de caso a caminho",
    moreComingSub: "o teu pode ser o próximo",
    contributeTitle: "Contribui com os teus dados",
    contributeLead:
      "Quantos mais perfis reais recolhermos, mais útil esta página se torna para quem procura trabalho. Põe o Job Hunter a correr na tua pesquisa e partilha os resultados (agregados e anónimos): bastam poucos passos.",
    betaTitle: "Torna-te beta tester",
    betaBody:
      "Põe a equipa a correr durante algumas semanas na tua pesquisa e partilha os resultados: ajudamos-te com a configuração. Guia e modelo de dados no GitHub.",
    selfHostTitle: "Auto-aloja & contribui",
    selfHostBody:
      "Instala o Job Hunter localmente ou no teu VPS, usa-o na tua pesquisa e abre um PR com os teus dados. Tudo open source.",
    repository: "Repositório:",
    footer:
      "Dados anónimos de execuções reais da equipa · snapshots versionados, sem informação pessoal do candidato.",
  },
};

export default async function CaseStudiesIndexPage() {
  const locale = await getRequestLocale();
  const t = T[locale];
  const nf = (n: number): string => n.toLocaleString(intlTag(locale));
  const localized = CASE_STUDIES.map((cs) => localizeCaseStudy(cs, locale));

  // ── Statistiche PER PROVIDER ────────────────────────────────────────────
  // Kimi (~€40) e Codex (~€100) NON si mediano insieme: prezzi diversi. Raggruppo
  // i casi per provider (model) e proietto ogni run su un mese di budget: un mese
  // ≈ 4,345 budget settimanali, quindi una run che ne ha consumati W producendo X
  // rende X × 4,345/W al mese ("giorni × 30" grezzo sovrastima le run intensive).
  // Per ogni tappa del funnel: totale/mese, al giorno (÷30) e prezzo medio per
  // risultato (canone ÷ output/mese). Free-run escluso. La riga ≥80 dà eccellenti/
  // giorno e €/eccellente; Trovate dà posizioni/mese.
  const WEEKS_PER_MONTH = 4.345;
  const MONTH_DAYS = 30;
  const PROVIDER_ORDER = ["Codex", "Kimi"];
  const STAGES = ["strong80", "strong70", "scored", "found"] as const;
  const eligible = localized.filter((cs) => !cs.freeRun && cs.run.conversion);
  const providers = PROVIDER_ORDER.map((id) => {
    const group = eligible.filter((cs) => cs.model === id);
    if (group.length === 0) return null;
    const perRun = group.map((cs) => {
      const budgetWeeks =
        (cs.run.usage?.daily ?? []).reduce((s, d) => s + (d.pct ?? 0), 0) / 100;
      // proietta al budget di un mese; fallback ai giorni se manca l'usage.
      const mult =
        budgetWeeks > 0.1
          ? WEEKS_PER_MONTH / budgetWeeks
          : MONTH_DAYS / Math.max(1, caseRunInfo(cs.run, locale).days);
      return {
        mult,
        eur: cs.subscription.monthlyEur ?? null,
        c: cs.run.conversion!,
      };
    });
    const mean = (fn: (r: (typeof perRun)[number]) => number) =>
      perRun.reduce((s, r) => s + fn(r), 0) / perRun.length;
    const meanPrice = (stage: (typeof STAGES)[number]) => {
      const xs = perRun
        .map((r) => {
          const m = r.c[stage] * r.mult;
          return r.eur != null && m > 0 ? r.eur / m : null;
        })
        .filter((v): v is number => v != null);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    };
    return {
      id,
      monthlyEur: perRun[0].eur,
      nCases: group.length,
      rows: STAGES.map((stage) => ({
        key: stage as string,
        count: mean((r) => r.c[stage] * r.mult),
        perDay: mean((r) => (r.c[stage] * r.mult) / MONTH_DAYS),
        price: meanPrice(stage),
      })),
    };
  }).filter((p): p is NonNullable<typeof p> => p != null);

  return (
    <main className="min-h-screen bg-[var(--color-panel)] text-[var(--color-white)]">
      <LandingI18nProvider>
        <LandingNav />
      </LandingI18nProvider>
      <div aria-hidden="true" className="h-14" />

      {/* Indice SENZA sidebar: il menu laterale dei tester serve solo nel
          dettaglio (/case-studies/[id]). Colonna centrata alla stessa larghezza
          del dettaglio (max-w-5xl): il canvas è già scalato da body{zoom:1.15},
          quindi max-w-6xl risultava troppo largo e il testo sembrava sparso. */}
      <div className="mx-auto max-w-5xl px-6 sm:px-10 py-12">
        {/* ── Hero / cos'è ──────────────────────────────────────── */}
        <header className="mb-12">
          <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-[var(--color-dim)]">
            {t.heroKicker}
          </span>
          <h1 className="mt-3 text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">
            {t.heroTitlePre}
            <span style={{ color: "#00e676" }}>{t.heroTitleEmph}</span>
            {t.heroTitlePost}
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-muted)]">
            {t.heroLeadPre}
            <strong className="text-[var(--color-white)]">
              {t.heroLeadStrong}
            </strong>
            {t.heroLeadPost}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-dim)]">
            {t.heroSub}
          </p>
        </header>

        {/* ── Statistiche per provider · una tabella-imbuto ─────── */}
        <ProviderStats providers={providers} />

        {/* ── Card dei case study ───────────────────────────────── */}
        <section className="mb-14">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {localized.map((cs) => (
              <div
                key={cs.id}
                className="border border-[var(--color-border)] bg-[var(--color-card)] p-5"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className="inline-flex items-center justify-center w-11 h-11 text-[14px] font-extrabold shrink-0"
                    style={{
                      background:
                        "color-mix(in srgb, var(--color-blue) 18%, transparent)",
                      color: "var(--color-blue)",
                    }}
                  >
                    {cs.profile.badge}
                  </span>
                  <div className="min-w-0">
                    {/* Solo il TITOLO è il link (sottolineato): il resto della card
                        resta testo selezionabile, non un unico blocco cliccabile. */}
                    <Link
                      href={`/case-studies/${cs.id}`}
                      className="group/title inline-flex items-baseline gap-1 w-fit text-[14px] font-bold text-[var(--color-white)] no-underline hover:text-[var(--color-blue)] transition-colors"
                    >
                      <span className="underline decoration-1 underline-offset-[3px]">
                        {cs.label}
                      </span>
                      <span
                        aria-hidden
                        className="opacity-0 group-hover/title:opacity-100 transition-opacity"
                      >
                        →
                      </span>
                    </Link>
                    <div className="text-[11px] text-[var(--color-dim)] truncate">
                      {cs.tagline}
                    </div>
                  </div>
                </div>
                <p className="text-[12px] text-[var(--color-muted)] leading-relaxed line-clamp-2 mb-4">
                  {cs.profile.headline} · {cs.profile.summary}
                </p>
                <div className="grid grid-cols-4 gap-2 border-t border-[var(--color-border)] pt-3">
                  <div>
                    <div
                      className="text-[18px] font-extrabold tabular-nums"
                      style={{ color: "var(--color-blue)" }}
                    >
                      {nf(cs.run.totals.positions)}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                      {t.positions}
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-[18px] font-extrabold tabular-nums"
                      style={{ color: "#00e676" }}
                    >
                      {Math.round(cs.run.match.avg)}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                      {t.avgMatch}
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-[18px] font-extrabold tabular-nums"
                      style={{ color: "#00e676" }}
                    >
                      {nf(cs.run.conversion?.strong70 ?? cs.run.match.strong70)}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                      {t.strongMatch}
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-[18px] font-extrabold tabular-nums"
                      style={{ color: "var(--color-white)" }}
                    >
                      {nf(caseRunInfo(cs.run, locale).days)}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                      {t.cardDays}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Contribuisci ──────────────────────────────────────── */}
        <section className="border border-[var(--color-border)] bg-[var(--color-card)] p-6 sm:p-8">
          <h2 className="text-xl font-bold tracking-tight">
            {t.contributeTitle}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted)]">
            {t.contributeLead}
          </p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border border-[var(--color-border)] bg-[var(--color-bg)] p-5">
              <a
                href={CONTRIBUTE_LINKS.beta}
                target="_blank"
                rel="noopener noreferrer"
                className="contrib-title group inline-flex items-baseline gap-1 w-fit text-[13px] font-bold text-[var(--color-white)] no-underline transition-colors hover:text-[#00e676]"
              >
                <span className="underline decoration-1 underline-offset-[3px]">
                  {t.betaTitle}
                </span>
                <span
                  className="inline-block transition-transform group-hover:translate-x-0.5"
                  style={{ color: "#00e676" }}
                >
                  →
                </span>
              </a>
              <p className="mt-1.5 text-[12px] text-[var(--color-muted)] leading-relaxed">
                {t.betaBody}
              </p>
            </div>
            <div className="border border-[var(--color-border)] bg-[var(--color-bg)] p-5">
              <a
                href={CONTRIBUTE_LINKS.contributing}
                target="_blank"
                rel="noopener noreferrer"
                className="contrib-title group inline-flex items-baseline gap-1 w-fit text-[13px] font-bold text-[var(--color-white)] no-underline transition-colors hover:text-[#00e676]"
              >
                <span className="underline decoration-1 underline-offset-[3px]">
                  {t.selfHostTitle}
                </span>
                <span
                  className="inline-block transition-transform group-hover:translate-x-0.5"
                  style={{ color: "#00e676" }}
                >
                  →
                </span>
              </a>
              <p className="mt-1.5 text-[12px] text-[var(--color-muted)] leading-relaxed">
                {t.selfHostBody}
              </p>
            </div>
          </div>
        </section>
      </div>

      <LandingI18nProvider>
        <LandingFooter />
      </LandingI18nProvider>
    </main>
  );
}
