"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import type { PositionTicket } from "@/lib/types";
import { splitTicketRequest } from "@/lib/ticket-attachment";

// Sezione "Richieste al team" sulla pagina posizione. L'utente scrive una
// richiesta testuale libera (popup) → ticket 'open'; il Capitano l'assegna a un
// agente; l'agente risolve con una risposta testuale che compare qui sotto.
// I CODICI di status (open/assigned/resolved) sono stabili nel DB; le label sono i18n.
type TicketStatus = "open" | "assigned" | "resolved";

const STATUS_COLOR: Record<string, string> = {
  open: "var(--color-yellow)",
  assigned: "var(--color-purple)",
  resolved: "var(--color-green)",
};

const T: Record<
  Locale,
  {
    statusLabel: Record<TicketStatus, string>;
    sectionTitle: string;
    newRequest: string;
    close: string;
    placeholder: string;
    cancel: string;
    sending: string;
    sendRequest: string;
    writeRequest: string;
    networkError: string;
    emptyState: string;
    teamResponse: string;
    attachFile: string;
    removeFile: string;
  }
> = {
  it: {
    statusLabel: {
      open: "In attesa",
      assigned: "In lavorazione",
      resolved: "Risolto",
    },
    sectionTitle: "Richieste al team",
    newRequest: "+ Nuova richiesta",
    close: "Chiudi",
    placeholder:
      "Scrivi cosa vuoi che il team faccia su questa offerta (es. verifica lo stipendio reale, controlla la cultura aziendale, riassumi i requisiti…)",
    cancel: "Annulla",
    sending: "Invio…",
    sendRequest: "Invia richiesta",
    writeRequest: "Scrivi la richiesta",
    networkError: "Errore di rete",
    emptyState:
      "Nessuna richiesta. Usa “Nuova richiesta” per chiedere al team qualcosa su questa offerta.",
    teamResponse: "Risposta del team",
    attachFile: "Allega un file",
    removeFile: "Rimuovi allegato",
  },
  en: {
    statusLabel: {
      open: "Pending",
      assigned: "In progress",
      resolved: "Resolved",
    },
    sectionTitle: "Requests to the team",
    newRequest: "+ New request",
    close: "Close",
    placeholder:
      "Write what you want the team to do on this position (e.g. verify the real salary, check company culture, summarize the requirements…)",
    cancel: "Cancel",
    sending: "Sending…",
    sendRequest: "Send request",
    writeRequest: "Write the request",
    networkError: "Network error",
    emptyState:
      "No requests. Use “New request” to ask the team something about this position.",
    teamResponse: "Team response",
    attachFile: "Attach a file",
    removeFile: "Remove attachment",
  },
  es: {
    statusLabel: {
      open: "En espera",
      assigned: "En proceso",
      resolved: "Resuelto",
    },
    sectionTitle: "Solicitudes al equipo",
    newRequest: "+ Nueva solicitud",
    close: "Cerrar",
    placeholder:
      "Escribe qué quieres que el equipo haga sobre esta posición (p. ej. verifica el salario real, revisa la cultura de la empresa, resume los requisitos…)",
    cancel: "Cancelar",
    sending: "Enviando…",
    sendRequest: "Enviar solicitud",
    writeRequest: "Escribe la solicitud",
    networkError: "Error de red",
    emptyState:
      "Sin solicitudes. Usa “Nueva solicitud” para pedirle algo al equipo sobre esta posición.",
    teamResponse: "Respuesta del equipo",
    attachFile: "Adjuntar un archivo",
    removeFile: "Quitar archivo",
  },
  fr: {
    statusLabel: {
      open: "En attente",
      assigned: "En cours",
      resolved: "Résolu",
    },
    sectionTitle: "Demandes à l'équipe",
    newRequest: "+ Nouvelle demande",
    close: "Fermer",
    placeholder:
      "Écrivez ce que vous voulez que l'équipe fasse sur ce poste (ex. vérifier le salaire réel, contrôler la culture d'entreprise, résumer les exigences…)",
    cancel: "Annuler",
    sending: "Envoi…",
    sendRequest: "Envoyer la demande",
    writeRequest: "Écrivez la demande",
    networkError: "Erreur réseau",
    emptyState:
      "Aucune demande. Utilisez « Nouvelle demande » pour demander quelque chose à l'équipe sur ce poste.",
    teamResponse: "Réponse de l'équipe",
    attachFile: "Joindre un fichier",
    removeFile: "Retirer le fichier",
  },
  de: {
    statusLabel: {
      open: "Ausstehend",
      assigned: "In Bearbeitung",
      resolved: "Gelöst",
    },
    sectionTitle: "Anfragen an das Team",
    newRequest: "+ Neue Anfrage",
    close: "Schließen",
    placeholder:
      "Schreibe, was das Team bei dieser Stelle tun soll (z. B. das echte Gehalt prüfen, die Unternehmenskultur checken, die Anforderungen zusammenfassen…)",
    cancel: "Abbrechen",
    sending: "Wird gesendet…",
    sendRequest: "Anfrage senden",
    writeRequest: "Anfrage eingeben",
    networkError: "Netzwerkfehler",
    emptyState:
      "Keine Anfragen. Nutze „Neue Anfrage“, um das Team etwas zu dieser Stelle zu fragen.",
    teamResponse: "Antwort des Teams",
    attachFile: "Datei anhängen",
    removeFile: "Anhang entfernen",
  },
  hu: {
    statusLabel: {
      open: "Várakozik",
      assigned: "Folyamatban",
      resolved: "Megoldva",
    },
    sectionTitle: "Kérések a csapatnak",
    newRequest: "+ Új kérés",
    close: "Bezárás",
    placeholder:
      "Írd le, mit szeretnél, hogy a csapat tegyen ezzel az állással (pl. ellenőrizze a valós fizetést, nézze meg a céges kultúrát, foglalja össze a követelményeket…)",
    cancel: "Mégse",
    sending: "Küldés…",
    sendRequest: "Kérés küldése",
    writeRequest: "Írd meg a kérést",
    networkError: "Hálózati hiba",
    emptyState:
      "Nincs kérés. Használd az „Új kérés” gombot, hogy kérj valamit a csapattól ehhez az álláshoz.",
    teamResponse: "A csapat válasza",
    attachFile: "Fájl csatolása",
    removeFile: "Melléklet eltávolítása",
  },
  pt: {
    statusLabel: {
      open: "Em espera",
      assigned: "Em andamento",
      resolved: "Resolvido",
    },
    sectionTitle: "Pedidos à equipa",
    newRequest: "+ Novo pedido",
    close: "Fechar",
    placeholder:
      "Escreve o que queres que a equipa faça nesta vaga (ex. verificar o salário real, analisar a cultura da empresa, resumir os requisitos…)",
    cancel: "Cancelar",
    sending: "Enviando…",
    sendRequest: "Enviar pedido",
    writeRequest: "Escreve o pedido",
    networkError: "Erro de rede",
    emptyState:
      "Sem pedidos. Usa “Novo pedido” para pedir algo à equipa sobre esta vaga.",
    teamResponse: "Resposta da equipa",
    attachFile: "Anexar um ficheiro",
    removeFile: "Remover anexo",
  },
};

