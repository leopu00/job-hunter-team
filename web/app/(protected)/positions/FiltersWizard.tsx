"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type FilterKey = "tier" | "status" | "remote" | "source" | "verdict";

interface Option {
  val: string;
  label: string;
  color?: string;
}

interface Group {
  key: FilterKey;
  label: string;
  options: Option[];
}

const TIER_OPTIONS: Option[] = [
  { val: "seria",       label: "Seria ≥70",       color: "var(--color-green)" },
  { val: "practice",    label: "Practice 40-69",  color: "var(--color-yellow)" },
  { val: "riferimento", label: "Riferimento <40", color: "var(--color-orange)" },
  { val: "noscore",     label: "Non scored",      color: "var(--color-dim)" },
];

const STATUS_OPTIONS: Option[] = [
  { val: "new",      label: "new",      color: "var(--color-muted)" },
  { val: "checked",  label: "checked",  color: "var(--color-blue)" },
  { val: "scored",   label: "scored",   color: "var(--color-purple)" },
  { val: "writing",  label: "writing",  color: "var(--color-yellow)" },
  { val: "review",   label: "review",   color: "var(--color-orange)" },
  { val: "ready",    label: "ready",    color: "#7fffb2" },
  { val: "applied",  label: "applied",  color: "var(--color-green)" },
  { val: "response", label: "response", color: "#58a6ff" },
  { val: "excluded", label: "excluded", color: "var(--color-red)" },
];

const REMOTE_OPTIONS: Option[] = [
  { val: "full_remote", label: "Full remote" },
  { val: "hybrid",      label: "Hybrid" },
  { val: "onsite",      label: "On-site" },
];

const VERDICT_OPTIONS: Option[] = [
  { val: "PASS",       label: "PASS",       color: "var(--color-green)" },
  { val: "NEEDS_WORK", label: "NEEDS WORK", color: "var(--color-yellow)" },
  { val: "REJECT",     label: "REJECT",     color: "var(--color-red)" },
];

const Company_LABELS: Record<FilterKey, string> = {
  tier: "Tier",
  status: "Status",
  remote: "Company",
  source: "Fonte",
  verdict: "Voto critico",
};

export default function FiltersWizard({
  availableSources,
}: {
  availableSources: string[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);

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

  const totalActive = Object.values(urlSelections).reduce((a, v) => a + v.length, 0);

  const sourceOptions: Option[] = useMemo(
    () => availableSources.map((s) => ({ val: s, label: s })),
    [availableSources],
  );

  const groups: Group[] = [
    { key: "tier",    label: Company_LABELS.tier,    options: TIER_OPTIONS },
    { key: "status",  label: Company_LABELS.status,  options: STATUS_OPTIONS },
    { key: "remote",  label: Company_LABELS.remote,  options: REMOTE_OPTIONS },
    { key: "source",  label: Company_LABELS.source,  options: sourceOptions },
    { key: "verdict", label: Company_LABELS.verdict, options: VERDICT_OPTIONS },
  ];

  function pushURL(selections: Record<FilterKey, string[]>) {
    const next = new URLSearchParams(sp.toString());
    (Object.keys(selections) as FilterKey[]).forEach((k) => {
      if (selections[k].length) next.set(k === "tier" ? "tier" : k, selections[k].join(","));
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
          borderColor: totalActive > 0 ? "var(--color-green)" : "var(--color-border)",
          background: "var(--color-card)",
        }}
      >
        ⚙ Filtri{totalActive > 0 ? ` · ${totalActive}` : ""}
      </button>

      {/* Chip riassuntive per gruppo: click = clear-only di quel gruppo.
          Per editare apri il wizard. */}
      {(Object.keys(urlSelections) as FilterKey[]).map((k) => {
        const vals = urlSelections[k];
        if (!vals.length) return null;
        return (
          <GroupChip
            key={k}
            label={Company_LABELS[k]}
            values={vals}
            onClear={() => clearGroup(k)}
            onEdit={() => setOpen(true)}
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
          ✕ Reset
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
}: {
  label: string;
  values: string[];
  onEdit: () => void;
  onClear: () => void;
}) {
  const preview = values.length === 1 ? values[0] : `${values[0]} +${values.length - 1}`;
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
        title="Modifica filtro"
      >
        <span style={{ color: "var(--color-dim)" }}>{label}:</span>{" "}
        <span>{preview}</span>
      </button>
      <button
        type="button"
        onClick={onClear}
        title="Rimuovi filtro"
        aria-label={`Rimuovi filtro ${label}`}
        className="px-2 py-1 cursor-pointer border-l"
        style={{ color: "var(--color-dim)", borderLeftColor: "var(--color-border)" }}
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
}: {
  groups: Group[];
  initial: Record<FilterKey, string[]>;
  onClose: () => void;
  onApply: (selections: Record<FilterKey, string[]>) => void;
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
      return { ...d, [key]: has ? cur.filter((v) => v !== val) : [...cur, val] };
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
      aria-label="Filtri posizioni"
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
            Filtri posizioni{totalDraft > 0 ? ` · ${totalDraft}` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
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
              setDraft({ tier: [], status: [], remote: [], source: [], verdict: [] })
            }
            disabled={totalDraft === 0}
            className="text-[10px] font-semibold tracking-[0.1em] uppercase cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--color-dim)" }}
          >
            ✕ Reset tutti
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
              Annulla
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
              Applica
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
}: {
  group: Group;
  selected: string[];
  onToggle: (val: string) => void;
  onClear: () => void;
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
            aria-label={`Pulisci ${group.label}`}
            title="Pulisci"
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
                      background: o.color ? `${o.color}20` : "var(--color-card)",
                    }
                  : {
                      color: "var(--color-dim)",
                      borderColor: "var(--color-border)",
                      background: "transparent",
                    }
              }
              aria-pressed={active}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function csv(v: string | null): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}
