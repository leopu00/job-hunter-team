"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
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
    noLocalDb:
      "A base de dados da equipa está inacessível: inicie a equipa uma vez e tente novamente.",
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
