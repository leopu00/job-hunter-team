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
  /** Without live rates only euro amounts are drawn, whatever currency was chosen. */
  eurOnly: string;
  /** The team has no position at all: one empty state in place of the boxes with nothing in them. */
  emptyTitle: string;
  emptyBody: string; // {team}: the name of the Team page
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
    eurOnly: "Senza tassi di cambio i grafici mostrano solo gli importi in euro: la valuta scelta nelle impostazioni è ignorata.",
    emptyTitle: "La squadra non ha ancora trovato posizioni",
    emptyBody: "Quando ne troverà, qui compariranno i conteggi, le posizioni con punteggio e i grafici. Intanto puoi vedere lo stato della squadra nella pagina «{team}».",
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
    eurOnly: "Without exchange rates the charts show euro amounts only: the currency chosen in the settings is ignored.",
    emptyTitle: "The team has not found any positions yet",
    emptyBody: "When it does, the counts, the scored positions and the charts will show up here. Meanwhile you can check the team's state on the «{team}» page.",
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
    eurOnly: "Ohne Wechselkurse zeigen die Diagramme nur Euro-Beträge: Die in den Einstellungen gewählte Währung wird ignoriert.",
    emptyTitle: "Das Team hat noch keine Stellen gefunden",
    emptyBody: "Sobald es welche findet, erscheinen hier die Zahlen, die bewerteten Stellen und die Diagramme. Den Zustand des Teams siehst du in der Zwischenzeit auf der Seite «{team}».",
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
    eurOnly: "Sans taux de change, les graphiques n’affichent que les montants en euros : la devise choisie dans les réglages est ignorée.",
    emptyTitle: "L’équipe n’a pas encore trouvé de postes",
    emptyBody: "Quand elle en trouvera, les chiffres, les postes avec un score et les graphiques apparaîtront ici. En attendant, tu peux voir l’état de l’équipe sur la page «{team}».",
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
    eurOnly: "Sin tipos de cambio, los gráficos solo muestran importes en euros: la moneda elegida en los ajustes se ignora.",
    emptyTitle: "El equipo aún no ha encontrado posiciones",
    emptyBody: "Cuando las encuentre, aquí aparecerán los recuentos, las posiciones con puntuación y los gráficos. Mientras tanto puedes ver el estado del equipo en la página «{team}».",
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
    eurOnly: "Sem taxas de câmbio, os gráficos mostram apenas valores em euros: a moeda escolhida nas definições é ignorada.",
    emptyTitle: "A equipa ainda não encontrou vagas",
    emptyBody: "Quando encontrar, aqui vão aparecer as contagens, as vagas com pontuação e os gráficos. Entretanto, podes ver o estado da equipa na página «{team}».",
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
    eurOnly: "Árfolyamok nélkül a diagramok csak euróban mutatják az összegeket: a beállításokban választott pénznem figyelmen kívül marad.",
    emptyTitle: "A csapat még nem talált állást",
    emptyBody: "Amint talál, itt megjelennek a számok, a pontszámmal rendelkező állások és a diagramok. Addig a csapat állapotát a «{team}» oldalon nézheted meg.",
  },
};

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ""));
}
