"use client";

import { useEffect, useRef, useState } from "react";
import HeroGlobe from "./HeroGlobe";

const NODES = {
  bridge: { emoji: "📡", name: "Bridge", color: "#26c6da" },
  sentinel: { emoji: "💂", name: "Sentinel", color: "#9c27b0" },
  captain: { emoji: "👨‍✈️", name: "Captain", color: "#ff9100" },
  pacing: { emoji: "⏱️", name: "Pacing", color: "#26c6da" },
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
  bridgePath: ArrowPath | null;
  sentinelToCaptainPath: ArrowPath | null;
  pacingPath: ArrowPath | null;
  captainPaths: ArrowPath[];
  chainPaths: ArrowPath[];
  dbPaths: ArrowPath[];
};

const PIPELINE: NodeId[] = ["scout", "analyst", "scorer", "writer", "critic"];

// Pattern stocastici: invece di uno script rigido, ogni "tick" del demo
// loop sceglie a caso quali eventi far partire, con jitter sui tempi.
// Risultato: simulazione organica con sovrapposizioni casuali, non una
// staffetta lineare. Alcuni pattern hanno catene causali interne (es.
// quando Scout trova → forwarda all'Analyst con delay variabile).

const PX_PER_SEC = 220;
const MIN_DURATION_MS = 700;

