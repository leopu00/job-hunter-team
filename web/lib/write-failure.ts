/**
 * Il motivo di una scrittura non riuscita, detto all'utente nella sua lingua.
 *
 * Le pagine che salvano o cancellano qualcosa di delicato (secrets,
 * credenziali dei provider, avatar e CV, sincronizzazione) mostravano il corpo
 * della route così com'era: `read_only`, `internal`, un messaggio in italiano
 * su una pagina inglese, o il testo di un'eccezione. Alcune non guardavano
 * nemmeno la risposta e toglievano la riga dalla lista: un secret cancellato
 * dal web in sola lettura spariva a schermo e restava sul disco.
 *
 * Qui c'è solo il motivo, dallo status. Cosa NON è successo (non salvato, non
 * cancellato) lo dice la pagina, che sa cosa stava facendo.
 */
import type { Locale } from "@/i18n/config";
import { makeT, type Dictionary } from "@/lib/i18n-dict";

export const WRITE_FAILURE = {
  invalid: {
    it: "Dati non validi: controlla i campi.",
    en: "Invalid data: check the fields.",
    hu: "Érvénytelen adatok: ellenőrizd a mezőket.",
    es: "Datos no válidos: revisa los campos.",
    de: "Ungültige Daten: Prüfe die Felder.",
    fr: "Données invalides : vérifiez les champs.",
    pt: "Dados inválidos: verifica os campos.",
  },
  session: {
    it: "Sessione scaduta: ricarica la pagina e accedi di nuovo.",
    en: "Session expired: reload the page and sign in again.",
    hu: "A munkamenet lejárt: töltsd újra az oldalt, és jelentkezz be újra.",
    es: "Sesión caducada: recarga la página e inicia sesión de nuevo.",
    de: "Sitzung abgelaufen: Lade die Seite neu und melde dich erneut an.",
    fr: "Session expirée : rechargez la page et reconnectez-vous.",
    pt: "Sessão expirada: recarrega a página e inicia sessão novamente.",
  },
  readOnly: {
    it: "Da qui non si può modificare: fallo dall'app sul computer dove gira il team.",
    en: "This cannot be changed from here: do it from the app on the computer where the team runs.",
    hu: "Innen nem módosítható: tedd meg az alkalmazásban azon a gépen, ahol a csapat fut.",
    es: "Esto no se puede cambiar desde aquí: hazlo desde la app en el ordenador donde funciona el equipo.",
    de: "Das lässt sich hier nicht ändern: Mach es in der App auf dem Computer, auf dem das Team läuft.",
    fr: "Impossible de modifier ici : faites-le depuis l'app sur l'ordinateur où tourne l'équipe.",
    pt: "Não é possível alterar daqui: faz isso na app no computador onde a equipa corre.",
  },
  notFound: {
    it: "Elemento non trovato: ricarica la pagina.",
    en: "Item not found: reload the page.",
    hu: "Az elem nem található: töltsd újra az oldalt.",
    es: "Elemento no encontrado: recarga la página.",
    de: "Eintrag nicht gefunden: Lade die Seite neu.",
    fr: "Élément introuvable : rechargez la page.",
    pt: "Elemento não encontrado: recarrega a página.",
  },
  rateLimit: {
    it: "Troppe richieste: riprova fra un minuto.",
    en: "Too many requests: try again in a minute.",
    hu: "Túl sok kérés: próbáld újra egy perc múlva.",
    es: "Demasiadas solicitudes: inténtalo de nuevo en un minuto.",
    de: "Zu viele Anfragen: Versuche es in einer Minute erneut.",
    fr: "Trop de requêtes : réessayez dans une minute.",
    pt: "Demasiados pedidos: tenta novamente daqui a um minuto.",
  },
  server: {
    it: "Errore del server, riprova tra poco.",
    en: "Server error, try again shortly.",
    hu: "Szerverhiba, próbáld újra kicsit később.",
    es: "Error del servidor, inténtalo de nuevo en un momento.",
    de: "Serverfehler, versuche es gleich noch einmal.",
    fr: "Erreur du serveur, réessayez dans un instant.",
    pt: "Erro do servidor, tenta novamente daqui a pouco.",
  },
  network: {
    it: "Errore di rete: controlla la connessione.",
    en: "Network error: check your connection.",
    hu: "Hálózati hiba: ellenőrizd a kapcsolatot.",
    es: "Error de red: comprueba la conexión.",
    de: "Netzwerkfehler: Prüfe deine Verbindung.",
    fr: "Erreur réseau : vérifiez votre connexion.",
    pt: "Erro de rede: verifica a ligação.",
  },
} satisfies Dictionary;

/** Il motivo per uno status HTTP, o per la rete che è caduta (`null`). */
export function writeFailureReason(
  locale: Locale | string,
  status: number | null,
): string {
  const t = makeT(WRITE_FAILURE, locale);
  if (status === null) return t("network");
  if (status === 400 || status === 422) return t("invalid");
  if (status === 401) return t("session");
  if (status === 403) return t("readOnly");
  if (status === 404) return t("notFound");
  if (status === 429) return t("rateLimit");
  return t("server");
}

/**
 * Esegue una scrittura e dice se la route l'ha FATTA.
 *
 * Riuscita = status 2xx e, se il corpo è JSON con un campo `ok`, `ok: true`
 * (le route dell'app rispondono `{ ok: false, error }` anche con un 200).
 * Con `expectOk` il `{ ok: true }` è obbligatorio: un 200 che non viene dalla
 * route (la pagina di un proxy, un corpo vuoto) non è una scrittura fatta.
 * Altrimenti il motivo, già tradotto. Il corpo grezzo della route non esce
 * mai di qui.
 */
export async function attemptWrite(
  locale: Locale | string,
  input: string,
  init: RequestInit,
  { expectOk = false }: { expectOk?: boolean } = {},
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: string; status: number | null }
> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return {
      ok: false,
      reason: writeFailureReason(locale, null),
      status: null,
    };
  }
  const body = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const refused = expectOk
    ? body?.ok !== true
    : body !== null && "ok" in body && body.ok !== true;
  if (!res.ok || refused) {
    const status = res.ok ? 500 : res.status;
    return { ok: false, reason: writeFailureReason(locale, status), status };
  }
  return { ok: true, body: body ?? {} };
}
