"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { createClient } from "@/lib/supabase/client";
import {
  syncTerminalOutcome,
  timestampAdvanced,
  waitForSyncOutcome,
  type SyncObservation,
  type SyncTerminalOutcome,
} from "@/lib/sync-rendezvous";
import {
  CLOUD_SYNC_STALE_AFTER_MS,
  cloudPushQuarantineCount,
  cloudSyncIsBehind,
  freshnessRowFromRead,
} from "@/lib/team-state/sync-freshness";

// "Sync now" lato CLOUD ([JHT-DATA-SYNC] fase 3). Mirror del CloudSyncStatusBanner
// (che è LOCAL-only): quello pusha SQLite→cloud, questo chiede alla VPS un push
// fresco on-demand, senza polling continuo del browser.
//
// Flusso: PATCH /api/team-state { sync_requested_at } (timbrato lato server) →
// il daemon VPS lo rileva, pusha e marca sync_completed_at → il browser lo
// riceve via Supabase REALTIME (websocket diretto, NIENTE polling, zero
// invocazioni Vercel) e fa un router.refresh().
//
// [JHT-DATA-FRESH-SIGNAL] Oltre al rendezvous esplicito, la route di push
// timbra sync_completed_at a ogni push che porta dati dashboard: qui lo
// intercettiamo come segnale "dati freschi" e aggiorniamo da soli (throttled,
// solo a tab visibile) — l'utente non deve più né premere il pulsante né
// ricaricare la pagina per vedere i dati nuovi.
//
// Fix UX 2026-07-21 (sintomi: "premo e non succede niente", "si ferma anche
// se ha sincronizzato, i dati cambiano solo ricaricando"):
//   1. setAuth(jwt) PRIMA della subscribe — senza, il canale parte anon e la
//      RLS blocca in silenzio tutti gli eventi (gotcha E2E 2026-05-23).
//   2. Niente confronti con l'orologio del browser: il completamento si
//      riconosce come avanzamento di sync_completed_at rispetto all'ultimo
//      valore NOTO DAL SERVER (baseline alla richiesta).
//   3. Un completamento in ritardo (VPS in deep-idle polla ogni 120s) aggiorna
//      comunque i dati appena arriva, anche dopo il timeout dello spinner.

const T: Record<
  Locale,
  {
    now: string;
    fewSecondsAgo: string;
    secAgo: (n: number) => string;
    minAgo: (n: number) => string;
    hourAgo: (n: number) => string;
    daysAgo: (n: number) => string;
    updated: (rel: string) => string;
    networkError: string;
    syncing: string;
    syncNow: string;
    title: string;
    updatedNow: string;
    behind: string;
    quarantined: (n: number) => string;
    vpsSlow: string;
    syncTimedOut: string;
    syncPushPartial: string;
    syncPushFailed: string;
    syncAckFailed: string;
    syncSuperseded: string;
  }
