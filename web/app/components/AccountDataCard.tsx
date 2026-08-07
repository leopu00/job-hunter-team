"use client";

// Esporta i tuoi dati · Cancella l'account.
//
// La cancellazione è irreversibile, e la forma dell'interfaccia è pensata
// perché sia difficile arrivarci per sbaglio senza essere fastidiosa per
// chi la vuole davvero:
//
//   1. il primo pulsante non cancella: chiede l'anteprima al server e
//      mostra COSA sparirà, riga per riga, con i numeri veri;
//   2. la conferma richiede di scrivere la propria email — un click
//      distratto non basta, e chi ha deciso ci mette dieci secondi;
//   3. il pulsante finale resta disabilitato finché l'email non combacia.
//
// L'utente da cancellare non è mai indicato da qui: il server usa quello
// della sessione. Vedi `app/api/account/delete/route.ts`.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useLocale } from "@/lib/use-locale";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./AccountDataCard.i18n";

const card: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
};

interface Preview {
  email: string | null;
  counts: Record<string, number>;
  total: number;
}

export default function AccountDataCard() {
  const locale = useLocale();
  const tr = makeT(T, locale);
  const router = useRouter();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete");
      if (!res.ok) throw new Error(String(res.status));
      setPreview((await res.json()) as Preview);
    } catch {
      setError(tr("error_preview"));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: typed }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // L'account non esiste più: si torna alla home, non a una pagina
      // dell'area riservata che ora risponderebbe 401.
      router.push("/");
      router.refresh();
    } catch {
      setError(tr("error_delete"));
      setBusy(false);
    }
  };

  const emailMatches =
    preview?.email != null &&
    typed.trim().toLowerCase() === preview.email.trim().toLowerCase();

  return (
    <div className="rounded-lg px-4 py-4" style={card}>
      <p className="text-[12px] font-semibold text-[var(--color-white)]">
        {tr("title")}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
        {tr("intro")}
      </p>

      <a
        href="/api/account/export"
        className="mt-3 inline-flex min-h-11 items-center rounded-md border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold text-[var(--color-bright)] no-underline transition-colors hover:border-[var(--color-green)] hover:text-[var(--color-green)]"
      >
        {tr("export")}
      </a>

      <div className="mt-5 border-t border-[var(--color-border)] pt-4">
        <p className="text-[12px] font-semibold text-[var(--color-white)]">
          {tr("delete_title")}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
          {tr("delete_intro")}
        </p>

        {!preview && (
          <button
            type="button"
            onClick={askPreview}
            disabled={busy}
            className="mt-3 inline-flex min-h-11 items-center rounded-md border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold text-[var(--color-muted)] transition-colors hover:border-[var(--color-red,#e5484d)] hover:text-[var(--color-red,#e5484d)] disabled:opacity-50"
          >
            {busy ? tr("loading") : tr("delete_start")}
          </button>
        )}

        {preview && (
          <div className="mt-4">
            <p className="text-[11px] font-semibold text-[var(--color-bright)]">
              {tr("will_delete")}
            </p>
            {preview.total === 0 ? (
              <p className="mt-2 text-[11px] text-[var(--color-muted)]">
                {tr("nothing_stored")}
              </p>
            ) : (
              <ul className="mt-2 space-y-0.5">
                {Object.entries(preview.counts).map(([table, n]) => (
                  <li
                    key={table}
                    className="flex justify-between text-[11px] text-[var(--color-muted)]"
                  >
                    <span className="font-mono">{table}</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-bright)]">
              {tr("irreversible")}
            </p>

            <label className="mt-3 block text-[11px] text-[var(--color-muted)]">
              {tr("type_email")}
              <input
                type="email"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={preview.email ?? ""}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[11px] text-[var(--color-bright)]"
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={confirmDelete}
                disabled={!emailMatches || busy}
                className="inline-flex min-h-11 items-center rounded-md border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold text-[var(--color-bright)] transition-colors enabled:hover:border-[var(--color-red,#e5484d)] enabled:hover:text-[var(--color-red,#e5484d)] disabled:opacity-40"
              >
                {busy ? tr("deleting") : tr("delete_confirm")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setTyped("");
                }}
                disabled={busy}
                className="inline-flex min-h-11 items-center px-2 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-bright)]"
              >
                {tr("cancel")}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 text-[11px] text-[var(--color-bright)]">{error}</p>
        )}
      </div>
    </div>
  );
}
