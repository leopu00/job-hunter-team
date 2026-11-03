"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import { useReadOnlyActions } from "@/lib/read-only-actions";
import type { Locale } from "@/i18n/config";

// O-22 — blocco note PRIVATO sulla posizione.
//
// ⚠️ IL MESSAGGIO DEL 503 DIPENDE DA DOVE LA FUNZIONE È ARRIVATA, e va
// riletto a ogni release che la sposta. È già stato sbagliato tre volte:
//   1. «serve il team acceso» — una causa che nessuno aveva misurato, detta
//      anche quando il team era acceso;
//   2. «si salvano dall'app sul computer» — onesta come frase, ma descriveva
//      un mondo che non esisteva: la nota è stata mergiata un'ora DOPO il tag
//      della v0.3.7, quindi non era né sul web né nell'app installata;
//   3. «arrivano col prossimo aggiornamento» — vera fino a O-33, falsa dal
//      momento in cui O-33 è uscita: l'aggiornamento È questo, e il 503 di
//      quel ramo non esiste più.
// Da O-33 la nota si scrive/rilegge/cancella anche a box spento (il ramo
// `cloud` della route + mig 069). Il 503 su quella fetch resta possibile per
// UNA sola causa diversa: il percorso local-token (app desktop nativa) quando
// il jobs.db del box non esiste — «DB locale assente» dentro localFirstWrite.
// Il messaggio qui sotto (`noLocalDb`) descrive QUELLA causa, l'unica
// rimasta. Il ramo non si cancella: cambia quello che racconta.
//
// «Cose che mi possono essere utili una volta che rivisito la posizione».
// Non è un ordine al team: gli agenti non la leggono, e il pannello lo dice
// esplicitamente — una nota che sembra condivisa e non lo è (o viceversa)
// cambia quello che una persona ci scrive dentro.

const MAX = 4000;

const T: Record<
  Locale,
  {
    title: string;
    private: string;
    placeholder: string;
    save: string;
    saving: string;
    saved: string;
    remove: string;
    error: string;
    noLocalDb: string;
    hasNotes: string;
    open: string;
    close: string;
  }
> = {
  it: {
    title: "Note private",
    private: "Solo tue: il team non le legge",
    placeholder: "Cosa ti servirà ricordare quando torni su questa posizione…",
    save: "Salva",
    saving: "Salvo…",
    saved: "Salvata",
    remove: "Elimina",
    error: "Non è riuscito a salvare la nota",
    noLocalDb:
      "Il database del team non è raggiungibile: avvia il team una volta, poi riprova.",
    hasNotes: "Ci sono note salvate",
    open: "Apri le note",
    close: "Chiudi le note",
  },
  en: {
    title: "Private notes",
    private: "Yours only: the team does not read them",
    placeholder:
      "What you'll want to remember when you come back to this role…",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    remove: "Delete",
    error: "Could not save the note",
    noLocalDb:
      "The team database isn't reachable: start the team once, then try again.",
    hasNotes: "Notes saved",
    open: "Open the notes",
    close: "Close the notes",
  },
  es: {
    title: "Notas privadas",
    private: "Solo tuyas: el equipo no las lee",
    placeholder: "Lo que querrás recordar cuando vuelvas a esta posición…",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Guardada",
    remove: "Eliminar",
    error: "No se pudo guardar la nota",
    noLocalDb:
      "No se puede acceder a la base de datos del equipo: inicia el equipo una vez y vuelve a intentarlo.",
    hasNotes: "Hay notas guardadas",
    open: "Abrir las notas",
    close: "Cerrar las notas",
  },
  de: {
    title: "Private Notizen",
    private: "Nur für dich: das Team liest sie nicht",
    placeholder:
      "Was du dir merken willst, wenn du zu dieser Stelle zurückkehrst…",
    save: "Speichern",
    saving: "Speichern…",
    saved: "Gespeichert",
    remove: "Löschen",
    error: "Notiz konnte nicht gespeichert werden",
    noLocalDb:
      "Die Team-Datenbank ist nicht erreichbar: starte das Team einmal und versuche es erneut.",
    hasNotes: "Notizen gespeichert",
    open: "Notizen öffnen",
    close: "Notizen schließen",
  },
  fr: {
    title: "Notes privées",
    private: "Pour vous seul : l'équipe ne les lit pas",
    placeholder: "Ce dont vous voudrez vous souvenir en revenant sur ce poste…",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Enregistrée",
    remove: "Supprimer",
    error: "Impossible d'enregistrer la note",
    noLocalDb:
      "La base de données de l'équipe est inaccessible : démarrez l'équipe une fois, puis réessayez.",
    hasNotes: "Notes enregistrées",
    open: "Ouvrir les notes",
    close: "Fermer les notes",
  },
  pt: {
    title: "Notas privadas",
    private: "Só tuas: a equipa não as lê",
    placeholder: "O que vai querer lembrar quando voltar a esta posição…",
    save: "Guardar",
    saving: "A guardar…",
    saved: "Guardada",
    remove: "Eliminar",
    error: "Não foi possível guardar a nota",
    noLocalDb:
      "A base de dados da equipa está inacessível: inicie a equipa uma vez e tente novamente.",
    hasNotes: "Há notas guardadas",
    open: "Abrir as notas",
    close: "Fechar as notas",
  },
  hu: {
    title: "Privát jegyzetek",
    private: "Csak a tiéd: a csapat nem olvassa",
    placeholder: "Amire emlékezni szeretnél, ha visszatérsz erre a pozícióra…",
    save: "Mentés",
    saving: "Mentés…",
    saved: "Mentve",
    remove: "Törlés",
    error: "A jegyzetet nem sikerült menteni",
    noLocalDb:
      "A csapat adatbázisa nem érhető el: indítsd el egyszer a csapatot, majd próbáld újra.",
    hasNotes: "Vannak mentett jegyzetek",
    open: "Jegyzetek megnyitása",
    close: "Jegyzetek bezárása",
  },
};

