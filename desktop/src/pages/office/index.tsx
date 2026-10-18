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
import { loadAgentStatuses } from "../../office/status";
import { appLocale } from "../../lib/app-locale";
import { useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";
import { readTeamStatus } from "../../lib/existing-team-status";
import { officeFromTeamProbe } from "../../office/readonly";
import { readVpsPiles } from "../../office/panel/vps-panels";
import { supabase } from "../../lib/supabase";
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
        setLoad(assets ? { state: "ready", ready: { assets, parts } } : { state: "no-assets" });
      })
      .catch((error: unknown) => {
        console.error("[office] load failed:", error);
        if (live) setLoad({ state: "failed" });
      });
    return () => {
      live = false;
    };
  }, []);

  if (load.state === "loading") return <DashboardSkeleton label="Caricamento ufficio" />;
  if (load.state === "no-assets") return <Notice>L'arte dell'ufficio non è ancora nell'app.</Notice>;
  if (load.state === "failed")
    return <Notice alert>Non riesco a caricare l'ufficio. Premi «Aggiorna» o riapri la pagina.</Notice>;
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
  const { assets, parts } = ready;
  // A click or a key on the office. Over an existing team's VPS an agent has no panel (its moves
  // are not in what the VPS reports): a speech bubble over it says so, never a panel with nothing in it.
  const openPanel = (click: OfficeClick | null, button?: HTMLButtonElement) => {
    if (click && source === "team-probe" && click.kind === "agent") {
      engineRef.current?.apply({ type: "say", uid: click.uid, text: EXISTING_TEAM_READONLY_TEXT[appLocale()].officeAgentNoMoves, seconds: 8 });
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
        setStatus("La scena non parte: questa finestra non ha WebGL.");
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
    const statuses = loadAgentStatuses(supabase);
    try {
      const next = await data.load(supabase);
      if (!engineRef.current) return;
      live.current ??= createLiveOffice(data.diff, applyEvent);
      live.current.snapshot(next);
      setSnapshot(next);
      setStatus(next.teamOnline === false ? teamOffMessage(next.roster.length) : null);
      // a team that is not online has no present status to show
      showStatuses(next.teamOnline ? await statuses : null);
    } catch {
      showStatuses(null);
      setStatus("Non riesco a leggere il cloud: l'ufficio resta com'era.");
    }
  };
  useEffect(() => {
    if (source !== "cloud") return;
    if (!parts.data) {
      setStatus("I dati dell'ufficio non sono ancora collegati: nessun agente in scena.");
      return;
    }
    const motion = watchReducedMotion((r) => {
      reduced.current = r;
    });
    reduced.current = motion.reduced();
    const s = createReadScheduler(() => read.current());
    scheduler.current = s;
    const unsubscribe = subscribeOffice(supabase, {
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
  const readOnly = useExistingTeamReadOnly();
  const connection = readOnly?.connection ?? null;
  const reading = useRef<Awaited<ReturnType<typeof readTeamStatus>>>({ kind: "unknown" });
  // the piles' counts from the team's positions, read with the probe while the container is up
  const probePiles = useRef<Piles | null>(null);
  const probeRead = useRef(0);
  const showProbe = () => {
    if (!parts.data || !engineRef.current) return;
    const office = officeFromTeamProbe(reading.current, connection, appLocale(), probePiles.current);
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
    if (result.kind === "read" && result.fields.containerRunning) {
      const piles = await readVpsPiles();
      if (probeRead.current !== mine) return;
      probePiles.current = piles;
    }
    probeShow.current();
  };
  const probeShow = useRef(showProbe);
  probeShow.current = showProbe;
  useEffect(() => {
    if (source !== "team-probe") return;
    if (!parts.data) {
      setStatus("I dati dell'ufficio non sono ancora collegati: nessun agente in scena.");
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
    // the shell gives the office the whole window under the navbar (Route.fullBleed)
    <div className="relative h-full" data-testid="office-page">
      <div ref={host} className="absolute inset-0" data-testid="office-canvas" />
      {status && (
        <p
          role={statusIsAlert ? "alert" : "status"}
          className="absolute left-4 top-4 m-0 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-[11px] text-[var(--color-muted)]"
        >
          {status}
        </p>
      )}
      <OfficeKeyboard
        targets={targets}
        label={label}
        onFocusTarget={focusTarget}
        onOpen={(t, button) => openPanel(t, button)}
      />
      {tag && !panel && <OfficeTooltip target={tag.target} at={tag.at} layout={assets.layout} snapshot={snapshot} statuses={statuses} />}
      {panel && (
        <OfficePanel
          target={panel}
          layout={assets.layout}
          snapshot={snapshot}
          statuses={statuses}
          client={source === "cloud" ? supabase : NO_CLOUD}
          source={source === "cloud" ? "cloud" : "vps"}
          onClose={() => setPanel(null)}
          onOpen={setPanel}
          onNavigate={navigate}
        />
      )}
    </div>
  );
}

/** A team that is off: the core seats are empty, the agents of the last 24 hours stay (office/data/load.ts). */
function teamOffMessage(agents: number): string {
  return agents === 0 ? "Il team è spento: l'ufficio è vuoto." : "Il team è spento: restano gli agenti che hanno lavorato nelle ultime 24 ore.";
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
