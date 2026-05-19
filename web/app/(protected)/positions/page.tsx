import Link from "next/link";
import { getPositions } from "@/lib/queries";
import type { PositionWithScore, PositionStatus } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import CloudSyncStatusBanner from "@/app/components/CloudSyncStatusBanner";
import PositionsTableScroller from "@/app/components/PositionsTableScroller";

const STATUS_COLORS: Record<string, string> = {
  new: "var(--color-muted)",
  checked: "var(--color-blue)",
  scored: "var(--color-purple)",
  writing: "var(--color-yellow)",
  review: "var(--color-orange)",
  ready: "#7fffb2",
  applied: "var(--color-green)",
  response: "#58a6ff",
  excluded: "var(--color-red)",
};

const ALL_STATUSES: PositionStatus[] = [
  "new",
  "checked",
  "scored",
  "writing",
  "review",
  "ready",
  "applied",
  "response",
  "excluded",
];

function scoreClass(s?: number) {
  if (!s) return "text-[var(--color-dim)]";
  if (s >= 75) return "text-[var(--color-green)]";
  if (s >= 55) return "text-[var(--color-yellow)]";
  return "text-[var(--color-red)]";
}

function scoreBg(s?: number) {
  if (!s) return "var(--color-border)";
  if (s >= 75) return "var(--color-green)";
  if (s >= 55) return "var(--color-yellow)";
  return "var(--color-red)";
}

function formatFoundAt(ts: string | null | undefined) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Tier config (dal legacy) ──────────────────────────────────────
const TIERS = [
  {
    val: "all",
    label: "Tutti",
    color: undefined,
    min: undefined,
    max: undefined,
    noScore: false,
  },
  {
    val: "seria",
    label: "Seria ≥70",
    color: "var(--color-green)",
    min: 70,
    max: undefined,
    noScore: false,
  },
  {
    val: "practice",
    label: "Practice 40-69",
    color: "var(--color-yellow)",
    min: 40,
    max: 69,
    noScore: false,
  },
  {
    val: "riferimento",
    label: "Riferimento <40",
    color: "var(--color-orange)",
    min: 1,
    max: 39,
    noScore: false,
  },
  {
    val: "noscore",
    label: "Non scored",
    color: "var(--color-dim)",
    min: undefined,
    max: undefined,
    noScore: true,
  },
] as const;

