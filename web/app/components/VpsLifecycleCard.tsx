"use client";

import { useState, useTransition } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

type Action = "pause" | "snapshot-destroy" | "terminate";

interface Props {
  // Mostrato solo quando il container gira su VPS. Il server component
  // padre (DashboardPage) passa true sse `JHT_HOST_TYPE === 'vps'`.
  // In Local PC mode i 3 bottoni non hanno senso — niente "snapshot
  // Hetzner" della tua MacBook.
  visible: boolean;
}

type Result =
  | { kind: "idle" }
  | { kind: "success"; action: Action; detail: string }
  | { kind: "error"; action: Action; message: string };

// Parte non linguistica delle azioni: i testi (title/cost/resume/button)
// vivono nel dizionario i18n qui sotto.
const ACTION_META: Record<
  Action,
  { emoji: string; tone: "neutral" | "warn" | "danger" }
> = {
  pause: { emoji: "⏸️", tone: "neutral" },
  "snapshot-destroy": { emoji: "📸", tone: "warn" },
  terminate: { emoji: "💀", tone: "danger" },
};

/* ── i18n ─────────────────────────────────────────────────────────── */
// Stesso pattern di TicketPanel: dict inline per le 7
// lingue + useLocale (cookie NEXT_LOCALE). Termini invariati: VPS,
// snapshot, "jht up", Supabase, deploy. Il suffisso del prezzo mensile
// segue la convenzione delle pagine docs (/mese, /mo, /mes, /mois,
// /Monat, /mês, /hó); i messaggi con dati runtime (nome container, id
// immagine, titolo azione) sono funzioni per-lingua.

interface ActionCopy {
  title: string;
  cost: string;
  resume: string;
  button: string;
}

interface Copy {
  sectionTitle: string;
  costAfter: string;
  resumeLabel: string;
  actions: Record<Action, ActionCopy>;
  confirmSnapshot: string;
  confirmTerminatePre: string;
  confirmTerminateStrong: string;
  confirmTerminatePost: string;
  yesProceed: string;
  cancel: string;
  okLabel: string;
  errorLabel: (actionTitle: string) => string;
  successPause: (container: string) => string;
  successSnapshot: (imageId: string) => string;
  successTerminate: string;
}

