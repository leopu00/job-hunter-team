"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PositionTicket } from "@/lib/types";

// Sezione "Richieste al team" sulla pagina posizione. L'utente scrive una
// richiesta testuale libera (popup) → ticket 'open'; il Capitano l'assegna a un
// agente; l'agente risolve con una risposta testuale che compare qui sotto.
const STATUS_LABEL: Record<string, string> = {
  open: "In attesa",
  assigned: "In lavorazione",
  resolved: "Risolto",
};
const STATUS_COLOR: Record<string, string> = {
  open: "var(--color-yellow)",
  assigned: "var(--color-purple)",
  resolved: "var(--color-green)",
};

export function TicketPanel({
  legacyId,
  tickets,
}: {
  legacyId: number;
  tickets: PositionTicket[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!text.trim()) {
      setError("Scrivi la richiesta");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/positions/${legacyId}/ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_text: text.trim() }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error ?? `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      setText("");
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore di rete");
    }
    setBusy(false);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <span className="section-label">Richieste al team</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)]"
          style={{
            borderColor: "var(--color-purple)",
            color: "var(--color-purple)",
          }}
        >
          {open ? "Chiudi" : "+ Nuova richiesta"}
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
            placeholder="Scrivi cosa vuoi che il team faccia su questa offerta (es. verifica lo stipendio reale, controlla la cultura aziendale, riassumi i requisiti…)"
            className="w-full p-2 rounded-md border text-[13px] resize-y"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setText("");
                setError(null);
              }}
              className="px-3 py-1.5 rounded-lg text-[11px]"
              style={{ color: "var(--color-dim)" }}
            >
              Annulla
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
              {busy ? "Invio…" : "Invia richiesta"}
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
          Nessuna richiesta. Usa “Nuova richiesta” per chiedere al team qualcosa
          su questa offerta.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tickets.map((t) => (
            <li
              key={t.id}
              className="p-3 rounded-lg border"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[10px] uppercase font-semibold tracking-wide"
                  style={{
                    color: STATUS_COLOR[t.status] ?? "var(--color-dim)",
                  }}
                >
                  {STATUS_LABEL[t.status] ?? t.status}
                  {t.assigned_agent ? ` · ${t.assigned_agent}` : ""}
                </span>
                <span
                  className="text-[10px]"
                  style={{ color: "var(--color-dim)" }}
                >
                  {t.created_at
                    ? t.created_at.slice(0, 16).replace("T", " ")
                    : ""}
                </span>
              </div>
              <p
                className="text-[13px] mt-1"
                style={{ color: "var(--color-text)" }}
              >
                {t.request_text}
              </p>
              {t.response_text && (
                <div
                  className="mt-2 pl-3 border-l-2"
                  style={{ borderColor: "var(--color-green)" }}
                >
                  <span
                    className="text-[10px] uppercase font-semibold"
                    style={{ color: "var(--color-green)" }}
                  >
                    Risposta del team
                  </span>
                  <p
                    className="text-[13px]"
                    style={{ color: "var(--color-text)" }}
                  >
                    {t.response_text}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
