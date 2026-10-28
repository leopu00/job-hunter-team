/**
 * Stand-in for web/lib/write-failure-read-only.ts. On the site a 403 means «do it from the app»; here the
 * app is the one asking, and the 403 means the link to this team is read only. The way out is the button
 * of the read-only banner (EXISTING_TEAM_READONLY_TEXT.connectInFull), which is shown only when there is
 * such a link. On a team of this computer the route is refused too and there is no banner, so the text states
 * no state of the team: it names the way out only «if the team is linked read only and the button is there».
 */
import type { LocaleDict } from "@/lib/i18n-dict";

export const READ_ONLY_FAILURE: LocaleDict = {
  it: "Da qui non si può modificare. Se la squadra è collegata in sola lettura e in alto c’è «Collega in scrittura», usalo e riprova.",
  en: "This cannot be changed from here. If the team is linked read only and “Connect with write access” shows at the top, use it and try again.",
  hu: "Innen nem módosítható. Ha a csapat csak olvasható módban csatlakozik, és felül megjelenik a „Csatlakozás írási joggal” gomb, használd, és próbáld újra.",
  es: "Esto no se puede cambiar desde aquí. Si el equipo está conectado en solo lectura y arriba aparece «Conectar con escritura», úsalo e inténtalo de nuevo.",
  de: "Das lässt sich hier nicht ändern. Wenn das Team nur lesend verbunden ist und oben „Mit Schreibzugriff verbinden“ steht, nutze es und versuche es erneut.",
  fr: "Impossible de modifier ici. Si l’équipe est connectée en lecture seule et que « Connecter en écriture » apparaît en haut, utilise-le et réessaie.",
  pt: "Não é possível alterar daqui. Se a equipa estiver ligada só em leitura e aparecer «Ligar com escrita» no topo, usa-o e tenta de novo.",
};
