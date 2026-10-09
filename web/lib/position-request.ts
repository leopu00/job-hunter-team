/**
 * I pulsanti di richiesta sulla pagina di una posizione: CV su misura,
 * lettera, rivalutazione, verifica dell'annuncio, geocoding e autorizzazione
 * della candidatura.
 *
 * Sono il punto in cui l'utente chiede un'azione al team, o autorizza
 * un invio. Fino al 09/10 quasi tutti cambiavano stato PRIMA della risposta
 * (update ottimistico) e, se la scrittura falliva, mostravano il corpo della
 * route così com'era: un messaggio in italiano, `query_failed`, `HTTP 500`, il
 * testo di un'eccezione. E un 200 qualunque valeva come richiesta fatta.
 *
 * Qui la regola condivisa: la richiesta vale solo se la route la CONFERMA
 * (ogni pulsante dice come: `write_requested`, `recheck_requested`, l'id del
 * ticket…). Altrimenti lo stato resta com'era e la frase dice, nella lingua
 * dell'utente, cosa NON è successo e perché.
 */
import type { Locale } from "@/i18n/config";
import { makeT, type Dictionary } from "@/lib/i18n-dict";
import { writeFailureReason } from "@/lib/write-failure";

export const POSITION_REQUEST = {
  request: {
    it: "Richiesta NON registrata: il team non la vede.",
    en: "Request NOT registered: the team does not see it.",
    hu: "A kérés NEM lett rögzítve: a csapat nem látja.",
    es: "Solicitud NO registrada: el equipo no la ve.",
    de: "Anfrage NICHT erfasst: Das Team sieht sie nicht.",
    fr: "Demande NON enregistrée : l'équipe ne la voit pas.",
    pt: "Pedido NÃO registado: a equipa não o vê.",
  },
  cancel: {
    it: "Annullamento NON registrato: il team vede ancora la richiesta.",
    en: "Cancellation NOT registered: the team still sees the request.",
    hu: "A visszavonás NEM lett rögzítve: a csapat továbbra is látja a kérést.",
    es: "Cancelación NO registrada: el equipo aún ve la solicitud.",
    de: "Abbruch NICHT erfasst: Das Team sieht die Anfrage weiterhin.",
    fr: "Annulation NON enregistrée : l'équipe voit toujours la demande.",
    pt: "Cancelamento NÃO registado: a equipa ainda vê o pedido.",
  },
  authorise: {
    it: "Candidatura NON autorizzata: il team non la invierà.",
    en: "Application NOT authorised: the team will not send it.",
    hu: "A jelentkezés NINCS jóváhagyva: a csapat nem küldi el.",
    es: "Candidatura NO autorizada: el equipo no la enviará.",
    de: "Bewerbung NICHT freigegeben: Das Team wird sie nicht senden.",
    fr: "Candidature NON autorisée : l'équipe ne l'enverra pas.",
    pt: "Candidatura NÃO autorizada: a equipa não a vai enviar.",
  },
  withdraw: {
    it: "Autorizzazione NON ritirata: il team può ancora inviare la candidatura.",
    en: "Authorisation NOT withdrawn: the team can still send the application.",
    hu: "A jóváhagyás NEM lett visszavonva: a csapat még elküldheti a jelentkezést.",
    es: "Autorización NO retirada: el equipo aún puede enviar la candidatura.",
    de: "Freigabe NICHT zurückgezogen: Das Team kann die Bewerbung weiterhin senden.",
    fr: "Autorisation NON retirée : l'équipe peut encore envoyer la candidature.",
    pt: "Autorização NÃO retirada: a equipa ainda pode enviar a candidatura.",
  },
  conflict: {
    it: "La posizione non è nello stato giusto per questa richiesta: ricarica la pagina.",
    en: "The position is not in the right state for this request: reload the page.",
    hu: "Az állás nincs megfelelő állapotban ehhez a kéréshez: töltsd újra az oldalt.",
    es: "La oferta no está en el estado adecuado para esta solicitud: recarga la página.",
    de: "Die Stelle ist nicht im richtigen Zustand für diese Anfrage: Lade die Seite neu.",
    fr: "Le poste n'est pas dans le bon état pour cette demande : rechargez la page.",
    pt: "A vaga não está no estado certo para este pedido: recarrega a página.",
  },
} satisfies Dictionary;

/** Cosa l'utente stava facendo: dice cosa NON è successo. */
export type RequestAction = "request" | "cancel" | "authorise" | "withdraw";

export type RequestOutcome =
  | { ok: true; body: Record<string, unknown> }
  | {
      ok: false;
      /** Status HTTP; `null` = la rete è caduta. */
      status: number | null;
      /** La route ha risposto 2xx ma non ha confermato la richiesta. */
      unconfirmed: boolean;
      /** Il codice della route (`already_submitted`…), solo se è un codice. */
      code: string | null;
    };

/**
 * Manda la richiesta e dice se la route l'ha confermata.
 *
 * `acknowledged` riceve il corpo JSON della risposta e dice se conferma
 * proprio quello che si è chiesto: un 200 che non viene dalla route, o che
 * dice altro, non cambia lo stato del pulsante.
 */
export async function sendPositionRequest(
  input: string,
  init: RequestInit,
  acknowledged: (body: Record<string, unknown>) => boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<RequestOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(input, init);
  } catch {
    return { ok: false, status: null, code: null, unconfirmed: false };
  }
  const body = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (res.ok && body !== null && acknowledged(body)) return { ok: true, body };
  // Solo un codice (`snake_case`) esce di qui, mai una frase della route.
  const error = body?.error;
  const code =
    typeof error === "string" && /^[a-z][a-z_]*$/.test(error) ? error : null;
  return {
    ok: false,
    status: res.ok ? 500 : res.status,
    code,
    unconfirmed: res.ok,
  };
}

/** Il motivo, dallo status: il 409 è lo stato della posizione. */
export function requestFailureReason(
  locale: Locale | string,
  status: number | null,
): string {
  if (status === 409) return makeT(POSITION_REQUEST, locale)("conflict");
  return writeFailureReason(locale, status);
}

/** La frase intera: cosa NON è successo, poi il motivo. */
export function requestFailureMessage(
  locale: Locale | string,
  action: RequestAction,
  reason: string,
): string {
  return `${makeT(POSITION_REQUEST, locale)(action)} ${reason}`;
}
