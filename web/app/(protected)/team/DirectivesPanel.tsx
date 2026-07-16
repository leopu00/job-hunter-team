"use client";

// 📋 DirectivesPanel — la BACHECA del team: ordini/strategia PERMANENTI
// dell'utente (es. "modalità mantenimento: stop scouting, CV solo 90+"). Il
// Capitano le rilegge a ogni riavvio (team_directives.py active) e le rispetta
// come policy che vince sui default. CRUD via /api/team-directives (SQLite
// locale nel container; il daemon `jht cloud sync-directives` fa il mirror cloud).

import { useEffect, useState, useCallback } from "react";
import { useLocale } from "@/lib/use-locale";
import { useToast } from "../../components/Toast";

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

const T: Record<string, Record<string, string>> = {
  title: {
    it: "Bacheca del team",
    en: "Team board",
    es: "Tablón del equipo",
    fr: "Tableau de l'équipe",
    de: "Team-Board",
    hu: "Csapattábla",
    pt: "Quadro da equipa",
  },
  subtitle: {
    it: "Ordini e strategia permanenti. Restano validi finché non li cambi; il Capitano li rilegge a ogni riavvio e li rispetta come policy.",
    en: "Permanent orders and strategy. They stay until you change them; the Captain re-reads them on every restart and honors them as policy.",
    es: "Órdenes y estrategia permanentes. Se mantienen hasta que las cambies; el Capitán las relee en cada reinicio y las respeta como política.",
    fr: "Ordres et stratégie permanents. Ils restent jusqu'à ce que tu les changes ; le Capitaine les relit à chaque redémarrage et les respecte comme politique.",
    de: "Dauerhafte Anweisungen und Strategie. Sie bleiben, bis du sie änderst; der Kapitän liest sie bei jedem Neustart und befolgt sie als Policy.",
    hu: "Állandó utasítások és stratégia. Addig érvényesek, amíg meg nem változtatod; a Kapitány minden újraindításkor újraolvassa és betartja.",
    pt: "Ordens e estratégia permanentes. Ficam até as mudares; o Capitão relê-as a cada reinício e respeita-as como política.",
  },
  addPlaceholder: {
    it: "Nuova direttiva… (es. Modalità mantenimento: stop nuove posizioni, CV solo 90+)",
    en: "New directive… (e.g. Maintenance mode: stop new positions, CVs only for 90+)",
    es: "Nueva directiva… (p. ej. Modo mantenimiento: parar nuevas posiciones, CV solo 90+)",
    fr: "Nouvelle directive… (ex. Mode maintenance : stop nouveaux postes, CV seulement 90+)",
    de: "Neue Direktive… (z. B. Wartungsmodus: keine neuen Stellen, Lebensläufe nur für 90+)",
    hu: "Új direktíva… (pl. Karbantartó mód: nincs új pozíció, önéletrajz csak 90+)",
    pt: "Nova diretiva… (ex. Modo manutenção: parar novas posições, CV só 90+)",
  },
  add: {
    it: "Aggiungi",
    en: "Add",
    es: "Añadir",
    fr: "Ajouter",
    de: "Hinzufügen",
    hu: "Hozzáad",
    pt: "Adicionar",
  },
  empty: {
    it: "Nessuna direttiva attiva. Aggiungine una qui sopra, oppure scrivila in chat al Capitano.",
    en: "No active directives. Add one above, or write it in chat to the Captain.",
    es: "No hay directivas activas. Añade una arriba, o escríbela en el chat al Capitán.",
    fr: "Aucune directive active. Ajoutes-en une ci-dessus, ou écris-la au Capitaine dans le chat.",
    de: "Keine aktiven Direktiven. Füge oben eine hinzu oder schreibe sie dem Kapitän im Chat.",
    hu: "Nincs aktív direktíva. Adj hozzá egyet fent, vagy írd meg a Kapitánynak a chatben.",
    pt: "Sem diretivas ativas. Adiciona uma acima, ou escreve-a no chat ao Capitão.",
  },
  edit: {
    it: "Modifica",
    en: "Edit",
    es: "Editar",
    fr: "Modifier",
    de: "Bearbeiten",
    hu: "Szerkeszt",
    pt: "Editar",
  },
  save: {
    it: "Salva",
    en: "Save",
    es: "Guardar",
    fr: "Enregistrer",
    de: "Speichern",
    hu: "Mentés",
    pt: "Guardar",
  },
  cancel: {
    it: "Annulla",
    en: "Cancel",
    es: "Cancelar",
    fr: "Annuler",
    de: "Abbrechen",
    hu: "Mégse",
    pt: "Cancelar",
  },
  archive: {
    it: "Archivia",
    en: "Archive",
    es: "Archivar",
    fr: "Archiver",
    de: "Archivieren",
    hu: "Archivál",
    pt: "Arquivar",
  },
  added: {
    it: "Direttiva aggiunta",
    en: "Directive added",
    es: "Directiva añadida",
    fr: "Directive ajoutée",
    de: "Direktive hinzugefügt",
    hu: "Direktíva hozzáadva",
    pt: "Diretiva adicionada",
  },
  archivedMsg: {
    it: "Direttiva archiviata",
    en: "Directive archived",
    es: "Directiva archivada",
    fr: "Directive archivée",
    de: "Direktive archiviert",
    hu: "Direktíva archiválva",
    pt: "Diretiva arquivada",
  },
  archivedSection: {
    it: "Archiviate",
    en: "Archived",
    es: "Archivadas",
    fr: "Archivées",
    de: "Archiviert",
    hu: "Archivált",
    pt: "Arquivadas",
  },
  errGeneric: {
    it: "Operazione fallita",
    en: "Operation failed",
    es: "Operación fallida",
    fr: "Opération échouée",
    de: "Vorgang fehlgeschlagen",
    hu: "A művelet sikertelen",
    pt: "Operação falhou",
  },
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

export default function DirectivesPanel() {
  const locale = useLocale();
  const { toast } = useToast();
  const t = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
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

      {/* form nuova direttiva */}
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
