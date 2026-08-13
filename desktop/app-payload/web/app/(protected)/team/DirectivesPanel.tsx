"use client";

import { useCallback, useEffect, useState } from "react";

type Directive = {
  id: number;
  body: string;
  kind: string;
  status: string;
  created_by: string;
  created_at: string;
};
const labels = {
  en: {
    title: "Team directives",
    add: "Add",
    archive: "Archive",
    placeholder: "New directive",
    queued: "Queued for Captain",
    error: "Captain delivery not confirmed",
  },
  it: {
    title: "Direttive del team",
    add: "Aggiungi",
    archive: "Archivia",
    placeholder: "Nuova direttiva",
    queued: "In coda per il Capitano",
    error: "Invio al Capitano non confermato",
  },
  es: {
    title: "Directivas del equipo",
    add: "Añadir",
    archive: "Archivar",
    placeholder: "Nueva directiva",
    queued: "En cola para el Capitán",
    error: "Entrega al Capitán no confirmada",
  },
  fr: {
    title: "Directives de l'équipe",
    add: "Ajouter",
    archive: "Archiver",
    placeholder: "Nouvelle directive",
    queued: "En file pour le Capitaine",
    error: "Envoi non confirmé",
  },
  de: {
    title: "Team-Anweisungen",
    add: "Hinzufügen",
    archive: "Archivieren",
    placeholder: "Neue Anweisung",
    queued: "Für den Kapitän eingereiht",
    error: "Zustellung nicht bestätigt",
  },
  hu: {
    title: "Csapattáblák",
    add: "Hozzáad",
    archive: "Archivál",
    placeholder: "Új direktíva",
    queued: "A Kapitány sorába állítva",
    error: "A kézbesítés nem igazolt",
  },
  pt: {
    title: "Diretivas da equipa",
    add: "Adicionar",
    archive: "Arquivar",
    placeholder: "Nova diretiva",
    queued: "Em fila para o Capitão",
    error: "Entrega não confirmada",
  },
} as const;

export default function DirectivesPanel() {
  const locale = (
    navigator.language.slice(0, 2) in labels
      ? navigator.language.slice(0, 2)
      : "en"
  ) as keyof typeof labels;
  const t = labels[locale];
  const [items, setItems] = useState<Directive[]>([]);
  const [text, setText] = useState("");
  const [events, setEvents] = useState<Record<number, string>>({});
  const load = useCallback(async () => {
    const r = await fetch("/api/team-directives");
    const d = await r.json();
    setItems(d.directives ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const mutate = async (payload: object) => {
    const r = await fetch("/api/team-directives", {
      method: "id" in payload ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (d.id && d.captain_event)
      setEvents((e) => ({ ...e, [Number(d.id)]: d.captain_event.status }));
    await load();
  };
  return (
    <section className="mt-8 rounded-xl border border-[var(--color-border)] p-4">
      <h2 className="mb-3 text-sm font-bold">{t.title}</h2>
      <div className="mb-4 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.placeholder}
          className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={!text.trim()}
          onClick={() => {
            void mutate({ body: text });
            setText("");
          }}
          className="rounded bg-[var(--color-blue)] px-3 py-1 text-xs"
        >
          {t.add}
        </button>
      </div>
      <ul className="space-y-2">
        {items.map((d) => (
          <li
            key={d.id}
            className="rounded border border-[var(--color-border)] p-2 text-xs"
          >
            <div className="flex gap-2">
              <span className="flex-1 whitespace-pre-wrap">{d.body}</span>
              <button
                type="button"
                onClick={() => void mutate({ id: d.id, action: "archive" })}
              >
                {t.archive}
              </button>
            </div>
            <div className="mt-1 text-[10px] text-[var(--color-dim)]">
              {new Date(d.created_at).toLocaleString(locale)} · {d.status} ·{" "}
              {d.created_by}{" "}
              {events[d.id] === "queued"
                ? `· ${t.queued}`
                : events[d.id] === "error"
                  ? `· ${t.error}`
                  : ""}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
