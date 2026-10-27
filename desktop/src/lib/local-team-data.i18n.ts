import type { Locale } from "@/i18n/config";

/** The pages that show the data of the team on this computer, which they only read. */
export interface LocalTeamDataCopy {
  /** On every disabled control: why nothing is changed from the page. */
  readOnly: string;
  /** The Team page: it reads the cloud, which a local profile has not got. */
  teamPage: string;
}

export const LOCAL_TEAM_DATA_TEXT: Record<Locale, LocalTeamDataCopy> = {
  it: { readOnly: "Con il profilo locale i dati della squadra si leggono soltanto: da qui non si modifica niente. Per chiedere qualcosa alla squadra usa la chat.", teamPage: "Con il profilo locale qui vedi l’attività degli agenti e gli ordini permanenti, in sola lettura; lo stato della squadra è un dato del cloud e non si mostra ancora. Per vedere chi lavora usa Agenti; per chiedere qualcosa alla squadra, la chat." },
  en: { readOnly: "With a local profile the team's data is shown to read only: nothing is changed from here. To ask the team for something, use the chat.", teamPage: "With a local profile you see the agents’ activity and the standing orders here, read only; the team’s status is cloud data and is not shown yet. To see who is working, use Agents; to ask the team something, use the chat." },
  de: { readOnly: "Mit einem lokalen Profil werden die Daten des Teams nur gelesen: Von hier aus wird nichts geändert. Um das Team um etwas zu bitten, nutze den Chat.", teamPage: "Mit einem lokalen Profil siehst du hier die Aktivität der Agenten und die Daueraufträge, nur lesend; der Status des Teams ist ein Cloud-Datum und wird noch nicht angezeigt. Wer gerade arbeitet, siehst du unter Agenten; um das Team um etwas zu bitten, nutze den Chat." },
  es: { readOnly: "Con un perfil local los datos del equipo se muestran solo para leer: desde aquí no se cambia nada. Para pedirle algo al equipo, usa el chat.", teamPage: "Con un perfil local ves aquí la actividad de los agentes y las órdenes permanentes, solo para leer; el estado del equipo es un dato de la nube y aún no se muestra. Para ver quién trabaja, usa Agentes; para pedirle algo al equipo, el chat." },
  fr: { readOnly: "Avec un profil local, les données de l’équipe sont en lecture seule : rien n’est modifié d’ici. Pour demander quelque chose à l’équipe, utilise le chat.", teamPage: "Avec un profil local, tu vois ici l’activité des agents et les ordres permanents, en lecture seule ; l’état de l’équipe est une donnée du cloud et ne s’affiche pas encore. Pour voir qui travaille, utilise Agents ; pour demander quelque chose à l’équipe, le chat." },
  hu: { readOnly: "Helyi profillal a csapat adatai csak olvashatók: innen semmi sem módosítható. Ha kérni szeretnél valamit a csapattól, használd a csevegést.", teamPage: "Helyi profillal itt az ügynökök tevékenységét és az állandó megbízásokat látod, csak olvasásra; a csapat állapota felhőadat, és még nem jelenik meg. Hogy ki dolgozik, az Ügynökök oldalon látod; ha kérni szeretnél valamit, használd a csevegést." },
  pt: { readOnly: "Com um perfil local, os dados da equipa só se leem: daqui não se altera nada. Para pedir algo à equipa, usa o chat.", teamPage: "Com um perfil local, vês aqui a atividade dos agentes e as ordens permanentes, só para ler; o estado da equipa é um dado da cloud e ainda não se mostra. Para ver quem está a trabalhar, usa Agentes; para pedir algo à equipa, o chat." },
};
