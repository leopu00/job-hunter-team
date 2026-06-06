"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/use-locale";

/* ── i18n inline ─────────────────────────────────────────────────── */

const T: Record<string, Record<string, string>> = {
  filters: {
    it: "Filtri",
    en: "Filters",
    hu: "Szűrők",
    es: "Filtros",
    de: "Filter",
    fr: "Filtres",
    pt: "Filtros",
  },
  reset: {
    it: "Reset",
    en: "Reset",
    hu: "Visszaállítás",
    es: "Restablecer",
    de: "Zurücksetzen",
    fr: "Réinitialiser",
    pt: "Repor",
  },
  reset_all: {
    it: "Reset tutti",
    en: "Reset all",
    hu: "Összes visszaállítása",
    es: "Restablecer todo",
    de: "Alle zurücksetzen",
    fr: "Tout réinitialiser",
    pt: "Repor tudo",
  },
  edit_filter: {
    it: "Modifica filtro",
    en: "Edit filter",
    hu: "Szűrő szerkesztése",
    es: "Editar filtro",
    de: "Filter bearbeiten",
    fr: "Modifier le filtre",
    pt: "Editar filtro",
  },
  remove_filter: {
    it: "Rimuovi filtro",
    en: "Remove filter",
    hu: "Szűrő eltávolítása",
    es: "Quitar filtro",
    de: "Filter entfernen",
    fr: "Supprimer le filtre",
    pt: "Remover filtro",
  },
  remove_filter_named: {
    it: "Rimuovi filtro {label}",
    en: "Remove filter {label}",
    hu: "{label} szűrő eltávolítása",
    es: "Quitar filtro {label}",
    de: "Filter {label} entfernen",
    fr: "Supprimer le filtre {label}",
    pt: "Remover filtro {label}",
  },
  position_filters: {
    it: "Filtri posizioni",
    en: "Position filters",
    hu: "Pozíciószűrők",
    es: "Filtros de posiciones",
    de: "Stellenfilter",
    fr: "Filtres de postes",
    pt: "Filtros de vagas",
  },
  close: {
    it: "Chiudi",
    en: "Close",
    hu: "Bezárás",
    es: "Cerrar",
    de: "Schließen",
    fr: "Fermer",
    pt: "Fechar",
  },
  cancel: {
    it: "Annulla",
    en: "Cancel",
    hu: "Mégse",
    es: "Cancelar",
    de: "Abbrechen",
    fr: "Annuler",
    pt: "Cancelar",
  },
  apply: {
    it: "Applica",
    en: "Apply",
    hu: "Alkalmaz",
    es: "Aplicar",
    de: "Anwenden",
    fr: "Appliquer",
    pt: "Aplicar",
  },
  clear: {
    it: "Pulisci",
    en: "Clear",
    hu: "Törlés",
    es: "Limpiar",
    de: "Löschen",
    fr: "Effacer",
    pt: "Limpar",
  },
  clear_named: {
    it: "Pulisci {label}",
    en: "Clear {label}",
    hu: "{label} törlése",
    es: "Limpiar {label}",
    de: "{label} löschen",
    fr: "Effacer {label}",
    pt: "Limpar {label}",
  },
  g_tier: {
    it: "Tier",
    en: "Tier",
    hu: "Szint",
    es: "Nivel",
    de: "Stufe",
    fr: "Niveau",
    pt: "Nível",
  },
  g_status: {
    it: "Status",
    en: "Status",
    hu: "Állapot",
    es: "Estado",
    de: "Status",
    fr: "Statut",
    pt: "Estado",
  },
  g_remote: {
    it: "Remote",
    en: "Remote",
    hu: "Távoli",
    es: "Remoto",
    de: "Remote",
    fr: "À distance",
    pt: "Remoto",
  },
  g_source: {
    it: "Fonte",
    en: "Source",
    hu: "Forrás",
    es: "Fuente",
    de: "Quelle",
    fr: "Source",
    pt: "Fonte",
  },
  g_verdict: {
    it: "Voto critico",
    en: "Critic verdict",
    hu: "Kritikai értékelés",
    es: "Veredicto crítico",
    de: "Kritiker-Urteil",
    fr: "Verdict critique",
    pt: "Veredito crítico",
  },
  opt_seria: {
    it: "Seria ≥70",
    en: "Serious ≥70",
    hu: "Komoly ≥70",
    es: "Seria ≥70",
    de: "Ernst ≥70",
    fr: "Sérieuse ≥70",
    pt: "Séria ≥70",
  },
  opt_practice: {
    it: "Practice 40-69",
    en: "Practice 40-69",
    hu: "Gyakorló 40-69",
    es: "Práctica 40-69",
    de: "Übung 40-69",
    fr: "Entraînement 40-69",
    pt: "Prática 40-69",
  },
  opt_riferimento: {
    it: "Riferimento <40",
    en: "Reference <40",
    hu: "Referencia <40",
    es: "Referencia <40",
    de: "Referenz <40",
    fr: "Référence <40",
    pt: "Referência <40",
  },
  opt_noscore: {
    it: "Non scored",
    en: "Not scored",
    hu: "Nincs pontozva",
    es: "Sin puntuar",
    de: "Nicht bewertet",
    fr: "Non noté",
    pt: "Sem pontuação",
  },
  opt_full_remote: {
    it: "Full remote",
    en: "Full remote",
    hu: "Teljesen távoli",
    es: "Totalmente remoto",
    de: "Vollständig remote",
    fr: "100 % à distance",
    pt: "Totalmente remoto",
  },
  opt_hybrid: {
    it: "Hybrid",
    en: "Hybrid",
    hu: "Hibrid",
    es: "Híbrido",
    de: "Hybrid",
    fr: "Hybride",
    pt: "Híbrido",
  },
  opt_onsite: {
    it: "On-site",
    en: "On-site",
    hu: "Helyszíni",
    es: "Presencial",
    de: "Vor Ort",
    fr: "Sur site",
    pt: "Presencial",
  },
};

