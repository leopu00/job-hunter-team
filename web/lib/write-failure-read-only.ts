/**
 * Il motivo di un 403 su una scrittura, come lo dice il SITO: i comandi della squadra si danno dall'app
 * sul computer dove gira. L'app desktop sostituisce questo modulo con `src/web-shims/write-failure-read-only.ts`
 * (alias in vite.config.ts): lì l'app è già quella, e il 403 vuol dire che il collegamento è in sola lettura.
 */
import type { LocaleDict } from "@/lib/i18n-dict";

export const READ_ONLY_FAILURE: LocaleDict = {
  it: "Da qui non si può modificare: fallo dall'app sul computer dove gira il team.",
  en: "This cannot be changed from here: do it from the app on the computer where the team runs.",
  hu: "Innen nem módosítható: tedd meg az alkalmazásban azon a gépen, ahol a csapat fut.",
  es: "Esto no se puede cambiar desde aquí: hazlo desde la app en el ordenador donde funciona el equipo.",
  de: "Das lässt sich hier nicht ändern: Mach es in der App auf dem Computer, auf dem das Team läuft.",
  fr: "Impossible de modifier ici : faites-le depuis l'app sur l'ordinateur où tourne l'équipe.",
  pt: "Não é possível alterar daqui: faz isso na app no computador onde a equipa corre.",
};