> = {
  it: {
    now: "ora",
    fewSecondsAgo: "pochi secondi fa",
    secAgo: (n) => `${n} sec fa`,
    minAgo: (n) => (n === 1 ? "1 min fa" : `${n} min fa`),
    hourAgo: (n) => (n === 1 ? "1 ora fa" : `${n} ore fa`),
    daysAgo: (n) => (n === 1 ? "1 giorno fa" : `${n} giorni fa`),
    updated: (rel) => `Aggiornato ${rel}`,
    networkError: "Controlla la connessione e riprova.",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Chiedi alla VPS un aggiornamento dei dati ora",
    updatedNow: "Dati aggiornati",
    behind:
      "I dati cloud potrebbero essere indietro. La sync automatica riproverà.",
    quarantined: (n) =>
      `${n} record locali richiedono attenzione. Gli altri dati continuano a sincronizzarsi.`,
    vpsSlow:
      "Nessuna conferma entro tre minuti. Controlla che il team sia online e riprova.",
    syncTimedOut:
      "La sincronizzazione ha impiegato troppo ed è stata interrotta. Riprova.",
    syncPushPartial:
      "Una parte dei dati non è stata confermata. Il resto è arrivato e il team riprova le righe rimaste.",
    syncPushFailed:
      "L'invio si è interrotto prima della fine. I dati già confermati restano; il team riprova da solo.",
    syncAckFailed:
      "I dati potrebbero essere arrivati, ma manca la conferma. Attendi qualche secondo e riprova.",
    syncSuperseded:
      "Una richiesta più recente ha sostituito questa sincronizzazione. Segui la scheda più recente.",
  },
  en: {
    now: "now",
    fewSecondsAgo: "a few seconds ago",
    secAgo: (n) => `${n} sec ago`,
    minAgo: (n) => (n === 1 ? "1 min ago" : `${n} min ago`),
    hourAgo: (n) => (n === 1 ? "1 hour ago" : `${n} hours ago`),
    daysAgo: (n) => (n === 1 ? "1 day ago" : `${n} days ago`),
    updated: (rel) => `Updated ${rel}`,
    networkError: "Check your connection and try again.",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Ask the VPS for a data refresh now",
    updatedNow: "Data updated",
    behind: "Cloud data may be behind. Automatic sync will retry.",
    quarantined: (n) =>
      `${n} local record${n === 1 ? "" : "s"} need attention. Other data continues syncing.`,
    vpsSlow:
      "No confirmation arrived within three minutes. Check that the team is online and try again.",
    syncTimedOut: "The sync took too long and was stopped. Try again.",
    syncPushPartial:
      "Some of the data wasn't confirmed. The rest arrived, and the team retries the remaining rows.",
    syncPushFailed:
      "The upload stopped before the end. Data already confirmed stays; the team retries on its own.",
    syncAckFailed:
      "The data may have arrived, but confirmation is missing. Wait a few seconds and try again.",
    syncSuperseded:
      "A newer request replaced this sync. Follow the most recent tab.",
  },
  es: {
    now: "ahora",
    fewSecondsAgo: "hace unos segundos",
    secAgo: (n) => `hace ${n} s`,
    minAgo: (n) => (n === 1 ? "hace 1 min" : `hace ${n} min`),
    hourAgo: (n) => (n === 1 ? "hace 1 hora" : `hace ${n} horas`),
    daysAgo: (n) => (n === 1 ? "hace 1 día" : `hace ${n} días`),
    updated: (rel) => `Actualizado ${rel}`,
    networkError: "Comprueba tu conexión e inténtalo de nuevo.",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Pedir a la VPS una actualización de datos ahora",
    updatedNow: "Datos actualizados",
    behind:
      "Los datos en la nube pueden estar atrasados. La sincronización automática volverá a intentarlo.",
    quarantined: (n) =>
      `${n} registro${n === 1 ? " local requiere" : "s locales requieren"} atención. Los demás datos siguen sincronizándose.`,
    vpsSlow:
      "No llegó ninguna confirmación en tres minutos. Comprueba que el equipo esté conectado e inténtalo de nuevo.",
    syncTimedOut:
      "La sincronización tardó demasiado y se detuvo. Inténtalo de nuevo.",
    syncPushPartial:
      "Parte de los datos no se confirmó. El resto llegó y el equipo reintenta las filas pendientes.",
    syncPushFailed:
      "El envío se interrumpió antes de terminar. Los datos ya confirmados se mantienen; el equipo reintenta solo.",
    syncAckFailed:
      "Puede que los datos hayan llegado, pero falta la confirmación. Espera unos segundos e inténtalo de nuevo.",
    syncSuperseded:
      "Una solicitud más reciente reemplazó esta sincronización. Sigue la pestaña más reciente.",
  },
  fr: {
    now: "maintenant",
    fewSecondsAgo: "il y a quelques secondes",
    secAgo: (n) => `il y a ${n} s`,
    minAgo: (n) => (n === 1 ? "il y a 1 min" : `il y a ${n} min`),
    hourAgo: (n) => (n === 1 ? "il y a 1 heure" : `il y a ${n} heures`),
    daysAgo: (n) => (n === 1 ? "il y a 1 jour" : `il y a ${n} jours`),
    updated: (rel) => `Mis à jour ${rel}`,
    networkError: "Vérifiez votre connexion et réessayez.",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Demander au VPS une actualisation des données maintenant",
    updatedNow: "Données mises à jour",
    behind:
      "Les données cloud sont peut-être en retard. La synchronisation automatique va réessayer.",
    quarantined: (n) =>
      `${n} enregistrement${n === 1 ? " local nécessite" : "s locaux nécessitent"} une attention. Les autres données continuent à se synchroniser.`,
    vpsSlow:
      "Aucune confirmation après trois minutes. Vérifiez que l'équipe est en ligne et réessayez.",
    syncTimedOut:
      "La synchronisation a pris trop de temps et a été arrêtée. Réessayez.",
    syncPushPartial:
      "Une partie des données n'a pas été confirmée. Le reste est arrivé et l'équipe réessaie les lignes restantes.",
    syncPushFailed:
      "L'envoi s'est interrompu avant la fin. Les données déjà confirmées restent ; l'équipe réessaie seule.",
    syncAckFailed:
      "Les données sont peut-être arrivées, mais la confirmation manque. Attendez quelques secondes et réessayez.",
    syncSuperseded:
      "Une demande plus récente a remplacé cette synchronisation. Suivez l'onglet le plus récent.",
  },
  de: {
    now: "jetzt",
    fewSecondsAgo: "vor wenigen Sekunden",
    secAgo: (n) => `vor ${n} Sek.`,
    minAgo: (n) => (n === 1 ? "vor 1 Min." : `vor ${n} Min.`),
    hourAgo: (n) => (n === 1 ? "vor 1 Stunde" : `vor ${n} Stunden`),
    daysAgo: (n) => (n === 1 ? "vor 1 Tag" : `vor ${n} Tagen`),
    updated: (rel) => `Aktualisiert ${rel}`,
    networkError: "Prüfe deine Verbindung und versuche es erneut.",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Den VPS jetzt um eine Datenaktualisierung bitten",
    updatedNow: "Daten aktualisiert",
    behind:
      "Die Cloud-Daten könnten veraltet sein. Die automatische Synchronisierung versucht es erneut.",
    quarantined: (n) =>
      `${n} lokale${n === 1 ? "r Datensatz braucht" : " Datensätze brauchen"} Aufmerksamkeit. Andere Daten werden weiter synchronisiert.`,
    vpsSlow:
      "Innerhalb von drei Minuten kam keine Bestätigung. Prüfe, ob das Team online ist, und versuche es erneut.",
    syncTimedOut:
      "Die Synchronisierung dauerte zu lange und wurde beendet. Versuche es erneut.",
    syncPushPartial:
      "Ein Teil der Daten wurde nicht bestätigt. Der Rest ist angekommen, und das Team wiederholt die übrigen Zeilen.",
    syncPushFailed:
      "Die Übertragung brach vor dem Ende ab. Bereits bestätigte Daten bleiben; das Team versucht es von selbst erneut.",
    syncAckFailed:
      "Die Daten sind möglicherweise angekommen, aber die Bestätigung fehlt. Warte kurz und versuche es erneut.",
    syncSuperseded:
      "Eine neuere Anfrage hat diese Synchronisierung ersetzt. Folge dem neuesten Tab.",
  },
  hu: {
    now: "most",
    fewSecondsAgo: "néhány másodperce",
    secAgo: (n) => `${n} mp.-e`,
    minAgo: (n) => `${n} perce`,
    hourAgo: (n) => (n === 1 ? "1 órája" : `${n} órája`),
    daysAgo: (n) => (n === 1 ? "1 napja" : `${n} napja`),
    updated: (rel) => `Frissítve ${rel}`,
    networkError: "Ellenőrizd a kapcsolatot, majd próbáld újra.",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Kérj a VPS-től friss adatfrissítést most",
    updatedNow: "Adatok frissítve",
    behind:
      "A felhőadatok lemaradhattak. Az automatikus szinkronizálás újrapróbálkozik.",
    quarantined: (n) =>
      `${n} helyi rekord figyelmet igényel. A többi adat szinkronizálása folytatódik.`,
    vpsSlow:
      "Három percen belül nem érkezett megerősítés. Ellenőrizd, hogy a csapat online van-e, majd próbáld újra.",
    syncTimedOut:
      "A szinkronizálás túl sokáig tartott, ezért leállt. Próbáld újra.",
    syncPushPartial:
      "Az adatok egy része nem lett megerősítve. A többi megérkezett, és a csapat újrapróbálja a maradék sorokat.",
    syncPushFailed:
      "A küldés a vége előtt megszakadt. A már megerősített adatok megmaradnak; a csapat magától újrapróbálja.",
    syncAckFailed:
      "Az adatok megérkezhettek, de nincs megerősítés. Várj néhány másodpercet, majd próbáld újra.",
    syncSuperseded:
      "Egy újabb kérés felváltotta ezt a szinkronizálást. A legutóbbi lapot kövesd.",
  },
  pt: {
    now: "agora",
    fewSecondsAgo: "há alguns segundos",
    secAgo: (n) => `há ${n} s`,
    minAgo: (n) => (n === 1 ? "há 1 min" : `há ${n} min`),
    hourAgo: (n) => (n === 1 ? "há 1 hora" : `há ${n} horas`),
    daysAgo: (n) => (n === 1 ? "há 1 dia" : `há ${n} dias`),
    updated: (rel) => `Atualizado ${rel}`,
    networkError: "Verifique sua conexão e tente novamente.",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Pedir ao VPS uma atualização dos dados agora",
    updatedNow: "Dados atualizados",
    behind:
      "Os dados na nuvem podem estar atrasados. A sincronização automática tentará novamente.",
    quarantined: (n) =>
      `${n} registo${n === 1 ? " local precisa" : "s locais precisam"} de atenção. Os outros dados continuam a sincronizar.`,
    vpsSlow:
      "Nenhuma confirmação chegou em três minutos. Verifique se a equipe está online e tente novamente.",
    syncTimedOut:
      "A sincronização demorou demais e foi interrompida. Tente novamente.",
    syncPushPartial:
      "Parte dos dados não foi confirmada. O resto chegou e a equipe repete as linhas restantes.",
    syncPushFailed:
      "O envio parou antes do fim. Os dados já confirmados permanecem; a equipe tenta de novo sozinha.",
    syncAckFailed:
      "Os dados podem ter chegado, mas falta a confirmação. Aguarde alguns segundos e tente novamente.",
    syncSuperseded:
      "Uma solicitação mais recente substituiu esta sincronização. Acompanhe a aba mais recente.",
  },
};

