import { useEffect, useRef, useState } from "react";
import { formatRelative } from "@/lib/message-display";
import { PUBLIC_STATE_COLORS, publicPositionState, publicPositionStateLabel } from "@/lib/position-state";
import { useLocale } from "@/lib/use-locale";
import type { AgentStatuses, DeptId, OfficeClick, OfficeLayout, OfficeSnapshot } from "../contract";
import { tagOf } from "../status";
import {
  loadAgentPanel,
  loadBoard,
  loadCvShelf,
  loadFoundPerDay,
  loadPhase,
  loadPlaces,
  PANEL_LIST_MAX,
  type AgentPanelData,
  type BoardData,
  type CvShelfData,
  type DayCount,
  type PanelPosition,
  type PlacesData,
} from "./load-panels";
import type { PanelClient } from "./types";

/**
 * The panel a click in the office opens, INSIDE the office (D07): the scene
 * stays in sight, nothing changes page unless the user follows the panel's
 * secondary link. Only what the cloud holds.
 */
export type OfficePanelProps = {
  target: OfficeClick;
  layout: OfficeLayout;
  snapshot: OfficeSnapshot | null;
  statuses: AgentStatuses | null;
  client: PanelClient;
  onClose: () => void;
  /** another panel in place of this one (the department's pile, from its panel) */
  onOpen: (target: OfficeClick) => void;
  onNavigate: (path: string) => void;
};

const DEPT_OF_ROLE: Record<string, DeptId> = {
  scout: "scout",
  analista: "analisti",
  scorer: "scorer",
  scrittore: "scrittori",
  critico: "critici",
};

export function deptName(layout: OfficeLayout, dept: DeptId): string {
  return layout.departments.find((d) => d.id === dept)?.name ?? dept;
}

export default function OfficePanel(props: OfficePanelProps) {
  const { target, onClose } = props;
  // the panel takes the focus when it opens (D08): the keyboard and a screen reader land in it
  const self = useRef<HTMLElement>(null);
  const key = JSON.stringify(target);
  useEffect(() => self.current?.focus(), [key]);
  return (
    <aside
      ref={self}
      tabIndex={-1}
      aria-label="Dettagli dell'ufficio"
      className="absolute right-3 top-3 bottom-3 z-20 flex w-[380px] focus:outline-none max-w-[calc(100%-24px)] flex-col overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Chiudi"
        onClick={onClose}
        className="absolute right-2 top-2 z-10 rounded px-2 py-0.5 text-[13px] text-[var(--color-muted)] hover:text-[var(--color-bright)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-bright)]"
      >
        ✕
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[12px] text-[var(--color-text)]">
        {target.kind === "agent" ? (
          <AgentBody key={target.uid} {...props} target={target} />
        ) : target.kind === "pile" ? (
          <PhaseBody key={target.dept} {...props} dept={target.dept} />
        ) : target.kind === "department" ? (
          <DepartmentBody key={target.dept} {...props} dept={target.dept} />
        ) : target.kind === "shelf" || target.kind === "printer" ? (
          <CvBody {...props} />
        ) : target.kind === "board" ? (
          <BoardBody {...props} />
        ) : (
          <PlacesBody {...props} />
        )}
      </div>
    </aside>
  );
}

/** Loads with `load` while mounted; `null` data = loading, `error` = why not. */
function useLoad<T>(load: () => Promise<T>): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ data, error: null }),
      (err: unknown) => live && setState({ data: null, error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
    // the body is keyed by its target: it loads once per target
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="mb-3 pr-6">
      <h2 className="m-0 text-[14px] font-bold tracking-widest text-[var(--color-white)]">{title}</h2>
      {sub && <p className="m-0 mt-0.5 text-[11px] text-[var(--color-muted)]">{sub}</p>}
    </header>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="m-0 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-dim)]">{title}</h3>
      {children}
    </section>
  );
}

function Loading({ error }: { error: string | null }) {
  return <p className="m-0 text-[11px] text-[var(--color-muted)]">{error ? `Non riesco a leggere il cloud: ${error}` : "Caricamento…"}</p>;
}

