// Dove va una segnalazione, e in che ordine.
//
// ── Perché mail-first, e fail-closed ──────────────────────────────────
// Il copy che l'utente legge promette una cosa sola: la segnalazione
// arriva alla casella di supporto. Il webhook è una comodità interna, non
// una destinazione di cui l'utente sappia nulla.
//
// La versione precedente lanciava i due canali insieme con `Promise.all` e
// rispondeva ok se ne riusciva almeno uno. Con la posta giù e il webhook
// su, l'utente leggeva «la segnalazione è arrivata al supporto» mentre in
// quella casella non era arrivato niente: una risposta vera nella forma e
// falsa nella sostanza. È la stessa famiglia del banner che offriva una
// scelta senza rispettarla.
//
// Quindi: prima la posta, e solo se accetta si prosegue. Se la posta manca
// o fallisce si risponde 503 e **non si tenta nessun altro canale** — non
// per rigore formale, ma perché mandare il webhook mentre si dice
// all'utente «non ci siamo riusciti» significa avere una copia della sua
// segnalazione in un posto che lui non sa.

export interface DispatchResult {
  /** `true` solo se la posta ha accettato: è l'unica promessa fatta. */
  delivered: boolean;
  /** Esito del webhook. `null` se non è stato nemmeno tentato. */
  webhook: boolean | null;
}

/**
 * Consegna una segnalazione: posta prima, webhook solo dopo.
 *
 * Le due funzioni arrivano da fuori così questo pezzo si può provare
 * davvero, con la posta giù e il webhook su — che è il caso che rendeva
 * bugiarda la risposta.
 */
export async function dispatchFeedback(
  sendEmail: () => Promise<boolean>,
  notifyWebhook: () => Promise<boolean>,
): Promise<DispatchResult> {
  const mail = await sendEmail();
  if (!mail) {
    // Fail-closed: niente webhook. Se la promessa all'utente non è
    // mantenuta, non si spargono copie della sua segnalazione altrove.
    return { delivered: false, webhook: null };
  }

  // Il webhook è best-effort: un suo errore non rende falsa la risposta,
  // perché la promessa era la posta ed è stata mantenuta.
  let webhook = false;
  try {
    webhook = await notifyWebhook();
  } catch {
    webhook = false;
  }
  return { delivered: true, webhook };
}
