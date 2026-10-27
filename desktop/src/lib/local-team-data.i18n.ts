import type { Locale } from "@/i18n/config";

/** The pages that show the data of the team on this computer, which they only read. */
export interface LocalTeamDataCopy {
  /** On every disabled control: why nothing is changed from the page. */
  readOnly: string;
  /** The Team page: it reads the cloud, which a local profile has not got. */
  teamPage: string;
}

export const LOCAL_TEAM_DATA_TEXT: Record<Locale, LocalTeamDataCopy> = {
  it: { readOnly: "Con il profilo locale i dati della squadra si leggono soltanto: da qui non si modifica niente. Per chiedere qualcosa alla squadra usa la chat.", teamPage: "Con il profilo locale questa pagina non mostra ancora lo stato, le direttive e l’attività degli agenti: sono dati del cloud. Per vedere cosa fa la squadra usa Agenti; per chiederle qualcosa, la chat." },
  en: { readOnly: "With a local profile the team's data is shown to read only: nothing is changed from here. To ask the team for something, use the chat.", teamPage: "With a local profile this page does not show the team’s status, standing orders and agent activity yet: they are cloud data. To see what the team is doing, use Agents; to ask it something, use the chat." },
  de: { readOnly: "Mit einem lokalen Profil werden die Daten des Teams nur gelesen: Von hier aus wird nichts geändert. Um das Team um etwas zu bitten, nutze den Chat.", teamPage: "Mit einem lokalen Profil zeigt diese Seite Status, Daueraufträge und Agentenaktivität des Teams noch nicht: Das sind Cloud-Daten. Was das Team gerade tut, siehst du unter Agenten; um es um etwas zu bitten, nutze den Chat." },
  es: { readOnly: "Con un perfil local los datos del equipo se muestran solo para leer: desde aquí no se cambia nada. Para pedirle algo al equipo, usa el chat.", teamPage: "Con un perfil local esta página aún no muestra el estado, las órdenes permanentes ni la actividad de los agentes: son datos de la nube. Para ver qué hace el equipo, usa Agentes; para pedirle algo, el chat." },
  fr: { readOnly: "Avec un profil local, les données de l’équipe sont en lecture seule : rien n’est modifié d’ici. Pour demander quelque chose à l’équipe, utilise le chat.", teamPage: "Avec un profil local, cette page ne montre pas encore l’état, les ordres permanents ni l’activité des agents : ce sont des données du cloud. Pour voir ce que fait l’équipe, utilise Agents ; pour lui demander quelque chose, le chat." },
  hu: { readOnly: "Helyi profillal a csapat adatai csak olvashatók: innen semmi sem módosítható. Ha kérni szeretnél valamit a csapattól, használd a csevegést.", teamPage: "Helyi profillal ez az oldal még nem mutatja a csapat állapotát, az állandó megbízásokat és az ügynökök tevékenységét: ezek felhőadatok. Hogy mit csinál a csapat, az Ügynökök oldalon látod; ha kérni szeretnél valamit, használd a csevegést." },
  pt: { readOnly: "Com um perfil local, os dados da equipa só se leem: daqui não se altera nada. Para pedir algo à equipa, usa o chat.", teamPage: "Com um perfil local, esta página ainda não mostra o estado, as ordens permanentes nem a atividade dos agentes: são dados da nuvem. Para ver o que a equipa está a fazer, usa Agentes; para lhe pedir algo, o chat." },
};