function StateChip({ status }: { status: string | null }) {
  const locale = useLocale();
  const state = publicPositionState(status);
  return (
    <span className="whitespace-nowrap text-[10px] font-semibold" style={{ color: PUBLIC_STATE_COLORS[state] }}>
      {publicPositionStateLabel(state, locale)}
    </span>
  );
}

function SecondaryLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded text-[11px] text-[var(--color-muted)] underline hover:text-[var(--color-bright)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-bright)]">
      {label}
    </button>
  );
}

function AgentBody({ target, layout, statuses, client, onNavigate }: OfficePanelProps & { target: Extract<OfficeClick, { kind: "agent" }> }) {
  const locale = useLocale();
  const { data, error } = useLoad<AgentPanelData>(() => loadAgentPanel(client, target.uid));
  const dept = DEPT_OF_ROLE[target.role];
  const status = statuses?.agents[target.uid.toLowerCase()];
  const tag = status ? tagOf(status) : null;
  return (
    <>
      <Heading title={target.uid.toUpperCase()} sub={dept ? `Reparto ${deptName(layout, dept)}` : target.role} />
      <Section title="Ora">
        {tag ? (
          <span className="rounded border px-2 py-0.5 text-[10px] font-bold tracking-widest" style={{ color: hex(tag.color), borderColor: hex(tag.color) }}>
            {tag.label}
          </span>
        ) : (
          <span className="text-[11px] text-[var(--color-muted)]">Stato non pubblicato dal team.</span>
        )}
      </Section>
      <Section title="In mano">
        {!data ? (
          <Loading error={error} />
        ) : data.inHand.length === 0 ? (
          <p className="m-0 text-[11px] text-[var(--color-muted)]">Nessuna posizione ferma dove l'ha lasciata.</p>
        ) : (
          <PositionList positions={data.inHand} onNavigate={onNavigate} />
        )}
      </Section>
      <Section title="Ultime mosse">
        {!data ? (
          <Loading error={error} />
        ) : data.moves.length === 0 ? (
          <p className="m-0 text-[11px] text-[var(--color-muted)]">Nessuna mossa registrata nel cloud.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {data.moves.map((m, i) => (
              <li key={i} className="flex items-baseline gap-2 border-b border-[var(--color-border)] py-1 last:border-0">
                <span className="w-16 flex-shrink-0 text-[10px] text-[var(--color-dim)]">{formatRelative(m.ts, locale)}</span>
                <span className="min-w-0 flex-1 truncate">{m.position ? positionLine(m.position) : "posizione non più nel cloud"}</span>
                <StateChip status={m.to} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <SecondaryLink label="Apri la pagina dell'agente" onClick={() => onNavigate(`/agents?agent=${encodeURIComponent(target.role)}`)} />
    </>
  );
}

function PhaseBody({ dept, layout, snapshot, client, onNavigate }: OfficePanelProps & { dept: DeptId }) {
  const { data, error } = useLoad<PanelPosition[]>(() => loadPhase(client, dept));
  const count = snapshot?.piles[dept];
  return (
    <>
      <Heading title={deptName(layout, dept)} sub={count == null ? "Posizioni in questa fase" : `${count} posizioni in questa fase`} />
      {!data ? (
        <Loading error={error} />
      ) : data.length === 0 ? (
        <p className="m-0 text-[11px] text-[var(--color-muted)]">Nessuna posizione in questa fase.</p>
      ) : (
        <>
          <PositionList positions={data} onNavigate={onNavigate} />
          {count != null && count > data.length && (
            <p className="m-0 mt-2 text-[10px] text-[var(--color-dim)]">Le {Math.min(data.length, PANEL_LIST_MAX)} più recenti.</p>
          )}
        </>
      )}
      <div className="mt-3">
        <SecondaryLink label="Tutte le posizioni" onClick={() => onNavigate("/positions")} />
      </div>
    </>
  );
}

function DepartmentBody({ dept, layout, snapshot, statuses, client, onOpen }: OfficePanelProps & { dept: DeptId }) {
  const d = layout.departments.find((x) => x.id === dept);
  const agents = (snapshot?.roster ?? []).filter((a) => DEPT_OF_ROLE[a.role] === dept);
  const inbox = snapshot?.piles[dept];
  return (
    <>
      <Heading title={deptName(layout, dept)} sub={d?.tagline} />
      <Section title="In ingresso">
        <p className="m-0">{inbox == null ? "—" : `${inbox} posizioni sulla pila`}</p>
        <SecondaryLink label="Le posizioni sulla pila" onClick={() => onOpen({ kind: "pile", dept })} />
      </Section>
      <Section title="Agenti del reparto">
        {agents.length === 0 ? (
          <p className="m-0 text-[11px] text-[var(--color-muted)]">Nessun agente del reparto nelle ultime 24 ore.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {agents.map((a) => {
              const s = statuses?.agents[a.uid.toLowerCase()];
              const tag = s ? tagOf(s) : null;
              return (
                <li key={a.uid} className="flex items-baseline justify-between border-b border-[var(--color-border)] py-1 last:border-0">
                  <span>{a.uid.toUpperCase()}</span>
                  {tag ? (
                    <span className="text-[10px] font-bold tracking-widest" style={{ color: hex(tag.color) }}>
                      {tag.label}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--color-dim)]">—</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {dept === "scout" && <FoundPerDay client={client} />}
    </>
  );
}

function FoundPerDay({ client }: { client: PanelClient }) {
  const { data, error } = useLoad<DayCount[]>(() => loadFoundPerDay(client));
  const max = Math.max(1, ...(data ?? []).map((d) => d.n));
  return (
    <Section title="Trovate negli ultimi 7 giorni">
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="flex h-20 items-end gap-1" role="img" aria-label={data.map((d) => `${d.day}: ${d.n}`).join(", ")}>
          {data.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-0.5">
              <span className="text-[9px] text-[var(--color-muted)]">{d.n}</span>
              <div className="w-full rounded-sm bg-[var(--color-green)]" style={{ height: `${(d.n / max) * 56}px`, minHeight: d.n ? 2 : 0 }} />
              <span className="text-[9px] text-[var(--color-dim)]">{d.day.slice(8)}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex-1 rounded border border-[var(--color-border)] px-2 py-1.5 text-center">
      <div className="text-[15px] font-bold text-[var(--color-white)]">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-[var(--color-dim)]">{label}</div>
    </div>
  );
}

function CvBody({ client, onNavigate }: OfficePanelProps) {
  const { data, error } = useLoad<CvShelfData>(() => loadCvShelf(client));
  const scored = (data?.list ?? []).map((p) => p.score).filter((n): n is number => typeof n === "number");
  const avg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
  return (
    <>
      <Heading title="CV prodotti" sub="Scaffale d'uscita: le candidature scritte dal team" />
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <Kpi label="scritti" value={data.written} />
            <Kpi label="pass" value={data.passed} />
            <Kpi label="senza verdetto" value={data.unreviewed} />
            <Kpi label="punteggio medio" value={avg ?? "—"} />
          </div>
          {avg != null && <p className="m-0 mb-2 text-[10px] text-[var(--color-dim)]">Punteggio medio dei {scored.length} più recenti con un punteggio.</p>}
          {data.list.length === 0 ? (
            <p className="m-0 text-[11px] text-[var(--color-muted)]">Nessun CV scritto.</p>
          ) : (
            <PositionList positions={data.list} onNavigate={onNavigate} />
          )}
        </>
      )}
    </>
  );
}

function BoardBody({ client, onNavigate }: OfficePanelProps) {
  const locale = useLocale();
  const { data, error } = useLoad<BoardData>(() => loadBoard(client));
  return (
    <>
      <Heading title="Bacheca" sub="Posizioni pronte, inviate e con risposta" />
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            {(["ready", "applied", "response"] as const).map((s) => (
              <Kpi key={s} label={publicPositionStateLabel(publicPositionState(s), locale)} value={data.counts[s]} />
            ))}
          </div>
          {data.list.length === 0 ? (
            <p className="m-0 text-[11px] text-[var(--color-muted)]">Nessuna posizione pronta, inviata o con risposta.</p>
          ) : (
            <PositionList positions={data.list} onNavigate={onNavigate} />
          )}
        </>
      )}
    </>
  );
}

function PlacesBody({ client, onNavigate }: OfficePanelProps) {
  const { data, error } = useLoad<PlacesData>(() => loadPlaces(client));
  return (
    <>
      <Heading title="Mappa" sub="Dove sono le posizioni" />
      {!data ? (
        <Loading error={error} />
      ) : data.places.length === 0 ? (
        <p className="m-0 text-[11px] text-[var(--color-muted)]">Nessuna posizione con un luogo.</p>
      ) : (
        <>
          <p className="m-0 mb-2 text-[11px] text-[var(--color-muted)]">{data.located} posizioni con un luogo; i più frequenti:</p>
          <ul className="m-0 list-none p-0">
            {data.places.map((p) => (
              <li key={p.place} className="flex items-baseline justify-between border-b border-[var(--color-border)] py-1 last:border-0">
                <span className="min-w-0 flex-1 truncate">{p.place}</span>
                <span className="text-[11px] font-bold text-[var(--color-bright)]">{p.n}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-3">
        <SecondaryLink label="Apri la mappa" onClick={() => onNavigate("/map")} />
      </div>
    </>
  );
}

function positionLine(p: PanelPosition): string {
  return [p.title ?? "(senza titolo)", p.company].filter(Boolean).join(" · ");
}

/** A list of positions; a row opens its detail in place. */
function PositionList({ positions, onNavigate }: { positions: PanelPosition[]; onNavigate: (path: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="m-0 list-none p-0">
      {positions.map((p) => (
        <li key={p.id} className="border-b border-[var(--color-border)] last:border-0">
          <button
            type="button"
            aria-expanded={open === p.id}
            onClick={() => setOpen(open === p.id ? null : p.id)}
            className="flex w-full items-baseline gap-2 rounded py-1.5 text-left hover:bg-[var(--color-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-bright)]"
          >
            <span className="w-7 flex-shrink-0 text-right text-[11px] font-bold text-[var(--color-bright)]">{p.score ?? "—"}</span>
            <span className="min-w-0 flex-1 truncate">{positionLine(p)}</span>
            <StateChip status={p.status} />
          </button>
          {open === p.id && <PositionDetail p={p} onNavigate={onNavigate} />}
        </li>
      ))}
    </ul>
  );
}

function PositionDetail({ p, onNavigate }: { p: PanelPosition; onNavigate: (path: string) => void }) {
  const locale = useLocale();
  const when = (iso: string | null) => (iso ? formatRelative(iso, locale) : null);
  const rows: Array<[string, string | null]> = [
    ["Luogo", [p.location, p.remoteType].filter(Boolean).join(" · ") || null],
    ["Trovata", [p.foundBy, when(p.foundAt)].filter(Boolean).join(" · ") || null],
    ["Scritta", [p.writtenBy, when(p.writtenAt)].filter(Boolean).join(" · ") || null],
    ["Critico", [p.verdict?.toUpperCase(), p.criticScore == null ? null : `${p.criticScore}`, p.reviewedBy].filter(Boolean).join(" · ") || null],
  ];
  return (
    <div className="mb-2 ml-9 text-[11px]">
      <dl className="m-0 grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[var(--color-dim)]">{k}</dt>
              <dd className="m-0">{v}</dd>
            </div>
          ))}
      </dl>
      {p.jdSummary && <p className="m-0 mt-1 text-[var(--color-muted)]">{p.jdSummary}</p>}
      {p.criticNotes && <p className="m-0 mt-1 text-[var(--color-muted)]">Note del critico: {p.criticNotes}</p>}
      <div className="mt-1">
        <SecondaryLink label="Apri la posizione" onClick={() => onNavigate(`/positions/${encodeURIComponent(p.id)}`)} />
      </div>
    </div>
  );
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