const T: Record<Locale, Copy> = {
  it: {
    sectionTitle: "VPS — Ciclo di vita",
    costAfter: "Costo dopo:",
    resumeLabel: "Riprendi:",
    actions: {
      pause: {
        title: "Pausa team",
        cost: "€4,50/mese (continui a pagare la VPS)",
        resume: "5s, 1 click",
        button: "Pausa",
      },
      "snapshot-destroy": {
        title: "Snapshot + Elimina VPS",
        cost: "~€0,10/mese (solo storage snapshot)",
        resume: "~90s (ricrea VPS da snapshot)",
        button: "Snapshot",
      },
      terminate: {
        title: "Termina VPS",
        cost: "€0",
        resume: "da zero (rifare il wizard)",
        button: "Termina",
      },
    },
    confirmSnapshot:
      "Confermi snapshot + delete? Lo snapshot può impiegare 2-4 minuti, durante i quali questa pagina resterà in attesa.",
    confirmTerminatePre: "Confermi distruzione del server? ",
    confirmTerminateStrong: "I dati locali sulla VPS verranno persi",
    confirmTerminatePost: ". Il backup cloud (Supabase) resta intatto.",
    yesProceed: "Sì, procedi",
    cancel: "Annulla",
    okLabel: "OK:",
    errorLabel: (actionTitle) => `Errore (${actionTitle}):`,
    successPause: (container) =>
      `Container fermato (${container}). Riprendi con "jht up" o un nuovo deploy.`,
    successSnapshot: (imageId) =>
      `Snapshot creato (image ${imageId}) e server eliminato. Fattura ferma.`,
    successTerminate:
      "Server eliminato. La VPS non è più raggiungibile da questa pagina.",
  },
  en: {
    sectionTitle: "VPS — Lifecycle",
    costAfter: "Cost after:",
    resumeLabel: "Resume:",
    actions: {
      pause: {
        title: "Pause team",
        cost: "€4.50/mo (you keep paying for the VPS)",
        resume: "5s, 1 click",
        button: "Pause",
      },
      "snapshot-destroy": {
        title: "Snapshot + Delete VPS",
        cost: "~€0.10/mo (snapshot storage only)",
        resume: "~90s (recreates the VPS from the snapshot)",
        button: "Snapshot",
      },
      terminate: {
        title: "Terminate VPS",
        cost: "€0",
        resume: "from scratch (run the wizard again)",
        button: "Terminate",
      },
    },
    confirmSnapshot:
      "Confirm snapshot + delete? The snapshot can take 2-4 minutes, during which this page will keep waiting.",
    confirmTerminatePre: "Confirm server destruction? ",
    confirmTerminateStrong: "Local data on the VPS will be lost",
    confirmTerminatePost: ". The cloud backup (Supabase) stays intact.",
    yesProceed: "Yes, proceed",
    cancel: "Cancel",
    okLabel: "OK:",
    errorLabel: (actionTitle) => `Error (${actionTitle}):`,
    successPause: (container) =>
      `Container stopped (${container}). Resume with "jht up" or a new deploy.`,
    successSnapshot: (imageId) =>
      `Snapshot created (image ${imageId}) and server deleted. Billing stopped.`,
    successTerminate:
      "Server deleted. The VPS is no longer reachable from this page.",
  },
  es: {
    sectionTitle: "VPS — Ciclo de vida",
    costAfter: "Coste después:",
    resumeLabel: "Reanudar:",
    actions: {
      pause: {
        title: "Pausar equipo",
        cost: "€4,50/mes (sigues pagando el VPS)",
        resume: "5s, 1 clic",
        button: "Pausar",
      },
      "snapshot-destroy": {
        title: "Snapshot + Eliminar VPS",
        cost: "~€0,10/mes (solo almacenamiento del snapshot)",
        resume: "~90s (recrea el VPS desde el snapshot)",
        button: "Snapshot",
      },
      terminate: {
        title: "Terminar VPS",
        cost: "€0",
        resume: "desde cero (repetir el asistente)",
        button: "Terminar",
      },
    },
    confirmSnapshot:
      "¿Confirmas snapshot + delete? El snapshot puede tardar 2-4 minutos, durante los cuales esta página quedará en espera.",
    confirmTerminatePre: "¿Confirmas la destrucción del servidor? ",
    confirmTerminateStrong: "Los datos locales en el VPS se perderán",
    confirmTerminatePost: ". El backup en la nube (Supabase) queda intacto.",
    yesProceed: "Sí, continuar",
    cancel: "Cancelar",
    okLabel: "OK:",
    errorLabel: (actionTitle) => `Error (${actionTitle}):`,
    successPause: (container) =>
      `Contenedor detenido (${container}). Reanuda con "jht up" o un nuevo deploy.`,
    successSnapshot: (imageId) =>
      `Snapshot creado (image ${imageId}) y servidor eliminado. Facturación detenida.`,
    successTerminate:
      "Servidor eliminado. El VPS ya no es accesible desde esta página.",
  },
  fr: {
    sectionTitle: "VPS — Cycle de vie",
    costAfter: "Coût après :",
    resumeLabel: "Reprise :",
    actions: {
      pause: {
        title: "Mettre l'équipe en pause",
        cost: "€4,50/mois (vous continuez à payer le VPS)",
        resume: "5s, 1 clic",
        button: "Pause",
      },
      "snapshot-destroy": {
        title: "Snapshot + Supprimer le VPS",
        cost: "~€0,10/mois (stockage du snapshot uniquement)",
        resume: "~90s (recrée le VPS depuis le snapshot)",
        button: "Snapshot",
      },
      terminate: {
        title: "Détruire le VPS",
        cost: "€0",
        resume: "de zéro (refaire l'assistant)",
        button: "Détruire",
      },
    },
    confirmSnapshot:
      "Confirmer le snapshot + delete ? Le snapshot peut prendre 2-4 minutes, pendant lesquelles cette page restera en attente.",
    confirmTerminatePre: "Confirmer la destruction du serveur ? ",
    confirmTerminateStrong: "Les données locales sur le VPS seront perdues",
    confirmTerminatePost: ". La sauvegarde cloud (Supabase) reste intacte.",
    yesProceed: "Oui, continuer",
    cancel: "Annuler",
    okLabel: "OK :",
    errorLabel: (actionTitle) => `Erreur (${actionTitle}) :`,
    successPause: (container) =>
      `Conteneur arrêté (${container}). Reprenez avec « jht up » ou un nouveau deploy.`,
    successSnapshot: (imageId) =>
      `Snapshot créé (image ${imageId}) et serveur supprimé. Facturation arrêtée.`,
    successTerminate:
      "Serveur supprimé. Le VPS n'est plus accessible depuis cette page.",
  },
  de: {
    sectionTitle: "VPS — Lebenszyklus",
    costAfter: "Kosten danach:",
    resumeLabel: "Fortsetzen:",
    actions: {
      pause: {
        title: "Team pausieren",
        cost: "€4,50/Monat (du zahlst weiter für den VPS)",
        resume: "5s, 1 Klick",
        button: "Pause",
      },
      "snapshot-destroy": {
        title: "Snapshot + VPS löschen",
        cost: "~€0,10/Monat (nur Snapshot-Speicher)",
        resume: "~90s (erstellt den VPS aus dem Snapshot neu)",
        button: "Snapshot",
      },
      terminate: {
        title: "VPS endgültig löschen",
        cost: "€0",
        resume: "von vorn (Assistent erneut durchlaufen)",
        button: "Löschen",
      },
    },
    confirmSnapshot:
      "Snapshot + Delete bestätigen? Der Snapshot kann 2-4 Minuten dauern; diese Seite wartet so lange.",
    confirmTerminatePre: "Zerstörung des Servers bestätigen? ",
    confirmTerminateStrong: "Lokale Daten auf dem VPS gehen verloren",
    confirmTerminatePost: ". Das Cloud-Backup (Supabase) bleibt intakt.",
    yesProceed: "Ja, fortfahren",
    cancel: "Abbrechen",
    okLabel: "OK:",
    errorLabel: (actionTitle) => `Fehler (${actionTitle}):`,
    successPause: (container) =>
      `Container gestoppt (${container}). Fortsetzen mit „jht up“ oder einem neuen Deploy.`,
    successSnapshot: (imageId) =>
      `Snapshot erstellt (Image ${imageId}), Server gelöscht. Abrechnung gestoppt.`,
    successTerminate:
      "Server gelöscht. Der VPS ist von dieser Seite aus nicht mehr erreichbar.",
  },
  pt: {
    sectionTitle: "VPS — Ciclo de vida",
    costAfter: "Custo depois:",
    resumeLabel: "Retomar:",
    actions: {
      pause: {
        title: "Pausar equipa",
        cost: "€4,50/mês (continuas a pagar o VPS)",
        resume: "5s, 1 clique",
        button: "Pausar",
      },
      "snapshot-destroy": {
        title: "Snapshot + Eliminar VPS",
        cost: "~€0,10/mês (só armazenamento do snapshot)",
        resume: "~90s (recria o VPS a partir do snapshot)",
        button: "Snapshot",
      },
      terminate: {
        title: "Terminar VPS",
        cost: "€0",
        resume: "do zero (refazer o assistente)",
        button: "Terminar",
      },
    },
    confirmSnapshot:
      "Confirmas snapshot + delete? O snapshot pode demorar 2-4 minutos, durante os quais esta página ficará à espera.",
    confirmTerminatePre: "Confirmas a destruição do servidor? ",
    confirmTerminateStrong: "Os dados locais no VPS serão perdidos",
    confirmTerminatePost: ". O backup na cloud (Supabase) fica intacto.",
    yesProceed: "Sim, continuar",
    cancel: "Cancelar",
    okLabel: "OK:",
    errorLabel: (actionTitle) => `Erro (${actionTitle}):`,
    successPause: (container) =>
      `Container parado (${container}). Retoma com "jht up" ou um novo deploy.`,
    successSnapshot: (imageId) =>
      `Snapshot criado (image ${imageId}) e servidor eliminado. Faturação parada.`,
    successTerminate:
      "Servidor eliminado. O VPS já não está acessível a partir desta página.",
  },
  hu: {
    sectionTitle: "VPS — Életciklus",
    costAfter: "Költség utána:",
    resumeLabel: "Folytatás:",
    actions: {
      pause: {
        title: "Csapat szüneteltetése",
        cost: "€4,50/hó (a VPS-t továbbra is fizeted)",
        resume: "5s, 1 kattintás",
        button: "Szünet",
      },
      "snapshot-destroy": {
        title: "Snapshot + VPS törlése",
        cost: "~€0,10/hó (csak a snapshot tárolása)",
        resume: "~90s (a VPS újraépül a snapshotból)",
        button: "Snapshot",
      },
      terminate: {
        title: "VPS megszüntetése",
        cost: "€0",
        resume: "nulláról (varázsló újra)",
        button: "Megszüntetés",
      },
    },
    confirmSnapshot:
      "Megerősíted a snapshot + delete műveletet? A snapshot 2-4 percig is eltarthat, ezalatt ez az oldal várakozik.",
    confirmTerminatePre: "Megerősíted a szerver megsemmisítését? ",
    confirmTerminateStrong: "A VPS-en lévő helyi adatok elvesznek",
    confirmTerminatePost: ". A felhőmentés (Supabase) érintetlen marad.",
    yesProceed: "Igen, mehet",
    cancel: "Mégse",
    okLabel: "OK:",
    errorLabel: (actionTitle) => `Hiba (${actionTitle}):`,
    successPause: (container) =>
      `Container leállítva (${container}). Folytatás: „jht up” vagy új deploy.`,
    successSnapshot: (imageId) =>
      `Snapshot elkészült (image ${imageId}), a szerver törölve. A számlázás leállt.`,
    successTerminate:
      "Szerver törölve. A VPS erről az oldalról többé nem érhető el.",
  },
};

