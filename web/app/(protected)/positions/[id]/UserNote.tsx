"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

// O-22 — blocco note PRIVATO sulla posizione.
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
    offline: string;
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
    offline: "La nota vive sul tuo computer: serve il team acceso.",
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
    offline: "The note lives on your computer: the team needs to be running.",
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
    offline: "La nota vive en tu ordenador: el equipo debe estar activo.",
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
    offline: "Die Notiz liegt auf deinem Rechner: das Team muss laufen.",
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
    offline: "La note vit sur votre ordinateur : l'équipe doit être active.",
  },
  pt: {
    title: "Notas privadas",
    private: "Só suas: a equipa não as lê",
    placeholder: "O que vai querer lembrar quando voltar a esta posição…",
    save: "Guardar",
    saving: "A guardar…",
    saved: "Guardada",
    remove: "Eliminar",
    error: "Não foi possível guardar a nota",
    offline: "A nota vive no seu computador: a equipa tem de estar ativa.",
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
    offline: "A jegyzet a gépeden él: a csapatnak futnia kell.",
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
  const router = useRouter();
  const [text, setText] = useState(initialNote ?? "");
  const [saved, setSaved] = useState<string | null>(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
        // 503 = box spento: la nota è locale per scelta, e dirlo è meglio
        // che un errore generico che fa pensare a un guasto.
        setError(res.status === 503 ? t.offline : t.error);
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
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-[0.15em] uppercase text-[var(--color-base)]">
          {t.title}
        </h2>
        <span className="text-[10px] text-[var(--color-dim)]">{t.private}</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX))}
        placeholder={t.placeholder}
        rows={4}
        className="mt-3 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[12px] text-[var(--color-base)] placeholder:text-[var(--color-dim)]"
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
              disabled={pending}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-muted)] transition-colors hover:bg-[var(--color-row)] disabled:opacity-60"
            >
              {t.remove}
            </button>
          )}
          <button
            type="button"
            onClick={() => void persist(false)}
            disabled={pending || !dirty || !text.trim()}
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
  );
}
