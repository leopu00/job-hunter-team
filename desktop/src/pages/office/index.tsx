import { useEffect, useRef, useState } from "react";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import type { AgentStatuses, OfficeClick, OfficeEngine, OfficeScene, OfficeSnapshot, Vec } from "../../office/contract";
import OfficePanel from "../../office/panel/OfficePanel";
import OfficeTooltip from "../../office/panel/OfficeTooltip";
import { emptyEngine, loadAssets, loadParts, type OfficeAssets, type OfficeParts } from "../../office/parts";
import { loadAgentStatuses } from "../../office/status";
import { supabase } from "../../lib/supabase";
import { navigate, useRefresh } from "../../shell/router";
import type { PageProps } from "../types";

/** How often the office reads the cloud again: the team pushes about this often. */
export const SNAPSHOT_EVERY_MS = 20_000;

type Ready = { assets: OfficeAssets; parts: OfficeParts };
type Load = { state: "loading" } | { state: "ready"; ready: Ready } | { state: "no-assets" } | { state: "failed" };

/**
 * /office: the team's office, as in the Godot game (D05). The page loads the
 * assets and the engine, mounts the PixiJS scene, and every SNAPSHOT_EVERY_MS
 * reads the cloud and hands the engine what changed. A click opens a panel
 * INSIDE the office (D07: agents, piles, departments, the CV shelf and the
 * printer, the corkboard, the hologram), the pointer shows a tag; only the
 * panel's secondary links change page.
 */
export default function OfficePage(_props: PageProps) {
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
  return <Office ready={load.ready} />;
}

function Office({ ready }: { ready: Ready }) {
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
  const [status, setStatus] = useState<string | null>(null);
  const { assets, parts } = ready;

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
          onClick: (click) => setPanel(click),
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
  }, [assets, parts]);

  // The data: a snapshot now and then, the difference to the engine.
  const prev = useRef<OfficeSnapshot | null>(null);
  const read = useRef<() => void>(() => {});
  read.current = () => {
    if (!parts.data) return;
    const data = parts.data;
    // The tags' statuses in a query of their own: its failure costs the tags, not the office.
    const statuses = loadAgentStatuses(supabase);
    data
      .load(supabase)
      .then(async (next) => {
        const engine = engineRef.current;
        if (!engine) return;
        for (const event of data.diff(prev.current, next)) engine.apply(event);
        prev.current = next;
        setSnapshot(next);
        setStatus(next.teamOnline === false ? "Il team è spento: l'ufficio è vuoto." : null);
        // a team that is not online has no present status to show
        showStatuses(next.teamOnline ? await statuses : null);
      })
      .catch(() => {
        showStatuses(null);
        setStatus("Non riesco a leggere il cloud: l'ufficio resta com'era.");
      });
  };
  useEffect(() => {
    if (!parts.data) {
      setStatus("I dati dell'ufficio non sono ancora collegati: nessun agente in scena.");
      return;
    }
    read.current();
    const id = window.setInterval(() => read.current(), SNAPSHOT_EVERY_MS);
    return () => window.clearInterval(id);
  }, [parts.data]);
  useRefresh(() => read.current());

  // Esc closes the panel, as the Godot office's overlays.
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  return (
    // the shell gives the office the whole window under the navbar (Route.fullBleed)
    <div className="relative h-full" data-testid="office-page">
      <div ref={host} className="absolute inset-0" data-testid="office-canvas" />
      {status && (
        <p
          role="status"
          className="absolute left-4 top-4 m-0 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-[11px] text-[var(--color-muted)]"
        >
          {status}
        </p>
      )}
      {hover && !panel && (
        <OfficeTooltip target={hover.target} at={hover.at} layout={assets.layout} snapshot={snapshot} statuses={statuses} />
      )}
      {panel && (
        <OfficePanel
          target={panel}
          layout={assets.layout}
          snapshot={snapshot}
          statuses={statuses}
          client={supabase}
          onClose={() => setPanel(null)}
          onOpen={setPanel}
          onNavigate={navigate}
        />
      )}
    </div>
  );
}

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
