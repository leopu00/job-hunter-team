import type { Locale } from "@/i18n/config";

/**
 * What the dashboard says about an existing team that is only read: the core's
 * own numbers with their denominators, and, block by block, how much of it
 * there is. `{n}` and the like are filled by the caller.
 */
export interface ExistingTeamDashboardText {
  title: string;
  /** "Average score {avg} over {n} positions with a score, of {active} active." */
  scored: string;
  /** No active position has a score yet. */
  unscored: string;
  scoreBuckets: string;
  sources: string;
  chartsPartial: string;
  eventsPartial: string;
  ratesUnavailable: string;
  seenLocal: string;
}

export const EXISTING_TEAM_DASHBOARD_TEXT: Record<Locale, ExistingTeamDashboardText> = {
  it: {
    title: "Dalla squadra (conteggi esatti)",
    scored: "Punteggio medio {avg} su {n} posizioni con punteggio, di {active} attive.",
    unscored: "Nessuna delle {active} posizioni attive ha ancora un punteggio.",
    scoreBuckets: "Punteggi",
    sources: "Fonti principali",
    chartsPartial: "I grafici mostrano le {n} posizioni più recenti su {of} attive.",
    eventsPartial: "La cronologia delle candidature mostra le {n} più recenti su {of}.",
    ratesUnavailable: "Tassi di cambio non raggiungibili: le {n} posizioni con stipendio in un’altra valuta non sono nel grafico degli stipendi.",
    seenLocal: "Il marcatore «nuova» vale solo per questo computer: la squadra non registra quali annunci hai già aperto.",
  },
  en: {
    title: "From the team (exact counts)",
    scored: "Average score {avg} over {n} positions with a score, of {active} active.",
    unscored: "None of the {active} active positions has a score yet.",
    scoreBuckets: "Scores",
    sources: "Top sources",
    chartsPartial: "The charts show the {n} most recent of {of} active positions.",
    eventsPartial: "The applications timeline shows the {n} most recent of {of}.",
    ratesUnavailable: "Exchange rates could not be reached: the {n} positions with a salary in another currency are not in the salary chart.",
    seenLocal: "The “new” marker is for this computer only: the team does not record which positions you already opened.",
  },
  de: {
    title: "Vom Team (genaue Zahlen)",
    scored: "Durchschnittliche Punktzahl {avg} bei {n} Stellen mit Punktzahl, von {active} aktiven.",
    unscored: "Keine der {active} aktiven Stellen hat bisher eine Punktzahl.",
    scoreBuckets: "Punktzahlen",
    sources: "Wichtigste Quellen",
    chartsPartial: "Die Diagramme zeigen die {n} neuesten von {of} aktiven Stellen.",
    eventsPartial: "Der Bewerbungsverlauf zeigt die {n} neuesten von {of}.",
    ratesUnavailable: "Wechselkurse nicht erreichbar: Die {n} Stellen mit Gehalt in anderer Währung fehlen im Gehaltsdiagramm.",
    seenLocal: "Die Markierung „neu“ gilt nur für diesen Computer: Das Team speichert nicht, welche Stellen du schon geöffnet hast.",
  },
  fr: {
    title: "De l’équipe (comptes exacts)",
    scored: "Score moyen {avg} sur {n} offres notées, parmi {active} actives.",
    unscored: "Aucune des {active} offres actives n’a encore de score.",
    scoreBuckets: "Scores",
    sources: "Principales sources",
    chartsPartial: "Les graphiques montrent les {n} offres les plus récentes sur {of} actives.",
    eventsPartial: "La chronologie des candidatures montre les {n} plus récentes sur {of}.",
    ratesUnavailable: "Taux de change injoignables : les {n} offres avec un salaire dans une autre devise ne figurent pas dans le graphique des salaires.",
    seenLocal: "Le marqueur « nouvelle » ne vaut que pour cet ordinateur : l’équipe n’enregistre pas les offres que tu as déjà ouvertes.",
  },
  es: {
    title: "Del equipo (cifras exactas)",
    scored: "Puntuación media {avg} sobre {n} ofertas con puntuación, de {active} activas.",
    unscored: "Ninguna de las {active} ofertas activas tiene todavía puntuación.",
    scoreBuckets: "Puntuaciones",
    sources: "Fuentes principales",
    chartsPartial: "Los gráficos muestran las {n} ofertas más recientes de {of} activas.",
    eventsPartial: "La cronología de candidaturas muestra las {n} más recientes de {of}.",
    ratesUnavailable: "No se pudieron obtener los tipos de cambio: las {n} ofertas con salario en otra moneda no están en el gráfico de salarios.",
    seenLocal: "El marcador «nueva» vale solo para este ordenador: el equipo no registra qué ofertas ya has abierto.",
  },
  pt: {
    title: "Da equipa (contagens exatas)",
    scored: "Pontuação média {avg} em {n} vagas com pontuação, de {active} ativas.",
    unscored: "Nenhuma das {active} vagas ativas tem ainda pontuação.",
    scoreBuckets: "Pontuações",
    sources: "Principais fontes",
    chartsPartial: "Os gráficos mostram as {n} vagas mais recentes de {of} ativas.",
    eventsPartial: "A cronologia das candidaturas mostra as {n} mais recentes de {of}.",
    ratesUnavailable: "Não foi possível obter as taxas de câmbio: as {n} vagas com salário noutra moeda não estão no gráfico de salários.",
    seenLocal: "O marcador «nova» vale só para este computador: a equipa não regista que vagas já abriste.",
  },
  hu: {
    title: "A csapattól (pontos számok)",
    scored: "Átlagos pontszám: {avg}, {n} pontozott pozíció alapján, a {active} aktívból.",
    unscored: "A {active} aktív pozíció egyikének sincs még pontszáma.",
    scoreBuckets: "Pontszámok",
    sources: "Fő források",
    chartsPartial: "A diagramok a {of} aktív pozíció közül a legutóbbi {n}-t mutatják.",
    eventsPartial: "A jelentkezések idővonala a legutóbbi {n}-t mutatja {of}-ból.",
    ratesUnavailable: "Az árfolyamok nem érhetők el: a más pénznemű fizetésű {n} pozíció nincs a fizetési diagramon.",
    seenLocal: "Az „új” jelölés csak erre a gépre vonatkozik: a csapat nem rögzíti, melyik pozíciót nyitottad meg.",
  },
};

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ""));
}
