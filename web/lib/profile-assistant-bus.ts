/**
 * Bus eventi per aprire la chat dell'Assistente da qualunque punto della
 * pagina profilo (bottone "Modifica", chip "campi mancanti"…).
 *
 * Il pannello chat vive in <ProfileAssistantFab/> e gestisce il proprio stato
 * `open` internamente. Invece di sollevare lo stato in un context, i trigger
 * sparano un CustomEvent globale che il FAB ascolta: apre il pannello e, se
 * presente, invia subito un messaggio iniziale (così l'Assistente risponde
 * chiedendo cosa l'utente vuole modificare).
 */
export const OPEN_ASSISTANT_EVENT = "jht:open-assistant";

export type OpenAssistantDetail = { message?: string };

/** Apre la chat dell'Assistente; se `message` è dato, lo invia subito. */
export function openProfileAssistant(message?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenAssistantDetail>(OPEN_ASSISTANT_EVENT, {
      detail: { message },
    }),
  );
}
