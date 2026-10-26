/**
 * Stand-in for web/lib/write-failure-read-only.ts. On the site a 403 means «do it from the app»; here the
 * app is the one asking, and the 403 means the link to this team is read only. The way out is the button
 * of the read-only banner (EXISTING_TEAM_READONLY_TEXT.connectInFull), which is shown only when there is
 * such a link: hence «if it is there», and no promise otherwise.
 */
import type { LocaleDict } from "@/lib/i18n-dict";

export const READ_ONLY_FAILURE: LocaleDict = {
  it: "Da qui non si può modificare: la squadra è aperta in sola lettura. Se in alto c’è «Collega in scrittura», usalo e riprova.",
  en: "This cannot be changed from here: the team is open read only. If “Connect with write access” shows at the top, use it and try again.",
  hu: "Innen nem módosítható: a csapat csak olvasható módban van megnyitva. Ha felül megjelenik a „Csatlakozás írási joggal” gomb, használd, és próbáld újra.",
  es: "Esto no se puede cambiar desde aquí: el equipo está abierto en solo lectura. Si arriba aparece «Conectar con escritura», úsalo e inténtalo de nuevo.",
  de: "Das lässt sich hier nicht ändern: Das Team ist nur lesend geöffnet. Wenn oben „Mit Schreibzugriff verbinden“ steht, nutze es und versuche es erneut.",
  fr: "Impossible de modifier ici : l’équipe est ouverte en lecture seule. Si « Connecter en écriture » apparaît en haut, utilisez-le et réessayez.",
  pt: "Não é possível alterar daqui: a equipa está aberta só em leitura. Se aparecer «Ligar com escrita» no topo, usa-o e tenta de novo.",
};