interface CompanyProps {
  searchParams: Promise<{
    status?: string;
    remote?: string;
    tier?: string;
    sync?: string;
    sort?: string;
    dir?: string;
    expand?: string;
    page?: string;
    pageSize?: string;
  }>;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

// Colonne espandibili (testo libero, può eccedere). Per le altre
// (id, score, voto, rilevata, stato) lo spazio fisso è già adeguato.
const EXPANDABLE_COLUMNS = new Set(["title", "company", "location"]);

const SORTABLE_COLUMNS = new Set([
  "id",
  "title",
  "company",
  "source",
  "location",
  "score",
  "critic",
  "found_at",
  "status",
]);

// Verdetto critico → colore badge.
const CRITIC_COLORS: Record<string, string> = {
  PASS: "var(--color-green)",
  NEEDS_WORK: "var(--color-yellow)",
  REJECT: "var(--color-red)",
};

const SYNC_FILTERS = [
  { val: "all", label: "Tutti" },
  { val: "synced", label: "☁ Sincronizzate" },
  { val: "unsynced", label: "Da sincronizzare" },
] as const;
type SyncFilter = (typeof SYNC_FILTERS)[number]["val"];

export default async function PositionsCompany({ searchParams }: CompanyProps) {
  const params = await searchParams;
  const statusFilter = params.status ?? "all";
  const remoteFilter = params.remote ?? "all";
  const tierFilter = params.tier ?? "all";
  const syncFilter: SyncFilter =
    params.sync === "synced" || params.sync === "unsynced"
      ? params.sync
      : "all";

  const sortCol = SORTABLE_COLUMNS.has(params.sort ?? "")
    ? params.sort!
    : "found_at";
  const sortDir: "asc" | "desc" = params.dir === "asc" ? "asc" : "desc";

  // expand=title,location → set di colonne mostrate full-width.
  const expandedCols = new Set(
    (params.expand ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => EXPANDABLE_COLUMNS.has(c)),
  );
  const isExpanded = (col: string) => expandedCols.has(col);

  // Paginazione: pageSize (whitelist), page 1-based.
  const requestedCompanySize = parseInt(params.pageSize ?? "", 10);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(
    requestedCompanySize,
  )
    ? requestedCompanySize
    : DEFAULT_PAGE_SIZE;
  const requestedCompany = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const tier = TIERS.find((t) => t.val === tierFilter) ?? TIERS[0];

  const allPositions = await getPositions({
    status: statusFilter !== "all" ? statusFilter : undefined,
    remoteType: remoteFilter !== "all" ? remoteFilter : undefined,
    minScore: tier.min,
    maxScore: tier.max,
    noScore: tier.noScore,
    limit: 600,
    sort: sortCol,
    dir: sortDir,
  });

  // Fetch dei legacy_id già su Supabase per l'utente loggato (set per
  // lookup O(1) dentro il loop righe). Errori → set vuoto, niente icona
  // ma la lista funziona comunque.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let syncedIds = new Set<number>();
  if (user) {
    const { data } = await supabase
      .from("positions")
      .select("legacy_id")
      .eq("user_id", user.id)
      .not("legacy_id", "is", null);
    syncedIds = new Set(
      (data ?? [])
        .map((r: { legacy_id: number | null }) => r.legacy_id)
        .filter((x: number | null): x is number => typeof x === "number"),
    );
  }

  // Applica filtro sync dopo aver caricato syncedIds. Una position senza
  // legacy_id non può essere sincronizzata → cade in "unsynced".
  const positions =
    syncFilter === "all"
      ? allPositions
      : allPositions.filter((p) => {
          const isSynced = p.legacy_id != null && syncedIds.has(p.legacy_id);
          return syncFilter === "synced" ? isSynced : !isSynced;
        });

  // Pagination computed values
  const totalResults = positions.length;
  const pageCount = Math.max(1, Math.ceil(totalResults / pageSize));
  const page = Math.min(requestedCompany, pageCount);
  const startIdx = (page - 1) * pageSize;
  const visiblePositions = positions.slice(startIdx, startIdx + pageSize);

  // Helper per costruire URL preservando filtri attivi.
  const buildHref = (
    overrides: Partial<
      Record<
        | "status"
        | "remote"
        | "tier"
        | "sync"
        | "sort"
        | "dir"
        | "expand"
        | "page"
        | "pageSize",
        string
      >
    >,
  ) => {
    const merged: Record<string, string> = {};
    if (statusFilter !== "all") merged.status = statusFilter;
    if (remoteFilter !== "all") merged.remote = remoteFilter;
    if (tierFilter !== "all") merged.tier = tierFilter;
    if (syncFilter !== "all") merged.sync = syncFilter;
    if (sortCol !== "found_at") merged.sort = sortCol;
    if (sortDir !== "desc") merged.dir = sortDir;
    if (expandedCols.size > 0) merged.expand = Array.from(expandedCols).join(",");
    if (page !== 1) merged.page = String(page);
    if (pageSize !== DEFAULT_PAGE_SIZE) merged.pageSize = String(pageSize);
    Object.assign(merged, overrides);
    // Rimuovi chiavi con valore 'all' o default → URL pulito
    for (const k of Object.keys(merged)) {
      if (merged[k] === "all") delete merged[k];
      if (k === "sort" && merged[k] === "found_at") delete merged[k];
      if (k === "dir" && merged[k] === "desc") delete merged[k];
      if (k === "expand" && merged[k] === "") delete merged[k];
      if (k === "page" && (merged[k] === "1" || merged[k] === "")) delete merged[k];
      if (k === "pageSize" && merged[k] === String(DEFAULT_PAGE_SIZE)) delete merged[k];
    }
    const qs = new URLSearchParams(merged).toString();
    return qs ? `/positions?${qs}` : "/positions";
  };

  // Toggle expand di una colonna: aggiunge/rimuove dalla CSV `expand`.
  const expandHref = (col: string) => {
    const next = new Set(expandedCols);
    if (next.has(col)) next.delete(col);
    else next.add(col);
    return buildHref({ expand: next.size ? Array.from(next).join(",") : "" });
  };

  // Link per ordinare cliccando un header: se la colonna è già attiva
  // toggla la direzione, altrimenti diventa la nuova attiva con dir
  // default (desc per metriche numeriche e id, asc per testo).
  const sortHref = (col: string) => {
    const isActive = sortCol === col;
    const NUMERIC = new Set(["id", "score", "critic", "found_at"]);
    const defaultDir = NUMERIC.has(col) ? "desc" : "asc";
    const nextDir = isActive
      ? sortDir === "asc"
        ? "desc"
        : "asc"
      : defaultDir;
    return buildHref({ sort: col, dir: nextDir });
  };

  const sortIndicator = (col: string) =>
    sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  // True se l'utente ha toccato qualsiasi filtro/sort/expand rispetto
  // al default — usato per mostrare il bottone "Reset filtri".
  const hasActiveFilters =
    statusFilter !== "all" ||
    remoteFilter !== "all" ||
    tierFilter !== "all" ||
    syncFilter !== "all" ||
    sortCol !== "found_at" ||
    sortDir !== "desc" ||
    expandedCols.size > 0;

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* Banner stato cloud-sync (compatto, nascosto se non loggato). */}
      <CloudSyncStatusBanner />

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            Posizioni
          </span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">
          Posizioni
        </h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1 flex flex-wrap items-center gap-x-2">
          <span>
            {positions.length} risultati
            {statusFilter !== "all" && ` · status: ${statusFilter}`}
            {remoteFilter !== "all" && ` · ${remoteFilter.replace("_", " ")}`}
            {tierFilter !== "all" && ` · ${tier.label}`}
            {syncFilter !== "all" &&
              ` · ${SYNC_FILTERS.find((s) => s.val === syncFilter)?.label}`}
          </span>
          {hasActiveFilters && (
            <Link
              href="/positions"
              className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline border border-[var(--color-border)] hover:border-[var(--color-green)] rounded-full px-2 py-0.5"
            >
              ✕ Reset filtri
            </Link>
          )}
        </p>
      </div>

