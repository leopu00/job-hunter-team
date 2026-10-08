import type { Locale } from "../i18n/config";

export const TELEGRAM_PAIR_COMMAND =
  "jht telegram pair assistente|capitano|mentor";

export const TELEGRAM_PAIRING_MESSAGE: Record<Locale, string> = {
  it: `Dal computer host esegui \`${TELEGRAM_PAIR_COMMAND}\`: il token viene chiesto senza eco. Per automazioni puoi passare il JSON su stdin; non salvare il token in \`~/.jht\` e, se usi un file fuori da lì, cancellalo subito dopo.`,
  en: `On the host computer, run \`${TELEGRAM_PAIR_COMMAND}\`: the token is requested without echo. For automation, you can pass JSON on stdin; do not save the token in \`~/.jht\` and, if you use a file outside it, delete it immediately afterward.`,
  es: `En el ordenador host, ejecuta \`${TELEGRAM_PAIR_COMMAND}\`: el token se solicita sin mostrarse. Para automatizaciones puedes pasar el JSON por stdin; no guardes el token en \`~/.jht\` y, si usas un archivo fuera de esa ruta, elimínalo justo después.`,
  fr: `Sur l'ordinateur hôte, exécutez \`${TELEGRAM_PAIR_COMMAND}\` : le jeton est demandé sans écho. Pour les automatisations, vous pouvez transmettre le JSON sur stdin ; n'enregistrez pas le jeton dans \`~/.jht\` et, si vous utilisez un fichier en dehors de ce dossier, supprimez-le immédiatement après.`,
  de: `Führe auf dem Host-Computer \`${TELEGRAM_PAIR_COMMAND}\` aus: Das Token wird ohne Echo abgefragt. Für Automatisierungen kannst du das JSON über stdin übergeben; speichere das Token nicht in \`~/.jht\` und lösche eine außerhalb davon verwendete Datei unmittelbar danach.`,
  hu: `A gazdagépen futtasd a \`${TELEGRAM_PAIR_COMMAND}\` parancsot: a program visszajelzés nélkül kéri be a tokent. Automatizáláshoz átadhatod a JSON-t az stdin bemeneten; ne mentsd a tokent a \`~/.jht\` könyvtárba, és ha azon kívüli fájlt használsz, utána azonnal töröld.`,
  pt: `No computador anfitrião, executa \`${TELEGRAM_PAIR_COMMAND}\`: o token é pedido sem ser mostrado. Para automatizações, podes passar o JSON por stdin (entrada padrão); não guardes o token em \`~/.jht\` e, se usares um ficheiro fora dessa pasta, elimina-o logo a seguir.`,
};

export function telegramPairingError(locale: Locale) {
  return {
    error: "telegram_pair_on_host",
    command: TELEGRAM_PAIR_COMMAND,
    message: TELEGRAM_PAIRING_MESSAGE[locale],
  };
}
