import { useEffect, useMemo, useRef, useState } from "react";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import type { AgentStatuses, OfficeClick, OfficeEngine, OfficeEvent, OfficeScene, OfficeSnapshot, Piles, Vec } from "../../office/contract";
import { createLiveOffice, createReadScheduler, subscribeOffice, type LiveOffice, type ReadScheduler } from "../../office/live";
import { watchReducedMotion } from "../../office/scene/motion";
import OfficePanel from "../../office/panel/OfficePanel";
import type { PanelClient } from "../../office/panel/types";
import OfficeKeyboard from "../../office/panel/OfficeKeyboard";
import OfficeTooltip, { tooltipFor } from "../../office/panel/OfficeTooltip";
import { keyboardTargets } from "../../office/scene/hit";
import { useLocale } from "@/lib/use-locale";
import { emptyEngine, loadAssets, loadParts, type OfficeAssets, type OfficeParts } from "../../office/parts";
import { loadAgentStatuses, stateOf } from "../../office/status";
import { officeSummary } from "../../office/summary";
import { withStatusAgents } from "../../office/data/load";
import { appLocale } from "../../lib/app-locale";
import { useExistingTeamView } from "../../lib/existing-team-readonly";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";
import { localizeLayout, officeText } from "../../office/office.i18n";
import { PAGE_STATES_TEXT } from "../../lib/page-states.i18n";
import { readTeamAgentsShared, type TeamAgentsReading } from "../../lib/existing-team-agents";
import { readTeamStatus } from "../../lib/existing-team-status";
import { officeFromTeamProbe } from "../../office/readonly";
import { readVpsPiles } from "../../office/panel/vps-panels";
import { cloudClient } from "../../lib/cloud-client";
import { navigate, useRefresh } from "../../shell/router";
import type { PageProps } from "../types";


type Ready = { assets: OfficeAssets; parts: OfficeParts };
type Load = { state: "loading" } | { state: "ready"; ready: Ready } | { state: "no-assets" } | { state: "failed" };

/**
 * /office: the team's office, as in the Godot game (D05). The page loads the
 * assets and the engine, mounts the PixiJS scene, and follows the cloud
 * (office/live.ts: Realtime, at most a read a minute) handing the engine what
 * changed. A click opens a panel
 * INSIDE the office (D07: agents, piles, departments, the CV shelf and the
 * printer, the corkboard, the hologram), the pointer shows a tag; only the
 * panel's secondary links change page.
 */
export default function OfficePage(_props: PageProps) {
  return <OfficeLoader source="cloud" />;
}

/**
 * Where the office's data comes from. The cloud (Realtime, at most a read a
 * minute) in the full shell; the existing team's VPS in the read-only view,
 * where there is no cloud: the probe behind the Squadra page, read when the
 * page opens and when «Aggiorna» asks, never on a timer of its own
 * (office/readonly.ts). In that view the panels read the same list of positions
 * the Posizioni page and the Map read (office/panel/vps-panels.ts), and never
 * the cloud; an agent's panel is not opened (its moves are not in what the VPS
 * reports) and a speech bubble over it says so.
 */
export type OfficeSource = "cloud" | "team-probe";

export function OfficeLoader({ source }: { source: OfficeSource }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let live = true;
    Promise.all([loadAssets(), loadParts()])
      .then(([assets, parts]) => {
        if (!live) return;
        setLoad(
          assets
            ? { state: "ready", ready: { assets: { ...assets, layout: localizeLayout(assets.layout, appLocale()) }, parts } }
            : { state: "no-assets" },
        );
      })
      .catch((error: unknown) => {
        console.error("[office] load failed:", error);
        if (live) setLoad({ state: "failed" });
      });
    return () => {
      live = false;
    };
  }, []);

  if (load.state === "loading") return <DashboardSkeleton label={PAGE_STATES_TEXT[appLocale()].loadingOffice} />;
  if (load.state === "no-assets") return <Notice>{PAGE_STATES_TEXT[appLocale()].officeNoAssets}</Notice>;
  if (load.state === "failed")
    return <Notice alert>{PAGE_STATES_TEXT[appLocale()].officeFailed}</Notice>;
  return <Office ready={load.ready} source={source} />;
}

