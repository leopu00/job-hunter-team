"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "@/i18n/config";
import { useLocale } from "@/lib/use-locale";

export type TeamState = {
  should_run: boolean | null;
  is_running: boolean | null;
  last_heartbeat_at: string | null;
  last_action: string | null;
  last_action_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  emergency_stop_requested_at: string | null;
  emergency_stop_completed_at: string | null;
};

type Copy = {
  title: string;
  readOnly: string;
  running: string;
  stopping: string;
  stopped: string;
  unavailable: string;
  heartbeat: string;
  never: string;
  stop: string;
  confirmTitle: string;
  confirmBody: string;
  cancel: string;
  confirm: string;
  requested: string;
  failed: string;
  refresh: string;
  chatDeliveryWarning: string;
  detectedAt: string;
};

const EN: Copy = {
  title: "Team status",
  readOnly: "Mobile view is read-only, except for emergency stop.",
  running: "Running",
  stopping: "Stopping…",
  stopped: "Stopped",
  unavailable: "Status unavailable",
  heartbeat: "Last device heartbeat",
  never: "not received",
  stop: "Emergency stop",
  confirmTitle: "Stop the whole team?",
  confirmBody:
    "This only sends a stop intent. It cannot run commands or restart the team.",
  cancel: "Cancel",
  confirm: "Stop now",
  requested: "Stop requested. The paired device is applying it.",
  failed: "The stop request failed. Try again.",
  refresh: "Refresh status",
  chatDeliveryWarning:
    "Some messages you sent may not have reached the team yet.",
  detectedAt: "Detected",
};

const T: Record<Locale, Copy> = {
  en: EN,
  it: {
    ...EN,
    title: "Stato del team",
    readOnly: "La vista mobile è sola lettura, tranne lo stop d'emergenza.",
    running: "In esecuzione",
    stopping: "Arresto in corso…",
    stopped: "Fermo",
    unavailable: "Stato non disponibile",
    heartbeat: "Ultimo segnale del dispositivo",
    never: "mai ricevuto",
    stop: "Stop d'emergenza",
    confirmTitle: "Fermare tutto il team?",
    confirmBody:
      "Invia soltanto l'intenzione di stop. Non può eseguire comandi o riavviare il team.",
    cancel: "Annulla",
    confirm: "Ferma ora",
    requested: "Stop richiesto. Il dispositivo associato lo sta applicando.",
    failed: "Richiesta di stop fallita. Riprova.",
    refresh: "Aggiorna stato",
    chatDeliveryWarning:
      "Alcuni messaggi che hai inviato potrebbero non essere ancora arrivati al team.",
    detectedAt: "Rilevato",
  },
  es: {
    ...EN,
    title: "Estado del equipo",
    readOnly:
      "La vista móvil es de solo lectura, salvo la parada de emergencia.",
    running: "En ejecución",
    stopping: "Deteniendo…",
    stopped: "Detenido",
    unavailable: "Estado no disponible",
    heartbeat: "Última señal del dispositivo",
    never: "no recibida",
    stop: "Parada de emergencia",
    confirmTitle: "¿Detener todo el equipo?",
    confirmBody:
      "Solo envía una intención de parada. No puede ejecutar comandos ni reiniciar el equipo.",
    cancel: "Cancelar",
    confirm: "Detener ahora",
    requested: "Parada solicitada. El dispositivo vinculado la está aplicando.",
    failed: "La solicitud de parada falló. Inténtalo de nuevo.",
    refresh: "Actualizar estado",
    chatDeliveryWarning:
      "Es posible que algunos mensajes que enviaste aún no hayan llegado al equipo.",
    detectedAt: "Detectado",
  },
  fr: {
    ...EN,
    title: "État de l'équipe",
    readOnly:
      "La vue mobile est en lecture seule, sauf pour l'arrêt d'urgence.",
    running: "En cours",
    stopping: "Arrêt en cours…",
    stopped: "Arrêtée",
    unavailable: "État indisponible",
    heartbeat: "Dernier signal de l'appareil",
    never: "jamais reçu",
    stop: "Arrêt d'urgence",
    confirmTitle: "Arrêter toute l'équipe ?",
    confirmBody:
      "Cette action envoie uniquement une intention d'arrêt. Elle ne peut ni exécuter de commandes ni redémarrer l'équipe.",
    cancel: "Annuler",
    confirm: "Arrêter maintenant",
    requested: "Arrêt demandé. L'appareil associé est en train de l'appliquer.",
    failed: "La demande d'arrêt a échoué. Réessayez.",
    refresh: "Actualiser l'état",
    chatDeliveryWarning:
      "Certains messages que vous avez envoyés ne sont peut-être pas encore parvenus à l'équipe.",
    detectedAt: "Détecté",
  },
  de: {
    ...EN,
    title: "Teamstatus",
    readOnly:
      "Die mobile Ansicht ist schreibgeschützt – außer für den Not-Aus.",
    running: "Aktiv",
    stopping: "Wird gestoppt…",
    stopped: "Gestoppt",
    unavailable: "Status nicht verfügbar",
    heartbeat: "Letztes Gerätesignal",
    never: "nicht empfangen",
    stop: "Not-Aus",
    confirmTitle: "Das gesamte Team stoppen?",
    confirmBody:
      "Dies sendet nur eine Stopp-Anforderung. Es kann keine Befehle ausführen oder das Team neu starten.",
    cancel: "Abbrechen",
    confirm: "Jetzt stoppen",
    requested: "Stopp angefordert. Das verbundene Gerät setzt ihn um.",
    failed: "Die Stopp-Anforderung ist fehlgeschlagen. Versuche es erneut.",
    refresh: "Status aktualisieren",
    chatDeliveryWarning:
      "Einige deiner gesendeten Nachrichten haben das Team möglicherweise noch nicht erreicht.",
    detectedAt: "Erkannt",
  },
  hu: {
    ...EN,
    title: "Csapat állapota",
    readOnly: "A mobilnézet csak olvasható, a vészleállítás kivételével.",
    running: "Fut",
    stopping: "Leállítás…",
    stopped: "Leállítva",
    unavailable: "Az állapot nem érhető el",
    heartbeat: "Utolsó eszközjelzés",
    never: "nem érkezett",
    stop: "Vészleállítás",
    confirmTitle: "Leállítod az egész csapatot?",
    confirmBody:
      "Ez csak leállítási szándékot küld. Nem futtathat parancsot és nem indíthatja újra a csapatot.",
    cancel: "Mégse",
    confirm: "Leállítás most",
    requested: "Leállítás kérve. A párosított eszköz végrehajtja.",
    failed: "A leállítási kérés sikertelen. Próbáld újra.",
    refresh: "Állapot frissítése",
    chatDeliveryWarning:
      "Előfordulhat, hogy néhány elküldött üzeneted még nem érkezett meg a csapathoz.",
    detectedAt: "Észlelve",
  },
  pt: {
    ...EN,
    title: "Estado da equipa",
    readOnly: "A vista móvel é só de leitura, exceto a paragem de emergência.",
    running: "Em execução",
    stopping: "A parar…",
    stopped: "Parada",
    unavailable: "Estado indisponível",
    heartbeat: "Último sinal do dispositivo",
    never: "não recebido",
    stop: "Paragem de emergência",
    confirmTitle: "Parar toda a equipa?",
    confirmBody:
      "Isto envia apenas uma intenção de paragem. Não pode executar comandos nem reiniciar a equipa.",
    cancel: "Cancelar",
    confirm: "Parar agora",
    requested: "Paragem pedida. O dispositivo associado está a aplicá-la.",
    failed: "O pedido de paragem falhou. Tenta novamente.",
    refresh: "Atualizar estado",
    chatDeliveryWarning:
      "Algumas mensagens que enviou poderão ainda não ter chegado à equipa.",
    detectedAt: "Detetado",
  },
};