export default function UserNote({
  legacyId,
  initialNote,
}: {
  legacyId: number;
  initialNote: string | null;
}) {
  const t = T[useLocale()];
  const readOnly = useReadOnlyActions();
  const router = useRouter();
  const [text, setText] = useState(initialNote ?? "");
  const [saved, setSaved] = useState<string | null>(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Chiuso di default: le note non spingono giù il resto della pagina. Il testo resta montato (nascosto)
  // anche da chiuso, così quello che si sta scrivendo non si perde chiudendo.
  const [open, setOpen] = useState(false);

  const dirty = text.trim() !== (saved ?? "");

  async function persist(clearing: boolean) {
    setError(null);
    try {
      const res = await fetch(`/api/positions/${legacyId}/user-note`, {
        method: clearing ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: clearing ? undefined : JSON.stringify({ note: text.trim() }),
      });
      if (!res.ok) {
        // 503 = l'app desktop non trova il jobs.db del box (localFirstWrite,
        // percorso local-token). NON è più «box spento»: a box spento la nota
        // va sul cloud da O-33. Dire la causa che resta è meglio di un errore
        // generico che fa pensare a un guasto.
        setError(res.status === 503 ? t.noLocalDb : t.error);
        return;
      }
      const body = (await res.json()) as { note?: string | null };
      setSaved(body.note ?? null);
      if (clearing) setText("");
      start(() => router.refresh());
    } catch {
      setError(t.error);
    }
  }

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`user-note-body-${legacyId}`}
        title={open ? t.close : t.open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <svg
            viewBox="0 0 10 6"
            className={`w-2.5 h-2.5 shrink-0 text-[var(--color-dim)] transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M1 1l4 4 4-4" />
          </svg>
          <h2 className="text-[11px] font-semibold tracking-[0.15em] uppercase text-[var(--color-base)]">
            {t.title}
          </h2>
          {/* Il segno che ci sono note: si vede anche a pannello chiuso. */}
          {saved && (
            <span
              data-testid="user-note-sign"
              role="img"
              aria-label={t.hasNotes}
              title={t.hasNotes}
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: "var(--color-green)" }}
            />
          )}
        </span>
        <span className="text-[10px] text-[var(--color-dim)] text-right">
          {t.private}
        </span>
      </button>
      <div id={`user-note-body-${legacyId}`} hidden={!open}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          placeholder={t.placeholder}
          rows={4}
          disabled={readOnly.readOnly}
          title={readOnly.readOnly ? readOnly.reason : undefined}
          wrap="soft"
          className="mt-3 block w-full resize-y overflow-x-hidden whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[12px] text-[var(--color-base)] [overflow-wrap:anywhere] placeholder:text-[var(--color-dim)]"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-[var(--color-dim)]">
            {pending ? t.saving : saved && !dirty ? `✓ ${t.saved}` : ""}
          </span>
          <span className="flex gap-2">
            {saved && (
              <button
                type="button"
                onClick={() => void persist(true)}
                disabled={pending || readOnly.readOnly}
                title={readOnly.readOnly ? readOnly.reason : undefined}
                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-muted)] transition-colors hover:bg-[var(--color-row)] disabled:opacity-60"
              >
                {t.remove}
              </button>
            )}
            <button
              type="button"
              onClick={() => void persist(false)}
              disabled={pending || !dirty || !text.trim() || readOnly.readOnly}
              title={readOnly.readOnly ? readOnly.reason : undefined}
              className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40"
              style={{
                color: "var(--color-green)",
                borderColor: "var(--color-green)",
              }}
            >
              {t.save}
            </button>
          </span>
        </div>
        {error && (
          <p className="mt-2 text-[10px]" style={{ color: "var(--color-red)" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