      {/* ── Tier filter (dal legacy: Seria / Practice / Riferimento) ── */}
      <div className="mb-5">
        <span className="text-[9.5px] font-semibold tracking-[0.14em] uppercase text-[var(--color-dim)] mr-3">
          Tier
        </span>
        <span className="inline-flex flex-wrap gap-1.5">
          {TIERS.map((t) => (
            <FilterChip
              key={t.val}
              href={buildHref({ tier: t.val })}
              label={t.label}
              active={tierFilter === t.val}
              color={t.color}
            />
          ))}
        </span>
      </div>

      {/* ── Sync filter (mostra solo se utente loggato — sennò info inutile) ── */}
      {user && (
        <div className="mb-5">
          <span className="text-[9.5px] font-semibold tracking-[0.14em] uppercase text-[var(--color-dim)] mr-3">
            Cloud sync
          </span>
          <span className="inline-flex flex-wrap gap-1.5">
            {SYNC_FILTERS.map((s) => (
              <FilterChip
                key={s.val}
                href={buildHref({ sync: s.val })}
                label={s.label}
                active={syncFilter === s.val}
                color={
                  s.val === "synced"
                    ? "var(--color-green)"
                    : s.val === "unsynced"
                      ? "var(--color-yellow, #d4a85a)"
                      : undefined
                }
              />
            ))}
          </span>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Status filter */}
        <div className="flex flex-wrap gap-1">
          <FilterChip
            href={buildHref({ status: "all" })}
            label="Tutti"
            active={statusFilter === "all"}
          />
          {ALL_STATUSES.map((s) => (
            <FilterChip
              key={s}
              href={buildHref({ status: s })}
              label={s}
              active={statusFilter === s}
              color={STATUS_COLORS[s]}
            />
          ))}
        </div>

        {/* Company filter */}
        <div className="flex gap-1 ml-auto">
          {[
            { val: "all", label: "Company: tutti" },
            { val: "full_remote", label: "Full remote" },
            { val: "hybrid", label: "Hybrid" },
            { val: "onsite", label: "On-site" },
          ].map(({ val, label }) => (
            <FilterChip
              key={val}
              href={buildHref({ remote: val })}
              label={label}
              active={remoteFilter === val}
            />
          ))}
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      {/* La pagina /positions è in MainChrome FULLSCREEN_FLOWS, quindi
          il main è già full-width con padding 48px. La tabella prende
          100% e ha scroll-x se eccede. */}
      <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg">
        <table
          className="w-full text-[12px]"
          style={{ borderCollapse: "collapse" }}
          aria-label="Lista posizioni"
        >
          <thead>
            <tr className="bg-[var(--color-panel)] border-b border-[var(--color-border)]">
              {[
                { col: "found_at", label: "Rilevata" },
                { col: "id", label: "ID" },
                { col: "title", label: "Titolo" },
                { col: "company", label: "Azienda" },
                { col: "source", label: "Fonte" },
                { col: "location", label: "Location" },
                { col: "score", label: "Score" },
                { col: "status", label: "Stato" },
                { col: "critic", label: "Voto finale" },
              ].map(({ col, label }) => (
                <th
                  key={col}
                  scope="col"
                  className="px-4 py-3 text-left text-[9.5px] font-semibold tracking-[0.15em] uppercase whitespace-nowrap"
                  style={{
                    color:
                      sortCol === col
                        ? "var(--color-bright)"
                        : "var(--color-dim)",
                  }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Link
                      href={sortHref(col)}
                      className="no-underline hover:text-[var(--color-green)] transition-colors"
                      style={{ color: "inherit" }}
                    >
                      {label}
                      <span aria-hidden="true">{sortIndicator(col)}</span>
                    </Link>
                    {EXPANDABLE_COLUMNS.has(col) && (
                      <Link
                        href={expandHref(col)}
                        title={
                          isExpanded(col)
                            ? "Comprimi colonna"
                            : "Espandi colonna"
                        }
                        aria-label={
                          isExpanded(col)
                            ? "Comprimi colonna"
                            : "Espandi colonna"
                        }
                        className="no-underline text-[10px] leading-none px-1 rounded hover:bg-[var(--color-card)] hover:text-[var(--color-green)] transition-colors"
                        style={{
                          color: isExpanded(col)
                            ? "var(--color-green)"
                            : "var(--color-dim)",
                        }}
                      >
                        {isExpanded(col) ? "⇲" : "⇱"}
                      </Link>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiblePositions.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-12 text-center text-[var(--color-dim)] text-[11px]"
                >
                  Nessuna posizione trovata con questi filtri.
                </td>
              </tr>
            ) : (
              visiblePositions.map((p: PositionWithScore, i: number) => (
                <tr
                  key={p.id}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors"
                  style={{
                    borderBottomColor:
                      i === visiblePositions.length - 1
                        ? "transparent"
                        : undefined,
                    background:
                      i % 2 === 1 ? "rgba(255,255,255,0.008)" : undefined,
                  }}
                >
                  <td className="px-4 py-3 text-[10px] text-[var(--color-muted)] whitespace-nowrap font-mono">
                    {formatFoundAt(p.found_at)}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-[var(--color-dim)] whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {p.legacy_id
                        ? `JHT-${String(p.legacy_id).padStart(3, "0")}`
                        : p.id.slice(0, 8)}
                      {p.legacy_id != null && syncedIds.has(p.legacy_id) && (
                        <span
                          title="Sincronizzato sul cloud"
                          aria-label="Sincronizzato sul cloud"
                          style={{
                            color: "var(--color-green)",
                            fontSize: "11px",
                            lineHeight: 1,
                          }}
                        >
                          ☁
                        </span>
                      )}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-3 font-medium ${
                      isExpanded("title") ? "" : "max-w-[220px]"
                    }`}
                  >
                    <Link
                      href={`/positions/${p.id}`}
                      className={`text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors ${
                        isExpanded("title") ? "" : "line-clamp-2"
                      }`}
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td
                    className={`px-4 py-3 text-[var(--color-base)] ${
                      isExpanded("company")
                        ? "whitespace-normal"
                        : "whitespace-nowrap max-w-[140px] truncate"
                    }`}
                    title={p.company}
                  >
                    {p.company}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-[var(--color-muted)] whitespace-nowrap font-mono">
                    {p.source ?? "—"}
                  </td>
                  <td
                    className={`px-4 py-3 text-[11px] text-[var(--color-muted)] ${
                      isExpanded("location")
                        ? "whitespace-normal"
                        : "max-w-[200px] truncate whitespace-nowrap"
                    }`}
                    title={p.location ?? undefined}
                  >
                    {p.location ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <span
                        className={`text-[12px] font-semibold w-6 text-right ${scoreClass(p.score)}`}
                      >
                        {p.score ?? "—"}
                      </span>
                      <div
                        className="w-10 h-1 rounded-full overflow-hidden"
                        style={{ background: "var(--color-border)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${p.score ?? 0}%`,
                            background: scoreBg(p.score),
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap"
                      style={{
                        color: STATUS_COLORS[p.status] ?? "var(--color-dim)",
                        borderColor:
                          STATUS_COLORS[p.status] ?? "var(--color-border)",
                        background: `${STATUS_COLORS[p.status]}18`,
                      }}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {p.critic_score != null || p.critic_verdict ? (
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[12px] font-semibold tabular-nums"
                          style={{
                            color:
                              CRITIC_COLORS[p.critic_verdict ?? ""] ??
                              "var(--color-muted)",
                          }}
                        >
                          {p.critic_score != null
                            ? p.critic_score.toFixed(1)
                            : "—"}
                        </span>
                        {p.critic_verdict && (
                          <span
                            className="text-[9px] font-semibold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded border"
                            style={{
                              color:
                                CRITIC_COLORS[p.critic_verdict] ??
                                "var(--color-dim)",
                              borderColor:
                                CRITIC_COLORS[p.critic_verdict] ??
                                "var(--color-border)",
                              background: `${CRITIC_COLORS[p.critic_verdict] ?? "var(--color-border)"}18`,
                            }}
                          >
                            {p.critic_verdict.replace("_", " ")}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[var(--color-dim)] text-[11px]">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-[11px] text-[var(--color-muted)]">
        <div>
          {totalResults === 0
            ? "0 risultati"
            : `${startIdx + 1}–${Math.min(startIdx + pageSize, totalResults)} di ${totalResults} · pagina ${page} / ${pageCount}`}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-dim)]">
              Righe per pagina
            </span>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <Link
                key={size}
                href={buildHref({ pageSize: String(size), page: "1" })}
                className="px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors no-underline"
                style={
                  pageSize === size
                    ? {
                        color: "var(--color-bright)",
                        borderColor: "var(--color-green)",
                        background: "var(--color-card)",
                      }
                    : {
                        color: "var(--color-dim)",
                        borderColor: "var(--color-border)",
                      }
                }
              >
                {size}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {page > 1 ? (
              <Link
                href={buildHref({ page: String(page - 1) })}
                className="px-3 py-1 text-[10px] font-semibold rounded border border-[var(--color-border)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors no-underline text-[var(--color-base)]"
              >
                ← Precedenti
              </Link>
            ) : (
              <span className="px-3 py-1 text-[10px] font-semibold rounded border border-[var(--color-border)] text-[var(--color-dim)] opacity-50">
                ← Precedenti
              </span>
            )}
            {page < pageCount ? (
              <Link
                href={buildHref({ page: String(page + 1) })}
                className="px-3 py-1 text-[10px] font-semibold rounded border border-[var(--color-border)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors no-underline text-[var(--color-base)]"
              >
                Successivi →
              </Link>
            ) : (
              <span className="px-3 py-1 text-[10px] font-semibold rounded border border-[var(--color-border)] text-[var(--color-dim)] opacity-50">
                Successivi →
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  href,
  label,
  active,
  color,
}: {
  href: string;
  label: string;
  active?: boolean;
  color?: string;
}) {
  return (
    <Link
      href={href}
      className="px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-colors no-underline whitespace-nowrap"
      style={
        active
          ? {
              color: color ?? "var(--color-bright)",
              borderColor: color ?? "var(--color-green)",
              background: color ? `${color}20` : "var(--color-card)",
            }
          : {
              color: "var(--color-dim)",
              borderColor: "var(--color-border)",
              background: "transparent",
            }
      }
    >
      {label}
    </Link>
  );
}
// Thu Apr 23 09:14:05 UTC 2026
