"use client";

import { useEffect, useRef, useState } from "react";
import HeroGlobe from "./HeroGlobe";

const NODES = {
  captain: { emoji: "👨‍✈️", name: "Captain", color: "#ff9100" },
  scout: { emoji: "🕵️", name: "Scout", color: "#2196f3" },
  analyst: { emoji: "👨‍🔬", name: "Analyst", color: "#00e676" },
  scorer: { emoji: "👨‍💻", name: "Scorer", color: "#b388ff" },
  writer: { emoji: "👨‍🏫", name: "Writer", color: "#ffd600" },
  critic: { emoji: "👨‍⚖️", name: "Critic", color: "#f44336" },
  db: { emoji: "🗄️", name: "DB", color: "#7f9cf5" },
} as const;

type NodeId = keyof typeof NODES;

type ArrowPath = { id: string; d: string };

type OverlayState = {
  width: number;
  height: number;
  captainPaths: ArrowPath[];
  chainPaths: ArrowPath[];
  dbPaths: ArrowPath[];
};

const PIPELINE: NodeId[] = ["scout", "analyst", "scorer", "writer", "critic"];

// Le pallaine sono scroll-driven puro: posizione = path.getPointAtLength
// (progress * length). Niente timer, niente loop temporali.

export default function BetaTeamFlow() {
  const flowRef = useRef<HTMLDivElement | null>(null);
  const captainEmojiRef = useRef<HTMLSpanElement | null>(null);
  const captainNameRef = useRef<HTMLSpanElement | null>(null);
  const pipelineRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const globeSlotRef = useRef<HTMLDivElement | null>(null);

  const [overlay, setOverlay] = useState<OverlayState>({
    width: 0,
    height: 0,
    captainPaths: [],
    chainPaths: [],
    dbPaths: [],
  });

  type Message = {
    key: number;
    pathId: string;
    color: string;
    progress: number; // ∈ (0, 1) — one-way mittente → destinatario
    totalLength: number;
  };
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const flow = flowRef.current;
        if (!flow) return;
        const fr = flow.getBoundingClientRect();
        const rectOf = (el: HTMLElement | null) =>
          el ? el.getBoundingClientRect() : null;

        const captainNameRect = rectOf(captainNameRef.current);

        // Captain → pipeline (skip Critic come in team/v2: il Capitano non
        // gli ordina direttamente, riceve solo feedback indiretto).
        const captainPaths: ArrowPath[] = [];
        const pipelineRects = pipelineRefs.current.map((n) => rectOf(n));
        if (captainNameRect) {
          const startX = captainNameRect.left + captainNameRect.width / 2 - fr.left;
          const startY = captainNameRect.bottom - fr.top + 6;
          pipelineRects.forEach((rect, idx) => {
            if (!rect || idx === 4) return;
            const endX = rect.left + rect.width / 2 - fr.left;
            const endY = rect.top - fr.top - 6;
            captainPaths.push({
              id: `captain-to-${PIPELINE[idx]}`,
              d: `M ${startX} ${startY} L ${endX} ${endY}`,
            });
          });
        }

        const chainPaths: ArrowPath[] = [];
        for (let i = 0; i < pipelineRects.length - 1; i++) {
          const a = pipelineRects[i];
          const b = pipelineRects[i + 1];
          if (!a || !b) continue;
          const sX = a.right - fr.left + 6;
          const eX = b.left - fr.left - 6;
          const y = a.top + a.height / 2 - fr.top;
          chainPaths.push({
            id: `chain-${PIPELINE[i]}-to-${PIPELINE[i + 1]}`,
            d: `M ${sX} ${y} L ${eX} ${y}`,
          });
        }

        // I path "verso il DB" puntano al perimetro top visibile del
        // globo, esposto da HeroGlobe via l'anchor [data-sphere-top]
        // (posizione computata con map.project del polo nord). Fallback:
        // 11.5% dell'altezza del wrap (geometria nominale a zoom 2.2,
        // canvas quadrato).
        const dbPaths: ArrowPath[] = [];
        const lowestY = pipelineRects.reduce((acc, r) => {
          if (!r) return acc;
          const bottom = r.bottom - fr.top;
          return Math.max(acc, bottom);
        }, 0);
        let convergeY = lowestY + 200;
        const slot = globeSlotRef.current;
        if (slot) {
          const anchor = slot.querySelector(
            "[data-sphere-top]",
          ) as HTMLElement | null;
          if (anchor) {
            const ar = anchor.getBoundingClientRect();
            convergeY = ar.top + ar.height / 2 - fr.top;
          } else {
            const gr = slot.getBoundingClientRect();
            convergeY = gr.top - fr.top + gr.height * 0.115;
          }
        }
        const convergeX = fr.width / 2;
        pipelineRects.forEach((rect, idx) => {
          if (!rect) return;
          const sX = rect.left + rect.width / 2 - fr.left;
          const sY = rect.bottom - fr.top + 6;
          dbPaths.push({
            id: `db-from-${PIPELINE[idx]}`,
            d: `M ${sX} ${sY} L ${convergeX} ${convergeY}`,
          });
        });

        setOverlay({
          width: Math.round(fr.width),
          height: Math.round(fr.height),
          captainPaths,
          chainPaths,
          dbPaths,
        });
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    if (flowRef.current) ro.observe(flowRef.current);
    if (globeSlotRef.current) ro.observe(globeSlotRef.current);
    window.addEventListener("resize", measure);

    // L'anchor [data-sphere-top] del globo cambia solo style.top (la
    // dimensione resta 1×1px), quindi il ResizeObserver non scatta.
    // Osservo l'attributo style per rimisurare quando MapLibre ridipinge.
    let mo: MutationObserver | null = null;
    const slot = globeSlotRef.current;
    if (slot && typeof MutationObserver !== "undefined") {
      const anchor = slot.querySelector("[data-sphere-top]");
      if (anchor) {
        mo = new MutationObserver(measure);
        mo.observe(anchor, { attributes: true, attributeFilter: ["style"] });
      }
    }

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Sequenza fissa: una pallina alla volta, scrubbing su scrollY.
  // Step i attivo per T ∈ (i*DURATION, (i+1)*DURATION). A progress
  // esattamente 0 o 1 non renderizziamo nulla (evita pallino fermo).
  useEffect(() => {
    if (overlay.width === 0) return;

    const SEQUENCE: Array<{ pathId: string; nodeKey: NodeId }> = [
      { pathId: "captain-to-scout", nodeKey: "captain" },
      { pathId: "db-from-scout", nodeKey: "scout" },
      { pathId: "captain-to-analyst", nodeKey: "captain" },
      { pathId: "db-from-analyst", nodeKey: "analyst" },
      { pathId: "captain-to-scorer", nodeKey: "captain" },
      { pathId: "db-from-scorer", nodeKey: "scorer" },
      { pathId: "captain-to-writer", nodeKey: "captain" },
      { pathId: "db-from-writer", nodeKey: "writer" },
      { pathId: "chain-writer-to-critic", nodeKey: "writer" },
    ];
    const DURATION = 220;

    const sec = flowRef.current?.closest(
      "[data-pin-section]",
    ) as HTMLElement | null;

    // Lo sticky in LandingHero è `top: 5rem` per stare sotto la nav,
    // quindi T deve partire da 0 quando il pin section top raggiunge
    // 80px (5rem) sotto il viewport top, non 0.
    const STICKY_TOP_OFFSET_PX = 80;

    const recompute = () => {
      const rectTop = sec ? sec.getBoundingClientRect().top : 0;
      // T = quanti px il pin ha scrollato OLTRE il punto di aggancio
      // dello sticky. = max(0, sticky_top_offset - rect.top).
      const T = Math.max(0, STICKY_TOP_OFFSET_PX - rectTop);

      const i = Math.floor(T / DURATION);
      if (i < 0 || i >= SEQUENCE.length) {
        setMessages([]);
        return;
      }
      const progress = (T - i * DURATION) / DURATION;
      // Bug fix: skip i frame "fermi" all'origine (progress=0) e
      // all'arrivo (progress=1). Sennò a scrollY=0 una pallina resta
      // visibile e ferma sotto l'agente di partenza.
      if (progress <= 0 || progress >= 1) {
        setMessages([]);
        return;
      }
      const step = SEQUENCE[i];
      const el = document.getElementById(
        step.pathId,
      ) as unknown as SVGPathElement | null;
      const totalLength = el?.getTotalLength?.() ?? 220;
      setMessages([
        {
          key: i,
          pathId: step.pathId,
          color: NODES[step.nodeKey].color,
          progress,
          totalLength,
        },
      ]);
    };

    recompute();
    window.addEventListener("scroll", recompute, { passive: true });
    return () => {
      window.removeEventListener("scroll", recompute);
      setMessages([]);
    };
  }, [overlay.width]);

  const renderNode = (
    nodeId: NodeId,
    ref: React.RefObject<HTMLSpanElement | null>,
    extraClass = "",
    nameRef?: React.RefObject<HTMLSpanElement | null>,
  ) => {
    const n = NODES[nodeId];
    return (
      <div
        className={`relative inline-flex select-none flex-col items-center gap-2 shrink-0 ${extraClass}`}
      >
        <span
          ref={ref}
          className="text-3xl md:text-4xl leading-none"
          aria-hidden="true"
        >
          {n.emoji}
        </span>
        <span
          ref={nameRef}
          className="text-[11px] md:text-[12px] font-semibold tracking-wide text-[var(--color-bright)] text-center"
        >
          {n.name}
        </span>
      </div>
    );
  };

  return (
    <div
      ref={flowRef}
      className="relative mx-auto w-full max-w-[1080px]"
    >
      {overlay.width > 0 && overlay.height > 0 && (
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${overlay.width} ${overlay.height}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ overflow: "visible" }}
        >
          <defs>
            <marker
              id="beta-arrowhead"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 Z" fill="var(--color-muted)" />
            </marker>
          </defs>

          {overlay.captainPaths.map((p) => (
            <path
              key={p.id}
              id={p.id}
              d={p.d}
              fill="none"
              stroke="var(--color-muted)"
              strokeWidth="1.75"
              strokeLinecap="round"
              markerStart="url(#beta-arrowhead)"
              markerEnd="url(#beta-arrowhead)"
              strokeDasharray="4 8"
            />
          ))}
          {overlay.chainPaths.map((p) => (
            <path
              key={p.id}
              id={p.id}
              d={p.d}
              fill="none"
              stroke="var(--color-dim)"
              strokeWidth="1.35"
              strokeLinecap="round"
              markerStart="url(#beta-arrowhead)"
              markerEnd="url(#beta-arrowhead)"
              strokeDasharray="4 8"
            />
          ))}
          {overlay.dbPaths.map((p) => (
            <path
              key={p.id}
              id={p.id}
              d={p.d}
              fill="none"
              stroke="var(--color-border-glow)"
              strokeWidth="1.25"
              strokeLinecap="round"
              markerStart="url(#beta-arrowhead)"
              markerEnd="url(#beta-arrowhead)"
              strokeDasharray="3 6"
            />
          ))}

          {messages.map(({ key, pathId, color, progress, totalLength }) => {
            // One-way: pallina dal mittente (0) al destinatario (length).
            const len = progress * totalLength;
            const el =
              typeof document !== "undefined"
                ? (document.getElementById(
                    pathId,
                  ) as unknown as SVGPathElement | null)
                : null;
            if (!el) return null;
            let pt: { x: number; y: number };
            try {
              pt = el.getPointAtLength(len);
            } catch {
              return null;
            }
            return (
              <g key={key} transform={`translate(${pt.x} ${pt.y})`}>
                <circle r="9" fill={color} opacity="0.28" />
                <circle r="3.4" fill={color} />
              </g>
            );
          })}
        </svg>
      )}

      {/* Top row: solo Captain, centrato sopra la pipeline */}
      <div className="flex justify-center items-end">
        {renderNode("captain", captainEmojiRef, "", captainNameRef)}
      </div>

      {/* Pipeline row */}
      <div className="grid grid-cols-5 justify-items-center items-start mt-24">
        {PIPELINE.map((nodeId, idx) => (
          <div key={nodeId}>
            <div className="relative inline-flex select-none flex-col items-center gap-2 shrink-0 min-w-[72px]">
              <span
                ref={(node) => {
                  pipelineRefs.current[idx] = node;
                }}
                className="text-3xl md:text-4xl leading-none"
                aria-hidden="true"
              >
                {NODES[nodeId].emoji}
              </span>
              <span className="text-[11px] md:text-[12px] font-semibold tracking-wide text-[var(--color-bright)] text-center">
                {NODES[nodeId].name}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Globo come figlio del flow: stesso coordinate space dei path
          SVG, niente querySelector cross-component per la convergenza
          (l'anchor [data-sphere-top] esposto da HeroGlobe vive qui
          dentro). Durante il pin l'inquadratura mostra il team sopra
          il globo; quando lo scroll esce dal pin, il globo scivola in
          alto e diventa il focus. */}
      <div ref={globeSlotRef} className="mt-32">
        <HeroGlobe />
      </div>
    </div>
  );
}
