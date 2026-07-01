// Pagina principale /case-studies — landing della sezione.
//
// Spiega cos'è (dati reali e anonimi di team in esecuzione su profili veri),
// elenca i case study disponibili come card (→ /case-studies/[id]) e incentiva
// gli utenti a contribuire i propri dati, referenziando i doc GitHub.
// È pensata per crescere: col tempo accoglierà il monitoraggio di più team.

import Link from "next/link";
import { LandingI18nProvider } from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import {
  CASE_STUDIES,
  CONTRIBUTE_LINKS,
  caseMonthlyProjection,
  caseRunInfo,
  localizeCaseStudy,
} from "@/lib/case-studies";
import ScoreDistribution from "@/app/components/ScoreDistribution";
import ConversionFunnelCard from "./ConversionFunnelCard";
import { getRequestLocale } from "@/lib/request-locale";
import type { Locale } from "@/i18n/config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Case studies · Job Hunter Team",
  description:
    "Dati reali e anonimi di team di agenti Job Hunter Team in esecuzione su profili veri. Guarda i risultati, e contribuisci con i tuoi dati.",
};

const LOCALE_TAG: Record<Locale, string> = {
  it: "it-IT",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  hu: "hu-HU",
  pt: "pt-PT",
};

// Colori dei livelli (coerenti col funnel e con CostPerOutcome).
const TIER_COLORS = ["#3B82F6", "#0EA5A4", "#22C55E", "#F59E0B"];

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
      "Job Hunter Team è una squadra di agenti AI autonomi che cerca lavoro per te: trova posizioni, le analizza, le valuta sul tuo profilo e prepara le candidature. Qui mostriamo cosa ha prodotto su ",
    heroLeadStrong: "profili candidato reali",
    heroLeadPost:
      " — dati aggregati e anonimi, nessuna informazione personale.",
    heroSub:
      "È una pagina viva: cresce a ogni nuovo team monitorato. Scegli un case study qui sotto per vedere tutti i risultati.",
    positions: "posizioni",
    avgMatch: "match medio",
    strongMatch: "match forti",
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
    moreComingTitle: "Altri case study in arrivo",
    moreComingSub: "il tuo potrebbe essere il prossimo",
    contributeTitle: "📥 Contribuisci con i tuoi dati",
    contributeLead:
      "Più profili reali raccogliamo, più questa pagina diventa utile a chi cerca lavoro. Fai girare Job Hunter sulla tua ricerca e condividi i risultati (aggregati e anonimi): bastano pochi passi.",
    betaTitle: "🧪 Diventa beta tester",
    betaBody:
      "Fai girare il team per qualche settimana sulla tua ricerca e condividi i risultati: ti aiutiamo col setup. Guida e modello dati su GitHub.",
    selfHostTitle: "🛠️ Self-host & contribuisci",
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
      "Job Hunter Team is a team of autonomous AI agents that looks for work on your behalf: it finds positions, analyzes them, scores them against your profile and prepares the applications. Here we show what it produced on ",
    heroLeadStrong: "real candidate profiles",
    heroLeadPost: " — aggregated, anonymous data, no personal information.",
    heroSub:
      "It's a living page: it grows with every new team we monitor. Pick a case study below to see all the results.",
    positions: "positions",
    avgMatch: "average match",
    strongMatch: "strong matches",
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
    moreComingTitle: "More case studies coming",
    moreComingSub: "yours could be next",
    contributeTitle: "📥 Contribute your data",
    contributeLead:
      "The more real profiles we collect, the more useful this page becomes for job seekers. Run Job Hunter on your search and share the results (aggregated and anonymous): it only takes a few steps.",
    betaTitle: "🧪 Become a beta tester",
    betaBody:
      "Run the team for a few weeks on your search and share the results: we'll help you with the setup. Guide and data model on GitHub.",
    selfHostTitle: "🛠️ Self-host & contribute",
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
      "Job Hunter es un equipo de agentes de IA que busca trabajo por ti: encuentra puestos, los analiza, los evalúa según tu perfil y prepara las candidaturas. Aquí mostramos lo que produjo sobre ",
    heroLeadStrong: "perfiles de candidato reales",
    heroLeadPost: " — datos agregados y anónimos, sin información personal.",
    heroSub:
      "Es una página viva: crece con cada nuevo equipo monitorizado. Elige un caso de estudio abajo para ver todos los resultados.",
    positions: "puestos",
    avgMatch: "coincidencia media",
    strongMatch: "coincidencias fuertes",
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
    moreComingTitle: "Más casos de estudio en camino",
    moreComingSub: "el tuyo podría ser el próximo",
    contributeTitle: "📥 Contribuye con tus datos",
    contributeLead:
      "Cuantos más perfiles reales recopilemos, más útil será esta página para quien busca trabajo. Ejecuta Job Hunter en tu búsqueda y comparte los resultados (agregados y anónimos): bastan unos pocos pasos.",
    betaTitle: "🧪 Conviértete en beta tester",
    betaBody:
      "Ejecuta el equipo durante unas semanas en tu búsqueda y comparte los resultados: te ayudamos con la configuración. Guía y modelo de datos en GitHub.",
    selfHostTitle: "🛠️ Auto-aloja y contribuye",
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
      "Job Hunter est une équipe d'agents IA qui cherche du travail à ta place : elle trouve des postes, les analyse, les évalue selon ton profil et prépare les candidatures. Nous montrons ici ce qu'elle a produit sur ",
    heroLeadStrong: "de vrais profils de candidat",
    heroLeadPost:
      " — données agrégées et anonymes, aucune information personnelle.",
    heroSub:
      "C'est une page vivante : elle grandit à chaque nouvelle équipe suivie. Choisis une étude de cas ci-dessous pour voir tous les résultats.",
    positions: "postes",
    avgMatch: "correspondance moyenne",
    strongMatch: "correspondances fortes",
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
    moreComingTitle: "D'autres études de cas à venir",
    moreComingSub: "la tienne pourrait être la prochaine",
    contributeTitle: "📥 Contribue avec tes données",
    contributeLead:
      "Plus nous recueillons de profils réels, plus cette page devient utile pour qui cherche du travail. Lance Job Hunter sur ta recherche et partage les résultats (agrégés et anonymes) : il suffit de quelques étapes.",
    betaTitle: "🧪 Deviens testeur beta",
    betaBody:
      "Lance l'équipe pendant quelques semaines sur ta recherche et partage les résultats : on t'aide pour la configuration. Guide et modèle de données sur GitHub.",
    selfHostTitle: "🛠️ Auto-héberge & contribue",
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
      "Job Hunter ist ein Team von KI-Agenten, das für dich Arbeit sucht: Es findet Stellen, analysiert sie, bewertet sie anhand deines Profils und bereitet die Bewerbungen vor. Hier zeigen wir, was es auf ",
    heroLeadStrong: "echten Kandidatenprofilen",
    heroLeadPost:
      " produziert hat — aggregierte, anonyme Daten, keine persönlichen Informationen.",
    heroSub:
      "Es ist eine lebendige Seite: Sie wächst mit jedem neu beobachteten Team. Wähle unten eine Fallstudie, um alle Ergebnisse zu sehen.",
    positions: "Stellen",
    avgMatch: "durchschnittlicher Match",
    strongMatch: "starke Matches",
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
    moreComingTitle: "Weitere Fallstudien folgen",
    moreComingSub: "deine könnte die nächste sein",
    contributeTitle: "📥 Steuere deine Daten bei",
    contributeLead:
      "Je mehr echte Profile wir sammeln, desto nützlicher wird diese Seite für Jobsuchende. Lass Job Hunter auf deiner Suche laufen und teile die Ergebnisse (aggregiert und anonym): Es sind nur wenige Schritte.",
    betaTitle: "🧪 Werde Beta-Tester",
    betaBody:
      "Lass das Team ein paar Wochen auf deiner Suche laufen und teile die Ergebnisse: Wir helfen dir beim Setup. Anleitung und Datenmodell auf GitHub.",
    selfHostTitle: "🛠️ Selbst hosten & beitragen",
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
    heroLeadPre:
      "A Job Hunter AI-ügynökök csapata, amely helyetted keres munkát: pozíciókat talál, elemzi azokat, a profilodhoz méri őket, és előkészíti a jelentkezéseket. Itt megmutatjuk, mit produkált ",
    heroLeadStrong: "valódi jelölti profilokon",
    heroLeadPost:
      " — összesített, anonim adatok, semmilyen személyes információ.",
    heroSub:
      "Ez egy élő oldal: minden új megfigyelt csapattal bővül. Válassz egy esettanulmányt alább az összes eredmény megtekintéséhez.",
    positions: "pozíció",
    avgMatch: "átlagos egyezés",
    strongMatch: "erős egyezések",
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
    moreComingTitle: "További esettanulmányok érkeznek",
    moreComingSub: "a tiéd lehet a következő",
    contributeTitle: "📥 Járulj hozzá az adataiddal",
    contributeLead:
      "Minél több valódi profilt gyűjtünk, annál hasznosabb lesz ez az oldal az álláskeresőknek. Futtasd a Job Huntert a saját keresésedre, és oszd meg az eredményeket (összesítve és anonim módon): csak néhány lépés.",
    betaTitle: "🧪 Legyél béta tesztelő",
    betaBody:
      "Futtasd a csapatot néhány hétig a saját keresésedre, és oszd meg az eredményeket: segítünk a beállításban. Útmutató és adatmodell a GitHubon.",
    selfHostTitle: "🛠️ Önkiszolgáló üzemeltetés & hozzájárulás",
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
      "O Job Hunter é uma equipa de agentes de IA que procura trabalho por ti: encontra posições, analisa-as, avalia-as face ao teu perfil e prepara as candidaturas. Aqui mostramos o que produziu sobre ",
    heroLeadStrong: "perfis de candidato reais",
    heroLeadPost: " — dados agregados e anónimos, sem informação pessoal.",
    heroSub:
      "É uma página viva: cresce a cada nova equipa monitorizada. Escolhe um estudo de caso abaixo para ver todos os resultados.",
    positions: "posições",
    avgMatch: "correspondência média",
    strongMatch: "correspondências fortes",
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
    moreComingTitle: "Mais estudos de caso a caminho",
    moreComingSub: "o teu pode ser o próximo",
    contributeTitle: "📥 Contribui com os teus dados",
    contributeLead:
      "Quantos mais perfis reais recolhermos, mais útil esta página se torna para quem procura trabalho. Põe o Job Hunter a correr na tua pesquisa e partilha os resultados (agregados e anónimos): bastam poucos passos.",
    betaTitle: "🧪 Torna-te beta tester",
    betaBody:
      "Põe a equipa a correr durante algumas semanas na tua pesquisa e partilha os resultados: ajudamos-te com a configuração. Guia e modelo de dados no GitHub.",
    selfHostTitle: "🛠️ Auto-aloja & contribui",
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
  const nf = (n: number): string => n.toLocaleString(LOCALE_TAG[locale]);
  const localized = CASE_STUDIES.map((cs) => localizeCaseStudy(cs, locale));

  // Numeri cumulativi su TUTTE le run monitorate (sezione in cima all'indice).
  const runs = localized.map((cs) => cs.run);
  const allScores = runs.flatMap((r) => r.match.scores ?? []);
  const cum = {
    cases: localized.length,
    positions: runs.reduce(
      (s, r) =>
        s + (r.conversion?.found ?? r.funnelTotals?.found ?? r.totals.positions),
      0,
    ),
    scored: runs.reduce((s, r) => s + (r.conversion?.scored ?? 0), 0),
    strong70: runs.reduce(
      (s, r) => s + (r.conversion?.strong70 ?? r.match.strong70),
      0,
    ),
    strong80: runs.reduce(
      (s, r) => s + (r.conversion?.strong80 ?? r.match.strong80),
      0,
    ),
    days: localized.reduce((s, cs) => s + caseRunInfo(cs.run, locale).days, 0),
    avg: allScores.length
      ? Math.round(allScores.reduce((s, n) => s + n, 0) / allScores.length)
      : 0,
  };
  // MEDIA per case study (una run tipo), non la somma: le run hanno durate
  // diverse quindi è indicativo — per dati mensili accurati servono run da un
  // mese intero (vedi beta tester 2 · finance, ~26 giorni).
  const nStudies = Math.max(1, cum.cases);
  const per = {
    positions: Math.round(cum.positions / nStudies),
    scored: Math.round(cum.scored / nStudies),
    strong70: Math.round(cum.strong70 / nStudies),
    strong80: Math.round(cum.strong80 / nStudies),
    days: Math.round(cum.days / nStudies),
  };

  // Prezzo MEDIO per risultato: media (sui case study con canone noto) del costo
  // mensile per posizione / valutata / forte≥70 / eccellente≥80. Finance è
  // misurato, gli altri stimati (proiezione a un mese, stessa logica del
  // dettaglio). Mescola canoni €100 (Codex) e €40 (Kimi) → media indicativa.
  const pricedStudies = localized
    .map((cs) => ({
      cs,
      mult: caseMonthlyProjection(cs.run, caseRunInfo(cs.run, locale).days)
        .multiplier,
    }))
    .filter((s) => s.cs.subscription.monthlyEur != null && s.cs.run.conversion);
  const avgCostOf = (key: "found" | "scored" | "strong70" | "strong80") => {
    if (pricedStudies.length === 0) return 0;
    const total = pricedStudies.reduce((acc, s) => {
      const monthly = s.cs.run.conversion![key] * s.mult;
      return acc + (monthly > 0 ? s.cs.subscription.monthlyEur! / monthly : 0);
    }, 0);
    return total / pricedStudies.length;
  };
  const eurFmt = (n: number) =>
    new Intl.NumberFormat(LOCALE_TAG[locale], {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  const priceTiers = [
    { v: avgCostOf("found"), l: t.pricePosition, c: TIER_COLORS[0] },
    { v: avgCostOf("scored"), l: t.priceScored, c: TIER_COLORS[1] },
    { v: avgCostOf("strong70"), l: t.priceStrong, c: TIER_COLORS[2] },
    { v: avgCostOf("strong80"), l: t.priceExcellent, c: TIER_COLORS[3] },
  ];
  const maxPrice = Math.max(...priceTiers.map((x) => x.v), 0.0001);

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
          <p className="mt-5 max-w-3xl text-[15px] leading-relaxed text-[var(--color-muted)]">
            {t.heroLeadPre}
            <strong className="text-[var(--color-white)]">
              {t.heroLeadStrong}
            </strong>
            {t.heroLeadPost}
          </p>
          <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-[var(--color-dim)]">
            {t.heroSub}
          </p>
        </header>

        {/* ── Numeri cumulativi (tutti i case study insieme) ─────── */}
        <section className="mb-14">
          <h2 className="text-xl font-bold tracking-tight">{t.cumTitle}</h2>
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[var(--color-muted)]">
            {t.cumLead}
          </p>

          {/* KPI headline */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { v: nf(cum.cases), l: t.cumCases, c: "var(--color-white)" },
              { v: nf(per.positions), l: t.cumPositions, c: "var(--color-blue)" },
              { v: nf(cum.avg), l: t.avgMatch, c: "#00e676" },
              { v: nf(per.days), l: t.cumDays, c: "var(--color-white)" },
            ].map((k) => (
              <div
                key={k.l}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-4"
              >
                <div
                  className="text-[22px] font-extrabold tabular-nums leading-none"
                  style={{ color: k.c }}
                >
                  {k.v}
                </div>
                <div className="mt-1.5 text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                  {k.l}
                </div>
              </div>
            ))}
          </div>

          {/* Grafici cumulativi: conversione complessiva + distribuzione match */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            <div className="flex flex-col">
              <div className="text-[12px] font-semibold text-[var(--color-base)] mb-3">
                {t.cumFunnelTitle}
              </div>
              <div className="flex-1">
                <ConversionFunnelCard
                  found={per.positions}
                  scored={per.scored}
                  strong70={per.strong70}
                  strong80={per.strong80}
                />
              </div>
            </div>
            <div className="flex flex-col">
              <ScoreDistribution
                scores={allScores}
                title={t.cumScoreTitle}
                emptyLabel={t.cumScoreEmpty}
                thresholdReady={70}
                thresholdLabel="≥ 70"
              />
            </div>
          </div>
        </section>

        {/* ── Prezzo medio per risultato (media tra gli studi) ───── */}
        <section className="mb-14">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">{t.priceTitle}</h2>
            <span
              className="text-[9px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5"
              style={{
                background: "color-mix(in srgb, #F59E0B 16%, transparent)",
                color: "#F59E0B",
              }}
            >
              {t.priceEstimate}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[var(--color-muted)]">
            {t.priceLead}
          </p>

          {/* Card: prezzo medio per livello */}
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {priceTiers.map((tier) => (
              <div
                key={tier.l}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-4"
              >
                <div
                  className="text-[22px] font-extrabold tabular-nums leading-none"
                  style={{ color: tier.c }}
                >
                  ≈ {eurFmt(tier.v)}
                </div>
                <div className="mt-1.5 text-[10px] leading-snug text-[var(--color-muted)]">
                  {tier.l}
                </div>
              </div>
            ))}
          </div>

          {/* Grafico a barre del prezzo medio */}
          <div className="mt-6 bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-6">
            <div className="text-[12px] font-semibold text-[var(--color-base)] mb-4">
              {t.priceChartTitle}
            </div>
            <div className="flex flex-col gap-3">
              {priceTiers.map((tier) => (
                <div key={tier.l}>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ background: tier.c }}
                    />
                    <span className="text-[11px] text-[var(--color-muted)] flex-1 truncate">
                      {tier.l}
                    </span>
                    <span className="text-[13px] font-bold tabular-nums text-[var(--color-base)]">
                      ≈ {eurFmt(tier.v)}
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden"
                    style={{ background: "var(--color-border)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (tier.v / maxPrice) * 100)}%`,
                        background: tier.c,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-dim)]">
              {t.priceCaption}
            </div>
          </div>
        </section>

        {/* ── Card dei case study ───────────────────────────────── */}
        <section className="mb-14">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {localized.map((cs) => (
              <div
                key={cs.id}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-[14px] font-extrabold shrink-0"
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
                <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-border)] pt-3">
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
                </div>
              </div>
            ))}

            {/* placeholder: altri in arrivo */}
            <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-5 flex items-center justify-center text-center opacity-70">
              <div>
                <div className="text-2xl mb-1">➕</div>
                <div className="text-[12px] text-[var(--color-muted)] font-semibold">
                  {t.moreComingTitle}
                </div>
                <div className="text-[11px] text-[var(--color-dim)] mt-1">
                  {t.moreComingSub}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Contribuisci ──────────────────────────────────────── */}
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 sm:p-8">
          <h2 className="text-xl font-bold tracking-tight">
            {t.contributeTitle}
          </h2>
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[var(--color-muted)]">
            {t.contributeLead}
          </p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a
              href={CONTRIBUTE_LINKS.results}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-xl border border-[#00e676]/40 bg-[var(--color-bg)] p-5 transition-colors hover:border-[#00e676] no-underline"
            >
              <div className="text-[13px] font-bold text-[var(--color-white)]">
                {t.betaTitle}{" "}
                <span
                  className="inline-block transition-transform group-hover:translate-x-0.5"
                  style={{ color: "#00e676" }}
                >
                  →
                </span>
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--color-muted)] leading-relaxed">
                {t.betaBody}
              </p>
            </a>
            <a
              href={CONTRIBUTE_LINKS.contributing}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5 transition-colors hover:border-[var(--color-blue)] no-underline"
            >
              <div className="text-[13px] font-bold text-[var(--color-white)]">
                {t.selfHostTitle}{" "}
                <span className="inline-block transition-transform group-hover:translate-x-0.5 text-[var(--color-blue)]">
                  →
                </span>
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--color-muted)] leading-relaxed">
                {t.selfHostBody}
              </p>
            </a>
          </div>
          <div className="mt-5 text-[11px] text-[var(--color-dim)]">
            {t.repository}{" "}
            <a
              href={CONTRIBUTE_LINKS.repo}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-muted)] underline hover:text-[var(--color-white)]"
            >
              github.com/leopu00/job-hunter-team
            </a>
          </div>
        </section>
      </div>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-[11px] text-[var(--color-muted)]">
        {t.footer}
      </footer>
    </main>
  );
}
