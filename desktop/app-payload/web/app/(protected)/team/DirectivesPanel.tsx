"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DirectiveAction,
  isDirectiveAcknowledgement,
  retainDirectiveRequest,
} from "@/lib/team-directive-request";

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
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    placeholder: "New directive",
    queued: "Queued for Captain",
    error: "Captain delivery not confirmed",
  },
  it: {
    title: "Direttive del team",
    add: "Aggiungi",
    archive: "Archivia",
    edit: "Modifica",
    save: "Salva",
    cancel: "Annulla",
    placeholder: "Nuova direttiva",
    queued: "In coda per il Capitano",
    error: "Invio al Capitano non confermato",
  },
  es: {
    title: "Directivas del equipo",
    add: "Añadir",
    archive: "Archivar",
    edit: "Editar",
    save: "Guardar",
    cancel: "Cancelar",
    placeholder: "Nueva directiva",
    queued: "En cola para el Capitán",
    error: "Entrega al Capitán no confirmada",
  },
  fr: {
    title: "Directives de l'équipe",
    add: "Ajouter",
    archive: "Archiver",
    edit: "Modifier",
    save: "Enregistrer",
    cancel: "Annuler",
    placeholder: "Nouvelle directive",
    queued: "En file pour le Capitaine",
    error: "Envoi non confirmé",
  },
  de: {
    title: "Team-Anweisungen",
    add: "Hinzufügen",
    archive: "Archivieren",
    edit: "Bearbeiten",
    save: "Speichern",
    cancel: "Abbrechen",
    placeholder: "Neue Anweisung",
    queued: "Für den Kapitän eingereiht",
    error: "Zustellung nicht bestätigt",
  },
  hu: {
    title: "Csapattáblák",
    add: "Hozzáad",
    archive: "Archivál",
    edit: "Szerkesztés",
    save: "Mentés",
    cancel: "Mégse",
    placeholder: "Új direktíva",
    queued: "A Kapitány sorába állítva",
    error: "A kézbesítés nem igazolt",
  },
  pt: {
    title: "Diretivas da equipa",
    add: "Adicionar",
    archive: "Arquivar",
    edit: "Editar",
    save: "Guardar",
    cancel: "Cancelar",
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
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const pendingRequests = useRef(new Map());
  const load = useCallback(async () => {
    const r = await fetch("/api/team-directives");
    const d = await r.json();
    setItems(d.directives ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const mutate = async (
    payload: object,
    key: string,
    action: DirectiveAction,
    expectedId?: number,
  ) => {
    const pending = retainDirectiveRequest(
      pendingRequests.current,
      key,
      payload,
    );
    setBusy(true);
    try {
      const r = await fetch("/api/team-directives", {
        method: "id" in payload ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, request_id: pending.requestId }),
      });
      const d = await r.json().catch(() => ({}));
      if (
        !r.ok ||
        !isDirectiveAcknowledgement(d, {
          requestId: pending.requestId,
          action,
          id: expectedId,
        })
      ) {
        if (expectedId) setEvents((e) => ({ ...e, [expectedId]: "error" }));
        return false;
      }
      pendingRequests.current.delete(key);
      setEvents((e) => ({ ...e, [Number(d.id)]: "queued" }));
      await load();
      return true;
    } catch {
      if (expectedId) setEvents((e) => ({ ...e, [expectedId]: "error" }));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-8 rounded-xl border border-[var(--color-border)] p-4">
      <h2 className="mb-3 text-sm font-bold">{t.title}</h2>
      <div className="mb-4 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          placeholder={t.placeholder}
          className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={async () => {
            const body = text.trim();
            if (await mutate({ body }, "create", "created")) setText("");
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
              {editId === d.id ? (
                <input
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  disabled={busy}
                  className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1"
                />
              ) : (
                <span className="flex-1 whitespace-pre-wrap">{d.body}</span>
              )}
              {editId === d.id ? (
                <>
                  <button
                    type="button"
                    disabled={busy || !editText.trim()}
                    onClick={async () => {
                      const body = editText.trim();
                      if (
                        await mutate(
                          { id: d.id, body },
                          `edit:${d.id}`,
                          "edited",
                          d.id,
                        )
                      ) {
                        setEditId(null);
                        setEditText("");
                      }
                    }}
                  >
                    {t.save}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditId(null)}
                  >
                    {t.cancel}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditId(d.id);
                    setEditText(d.body);
                  }}
                >
                  {t.edit}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    { id: d.id, action: "archive" },
                    `archive:${d.id}`,
                    "archived",
                    d.id,
                  )
                }
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
