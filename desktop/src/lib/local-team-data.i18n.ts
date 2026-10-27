import type { Locale } from "@/i18n/config";

/** The pages that show the data of the team on this computer, which they only read. */
export interface LocalTeamDataCopy {
  /** On every disabled control: why nothing is changed from the page. */
  readOnly: string;
}

export const LOCAL_TEAM_DATA_TEXT: Record<Locale, LocalTeamDataCopy> = {
  it: { readOnly: "Con il profilo locale i dati della squadra si leggono soltanto: da qui non si modifica niente. Per chiedere qualcosa alla squadra usa la chat." },
  en: { readOnly: "With a local profile the team's data is shown to read only: nothing is changed from here. To ask the team for something, use the chat." },
  de: { readOnly: "Mit einem lokalen Profil werden die Daten des Teams nur gelesen: Von hier aus wird nichts geändert. Um das Team um etwas zu bitten, nutze den Chat." },
  es: { readOnly: "Con un perfil local los datos del equipo se muestran solo para leer: desde aquí no se cambia nada. Para pedirle algo al equipo, usa el chat." },
  fr: { readOnly: "Avec un profil local, les données de l’équipe sont en lecture seule : rien n’est modifié d’ici. Pour demander quelque chose à l’équipe, utilise le chat." },
  hu: { readOnly: "Helyi profillal a csapat adatai csak olvashatók: innen semmi sem módosítható. Ha kérni szeretnél valamit a csapattól, használd a csevegést." },
  pt: { readOnly: "Com um perfil local, os dados da equipa só se leem: daqui não se altera nada. Para pedir algo à equipa, usa o chat." },
};