export function TicketPanel({
  legacyId,
  tickets,
  hideTitle = false,
}: {
  legacyId: number;
  tickets: PositionTicket[];
  // Dentro TeamActionsSheet il titolo lo mette già l'header del popup:
  // qui resta solo il bottone "+ Nuova richiesta".
  hideTitle?: boolean;
}) {
  const t = T[useLocale()];
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);

  const submit = async () => {
    setError(null);
    if (!text.trim()) {
      setError(t.writeRequest);
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("request_text", text.trim());
      if (attachment) form.append("attachment", attachment);
      const res = await fetch(`/api/positions/${legacyId}/ticket`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error ?? `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      setText("");
      setAttachment(null);
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : t.networkError);
    }
    setBusy(false);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        {hideTitle ? (
          <span />
        ) : (
          <span className="section-label">{t.sectionTitle}</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)]"
          style={{
            borderColor: "var(--color-purple)",
            color: "var(--color-purple)",
          }}
        >
          {open ? t.close : t.newRequest}
        </button>
      </div>

      {open && (
        <div
          className="mb-4 p-3 rounded-lg border flex flex-col gap-2"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-row)",
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t.placeholder}
            className="w-full p-2 rounded-md border text-[13px] resize-y"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
            }}
          />
          <div className="flex items-center gap-2 text-[11px]">
            <label
              className="px-3 py-1.5 rounded-lg border cursor-pointer"
              style={{ borderColor: "var(--color-border)" }}
            >
              {t.attachFile}
              <input
                type="file"
                className="sr-only"
                onChange={(event) =>
                  setAttachment(event.target.files?.[0] ?? null)
                }
              />
            </label>
            {attachment && (
              <>
                <span style={{ color: "var(--color-dim)" }}>
                  📎 {attachment.name}
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  style={{ color: "var(--color-red)" }}
                >
                  {t.removeFile}
                </button>
              </>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setText("");
                setAttachment(null);
                setError(null);
              }}
              className="px-3 py-1.5 rounded-lg text-[11px]"
              style={{ color: "var(--color-dim)" }}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || isPending}
              className="px-4 py-1.5 rounded-lg border text-[11px] font-semibold disabled:opacity-60 disabled:cursor-wait"
              style={{
                borderColor: "var(--color-purple)",
                color: "var(--color-purple)",
              }}
            >
              {busy ? t.sending : t.sendRequest}
            </button>
          </div>
          {error && (
            <span className="text-[10px]" style={{ color: "var(--color-red)" }}>
              {error}
            </span>
          )}
        </div>
      )}

      {tickets.length === 0 ? (
        <p className="text-[12px]" style={{ color: "var(--color-dim)" }}>
          {t.emptyState}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tickets.map((tk) => {
            const request = splitTicketRequest(tk.request_text);
            return (
              <li
                key={tk.id}
                className="p-3 rounded-lg border"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-[10px] uppercase font-semibold tracking-wide"
                    style={{
                      color: STATUS_COLOR[tk.status] ?? "var(--color-dim)",
                    }}
                  >
                    {t.statusLabel[tk.status as TicketStatus] ?? tk.status}
                    {tk.assigned_agent ? ` · ${tk.assigned_agent}` : ""}
                  </span>
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--color-dim)" }}
                  >
                    {tk.created_at
                      ? tk.created_at.slice(0, 16).replace("T", " ")
                      : ""}
                  </span>
                </div>
                <p
                  className="text-[13px] mt-1"
                  style={{ color: "var(--color-text)" }}
                >
                  {request.text}
                </p>
                {request.attachmentName && (
                  <p
                    className="text-[11px] mt-1"
                    style={{ color: "var(--color-purple)" }}
                  >
                    📎 {request.attachmentName}
                  </p>
                )}
                {tk.response_text && (
                  <div
                    className="mt-2 pl-3 border-l-2"
                    style={{ borderColor: "var(--color-green)" }}
                  >
                    <span
                      className="text-[10px] uppercase font-semibold"
                      style={{ color: "var(--color-green)" }}
                    >
                      {t.teamResponse}
                    </span>
                    <p
                      className="text-[13px]"
                      style={{ color: "var(--color-text)" }}
                    >
                      {tk.response_text}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