function Office({ ready, source }: { ready: Ready; source: OfficeSource }) {
  const host = useRef<HTMLDivElement>(null);
  const engineRef = useRef<OfficeEngine | null>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  // The last statuses read: a scene that mounts after the first read gets them at once.
  const statusesRef = useRef<AgentStatuses | null>(null);
  const [statuses, setStatuses] = useState<AgentStatuses | null>(null);
  const showStatuses = (next: AgentStatuses | null) => {
    statusesRef.current = next;
    sceneRef.current?.setAgentStatuses?.(next);
    setStatuses(next);
  };
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null);
  const [panel, setPanel] = useState<OfficeClick | null>(null);
  const [hover, setHover] = useState<{ target: OfficeClick; at: Vec } | null>(null);
  // the keyboard's focus (D08): the target focused and where its tag goes
  const [keyFocus, setKeyFocus] = useState<{ target: OfficeClick; at: Vec } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const locale = useLocale();
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsAlert, setStatusIsAlert] = useState(false);
  // What a click on an agent says where there is no panel: ONE line above the scene, never a bubble over it
  // (two clicks made two bubbles that covered each other and the agents).
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);
  const { assets, parts } = ready;
  // A click or a key on the office. Over an existing team's VPS an agent has no panel (its moves
  // are not in what the VPS reports): a line above the scene says so, never a panel with nothing in it.
  const openPanel = (click: OfficeClick | null, button?: HTMLButtonElement) => {
    if (click && source === "team-probe" && click.kind === "agent") {
      if (noteTimer.current) clearTimeout(noteTimer.current);
      setNote(EXISTING_TEAM_READONLY_TEXT[appLocale()].officeAgentNoMoves);
      noteTimer.current = setTimeout(() => setNote(null), 8000);
      setPanel(null);
      return;
    }
    if (button) opener.current = button;
    setPanel(click);
  };

  // The scene: mounted once, resized with its box, destroyed on leave.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const engine = parts.createEngine ? parts.createEngine(assets.layout, { characters: assets.manifest.characters }) : emptyEngine();
    engineRef.current = engine;
    let scene: OfficeScene | null = null;
    let gone = false;
    const observer = new ResizeObserver(() => scene?.resize(el.clientWidth, el.clientHeight));
    import("../../office/scene/pixi-scene")
      .then(({ createOfficeScene }) =>
        createOfficeScene(el, {
          manifest: assets.manifest,
          layout: assets.layout,
          engine,
          // a click on nothing closes the panel
          onClick: (click) => openPanel(click),
          onHover: (target, at) => setHover(target ? { target, at } : null),
        }),
      )
      .then((s) => {
        if (gone) return s.destroy();
        scene = s;
        sceneRef.current = s;
        s.setAgentStatuses?.(statusesRef.current);
        observer.observe(el);
      })
      .catch((error: unknown) => {
        console.error("[office] scene failed:", error);
        setStatus(officeText().noWebGl);
      });
    return () => {
      gone = true;
      observer.disconnect();
      scene?.destroy();
      sceneRef.current = null;
      engineRef.current = null;
    };
  }, [assets, parts, source]);

  // The data, alive (D09, office/live.ts): Realtime on what the office reads
  // asks for a read, at most one a minute; with the channel down, one a
  // minute anyway. A transition on the channel is a trip at once. Under
  // prefers-reduced-motion the trips are not walked: the piles' numbers change.
  const live = useRef<LiveOffice | null>(null);
  const scheduler = useRef<ReadScheduler | null>(null);
  const reduced = useRef(false);
  const applyEvent = (e: OfficeEvent) => {
    if (reduced.current && e.type === "pipeline") return;
    engineRef.current?.apply(e);
  };
  const read = useRef<() => Promise<void>>(async () => {});
  read.current = async () => {
    if (!parts.data) return;
    const data = parts.data;
    // The tags' statuses in a query of their own: its failure costs the tags, not the office.
    const statuses = loadAgentStatuses(cloudClient());
    try {
      const read = await data.load(cloudClient());
      if (!engineRef.current) return;
      // a team that is not online has no present status to show
      const tags = read.teamOnline ? await statuses : null;
      if (!engineRef.current) return;
      // the agents the status map names are in the office too: the stopped ones move no position
      const next = withStatusAgents(read, tags);
      live.current ??= createLiveOffice(data.diff, applyEvent);
      live.current.snapshot(next);
      setSnapshot(next);
      setStatus(next.teamOnline === false ? teamOffMessage(next.roster.length) : summaryOf(tags, next));
      showStatuses(tags);
    } catch {
      showStatuses(null);
      setStatus(officeText().readFailed);
    }
  };
  useEffect(() => {
    if (source !== "cloud") return;
    if (!parts.data) {
      setStatus(officeText().notWired);
      return;
    }
    const motion = watchReducedMotion((r) => {
      reduced.current = r;
    });
    reduced.current = motion.reduced();
    const s = createReadScheduler(() => read.current());
    scheduler.current = s;
    const unsubscribe = subscribeOffice(cloudClient(), {
      onChange: () => s.poke(),
      onTransition: (t) => live.current?.transition(t),
      onStatus: (up) => s.setChannel(up),
    });
    return () => {
      s.stop();
      unsubscribe();
      motion.stop();
      scheduler.current = null;
    };
  }, [parts.data, source]);

  // The existing team's VPS (office/readonly.ts): the Squadra page's probe, read
  // once the page is open and again when «Aggiorna» asks, no timer of its own.
  // The connection's own values (the two sessions) can change without a new
  // read, so the office is drawn again from the last reading when they do.
  const readOnly = useExistingTeamView();
  const connection = readOnly?.connection ?? null;
  const reading = useRef<Awaited<ReturnType<typeof readTeamStatus>>>({ kind: "unknown" });
  // the piles' counts from the team's positions, read with the probe while the container is up
  const probePiles = useRef<Piles | null>(null);
  // the team's agents, the Agents page's read (shared with it), while the container is up
  const probeAgents = useRef<TeamAgentsReading | null>(null);
  const probeRead = useRef(0);
  const showProbe = () => {
    if (!parts.data || !engineRef.current) return;
    const office = officeFromTeamProbe(reading.current, connection, appLocale(), probePiles.current, probeAgents.current);
    live.current ??= createLiveOffice(parts.data.diff, applyEvent);
    live.current.snapshot(office.snapshot);
    setSnapshot(office.snapshot);
    showStatuses(office.statuses);
    setStatus(office.notice?.text ?? null);
    setStatusIsAlert(office.notice?.alert ?? false);
  };
  const readProbe = async () => {
    const mine = ++probeRead.current;
    const result = await readTeamStatus();
    // A read that finished after a newer one started, or after leaving the page, is not shown.
    if (probeRead.current !== mine) return;
    reading.current = result;
    // The piles come from the team's list of positions, the one read the panels and the globe
    // share; only a team whose container is up has one to read, and one that cannot be read
    // has unknown piles, not empty ones.
    probePiles.current = null;
    probeAgents.current = null;
    if (result.kind === "read" && result.fields.containerRunning) {
      const [piles, agents] = await Promise.all([readVpsPiles(), readTeamAgentsShared()]);
      if (probeRead.current !== mine) return;
      probePiles.current = piles;
      probeAgents.current = agents;
    }
    probeShow.current();
  };
  const probeShow = useRef(showProbe);
  probeShow.current = showProbe;
  useEffect(() => {
    if (source !== "team-probe") return;
    if (!parts.data) {
      setStatus(officeText().notWired);
      return;
    }
    void readProbe();
    return () => {
      probeRead.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, parts.data]);
  useEffect(() => {
    if (source === "team-probe" && reading.current.kind !== "unknown") probeShow.current();
  }, [source, connection]);
  // «Aggiorna» asks for a read too: the gap holds for it as well
  useRefresh(() => (source === "cloud" ? scheduler.current?.poke() : void readProbe()));

  // Esc closes the panel, as the Godot office's overlays.
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);
  // A panel opened from the keyboard gives the focus back to its button when it closes.
  useEffect(() => {
    if (panel || !opener.current) return;
    opener.current.focus();
    opener.current = null;
  }, [panel]);

  const targets = useMemo(() => keyboardTargets(snapshot?.roster ?? [], assets.layout), [snapshot?.roster, assets.layout]);
  const label = (t: OfficeClick) => {
    const { title, lines } = tooltipFor(t, { layout: assets.layout, snapshot, statuses, locale });
    return [title, ...lines].join(", ");
  };
  const focusTarget = (t: OfficeClick | null) => {
    const box = sceneRef.current?.focus?.(t) ?? null;
    setKeyFocus(t && box ? { target: t, at: { x: box.x + box.w, y: box.y + box.h } } : null);
  };
  const tag = hover ?? keyFocus;

  return (
    // the shell gives the office the whole window under the navbar (Route.fullBleed);
    // the status line sits above the scene, never over it
    <div className="flex h-full flex-col" data-testid="office-page">
      {status && (
        <p
          role={statusIsAlert ? "alert" : "status"}
          className="m-0 shrink-0 border-b border-[var(--color-border)] px-4 py-1.5 text-[11px] text-[var(--color-muted)]"
        >
          {status}
        </p>
      )}
      {note && (
        <p
          role="status"
          data-testid="office-agent-note"
          className="m-0 shrink-0 border-b border-[var(--color-border)] px-4 py-1.5 text-[11px] text-[var(--color-muted)]"
        >
          {note}
        </p>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row" data-testid="office-workspace">
        <div className="relative min-h-0 flex-1" data-testid="office-stage">
          <div ref={host} className="absolute inset-0" data-testid="office-canvas" />
          <OfficeKeyboard
            targets={targets}
            label={label}
            onFocusTarget={focusTarget}
            onOpen={(t, button) => openPanel(t, button)}
          />
          {tag && !panel && <OfficeTooltip target={tag.target} at={tag.at} layout={assets.layout} snapshot={snapshot} statuses={statuses} />}
        </div>
        {panel && (
          <OfficePanel
            target={panel}
            layout={assets.layout}
            snapshot={snapshot}
            statuses={statuses}
            client={source === "cloud" ? cloudClient() : NO_CLOUD}
            source={source === "cloud" ? "cloud" : "vps"}
            onClose={() => setPanel(null)}
            onOpen={setPanel}
            onNavigate={navigate}
          />
        )}
      </div>
    </div>
  );
}

/** How the team is at a glance (office/summary.ts): the statuses' counts and who has no seat; null without statuses. */
function summaryOf(tags: AgentStatuses | null, snapshot: OfficeSnapshot): string | null {
  if (!tags) return null;
  const drawn = new Set(snapshot.roster.map((a) => a.uid));
  return officeSummary(
    Object.entries(tags.agents).map(([uid, status]) => ({ name: uid, state: stateOf(status)?.state ?? null, drawn: drawn.has(uid) })),
    appLocale(),
  );
}

/** A team that is off: the core seats are empty, the agents of the last 24 hours stay (office/data/load.ts). */
function teamOffMessage(agents: number): string {
  const t = officeText();
  return agents === 0 ? t.teamOffEmpty : t.teamOffRecent;
}

/** What the panels get over an existing team's VPS: the cloud is never asked, and a use of it is a failure. */
const NO_CLOUD = new Proxy({} as PanelClient, {
  get: (_, key) => {
    throw new Error(`the cloud is not read over an existing team's VPS (${String(key)})`);
  },
});

function Notice({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <p
      role={alert ? "alert" : "status"}
      className="max-w-6xl mx-auto px-5 pt-8 text-[12px]"
      style={{ color: alert ? "var(--color-red)" : "var(--color-muted)" }}
    >
      {children}
    </p>
  );
}
