"use client";

// 📋 DirectivesPanel — la BACHECA del team: ordini/strategia PERMANENTI
// dell'utente (es. "modalità mantenimento: stop scouting, CV solo 90+"). Il
// Capitano le rilegge a ogni riavvio (team_directives.py active) e le rispetta
// come policy che vince sui default. CRUD via /api/team-directives (SQLite
// locale nel container; il daemon `jht cloud sync-directives` fa il mirror cloud).

import { useEffect, useState, useCallback } from "react";
import { useLocale } from "@/lib/use-locale";
import { useToast } from "../../components/Toast";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./DirectivesPanel.i18n";

type Directive = {
  id: number;
  body: string;
  kind: string;
  status: string;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

const KIND_LABEL: Record<string, Record<string, string>> = {
  order: {
    it: "Ordine",
    en: "Order",
    es: "Orden",
    fr: "Ordre",
    de: "Anweisung",
    hu: "Utasítás",
    pt: "Ordem",
  },
  strategy: {
    it: "Strategia",
    en: "Strategy",
    es: "Estrategia",
    fr: "Stratégie",
    de: "Strategie",
    hu: "Stratégia",
    pt: "Estratégia",
  },
  formation: {
    it: "Formazione",
    en: "Formation",
    es: "Formación",
    fr: "Formation",
    de: "Formation",
    hu: "Felállás",
    pt: "Formação",
  },
  note: {
    it: "Nota",
    en: "Note",
    es: "Nota",
    fr: "Note",
    de: "Notiz",
    hu: "Megjegyzés",
    pt: "Nota",
  },
};

const KINDS = ["order", "strategy", "formation", "note"];

export default function DirectivesPanel({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const locale = useLocale();
  const { toast } = useToast();
  const t = makeT(T, locale);
  const kindLabel = (k: string) =>
    KIND_LABEL[k]?.[locale] ?? KIND_LABEL[k]?.en ?? k;

  const [items, setItems] = useState<Directive[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBody, setNewBody] = useState("");
  const [newKind, setNewKind] = useState("order");
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [eventStatus, setEventStatus] = useState<
    Record<string, "queued" | "error">
  >({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team-directives");
      const data = await res.json();
      if (res.ok)
        setItems(Array.isArray(data.directives) ? data.directives : []);
    } catch {
      /* silent — pannello best-effort */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (payload: object, okMsg?: string) => {
    setBusy(true);
    try {
      const method = "id" in payload ? "PATCH" : "POST";
      const res = await fetch("/api/team-directives", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || t("errGeneric"), "error");
        return false;
      }
      const event = data.captain_event as
        | { status?: "queued" | "error" }
        | undefined;
      if ("id" in payload && event)
        setEventStatus((old) => ({
          ...old,
          [String(payload.id)]: event.status === "queued" ? "queued" : "error",
        }));
      else if (event && data.id)
        setEventStatus((old) => ({
          ...old,
          [String(data.id)]: event.status === "queued" ? "queued" : "error",
        }));
      if (okMsg) toast(okMsg, "success");
      await load();
      return true;
    } catch {
      toast(t("errGeneric"), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const body = newBody.trim();
    if (!body) return;
    if (await post({ body, kind: newKind }, t("added"))) {
      setNewBody("");
      setNewKind("order");
    }
  };

  const saveEdit = async (id: number) => {
    const body = editText.trim();
    if (!body) return;
    if (await post({ id, body })) {
      setEditId(null);
      setEditText("");
    }
  };

  const archive = (id: number) =>
    post({ id, action: "archive" }, t("archivedMsg"));

  const active = items.filter((d) => d.status === "active");
  const archived = items.filter((d) => d.status === "archived");

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 sm:p-6">
      <div className="mb-1 flex items-center gap-2">
        <span aria-hidden>📋</span>
        <h3 className="text-[15px] font-bold text-[var(--color-white)]">
          {t("title")}
        </h3>
      </div>
      <p className="mb-4 text-[12px] leading-relaxed text-[var(--color-muted)]">
        {t("subtitle")}
      </p>

      {/* Su /team cloud la bacheca è una vista: gli edit restano nel cockpit
          desktop, coerentemente con l'interaction-plane. */}
      {!readOnly && (
        <div className="mb-5 flex flex-col gap-2 sm:flex-row">
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder={t("addPlaceholder")}
            rows={2}
            maxLength={2000}
            className="flex-1 resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[13px] text-[var(--color-white)] placeholder:text-[var(--color-dim)]"
          />
          <div className="flex gap-2 sm:flex-col">
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-2 text-[12px] text-[var(--color-white)]"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={add}
              disabled={busy || !newBody.trim()}
              className="rounded-lg bg-[var(--color-blue)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {t("add")}
            </button>
          </div>
        </div>
      )}

      {/* elenco attive */}
      {!loading && active.length === 0 && (
        <p className="text-[12px] text-[var(--color-dim)]">{t("empty")}</p>
      )}
      <ul className="flex flex-col gap-2">
        {active.map((d) => (
          <li
            key={d.id}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3"
          >
            {editId === d.id ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-[13px] text-[var(--color-white)]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => saveEdit(d.id)}
                    disabled={busy}
                    className="rounded-md bg-[var(--color-blue)] px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
                  >
                    {t("save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(null);
                      setEditText("");
                    }}
                    className="rounded-md border border-[var(--color-border)] px-3 py-1 text-[12px] text-[var(--color-muted)]"
                  >
                    {t("cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 rounded-md bg-[color-mix(in_srgb,var(--color-blue)_18%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-blue)]">
                  {kindLabel(d.kind)}
                </span>
                <p className="flex-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-white)]">
                  {d.body}
                </p>
                <div className="shrink-0 text-right text-[10px] text-[var(--color-dim)]">
                  <div>{new Date(d.created_at).toLocaleString(locale)}</div>
                  <div>
                    {d.status} · {d.created_by}
                  </div>
                  {eventStatus[String(d.id)] === "queued" && (
                    <div className="text-[var(--color-blue)]">
                      {t("captainQueued")}
                    </div>
                  )}
                  {eventStatus[String(d.id)] === "error" && (
                    <div className="text-red-400">{t("captainError")}</div>
                  )}
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(d.id);
                        setEditText(d.body);
                      }}
                      className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-white)]"
                    >
                      {t("edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => archive(d.id)}
                      disabled={busy}
                      className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-white)] disabled:opacity-50"
                    >
                      {t("archive")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* archiviate (collassabile) */}
      {archived.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-white)]"
          >
            {showArchived ? "▾" : "▸"} {t("archivedSection")} ({archived.length}
            )
          </button>
          {showArchived && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {archived.map((d) => (
                <li
                  key={d.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[12px] text-[var(--color-dim)] line-through"
                >
                  {d.body}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
