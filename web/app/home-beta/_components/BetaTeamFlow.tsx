"use client";

import { useEffect, useRef, useState } from "react";
import HeroGlobe from "./HeroGlobe";
import { LUXURY_POSITIONS } from "../_data/luxuryPositions";

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
  // Colore di ciascuno dei 24 pin sul globo. null = pin invisibile.
  // Round 1 (pin 0-13): pipeline completa Scout → Analyst → Scorer →
  //   Writer. Ogni step DB tinge i 14 pin nord sequenzialmente.
  // Round 2 (pin 14-23): Scout trova 10 nuove offerte globali (incluso
  //   emisfero sud), il globo continua a girare per centrarle.
  const PIN_COUNT = 24;
  const [pinColors, setPinColors] = useState<(string | null)[]>(() =>
    Array(PIN_COUNT).fill(null),
  );
  // Longitudine corrente del centro del globo. Interpolata in funzione
  // di T tra le longitudini dei pin che vengono toccati in sequenza.
  // La latitudine resta fissa nel HeroGlobe (~20°) per non distorcere
  // la proiezione globe a lat estreme (London 51° → vista polo nord).
  const [globeLon, setGlobeLon] = useState<number>(
    LUXURY_POSITIONS[0]?.lon ?? 10,
  );

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

  // Sequenza fissa, scrubbing su scrollY. Ogni step ha:
  //   - pathId / nodeKey
  //   - count: quante palline emettere (default 1). Le palline sono
  //     SEQUENZIALI: pallina k parte solo quando pallina k-1 è arrivata
  //     a destinazione (no raffica). Durata totale step = count*DURATION.
  useEffect(() => {
    if (overlay.width === 0) return;

    const SEQUENCE: Array<{
      pathId: string;
      nodeKey: NodeId;
      count?: number;
    }> = [
      // Round 1: pipeline completa sui primi 14 pin (nord).
      { pathId: "captain-to-scout", nodeKey: "captain" },
      { pathId: "db-from-scout", nodeKey: "scout", count: 14 },
      { pathId: "captain-to-analyst", nodeKey: "captain" },
      { pathId: "db-from-analyst", nodeKey: "analyst", count: 14 },
      { pathId: "captain-to-scorer", nodeKey: "captain" },
      { pathId: "db-from-scorer", nodeKey: "scorer", count: 14 },
      { pathId: "captain-to-writer", nodeKey: "captain" },
      { pathId: "db-from-writer", nodeKey: "writer", count: 14 },
      { pathId: "chain-writer-to-critic", nodeKey: "writer" },
      // Round 2: lo Scout trova 10 nuove offerte globali (pin 14-23).
      { pathId: "captain-to-scout", nodeKey: "captain" },
      { pathId: "db-from-scout", nodeKey: "scout", count: 10 },
    ];
    const DURATION = 360; // px di scroll per il viaggio di 1 pallina

    // Pre-calcolo i T di start di ogni step. Durata step = count * DURATION.
    const stepStarts: number[] = [];
    let acc = 0;
    for (const step of SEQUENCE) {
      stepStarts.push(acc);
      const count = step.count ?? 1;
      acc += count * DURATION;
    }

    const sec = flowRef.current?.closest(
      "[data-pin-section]",
    ) as HTMLElement | null;

    // Lo sticky in LandingHero è `top: 5rem` per stare sotto la nav,
    // quindi T parte da 0 quando il pin top raggiunge 80px sotto il
    // viewport top.
    const STICKY_TOP_OFFSET_PX = 80;

    // Step "→ DB" della pipeline. Ogni step ha la lista di PIN che le
    // sue palline attivano (in ordine). Quando la pallina k arriva, il
    // pin pinIdxs[k] viene tinto con il colore nodeKey.
    const range = (start: number, end: number) =>
      Array.from({ length: end - start }, (_, i) => start + i);
    const DB_STEPS: Array<{
      stepIdx: number;
      nodeKey: NodeId;
      pinIdxs: number[];
    }> = [
      // Round 1 → pin 0-13
      { stepIdx: 1, nodeKey: "scout", pinIdxs: range(0, 14) },
      { stepIdx: 3, nodeKey: "analyst", pinIdxs: range(0, 14) },
      { stepIdx: 5, nodeKey: "scorer", pinIdxs: range(0, 14) },
      { stepIdx: 7, nodeKey: "writer", pinIdxs: range(0, 14) },
      // Round 2 → pin 14-23 in ordine di longitudine MONOTONICA verso
      // est (partendo da pin 13 = NY, lon -74). Così la lerp tra pin
      // successivi gira sempre nella stessa direzione e cumulativamente
      // copre ~360° (giro completo del globo).
      // 22=BuenosAires(-58) → 14=SãoPaulo(-47) → 19=CapeTown(18) →
      // 23=Dubai(55) → 15=Mumbai(73) → 17=Bangkok(100) →
      // 16=Singapore(104) → 18=Sydney(151) → 20=MexCity(-99) →
      // 21=Lima(-77). Somma diff lon: ~357° verso est.
      {
        stepIdx: 10,
        nodeKey: "scout",
        pinIdxs: [22, 14, 19, 23, 15, 17, 16, 18, 20, 21],
      },
    ];

    const computePinColors = (T: number): (string | null)[] => {
      const colors: (string | null)[] = Array(PIN_COUNT).fill(null);
      // Iterazione cronologica: l'ULTIMO step DB che ha raggiunto un
      // pin determina il suo colore.
      for (const { stepIdx, nodeKey, pinIdxs } of DB_STEPS) {
        for (let k = 0; k < pinIdxs.length; k++) {
          const arrivalT = stepStarts[stepIdx] + (k + 1) * DURATION;
          if (T >= arrivalT) colors[pinIdxs[k]] = NODES[nodeKey].color;
        }
      }
      return colors;
    };

    // Sequenza cronologica di tutti gli "arrivi pallina al pin", ordinata
    // per T crescente. Tra un arrivo e il successivo, il globo ruota
    // linearmente in longitudine fino a centrare il pin successivo.
    type GlobeEvent = { arrivalT: number; lon: number };
    const globeEvents: GlobeEvent[] = [];
    for (const { stepIdx, pinIdxs } of DB_STEPS) {
      for (let k = 0; k < pinIdxs.length; k++) {
        const pos = LUXURY_POSITIONS[pinIdxs[k]];
        if (!pos) continue;
        globeEvents.push({
          arrivalT: stepStarts[stepIdx] + (k + 1) * DURATION,
          lon: pos.lon,
        });
      }
    }
    globeEvents.sort((a, b) => a.arrivalT - b.arrivalT);

    // Lerp tra due longitudini scegliendo il "cammino più corto" sulla
    // sfera (es. da 170° a -170° passa per +180° → solo 20°, non 340°).
    const lerpLon = (a: number, b: number, t: number) => {
      let diff = b - a;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      let out = a + diff * t;
      if (out > 180) out -= 360;
      if (out < -180) out += 360;
      return out;
    };

    const computeGlobeLon = (T: number): number => {
      if (globeEvents.length === 0) return LUXURY_POSITIONS[0]?.lon ?? 10;
      if (T <= globeEvents[0].arrivalT) return globeEvents[0].lon;
      const last = globeEvents[globeEvents.length - 1];
      if (T >= last.arrivalT) return last.lon;
      for (let i = 0; i < globeEvents.length - 1; i++) {
        const a = globeEvents[i];
        const b = globeEvents[i + 1];
        if (T >= a.arrivalT && T < b.arrivalT) {
          const segT = (T - a.arrivalT) / (b.arrivalT - a.arrivalT);
          return lerpLon(a.lon, b.lon, segT);
        }
      }
      return last.lon;
    };

    let lastPinColorsKey = "";
    // Niente NaN init: Math.abs(x - NaN) = NaN e NaN > 0.05 è false,
    // quindi setGlobeLon non veniva MAI chiamato.
    let lastGlobeLon: number | null = null;

    const recompute = () => {
      const rectTop = sec ? sec.getBoundingClientRect().top : 0;
      const T = Math.max(0, STICKY_TOP_OFFSET_PX - rectTop);

      // 1a) Aggiorno i pin del globo (solo se cambia qualcosa, per
      // evitare re-render inutili di HeroGlobe).
      const newPinColors = computePinColors(T);
      const key = newPinColors.join("|");
      if (key !== lastPinColorsKey) {
        lastPinColorsKey = key;
        setPinColors(newPinColors);
      }
      // 1b) Aggiorno la longitudine del centro globo. Throttling: cambio
      // lo state solo se la differenza supera 0.05°.
      const newLon = computeGlobeLon(T);
      if (lastGlobeLon === null || Math.abs(newLon - lastGlobeLon) > 0.05) {
        lastGlobeLon = newLon;
        setGlobeLon(newLon);
      }

      // 2) Aggiorno la pallina in volo (al massimo 1 alla volta).
      let stepIdx = -1;
      for (let i = 0; i < SEQUENCE.length; i++) {
        const count = SEQUENCE[i].count ?? 1;
        if (T >= stepStarts[i] && T < stepStarts[i] + count * DURATION) {
          stepIdx = i;
          break;
        }
      }
      if (stepIdx < 0) {
        setMessages([]);
        return;
      }
      const step = SEQUENCE[stepIdx];
      const tRel = T - stepStarts[stepIdx];
      const k = Math.floor(tRel / DURATION);
      const progress = (tRel - k * DURATION) / DURATION;
      if (progress <= 0 || progress >= 1) {
        setMessages([]);
        return;
      }
      const el = document.getElementById(
        step.pathId,
      ) as unknown as SVGPathElement | null;
      const totalLength = el?.getTotalLength?.() ?? 220;
      setMessages([
        {
          key: stepIdx * 100 + k,
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
        <HeroGlobe pinColors={pinColors} centerLon={globeLon} />
      </div>
    </div>
  );
}