// `last_error` is also used by the team reconciler for unrelated failures.
// Chat sync writes one of these stable, sanitized summaries. Match the known
// classification but never render its value: the read-failure variant may
// carry a bounded transport detail that belongs in logs, not in the UI.
const CHAT_DELIVERY_ERROR = [
  /^chat: web turns cannot be retrieved \(no cloud read channel\)$/,
  /^chat: failed to read user turns from the cloud(?: \(.{0,160}\))?$/,
  /^chat: [1-9]\d{0,9} pane delivery outcomes are uncertain$/,
  /^chat: [1-9]\d{0,9} user turns not delivered to the agent$/,
];

export function mobileChatDeliveryAlert(
  state: TeamState | null,
): { detectedAt: string } | null {
  const summary = state?.last_error;
  if (!summary || !CHAT_DELIVERY_ERROR.some((pattern) => pattern.test(summary)))
    return null;
  const detected = Date.parse(state?.last_error_at ?? "");
  if (!Number.isFinite(detected)) return null;
  return { detectedAt: new Date(detected).toISOString() };
}

function fullTimestamp(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function MobileChatDeliveryWarning({
  state,
  locale,
}: {
  state: TeamState | null;
  locale: Locale;
}) {
  const alert = mobileChatDeliveryAlert(state);
  if (!alert) return null;
  const t = T[locale] ?? EN;
  return (
    <div
      role="alert"
      data-chat-delivery-warning
      className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 text-amber-100"
    >
      <p className="text-[12px] font-semibold leading-relaxed">
        {t.chatDeliveryWarning}
      </p>
      <p className="mt-1 text-[10px] text-amber-100/70">
        {t.detectedAt}:{" "}
        <time dateTime={alert.detectedAt}>
          {fullTimestamp(alert.detectedAt, locale)}
        </time>
      </p>
    </div>
  );
}

export function mobileTeamStatus(
  state: TeamState | null,
): "running" | "stopping" | "stopped" | "unavailable" {
  if (!state) return "unavailable";
  const requested = Date.parse(state.emergency_stop_requested_at ?? "");
  const completed = Date.parse(state.emergency_stop_completed_at ?? "");
  if (
    Number.isFinite(requested) &&
    (!Number.isFinite(completed) || requested > completed)
  )
    return "stopping";
  if (state.is_running === true) return "running";
  if (state.is_running === false) return "stopped";
  return "unavailable";
}

function relativeTime(value: string | null, locale: Locale): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  const deltaSeconds = Math.round((at - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(deltaSeconds) < 90)
    return formatter.format(deltaSeconds, "second");
  const minutes = Math.round(deltaSeconds / 60);
  if (Math.abs(minutes) < 90) return formatter.format(minutes, "minute");
  return formatter.format(Math.round(minutes / 60), "hour");
}

export default function MobileTeamStatus() {
  const locale = useLocale();
  const t = T[locale] ?? EN;
  const [state, setState] = useState<TeamState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"ok" | "error" | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/team-state", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        state?: TeamState | null;
      };
      if (response.ok) setState(data.state ?? null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const status = mobileTeamStatus(state);
  const statusLabel = loaded ? t[status] : "…";
  const heartbeat = useMemo(
    () => relativeTime(state?.last_heartbeat_at ?? null, locale),
    [state?.last_heartbeat_at, locale],
  );

  const stop = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/team-state/emergency-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "STOP" }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        state?: TeamState;
      };
      if (!response.ok) {
        setNotice("error");
        return;
      }
      if (data.state) setState(data.state);
      setConfirming(false);
      setNotice("ok");
    } catch {
      setNotice("error");
    } finally {
      setBusy(false);
    }
  };

  // Lo stato observed può essere vecchio dopo una ripartenza desktop. Uno
  // stop idempotente è più sicuro di un bottone disabilitato proprio quando
  // serve: basta che esista la riga del device e non ci sia già una richiesta.
  const canStop = loaded && state !== null && status !== "stopping";
  const tone =
    status === "running"
      ? "var(--color-green)"
      : status === "stopping"
        ? "var(--color-yellow)"
        : "var(--color-muted)";

  return (
    <section
      aria-labelledby="mobile-team-status-title"
      className="mb-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2
            id="mobile-team-status-title"
            className="text-[15px] font-bold text-[var(--color-white)]"
          >
            {t.title}
          </h2>
          <div className="mt-2 flex items-center gap-2" aria-live="polite">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: tone }}
              aria-hidden="true"
            />
            <span className="text-[14px] font-semibold" style={{ color: tone }}>
              {statusLabel}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
            {t.readOnly}
          </p>
          <p className="mt-1 text-[10px] text-[var(--color-dim)]">
            {t.heartbeat}: {heartbeat ?? t.never}
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-52">
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!canStop || busy}
              className="min-h-12 w-full rounded-xl border border-red-500/60 bg-red-500/10 px-4 py-3 text-[13px] font-bold text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t.stop}
            </button>
          ) : (
            <div
              role="alertdialog"
              aria-labelledby="stop-confirm-title"
              aria-describedby="stop-confirm-description"
              className="rounded-xl border border-red-500/60 bg-red-500/10 p-3"
            >
              <p
                id="stop-confirm-title"
                className="text-[13px] font-bold text-red-200"
              >
                {t.confirmTitle}
              </p>
              <p
                id="stop-confirm-description"
                className="mt-1 text-[11px] leading-relaxed text-red-100/80"
              >
                {t.confirmBody}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="min-h-11 rounded-lg border border-[var(--color-border)] px-3 text-[12px] text-[var(--color-muted)]"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={stop}
                  disabled={busy}
                  className="min-h-11 rounded-lg bg-red-600 px-3 text-[12px] font-bold text-white disabled:opacity-50"
                >
                  {busy ? "…" : t.confirm}
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="min-h-11 text-[11px] text-[var(--color-muted)] underline-offset-4 hover:underline disabled:opacity-50"
          >
            {t.refresh}
          </button>
        </div>
      </div>

      <MobileChatDeliveryWarning state={state} locale={locale} />

      {notice && (
        <p
          role="status"
          className={`mt-3 text-[11px] ${notice === "ok" ? "text-emerald-300" : "text-red-300"}`}
        >
          {notice === "ok" ? t.requested : t.failed}
        </p>
      )}
    </section>
  );
}