type FilterKey = "tier" | "status" | "remote" | "source" | "verdict";

interface Option {
  val: string;
  label: string;
  // Chiave i18n opzionale: se presente, l'etichetta viene tradotta a render.
  // Status/verdict usano valori tecnici come label (new, PASS…) → no labelKey.
  labelKey?: string;
  color?: string;
}

interface Group {
  key: FilterKey;
  label: string;
  options: Option[];
}

const TIER_OPTIONS: Option[] = [
  {
    val: "seria",
    label: "Seria ≥70",
    labelKey: "opt_seria",
    color: "var(--color-green)",
  },
  {
    val: "practice",
    label: "Practice 40-69",
    labelKey: "opt_practice",
    color: "var(--color-yellow)",
  },
  {
    val: "riferimento",
    label: "Riferimento <40",
    labelKey: "opt_riferimento",
    color: "var(--color-orange)",
  },
  {
    val: "noscore",
    label: "Non scored",
    labelKey: "opt_noscore",
    color: "var(--color-dim)",
  },
];

const STATUS_OPTIONS: Option[] = [
  { val: "new", label: "new", color: "var(--color-muted)" },
  { val: "checked", label: "checked", color: "var(--color-blue)" },
  { val: "scored", label: "scored", color: "var(--color-purple)" },
  { val: "writing", label: "writing", color: "var(--color-yellow)" },
  { val: "review", label: "review", color: "var(--color-orange)" },
  { val: "ready", label: "ready", color: "#7fffb2" },
  { val: "applied", label: "applied", color: "var(--color-green)" },
  { val: "response", label: "response", color: "#58a6ff" },
  { val: "excluded", label: "excluded", color: "var(--color-red)" },
];

const REMOTE_OPTIONS: Option[] = [
  { val: "full_remote", label: "Full remote", labelKey: "opt_full_remote" },
  { val: "hybrid", label: "Hybrid", labelKey: "opt_hybrid" },
  { val: "onsite", label: "On-site", labelKey: "opt_onsite" },
];

const VERDICT_OPTIONS: Option[] = [
  { val: "PASS", label: "PASS", color: "var(--color-green)" },
  { val: "NEEDS_WORK", label: "NEEDS WORK", color: "var(--color-yellow)" },
  { val: "REJECT", label: "REJECT", color: "var(--color-red)" },
];

// Chiavi i18n per le label di gruppo (risolte a render via tr()).
const GROUP_LABEL_KEYS: Record<FilterKey, string> = {
  tier: "g_tier",
  status: "g_status",
  remote: "g_remote",
  source: "g_source",
  verdict: "g_verdict",
};