export default function BetaTeamFlow() {
  const flowRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<HTMLSpanElement | null>(null);
  const sentinelRef = useRef<HTMLSpanElement | null>(null);
  const captainEmojiRef = useRef<HTMLSpanElement | null>(null);
  const captainNameRef = useRef<HTMLSpanElement | null>(null);
  const pacingRef = useRef<HTMLSpanElement | null>(null);
  const pipelineRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const globeSlotRef = useRef<HTMLDivElement | null>(null);

  const [overlay, setOverlay] = useState<OverlayState>({
    width: 0,
    height: 0,
    bridgePath: null,
    sentinelToCaptainPath: null,
    pacingPath: null,
    captainPaths: [],
    chainPaths: [],
    dbPaths: [],
  });

  const [messages, setMessages] = useState<
    Array<{ key: number; pathId: string; color: string; durationMs: number; reverse?: boolean }>
  >([]);
  const animKey = useRef(0);
  const [inView, setInView] = useState(false);

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

        const bridgeRect = rectOf(bridgeRef.current);
        const sentinelRect = rectOf(sentinelRef.current);
        const captainRect = rectOf(captainEmojiRef.current);
        const captainNameRect = rectOf(captainNameRef.current);
        const pacingRect = rectOf(pacingRef.current);

        const horiz = (a: DOMRect, b: DOMRect, id: string): ArrowPath => {
          const sX = a.right - fr.left + 6;
          const eX = b.left - fr.left - 6;
          const y = a.top + a.height / 2 - fr.top;
          return { id, d: `M ${sX} ${y} L ${eX} ${y}` };
        };

        const bridgePath =
          bridgeRect && sentinelRect
            ? horiz(bridgeRect, sentinelRect, "bridge-to-sentinel")
            : null;
        const sentinelToCaptainPath =
          sentinelRect && captainRect
            ? horiz(sentinelRect, captainRect, "sentinel-to-captain")
            : null;

        // Pacing → Captain: pacing è alla destra del captain, freccia va
        // da sinistra del pacing verso destra del captain.
        let pacingPath: ArrowPath | null = null;
        if (pacingRect && captainRect) {
          const sX = pacingRect.left - fr.left - 6;
          const eX = captainRect.right - fr.left + 6;
          const y = pacingRect.top + pacingRect.height / 2 - fr.top;
          pacingPath = { id: "pacing-to-captain", d: `M ${sX} ${y} L ${eX} ${y}` };
        }

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

        // I path "verso il DB" ora puntano al top del globo (renderizzato
        // subito sotto la rosa nello stesso pin section). Tutti convergono
        // a un singolo punto centrato sotto la pipeline.
        const dbPaths: ArrowPath[] = [];
        const lowestY = pipelineRects.reduce((acc, r) => {
          if (!r) return acc;
          const bottom = r.bottom - fr.top;
          return Math.max(acc, bottom);
        }, 0);
        // Globo renderizzato come figlio di questo stesso flow → ref
        // diretto, no querySelector, no polling. La sfera MapLibre a
        // zoom 2.2 fitta ~77% del canvas quadrato → top sfera = canvas
        // top + 11.5% canvas height.
        // Canvas globo ora rapporto 1/0.7 → sfera MapLibre fitta l'altezza
        // del canvas. Convergence = canvas top + piccolo offset (~5% canvas
        // height) per cadere precisamente sul perimetro visibile della sfera.
        let convergeY = lowestY + 200;
        const slot = globeSlotRef.current;
        if (slot) {
          const gr = slot.getBoundingClientRect();
          convergeY = gr.top - fr.top + gr.height * 0.05;
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
          bridgePath,
          sentinelToCaptainPath,
          pacingPath,
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
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const node = flowRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setInView(e.isIntersecting);
      },
      { threshold: 0.1 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  // Senza pin section, attivita' a livello medio costante (~0.5).
  // Se c'e' un [data-pin-section] ancestrale, traccia lo scroll progress
  // per scalare l'intensita' (legacy hook).
  const progressRef = useRef(0.5);
  useEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    const sec = flow.closest("[data-pin-section]") as HTMLElement | null;
    if (!sec) return;
    const onScroll = () => {
      const rect = sec.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) {
        progressRef.current = 0.5;
        return;
      }
      progressRef.current = Math.max(0, Math.min(1, -rect.top / total));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Demo loop stocastico: ogni tick decide casualmente quali pattern
  // attivare, con jitter sui tempi → simulazione organica, non staffetta.
  useEffect(() => {
    if (!inView) return;
    if (overlay.width === 0) return;
    const timers: number[] = [];
    let cancelled = false;

    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    const schedule = (delayMs: number, fn: () => void) => {
      const t = window.setTimeout(() => {
        if (!cancelled) fn();
      }, delayMs);
      timers.push(t);
    };

    const MAX_CONCURRENT = 8;
    let active = 0;
    const pushAnim = (pathId: string, color: string, reverse?: boolean) => {
      if (active >= MAX_CONCURRENT) return;
      const el =
        typeof document !== "undefined"
          ? (document.getElementById(pathId) as unknown as SVGPathElement | null)
          : null;
      const len = el?.getTotalLength?.() ?? 220;
      const durationMs = Math.max(
        MIN_DURATION_MS,
        Math.round((len / PX_PER_SEC) * 1000),
      );
      const key = ++animKey.current;
      active++;
      setMessages((prev) => [...prev, { key, pathId, color, durationMs, reverse }]);
      schedule(durationMs + 400, () => {
        active = Math.max(0, active - 1);
        setMessages((prev) => prev.filter((m) => m.key !== key));
      });
    };

    // Ogni agente ha il suo loop indipendente → girano in parallelo.
    // L'intervallo si accorcia col progress: a inizio pin sono pigri, a
    // fine pin lavorano tutti insieme rapidamente.
    type LoopFn = () => void;
    const loops: Array<{ baseMin: number; baseMax: number; fn: LoopFn }> = [
      {
        // Scout: scova nuove offerte → DB → passa ad Analyst
        baseMin: 5000,
        baseMax: 9000,
        fn: () => {
          pushAnim("db-from-scout", NODES.scout.color);
          schedule(rand(300, 1100), () =>
            pushAnim("chain-scout-to-analyst", NODES.scout.color),
          );
          if (Math.random() < 0.35) {
            schedule(rand(700, 1800), () =>
              pushAnim("captain-to-scout", NODES.scout.color, true),
            );
          }
        },
      },
      {
        // Analyst: valuta fit
        baseMin: 6000,
        baseMax: 10000,
        fn: () => {
          pushAnim("db-from-analyst", NODES.analyst.color);
          schedule(rand(300, 1100), () =>
            pushAnim("chain-analyst-to-scorer", NODES.analyst.color),
          );
          if (Math.random() < 0.3) {
            schedule(rand(700, 2000), () =>
              pushAnim("captain-to-analyst", NODES.analyst.color, true),
            );
          }
        },
      },
      {
        // Scorer: assegna priorità
        baseMin: 7000,
        baseMax: 11000,
        fn: () => {
          pushAnim("db-from-scorer", NODES.scorer.color);
          schedule(rand(300, 1100), () =>
            pushAnim("chain-scorer-to-writer", NODES.scorer.color),
          );
          if (Math.random() < 0.25) {
            schedule(rand(700, 2000), () =>
              pushAnim("captain-to-scorer", NODES.scorer.color, true),
            );
          }
        },
      },
      {
        // Writer: prepara CV/cover, riceve feedback dal Critic
        baseMin: 8000,
        baseMax: 13000,
        fn: () => {
          pushAnim("db-from-writer", NODES.writer.color);
          schedule(rand(500, 1300), () =>
            pushAnim("chain-writer-to-critic", NODES.writer.color),
          );
          if (Math.random() < 0.5) {
            schedule(rand(1000, 2200), () =>
              pushAnim("chain-writer-to-critic", NODES.critic.color, true),
            );
          }
          if (Math.random() < 0.3) {
            schedule(rand(900, 2200), () =>
              pushAnim("captain-to-writer", NODES.writer.color, true),
            );
          }
        },
      },
      {
        // Captain: invia ordini casuali a un agent pipeline
        baseMin: 9000,
        baseMax: 15000,
        fn: () => {
          const targets: NodeId[] = ["scout", "analyst", "scorer", "writer"];
          const t = targets[Math.floor(Math.random() * targets.length)];
          pushAnim(`captain-to-${t}`, NODES.captain.color);
        },
      },
      {
        // Bridge tick (poll budget) → eventuale alert Sentinel→Captain
        baseMin: 12000,
        baseMax: 18000,
        fn: () => {
          pushAnim("bridge-to-sentinel", NODES.bridge.color);
          if (Math.random() < 0.4) {
            schedule(rand(700, 1700), () =>
              pushAnim("sentinel-to-captain", NODES.sentinel.color),
            );
          }
        },
      },
      {
        // Pacing tick: report al Captain
        baseMin: 15000,
        baseMax: 25000,
        fn: () => {
          pushAnim("pacing-to-captain", NODES.pacing.color);
        },
      },
    ];

    // Avvia tutti i loop con offset di partenza sfalsato così non
    // emettono tutti al primo istante.
    loops.forEach((loop) => {
      const runOnce = () => {
        if (cancelled) return;
        const p = progressRef.current;
        // Intervallo scalato col progress: a p=1 scende al 55% del base.
        const scale = 1 - 0.45 * p;
        const minD = loop.baseMin * scale;
        const maxD = loop.baseMax * scale;
        // Skip alto sempre: 70% inizio → 30% fine.
        const skipProb = 0.7 - 0.4 * p;
        if (Math.random() >= skipProb) loop.fn();
        schedule(rand(minD, maxD), runOnce);
      };
      schedule(rand(0, 5000), runOnce);
    });
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
      setMessages([]);
    };
  }, [inView, overlay.width]);

  // Callback ref che fa beginElement() sul nodo SMIL appena entra nel DOM.
  // WeakSet previene riavvii in caso di re-render React.
  const startedRef = useRef<WeakSet<SVGAnimateMotionElement>>(new WeakSet());
  const beginAnim = (el: SVGAnimateMotionElement | null) => {
    if (!el || startedRef.current.has(el)) return;
    startedRef.current.add(el);
    requestAnimationFrame(() => {
      try {
        el.beginElement();
      } catch {}
    });
  };

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

          {overlay.bridgePath && (
            <path
              id={overlay.bridgePath.id}
              d={overlay.bridgePath.d}
              fill="none"
              stroke="var(--color-muted)"
              strokeWidth="1.75"
              strokeLinecap="round"
              markerStart="url(#beta-arrowhead)"
              markerEnd="url(#beta-arrowhead)"
              strokeDasharray="4 8"
            />
          )}
          {overlay.sentinelToCaptainPath && (
            <path
              id={overlay.sentinelToCaptainPath.id}
              d={overlay.sentinelToCaptainPath.d}
              fill="none"
              stroke="var(--color-muted)"
              strokeWidth="1.75"
              strokeLinecap="round"
              markerStart="url(#beta-arrowhead)"
              markerEnd="url(#beta-arrowhead)"
              strokeDasharray="4 8"
            />
          )}
          {overlay.pacingPath && (
            <path
              id={overlay.pacingPath.id}
              d={overlay.pacingPath.d}
              fill="none"
              stroke="var(--color-muted)"
              strokeWidth="1.75"
              strokeLinecap="round"
              markerStart="url(#beta-arrowhead)"
              markerEnd="url(#beta-arrowhead)"
              strokeDasharray="4 8"
            />
          )}
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

          {messages.map(({ key, pathId, color, durationMs, reverse }) => {
            const motionProps = reverse
              ? { keyPoints: "1;0", keyTimes: "0;1" }
              : {};
            return (
              <g key={key}>
                <circle cx="0" cy="0" r="9" fill={color} opacity="0.28">
                  <animateMotion
                    ref={beginAnim}
                    dur={`${durationMs}ms`}
                    begin="indefinite"
                    repeatCount="1"
                    fill="freeze"
                    calcMode="linear"
                    {...motionProps}
                  >
                    <mpath href={`#${pathId}`} xlinkHref={`#${pathId}`} />
                  </animateMotion>
                </circle>
                <circle cx="0" cy="0" r="3.4" fill={color}>
                  <animateMotion
                    ref={beginAnim}
                    dur={`${durationMs}ms`}
                    begin="indefinite"
                    repeatCount="1"
                    fill="freeze"
                    calcMode="linear"
                    {...motionProps}
                  >
                    <mpath href={`#${pathId}`} xlinkHref={`#${pathId}`} />
                  </animateMotion>
                </circle>
              </g>
            );
          })}
        </svg>
      )}

      {/* Top row: Bridge | Sentinel | Captain | Pacing */}
      <div className="grid grid-cols-5 justify-items-center items-end">
        <div className="col-start-1">
          {renderNode("bridge", bridgeRef)}
        </div>
        <div className="col-start-2">
          {renderNode("sentinel", sentinelRef)}
        </div>
        <div className="col-start-3 -translate-y-3 md:-translate-y-4">
          {renderNode("captain", captainEmojiRef, "", captainNameRef)}
        </div>
        <div className="col-start-4">
          {renderNode("pacing", pacingRef)}
        </div>
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

      {/* Globo renderizzato come figlio del flow: stesso coordinate space
          dei path SVG, no querySelector/polling cross-component. */}
      <div ref={globeSlotRef} className="mt-32">
        <HeroGlobe />
      </div>
    </div>
  );
}