function formatRelativeTime(iso: string, t: (typeof T)[Locale]): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return t.now;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return sec <= 5 ? t.fewSecondsAgo : t.secAgo(sec);
  const min = Math.floor(sec / 60);
  if (min < 60) return t.minAgo(min);
  const hr = Math.floor(min / 60);
  if (hr < 24) return t.hourAgo(hr);
  const days = Math.floor(hr / 24);
  return t.daysAgo(days);
}

// Throttle degli auto-refresh spontanei: ogni router.refresh() costa una
// render server-side su Vercel — il segnale può arrivare a ogni push della
// VPS (~30-60s a team attivo), il refetch no.
const REFRESH_THROTTLE_MS = 90_000;
// Finestra massima del catch-up bounded. Il giro normale del daemon e' <=5s;
// teniamo margine per deep-idle e push lento senza lasciare un poller vivo
// fuori da un'operazione richiesta esplicitamente.
const REQUEST_TIMEOUT_MS = 180_000;
const REQUEST_POLL_MS = 1_000;
const REQUEST_START_TIMEOUT_MS = 15_000;
const REQUEST_READ_TIMEOUT_MS = 10_000;

export function CloudPushQuarantineWarning({
  locale,
  status,
}: {
  locale: Locale;
  status: string | null;
}) {
  const count = cloudPushQuarantineCount(status);
  if (count === 0) return null;
  return (
    <span
      role="alert"
      data-cloud-push-quarantine-warning
      style={{ color: "var(--color-yellow)" }}
    >
      {T[locale].quarantined(count)}
    </span>
  );
}