export default function FiltersWizard({
  availableSources,
}: {
  availableSources: string[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const groupLabel = (k: FilterKey) => tr(GROUP_LABEL_KEYS[k]);

  // Stato URL = "applicato". Draft = stato locale del wizard.
  const urlSelections = useMemo<Record<FilterKey, string[]>>(
    () => ({
      tier: csv(sp.get("tier")),
      status: csv(sp.get("status")),
      remote: csv(sp.get("remote")),
      source: csv(sp.get("source")),
      verdict: csv(sp.get("verdict")),
    }),
    [sp],
  );

  const totalActive = Object.values(urlSelections).reduce(
    (a, v) => a + v.length,
    0,
  );

  const sourceOptions: Option[] = useMemo(
    () => availableSources.map((s) => ({ val: s, label: s })),
    [availableSources],
  );

  const groups: Group[] = [
    { key: "tier", label: groupLabel("tier"), options: TIER_OPTIONS },
    { key: "status", label: groupLabel("status"), options: STATUS_OPTIONS },
    { key: "remote", label: groupLabel("remote"), options: REMOTE_OPTIONS },
    { key: "source", label: groupLabel("source"), options: sourceOptions },
    { key: "verdict", label: groupLabel("verdict"), options: VERDICT_OPTIONS },
  ];

  function pushURL(selections: Record<FilterKey, string[]>) {
    const next = new URLSearchParams(sp.toString());
    (Object.keys(selections) as FilterKey[]).forEach((k) => {
      if (selections[k].length)
        next.set(k === "tier" ? "tier" : k, selections[k].join(","));
      else next.delete(k);
    });
    next.delete("page");
    const qs = next.toString();
    router.push(qs ? `/positions?${qs}` : "/positions");
  }

  function clearGroup(key: FilterKey) {
    pushURL({ ...urlSelections, [key]: [] });
  }

  function resetAll() {
    pushURL({ tier: [], status: [], remote: [], source: [], verdict: [] });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-[10.5px] font-semibold tracking-[0.12em] uppercase rounded-full border cursor-pointer transition-colors"
        style={{
          color: totalActive > 0 ? "var(--color-bright)" : "var(--color-base)",
          borderColor:
            totalActive > 0 ? "var(--color-green)" : "var(--color-border)",
          background: "var(--color-card)",
        }}
      >
        ⚙ {tr("filters")}
        {totalActive > 0 ? ` · ${totalActive}` : ""}
      </button>

      {/* Chip riassuntive per gruppo: click = clear-only di quel gruppo.
          Per editare apri il wizard. */}
      {(Object.keys(urlSelections) as FilterKey[]).map((k) => {
        const vals = urlSelections[k];
        if (!vals.length) return null;
        return (
          <GroupChip
            key={k}
            label={groupLabel(k)}
            values={vals}
            onClear={() => clearGroup(k)}
            onEdit={() => setOpen(true)}
            tr={tr}
          />
        );
      })}

      {totalActive > 1 && (
        <button
          type="button"
          onClick={resetAll}
          className="text-[10px] font-semibold tracking-[0.1em] uppercase rounded-full border px-2 py-0.5 cursor-pointer transition-colors"
          style={{
            color: "var(--color-dim)",
            borderColor: "var(--color-border)",
            background: "transparent",
          }}
        >
          ✕ {tr("reset")}
        </button>
      )}

      {open && (
        <WizardModal
          groups={groups}
          initial={urlSelections}
          onClose={() => setOpen(false)}
          onApply={(s) => {
            pushURL(s);
            setOpen(false);
          }}
          tr={tr}
        />
      )}
    </div>
  );
}

function GroupChip({
  label,
  values,
  onEdit,
  onClear,
  tr,
}: {
  label: string;
  values: string[];
  onEdit: () => void;
  onClear: () => void;
  tr: (k: string) => string;
}) {
  const preview =
    values.length === 1 ? values[0] : `${values[0]} +${values.length - 1}`;
  return (
    <span
      className="inline-flex items-center text-[10px] font-semibold rounded-full border overflow-hidden"
      style={{
        color: "var(--color-bright)",
        borderColor: "var(--color-green)",
        background: "var(--color-card)",
      }}
    >
      <button
        type="button"
        onClick={onEdit}
        className="px-2.5 py-1 cursor-pointer"
        title={tr("edit_filter")}
      >
        <span style={{ color: "var(--color-dim)" }}>{label}:</span>{" "}
        <span>{preview}</span>
      </button>
      <button
        type="button"
        onClick={onClear}
        title={tr("remove_filter")}
        aria-label={tr("remove_filter_named").replace("{label}", label)}
        className="px-2 py-1 cursor-pointer border-l"
        style={{
          color: "var(--color-dim)",
          borderLeftColor: "var(--color-border)",
        }}
      >
        ✕
      </button>
    </span>
  );
}

function WizardModal({
  groups,
  initial,
  onClose,
  onApply,
  tr,
}: {
  groups: Group[];
  initial: Record<FilterKey, string[]>;
  onClose: () => void;
  onApply: (selections: Record<FilterKey, string[]>) => void;
  tr: (k: string) => string;
}) {
  const [draft, setDraft] = useState<Record<FilterKey, string[]>>(initial);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onApply(draft);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, onClose, onApply]);

  function toggle(key: FilterKey, val: string) {
    setDraft((d) => {
      const cur = d[key];
      const has = cur.includes(val);
      return {
        ...d,
        [key]: has ? cur.filter((v) => v !== val) : [...cur, val],
      };
    });
  }

  function clearGroup(key: FilterKey) {
    setDraft((d) => ({ ...d, [key]: [] }));
  }

  const totalDraft = Object.values(draft).reduce((a, v) => a + v.length, 0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={tr("position_filters")}
    >
      <div
        className="w-full max-w-3xl rounded-lg border shadow-2xl my-8"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-panel)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-5 py-3 border-b flex items-center justify-between"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            className="text-[12.5px] font-bold tracking-[0.08em] uppercase"
            style={{ color: "var(--color-white)" }}
          >
            {tr("position_filters")}
            {totalDraft > 0 ? ` · ${totalDraft}` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr("close")}
            className="text-[16px] cursor-pointer leading-none"
            style={{ color: "var(--color-dim)" }}
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {groups.map((g) => (
            <GroupRow
              key={g.key}
              group={g}
              selected={draft[g.key]}
              onToggle={(v) => toggle(g.key, v)}
              onClear={() => clearGroup(g.key)}
              tr={tr}
            />
          ))}
        </div>

        <div
          className="px-5 py-3 border-t flex items-center justify-between gap-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            type="button"
            onClick={() =>
              setDraft({
                tier: [],
                status: [],
                remote: [],
                source: [],
                verdict: [],
              })
            }
            disabled={totalDraft === 0}
            className="text-[10px] font-semibold tracking-[0.1em] uppercase cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--color-dim)" }}
          >
            ✕ {tr("reset_all")}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-[10.5px] font-semibold tracking-[0.12em] uppercase rounded border cursor-pointer transition-colors"
              style={{
                color: "var(--color-dim)",
                borderColor: "var(--color-border)",
                background: "transparent",
              }}
            >
              {tr("cancel")}
            </button>
            <button
              type="button"
              onClick={() => onApply(draft)}
              disabled={!dirty}
              className="px-4 py-1.5 text-[10.5px] font-semibold tracking-[0.12em] uppercase rounded border cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                color: "var(--color-green)",
                borderColor: "var(--color-green)",
                background: "transparent",
              }}
            >
              {tr("apply")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupRow({
  group,
  selected,
  onToggle,
  onClear,
  tr,
}: {
  group: Group;
  selected: string[];
  onToggle: (val: string) => void;
  onClear: () => void;
  tr: (k: string) => string;
}) {
  if (!group.options.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-24 shrink-0 flex items-center justify-between">
        <span
          className="text-[9.5px] font-semibold tracking-[0.14em] uppercase"
          style={{ color: "var(--color-dim)" }}
        >
          {group.label}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            aria-label={tr("clear_named").replace("{label}", group.label)}
            title={tr("clear")}
            className="text-[10px] cursor-pointer leading-none"
            style={{ color: "var(--color-dim)" }}
          >
            ✕
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 flex-1">
        {group.options.map((o) => {
          const active = selected.includes(o.val);
          return (
            <button
              key={o.val}
              type="button"
              onClick={() => onToggle(o.val)}
              className="px-2.5 py-1 text-[10px] font-semibold rounded-full border cursor-pointer transition-colors whitespace-nowrap"
              style={
                active
                  ? {
                      color: o.color ?? "var(--color-bright)",
                      borderColor: o.color ?? "var(--color-green)",
                      background: o.color
                        ? `${o.color}20`
                        : "var(--color-card)",
                    }
                  : {
                      color: "var(--color-dim)",
                      borderColor: "var(--color-border)",
                      background: "transparent",
                    }
              }
              aria-pressed={active}
            >
              {o.labelKey ? tr(o.labelKey) : o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function csv(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
