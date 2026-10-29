import type { Locale } from "@/i18n/config";

/** The pages that show the data of the team on this computer, which they only read. */
export interface LocalTeamDataCopy {
  /** On every disabled control: why nothing is changed from the page. */
  readOnly: string;
  /** The Team page: it reads the cloud, which a local profile has not got. */
  teamPage: string;
}

export const LOCAL_TEAM_DATA_TEXT: Record<Locale, LocalTeamDataCopy> = {
  it: { readOnly: "Con il profilo locale i dati della squadra si leggono soltanto: da qui non si modifica niente. Per chiedere qualcosa alla squadra usa la chat.", teamPage: "Con il profilo locale questa pagina è in sola lettura: attività, ordini permanenti e stato vengono dalla squadra di questo computer. Per fermare o mettere in pausa la squadra usa Agenti; per chiederle qualcosa, la chat." },
  en: { readOnly: "With a local profile the team's data is shown to read only: nothing is changed from here. To ask the team for something, use the chat.", teamPage: "With a local profile this page is read only: the activity, the standing orders and the status come from the team on this computer. To pause or stop the team, use Agents; to ask it something, use the chat." },
  de: { readOnly: "Mit einem lokalen Profil werden die Daten des Teams nur gelesen: Von hier aus wird nichts geändert. Um das Team um etwas zu bitten, nutze den Chat.", teamPage: "Mit einem lokalen Profil ist diese Seite nur lesend: Aktivität, Daueraufträge und Status kommen vom Team auf diesem Computer. Zum Pausieren oder Stoppen nutze Agenten; um das Team um etwas zu bitten, den Chat." },
  es: { readOnly: "Con un perfil local los datos del equipo se muestran solo para leer: desde aquí no se cambia nada. Para pedirle algo al equipo, usa el chat.", teamPage: "Con un perfil local esta página es de solo lectura: la actividad, las órdenes permanentes y el estado vienen del equipo de este ordenador. Para pausar o parar el equipo, usa Agentes; para pedirle algo, el chat." },
  fr: { readOnly: "Avec un profil local, les données de l’équipe sont en lecture seule : rien n’est modifié d’ici. Pour demander quelque chose à l’équipe, utilise le chat.", teamPage: "Avec un profil local, cette page est en lecture seule : l’activité, les ordres permanents et l’état viennent de l’équipe de cet ordinateur. Pour mettre l’équipe en pause ou l’arrêter, utilise Agents ; pour lui demander quelque chose, le chat." },
  hu: { readOnly: "Helyi profillal a csapat adatai csak olvashatók: innen semmi sem módosítható. Ha kérni szeretnél valamit a csapattól, használd a csevegést.", teamPage: "Helyi profillal ez az oldal csak olvasható: a tevékenység, az állandó megbízások és az állapot a számítógépeden lévő csapattól származnak. A csapat szüneteltetéséhez vagy leállításához használd az Ügynökök oldalt; ha kérni szeretnél valamit, a csevegést." },
  pt: { readOnly: "Com um perfil local, os dados da equipa só se leem: daqui não se altera nada. Para pedir algo à equipa, usa o chat.", teamPage: "Com um perfil local, esta página é só de leitura: a atividade, as ordens permanentes e o estado vêm da equipa deste computador. Para pôr a equipa em pausa ou pará-la, usa Agentes; para lhe pedir algo, o chat." },
};