export default function VpsLifecycleCard({ visible }: Props) {
  const t = T[useLocale()];
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const [confirmFor, setConfirmFor] = useState<Action | null>(null);
  const [result, setResult] = useState<Result>({ kind: "idle" });

  if (!visible) return null;

  function callApi(action: Action, body?: unknown) {
    setActiveAction(action);
    setResult({ kind: "idle" });
    startTransition(async () => {
      try {
        const res = await fetch(`/api/vps/${action}`, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const json = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!res.ok || json.ok === false) {
          throw new Error((json.error as string) || `HTTP ${res.status}`);
        }
        const detail =
          action === "pause"
            ? t.successPause(String(json.container ?? "jht"))
            : action === "snapshot-destroy"
              ? t.successSnapshot(String(json.snapshotImageId ?? "?"))
              : t.successTerminate;
        setResult({ kind: "success", action, detail });
      } catch (e) {
        setResult({ kind: "error", action, message: (e as Error).message });
      } finally {
        setActiveAction(null);
        setConfirmFor(null);
      }
    });
  }

  function onClick(action: Action) {
    if (action === "pause") {
      // Pause è reversibile in 5s, niente confirm step.
      callApi("pause");
      return;
    }
    setConfirmFor(action);
  }

  function onConfirm(action: Action) {
    if (action === "snapshot-destroy") callApi(action);
    if (action === "terminate") callApi(action, { confirm: "TERMINATE" });
  }

  return (
    <div className="mb-8" style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="section-label mb-4">🖥️ {t.sectionTitle}</div>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        {(Object.keys(ACTION_META) as Action[]).map((action, i) => {
          const meta = ACTION_META[action];
          const copy = t.actions[action];
          const isPending = pending && activeAction === action;
          const isConfirming = confirmFor === action;
          const tone =
            meta.tone === "danger"
              ? "var(--color-red)"
              : meta.tone === "warn"
                ? "var(--color-yellow)"
                : "var(--color-blue)";
          return (
            <div
              key={action}
              className="flex items-start gap-4 p-4"
              style={{
                borderTop: i > 0 ? "1px solid var(--color-border)" : undefined,
                opacity: pending && !isPending ? 0.5 : 1,
              }}
            >
              <div
                className="text-2xl leading-none shrink-0 mt-0.5"
                aria-hidden
              >
                {meta.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold text-[var(--color-bright)] mb-1">
                  {copy.title}
                </div>
                <p className="text-[10px] text-[var(--color-muted)] m-0 leading-relaxed">
                  {t.costAfter} <span style={{ color: tone }}>{copy.cost}</span>
                  {" · "}
                  {t.resumeLabel} {copy.resume}
                </p>
                {isConfirming && (
                  <div
                    className="mt-3 p-3 rounded border text-[11px]"
                    style={{
                      borderColor: tone,
                      background: "var(--color-panel)",
                      color: "var(--color-bright)",
                    }}
                  >
                    {action === "snapshot-destroy" ? (
                      <p className="m-0 mb-2">{t.confirmSnapshot}</p>
                    ) : (
                      <p className="m-0 mb-2">
                        {t.confirmTerminatePre}
                        <strong>{t.confirmTerminateStrong}</strong>
                        {t.confirmTerminatePost}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onConfirm(action)}
                        disabled={pending}
                        className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          background: tone,
                          color: "var(--color-base)",
                          border: "none",
                          cursor: pending ? "wait" : "pointer",
                        }}
                      >
                        {t.yesProceed}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmFor(null)}
                        disabled={pending}
                        className="px-3 py-1.5 rounded text-[10px] font-semibold uppercase tracking-wider"
                        style={{
                          background: "transparent",
                          color: "var(--color-muted)",
                          border: "1px solid var(--color-border)",
                          cursor: pending ? "wait" : "pointer",
                        }}
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onClick(action)}
                disabled={pending || isConfirming}
                className="px-3 py-2 rounded shrink-0 text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  background: isPending
                    ? "var(--color-border)"
                    : "var(--color-panel)",
                  color: tone,
                  border: `1px solid ${tone}`,
                  cursor: pending ? "wait" : "pointer",
                  minWidth: "90px",
                }}
              >
                {isPending ? "..." : copy.button}
              </button>
            </div>
          );
        })}
      </div>

      {result.kind === "success" && (
        <div
          className="mt-3 p-3 rounded border text-[11px]"
          style={{
            borderColor: "var(--color-green)",
            background: "rgba(0, 232, 122, 0.06)",
            color: "var(--color-bright)",
          }}
        >
          <strong style={{ color: "var(--color-green)" }}>
            {ACTION_META[result.action].emoji} {t.okLabel}
          </strong>{" "}
          {result.detail}
        </div>
      )}
      {result.kind === "error" && (
        <div
          className="mt-3 p-3 rounded border text-[11px]"
          style={{
            borderColor: "var(--color-red)",
            background: "rgba(255, 80, 80, 0.06)",
            color: "var(--color-bright)",
          }}
        >
          <strong style={{ color: "var(--color-red)" }}>
            {t.errorLabel(t.actions[result.action].title)}
          </strong>{" "}
          {result.message}
        </div>
      )}
    </div>
  );
}