export default function CloudRefreshButton() {
  const router = useRouter();
  const locale = useLocale();
  const t = T[locale];
  const [remote, setRemote] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [freshnessKnown, setFreshnessKnown] = useState(false);
  const [freshnessClock, setFreshnessClock] = useState(() => Date.now());
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [pushCheckedAt, setPushCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const mounted = useRef(true);

  // Ultimo sync_completed_at NOTO (timestamp del server): unico riferimento
  // per riconoscere gli avanzamenti — mai l'orologio del browser.
  const lastSyncRef = useRef<string | null>(null);
  // Richiesta "Sync now" in corso + baseline (completed al momento del click).
  const pendingRef = useRef(false);
  // Diventa true solo dopo che la PATCH ha restituito la baseline server:
  // un catch-up iniziale che corre durante la request non puo' quindi
  // scambiare un vecchio completion per la risposta al click corrente.
  const requestArmedRef = useRef(false);
  const baselineRef = useRef<string | null>(null);
  const requestedAtRef = useRef<string | null>(null);
  const requestTokenRef = useRef(0);
  // Primo valore dal catch-up iniziale: è la baseline, non un avanzamento
  // (i dati SSR appena renderizzati sono già allineati a quel timestamp).
  const initializedRef = useRef(false);
  // Auto-refresh: throttle + refresh rimandato quando il tab è nascosto.
  const lastRefreshMsRef = useRef(0);
  const staleRef = useRef(false);
  const staleTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  // Nessun polling: questo timer cambia soltanto l'etichetta quando scade il
  // bound del daemon. I dati continuano ad arrivare via Realtime/catch-up.
  useEffect(() => {
    if (!freshnessKnown || !pushCheckedAt) return;
    const checkedMs = Date.parse(pushCheckedAt);
    if (!Number.isFinite(checkedMs)) return;
    const delay = Math.max(
      0,
      checkedMs + CLOUD_SYNC_STALE_AFTER_MS - Date.now() + 50,
    );
    const id = window.setTimeout(
      () => setFreshnessClock(Date.now()),
      Math.min(delay, 2_147_483_647),
    );
    return () => window.clearTimeout(id);
  }, [freshnessKnown, pushCheckedAt]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (staleTimerRef.current != null)
        window.clearTimeout(staleTimerRef.current);
      if (flashTimerRef.current != null)
        window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  // Determina cloud-vs-local + login (stessa fonte del banner locale).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/local/sync/status");
        if (!res.ok) return;
        const s = await res.json();
        if (!mounted.current) return;
        setRemote(!!s.remote);
        setLoggedIn(!!s.logged_in);
      } catch {
        /* offline: resta nascosto */
      }
    })();
  }, []);

  function showFlash() {
    setFlash(true);
    if (flashTimerRef.current != null)
      window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null;
      if (mounted.current) setFlash(false);
    }, 4000);
  }

  // Refetch dei dati. force=true (completamento di un Sync now esplicito)
  // bypassa throttle e visibilità; force=false (push spontaneo della VPS)
  // rispetta entrambi e in caso rimanda: al rientro del tab o allo scadere
  // della finestra di throttle.
  function doRefresh(force: boolean) {
    if (!mounted.current) return;
    if (!force) {
      if (document.visibilityState === "hidden") {
        staleRef.current = true;
        return;
      }
      const elapsed = Date.now() - lastRefreshMsRef.current;
      if (elapsed < REFRESH_THROTTLE_MS) {
        staleRef.current = true;
        if (staleTimerRef.current == null) {
          staleTimerRef.current = window.setTimeout(
            () => {
              staleTimerRef.current = null;
              if (staleRef.current) doRefresh(false);
            },
            REFRESH_THROTTLE_MS - elapsed + 250,
          );
        }
        return;
      }
    }
    staleRef.current = false;
    lastRefreshMsRef.current = Date.now();
    router.refresh();
    showFlash();
  }

  /** Applica un ACK visto indifferentemente da Realtime o dal catch-up. */
  function applyCompletion(done: string | null, correlated = false) {
    if (!mounted.current || !done) return;
    const doneMs = Date.parse(done);
    if (Number.isNaN(doneMs)) return;
    const prev = lastSyncRef.current;
    const isNewKnownCompletion = timestampAdvanced(done, prev);
    if (isNewKnownCompletion) {
      lastSyncRef.current = done;
      setLastSync(done);
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      // Primo valore visto: baseline, salvo una richiesta gia' in volo.
      if (!pendingRef.current || !requestArmedRef.current) return;
    }

    if (
      pendingRef.current &&
      requestArmedRef.current &&
      (correlated || timestampAdvanced(done, baselineRef.current))
    ) {
      pendingRef.current = false;
      requestArmedRef.current = false;
      requestTokenRef.current++; // cancella timeout/poll della richiesta
      setError(null);
      setSyncing(false);
      doRefresh(true);
      return;
    }
    // Un poll puo' rileggere lo stesso ACK gia' visto da Realtime mentre la
    // PATCH era in volo. Sopra lo accettiamo contro la baseline; fuori da una
    // richiesta, invece, lo stesso timestamp non causa refresh duplicati.
    if (!isNewKnownCompletion) return;
    setError(null);
    doRefresh(false);
  }

  function finishTerminalOutcome(outcome: SyncTerminalOutcome) {
    if (outcome.status === "completed") {
      applyCompletion(outcome.completedAt, true);
      return;
    }
    pendingRef.current = false;
    requestArmedRef.current = false;
    requestTokenRef.current++;
    setSyncing(false);
    if (outcome.status === "timeout") setError(t.syncTimedOut);
    // Il push arrivato in fondo con righe isolate non e' un invio fallito:
    // dirlo cosi' mandava l'utente a cercare un guasto che non c'e'. Il
    // dettaglio di QUANTE righe restano lo da' gia' l'avviso quarantena.
    else if (outcome.status === "push_partial") setError(t.syncPushPartial);
    else if (outcome.status === "push_failed") setError(t.syncPushFailed);
    else if (outcome.status === "ack_failed") setError(t.syncAckFailed);
    else setError(t.syncSuperseded);
  }

  // Tab di nuovo visibile con dati arretrati → recupera il refresh rimandato.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && staleRef.current) {
        doRefresh(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestSync() {
    if (syncing || pendingRef.current) return;
    setError(null);
    setSyncing(true);
    pendingRef.current = true;
    requestArmedRef.current = false;
    baselineRef.current = lastSyncRef.current;
    const token = ++requestTokenRef.current;
    try {
      const res = await fetch("/api/team-state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(REQUEST_START_TIMEOUT_MS),
        // Il valore è solo un trigger: la route lo timbra lato server
        // (orologio browser fuori dall'equazione del rendezvous).
        body: JSON.stringify({ sync_requested_at: new Date().toISOString() }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        state?: {
          sync_requested_at?: string | null;
          sync_completed_at?: string | null;
        } | null;
      };
      if (!res.ok) {
        if (mounted.current && requestTokenRef.current === token) {
          setError(d.error || `HTTP ${res.status}`);
          setSyncing(false);
          pendingRef.current = false;
          requestArmedRef.current = false;
        }
        return;
      }

      // La risposta PATCH e' la baseline autorevole del server. Se la
      // subscription non aveva ancora completato il catch-up iniziale, usare
      // solo lastSyncRef=null farebbe accettare qualsiasi timestamp storico.
      baselineRef.current =
        d.state?.sync_completed_at ?? baselineRef.current ?? null;
      requestedAtRef.current = d.state?.sync_requested_at ?? null;
      requestArmedRef.current = true;
    } catch {
      if (mounted.current && requestTokenRef.current === token) {
        setError(t.networkError);
        setSyncing(false);
        pendingRef.current = false;
        requestArmedRef.current = false;
      }
      return;
    }

    // Realtime e' il fast path. Questo catch-up bounded e' la conferma:
    // osserva lo stesso ACK anche se l'UPDATE websocket e' andato perso.
    void waitForSyncOutcome({
      baselineCompletion: baselineRef.current,
      requestedAt: requestedAtRef.current,
      intervalMs: REQUEST_POLL_MS,
      timeoutMs: REQUEST_TIMEOUT_MS,
      isCancelled: () =>
        !mounted.current ||
        !pendingRef.current ||
        requestTokenRef.current !== token,
      readObservation: async () => {
        try {
          const statusRes = await fetch("/api/team-state", {
            cache: "no-store",
            signal: AbortSignal.timeout(REQUEST_READ_TIMEOUT_MS),
          });
          if (!statusRes.ok)
            return {
              requestedAt: null,
              completedAt: null,
              lastAction: null,
              lastActionAt: null,
            };
          const status = (await statusRes.json()) as {
            state?: {
              sync_requested_at?: string | null;
              sync_completed_at?: string | null;
              last_action?: string | null;
              last_action_at?: string | null;
            } | null;
          };
          return {
            requestedAt: status.state?.sync_requested_at ?? null,
            completedAt: status.state?.sync_completed_at ?? null,
            lastAction: status.state?.last_action ?? null,
            lastActionAt: status.state?.last_action_at ?? null,
          };
        } catch {
          return {
            requestedAt: null,
            completedAt: null,
            lastAction: null,
            lastActionAt: null,
          };
        }
      },
    }).then((outcome) => {
      if (
        mounted.current &&
        pendingRef.current &&
        requestTokenRef.current === token
      ) {
        if (outcome?.status === "completed") {
          // Il poller ha gia' validato o l'avanzamento della baseline o
          // l'action `sync:completed` correlata alla richiesta corrente.
          applyCompletion(outcome.completedAt, true);
          return;
        }
        if (outcome) finishTerminalOutcome(outcome);
        else {
          pendingRef.current = false;
          requestArmedRef.current = false;
          setSyncing(false);
          setError(t.vpsSlow);
        }
      }
    });
  }

  // [REALTIME] Sottoscrizione ai cambi di team_state — niente polling. Supabase
  // PUSHA l'update sul websocket quando la VPS (o la route di push) scrive
  // sync_completed_at; la RLS fa sì che il browser riceva SOLO la propria riga.
  // All'apertura (e a ogni riconnessione) una lettura di catch-up.
  useEffect(() => {
    if (!remote || !loggedIn) return;
    const supabase = createClient();

    type StateRow = {
      sync_requested_at?: string | null;
      sync_completed_at?: string | null;
      last_action?: string | null;
      last_action_at?: string | null;
      cloud_push_status?: string | null;
      cloud_push_checked_at?: string | null;
    };
    const apply = (row: StateRow | null) => {
      setFreshnessKnown(true);
      setFreshnessClock(Date.now());
      setPushStatus(row?.cloud_push_status ?? null);
      setPushCheckedAt(row?.cloud_push_checked_at ?? null);
      if (pendingRef.current && requestArmedRef.current) {
        const observation: SyncObservation = {
          requestedAt: row?.sync_requested_at ?? null,
          completedAt: row?.sync_completed_at ?? null,
          lastAction: row?.last_action ?? null,
          lastActionAt: row?.last_action_at ?? null,
        };
        const outcome = syncTerminalOutcome(
          observation,
          baselineRef.current,
          requestedAtRef.current,
        );
        if (outcome) finishTerminalOutcome(outcome);
        // Durante un rendezvous il solo timestamp non basta: CAS + request id
        // devono correlare l'ACK al tab corrente.
        return;
      }
      applyCompletion(row?.sync_completed_at ?? null);
    };

    const catchUp = async () => {
      try {
        const row = freshnessRowFromRead(
          await supabase
            .from("team_state")
            .select(
              "sync_requested_at,sync_completed_at,last_action,last_action_at,cloud_push_status,cloud_push_checked_at",
            )
            .maybeSingle(),
        );
        if (mounted.current && row !== undefined) {
          apply(row as StateRow | null);
        }
      } catch {
        /* offline: nessun timestamp */
      }
    };

    // Client non configurato (mock): niente websocket, resta solo il catch-up.
    if (typeof supabase.channel !== "function") {
      void catchUp();
      return;
    }

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;
    // Realtime NON disponibile (es. Safari che rifiuta il websocket: "The
    // operation is insecure") ≠ pagina rotta: si degrada al solo catch-up.
    // subscribe()/il costruttore WebSocket possono lanciare SINCRONO, quindi
    // TUTTO il setup del canale (auth + subscribe) sta in try/catch: senza,
    // l'eccezione buttava giù l'intera dashboard.
    void (async () => {
      try {
        // Auth del canale col JWT user PRIMA della subscribe: senza, il canale
        // parte con role anon → la RLS blocca in silenzio ogni postgres_changes
        // e il completamento non arriva MAI (root cause del "Sync now morto").
        const { data } = (await supabase.auth.getSession()) as {
          data: { session: { access_token: string } | null };
        };
        if (cancelled) return;
        const jwt = data.session?.access_token;
        if (jwt && supabase.realtime?.setAuth) {
          await supabase.realtime.setAuth(jwt);
        }
        channel = supabase
          .channel("cloud-sync-status")
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "team_state" },
            (payload: { new: StateRow }) => {
              if (!cancelled) apply(payload.new);
            },
          )
          .subscribe((status: string) => {
            // Alla (ri)connessione recupera lo stato corrente (eventi persi
            // a socket giù).
            if (status === "SUBSCRIBED" && !cancelled) void catchUp();
          });
      } catch {
        channel = null;
      }
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, loggedIn]);

  if (!remote || !loggedIn) return null;

  const behind =
    freshnessKnown &&
    cloudSyncIsBehind(pushStatus, pushCheckedAt, freshnessClock);
  const quarantineCount = cloudPushQuarantineCount(pushStatus);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        justifyContent: "flex-end",
        marginBottom: "0.75rem",
        fontSize: "0.8rem",
        color: "var(--color-muted)",
      }}
    >
      {flash && (
        <span style={{ color: "var(--color-green)" }}>{t.updatedNow}</span>
      )}
      {!flash && quarantineCount > 0 && !syncing && (
        <CloudPushQuarantineWarning locale={locale} status={pushStatus} />
      )}
      {!flash && quarantineCount === 0 && behind && !syncing && (
        <span style={{ color: "var(--color-yellow)" }}>{t.behind}</span>
      )}
      {!flash && !behind && lastSync && !syncing && (
        <span>{t.updated(formatRelativeTime(lastSync, t))}</span>
      )}
      {error && <span style={{ color: "var(--color-yellow)" }}>{error}</span>}
      <button
        onClick={() => void requestSync()}
        disabled={syncing}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          padding: "0.3rem 0.7rem",
          borderRadius: "6px",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-text)",
          cursor: syncing ? "default" : "pointer",
          opacity: syncing ? 0.6 : 1,
        }}
        title={t.title}
      >
        <span style={{ display: "inline-block", transformOrigin: "center" }}>
          ↻
        </span>
        {syncing ? t.syncing : t.syncNow}
      </button>
    </div>
  );
}
