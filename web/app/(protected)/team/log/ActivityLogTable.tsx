"use client";

import { useMemo, useState } from "react";
import type {
  RecentActivityEvent,
  TeamActivityRole,
} from "@/lib/team-activity";
import { ROLE_META } from "@/lib/team-activity-meta";
import { ActivityRow } from "@/app/components/activity-format";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import ActorIcon from "@/app/components/ActorIcon";

const T: Record<
  Locale,
  {
    all: string;
    searchPlaceholder: string;
    rowsPerPage: string;
    ofTotal: (total: number) => string;
    prev: string;
    next: string;
    noActions: string;
  }
> = {
  it: {
    all: "Tutti",
    searchPlaceholder: "Cerca istanza, titolo, azienda, #id…",
    rowsPerPage: "Righe per pagina",
    ofTotal: (total) => `di ${total}`,
    prev: "← Prec",
    next: "Succ →",
    noActions: "Nessuna azione per i filtri selezionati.",
  },
  en: {
    all: "All",
    searchPlaceholder: "Search instance, title, company, #id…",
    rowsPerPage: "Rows per page",
    ofTotal: (total) => `of ${total}`,
    prev: "← Prev",
    next: "Next →",
    noActions: "No actions for the selected filters.",
  },
  es: {
    all: "Todos",
    searchPlaceholder: "Buscar instancia, título, empresa, #id…",
    rowsPerPage: "Filas por página",
    ofTotal: (total) => `de ${total}`,
    prev: "← Ant",
    next: "Sig →",
    noActions: "Sin acciones para los filtros seleccionados.",
  },
  fr: {
    all: "Tous",
    searchPlaceholder: "Rechercher instance, titre, entreprise, #id…",
    rowsPerPage: "Lignes par page",
    ofTotal: (total) => `sur ${total}`,
    prev: "← Préc",
    next: "Suiv →",
    noActions: "Aucune action pour les filtres sélectionnés.",
  },
  de: {
    all: "Alle",
    searchPlaceholder: "Instanz, Titel, Unternehmen, #id suchen…",
    rowsPerPage: "Zeilen pro Seite",
    ofTotal: (total) => `von ${total}`,
    prev: "← Zurück",
    next: "Weiter →",
    noActions: "Keine Aktionen für die ausgewählten Filter.",
  },
  hu: {
    all: "Mind",
    searchPlaceholder: "Példány, cím, cég, #id keresése…",
    rowsPerPage: "Sorok oldalanként",
    ofTotal: (total) => `/ ${total}`,
    prev: "← Előző",
    next: "Köv →",
    noActions: "Nincs művelet a kiválasztott szűrőkhöz.",
  },
  pt: {
    all: "Todos",
    searchPlaceholder: "Pesquisar instância, título, empresa, #id…",
    rowsPerPage: "Linhas por página",
    ofTotal: (total) => `de ${total}`,
    prev: "← Ant",
    next: "Próx →",
    noActions: "Sem ações para os filtros selecionados.",
  },
};

const ROLES: TeamActivityRole[] = [
  "scout",
  "analista",
  "scorer",
  "scrittore",
  "critico",
];
const PAGE_SIZES = [20, 50, 100, 200];

export default function ActivityLogTable({
  events,
}: {
  events: RecentActivityEvent[];
}) {
  const t = T[useLocale()];
  const [role, setRole] = useState<TeamActivityRole | "all">("all");
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  // Conteggio per ruolo (per i chip)
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: events.length };
    for (const r of ROLES) m[r] = 0;
    for (const e of events) m[e.role] = (m[e.role] ?? 0) + 1;
    return m;
  }, [events]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (role !== "all" && e.role !== role) return false;
      if (!needle) return true;
      return (
        e.actor.toLowerCase().includes(needle) ||
        (e.title ?? "").toLowerCase().includes(needle) ||
        (e.company ?? "").toLowerCase().includes(needle) ||
        (e.legacyId != null && String(e.legacyId).includes(needle)) ||
        (e.pid ?? "").toLowerCase().includes(needle)
      );
    });
  }, [events, role, q]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);

  // Cambiando filtro/ricerca/dimensione torno a pagina 1.
  const reset = () => setPage(1);

  return (
    <div>
      {/* ── Filtri ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => {
            setRole("all");
            reset();
          }}
          className="px-2.5 py-1 rounded-md text-[10px] font-semibold tracking-wide transition-colors"
          style={{
            background: role === "all" ? "var(--color-green)" : "transparent",
            color: role === "all" ? "#0a0a0a" : "var(--color-muted)",
            border: `1px solid ${role === "all" ? "var(--color-green)" : "var(--color-border)"}`,
          }}
        >
          {t.all} <span className="opacity-60 tabular-nums">{counts.all}</span>
        </button>
        {ROLES.map((r) => {
          const meta = ROLE_META[r];
          const active = role === r;
          return (
            <button
              key={r}
              onClick={() => {
                setRole(r);
                reset();
              }}
              disabled={!counts[r]}
              className="px-2.5 py-1 rounded-md text-[10px] font-semibold tracking-wide transition-colors disabled:opacity-30"
              style={{
                background: active ? meta.color : "transparent",
                color: active ? "#0a0a0a" : meta.color,
                border: `1px solid ${active ? meta.color : "var(--color-border)"}`,
              }}
            >
              <ActorIcon role={r} size={11} /> {meta.label}{" "}
              <span className="opacity-60 tabular-nums">{counts[r] ?? 0}</span>
            </button>
          );
        })}
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            reset();
          }}
          placeholder={t.searchPlaceholder}
          className="ml-auto bg-[var(--color-card)] border border-[var(--color-border)] rounded-md px-3 py-1.5 text-[11px] text-[var(--color-white)] outline-none focus:border-[var(--color-blue)] transition-colors w-64 max-w-full"
          style={{ fontFamily: "inherit" }}
        />
      </div>

      {/* ── Righe per pagina + paginazione (in cima) ───────────── */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4 text-[10px] text-[var(--color-dim)]">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap">{t.rowsPerPage}</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              reset();
            }}
            className="cursor-pointer"
            // La regola globale `select { width:100% }` (unlayered) batte le
            // classi Tailwind: forzo larghezza/padding/font via inline.
            style={{
              fontFamily: "inherit",
              width: "auto",
              padding: "4px 26px 4px 10px",
              fontSize: "10px",
              borderRadius: 6,
            }}
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="whitespace-nowrap tabular-nums">
            {total === 0
              ? "0"
              : `${start + 1}–${Math.min(start + pageSize, total)}`}{" "}
            {t.ofTotal(total)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, safePage - 1))}
            disabled={safePage <= 1}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-white)] hover:border-[var(--color-muted)] transition-colors disabled:opacity-30 whitespace-nowrap"
          >
            {t.prev}
          </button>
          <span className="tabular-nums whitespace-nowrap px-1">
            {safePage} / {pages}
          </span>
          <button
            onClick={() => setPage(Math.min(pages, safePage + 1))}
            disabled={safePage >= pages}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-white)] hover:border-[var(--color-muted)] transition-colors disabled:opacity-30 whitespace-nowrap"
          >
            {t.next}
          </button>
        </div>
      </div>

      {/* ── Lista a frase (stessa resa del feed dashboard) ──────── */}
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] overflow-x-auto">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[11px] text-[var(--color-dim)]">
            {t.noActions}
          </div>
        ) : (
          rows.map((ev, i) => (
            <ActivityRow
              key={`${ev.role}-${ev.actor}-${ev.ts}-${start + i}`}
              ev={ev}
            />
          ))
        )}
      </div>
    </div>
  );
}
