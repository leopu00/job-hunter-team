"use client";

import { useEffect, useRef, useState } from "react";
import HeroGlobe from "./HeroGlobe";
import { LUXURY_POSITIONS } from "./_data/luxuryPositions";
import { useLandingI18n } from "./LandingI18n";

// `name` è il fallback EN: il display name passa dal dizionario i18n
// via agentName() dentro al componente.
const NODES = {
  captain: { emoji: "👨‍✈️", name: "Captain", color: "#ff9100" },
  scout: { emoji: "🕵️", name: "Scout", color: "#2196f3" },
  analyst: { emoji: "👨‍🔬", name: "Analyst", color: "#ffd600" },
  scorer: { emoji: "👨‍💻", name: "Scorer", color: "#b388ff" },
  writer: { emoji: "👨‍🏫", name: "Writer", color: "#00e676" },
  critic: { emoji: "👨‍⚖️", name: "Critic", color: "#f44336" },
  db: { emoji: "🗄️", name: "DB", color: "#7f9cf5" },
} as const;

type NodeId = keyof typeof NODES;

// Chiavi i18n per nodi (db escluso, usa il fallback "DB").
const AGENT_NAME_KEY = {
  captain: "agent_captain",
  scout: "agent_scout",
  analyst: "agent_analyst",
  scorer: "agent_scorer",
  writer: "agent_writer",
  critic: "agent_critic",
} as const;

// Chiavi i18n per le 10 vignette del team flow.
type ChatterKey =
  | "chat_captain_go"
  | "chat_captain_profile"
  | "chat_scout_europe"
  | "chat_scout_asia"
  | "chat_scout_usa"
  | "chat_analyst_check"
  | "chat_captain_good"
  | "chat_scorer_top"
  | "chat_writer_cvs"
  | "chat_critic_reviewing";

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
  const { t } = useLandingI18n();
  // Nome localizzato del nodo. "db" non ha chiave i18n → fallback EN.
  const agentName = (id: NodeId): string => {
    if (id === "db") return NODES.db.name;
    return t(AGENT_NAME_KEY[id]);
  };
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
    reverse?: boolean; // se true, viaggia dal punto-end al punto-start
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
  // Vignetta "speech bubble" che ogni tanto compare sopra un agente
  // durante la fase 1. Null = nessuna vignetta attiva.
  const [chatter, setChatter] = useState<{
    nodeKey: NodeId;
    textKey: ChatterKey;
  } | null>(null);

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

        // Captain → pipeline (skip Critic come nella team v2 archiviata: il Capitano non
        // gli ordina direttamente, riceve solo feedback indiretto).
        const captainPaths: ArrowPath[] = [];
        const pipelineRects = pipelineRefs.current.map((n) => rectOf(n));
        if (captainNameRect) {
          const startX =
            captainNameRect.left + captainNameRect.width / 2 - fr.left;
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

    // Ogni step ha 1+ `paths` (pallini contemporanei) e opzionale count.
    //   paths.length === 1 + count > 1 → step multi-pallina sequenziale
    //   paths.length > 1                → step con N palline parallele
    //   default                          → 1 pallina sola
    // Quando un agente FINISCE la sua iterazione (scrive nel DB), parte
    // contemporaneamente: 1 pallina reverse verso il Captain (report) +
    // 1 pallina forward verso il prossimo agente (handoff).
    type StepPath = { pathId: string; nodeKey: NodeId; reverse?: boolean };
    type Step = { paths: StepPath[]; count?: number };
    const SEQUENCE: Step[] = [
      // Round 1
      { paths: [{ pathId: "captain-to-scout", nodeKey: "captain" }] },
      { paths: [{ pathId: "db-from-scout", nodeKey: "scout" }], count: 5 },
      // Scout finisce → report al Captain + handoff all'Analyst
      {
        paths: [
          { pathId: "captain-to-scout", nodeKey: "scout", reverse: true },
          { pathId: "chain-scout-to-analyst", nodeKey: "scout" },
        ],
      },
      { paths: [{ pathId: "db-from-analyst", nodeKey: "analyst" }], count: 4 },
      // Analyst finisce → report + handoff allo Scorer
      {
        paths: [
          { pathId: "captain-to-analyst", nodeKey: "analyst", reverse: true },
          { pathId: "chain-analyst-to-scorer", nodeKey: "analyst" },
        ],
      },
      { paths: [{ pathId: "db-from-scorer", nodeKey: "scorer" }], count: 3 },
      // Scorer finisce → report + handoff al Writer
      {
        paths: [
          { pathId: "captain-to-scorer", nodeKey: "scorer", reverse: true },
          { pathId: "chain-scorer-to-writer", nodeKey: "scorer" },
        ],
      },
      { paths: [{ pathId: "db-from-writer", nodeKey: "writer" }], count: 2 },
      // Writer finisce → report + handoff al Critic
      {
        paths: [
          { pathId: "captain-to-writer", nodeKey: "writer", reverse: true },
          { pathId: "chain-writer-to-critic", nodeKey: "writer" },
        ],
      },
      // Round 2
      { paths: [{ pathId: "captain-to-scout", nodeKey: "captain" }] },
      { paths: [{ pathId: "db-from-scout", nodeKey: "scout" }], count: 4 },
    ];
    const DURATION = 360; // px di scroll per il viaggio di 1 pallina

    // Pre-calcolo i T di start di ogni step. Durata:
    //   - paths.length > 1   → 1 round con N palline parallele = DURATION
    //   - count > 1          → count round sequenziali = count * DURATION
    //   - default            → DURATION
    const stepDurationOf = (step: Step) => {
      if (step.paths.length > 1) return DURATION;
      return (step.count ?? 1) * DURATION;
    };
    const stepStarts: number[] = [];
    let acc = 0;
    for (const step of SEQUENCE) {
      stepStarts.push(acc);
      acc += stepDurationOf(step);
    }

    const sec = flowRef.current?.closest(
      "[data-pin-section]",
    ) as HTMLElement | null;

    // Lo sticky in LandingHero è `top: 5rem` per stare sotto la nav,
    // quindi T parte da 0 quando il pin top raggiunge 80px sotto il
    // viewport top.
    const STICKY_TOP_OFFSET_PX = 80;

    // Step "→ DB". Ogni pallina k attiva pinGroups[k] (tutti i pin del
    // gruppo prendono il colore nodeKey). Selezione decrescente lungo
    // la pipeline: alcune offerte "saltano" lo step successivo, così
    // a fine round 1 il globo è un mix di blu/verde/viola/giallo
    // (non tutto giallo).
    //
    // Stato finale round 1:
    //   - Yellow (Writer):   Rome, Beijing, Tokyo, NY              (4)
    //   - Purple (Scorer):   London, Moscow, SF                    (3)
    //   - Green (Analyst):   Paris, Stockholm, Chicago             (3)
    //   - Blue   (Scout):    Vienna, Istanbul, Seoul, Las Vegas    (4)
    const DB_STEPS: Array<{
      stepIdx: number;
      nodeKey: NodeId;
      pinGroups: number[][];
    }> = [
      // Scout: tutti 14 pin diventano blu.
      {
        stepIdx: 1,
        nodeKey: "scout",
        pinGroups: [
          [0, 1, 2],
          [3, 4, 5],
          [6, 7],
          [8, 9],
          [10, 11, 12, 13],
        ],
      },
      // Analyst (10/14 → verdi): saltano Vienna(2), Istanbul(5),
      // Seoul(8), Las Vegas(11) — restano blu.
      {
        stepIdx: 3,
        nodeKey: "analyst",
        pinGroups: [
          [0, 1],
          [3, 4],
          [6, 7],
          [9, 10, 12, 13],
        ],
      },
      // Scorer (7/10 → viola): saltano Paris(1), Stockholm(3),
      // Chicago(12) — restano verdi.
      {
        stepIdx: 5,
        nodeKey: "scorer",
        pinGroups: [
          [0, 4],
          [6, 7],
          [9, 10, 13],
        ],
      },
      // Writer (4/7 → gialli): saltano London(0), Moscow(6), SF(10)
      // — restano viola.
      {
        stepIdx: 7,
        nodeKey: "writer",
        pinGroups: [
          [4, 7],
          [9, 13],
        ],
      },
      // Round 2: il Writer fa una passata finale e tinge di VERDE
      // TUTTI i 24 pin durante il giro a inquadratura fissa sul globo.
      // Raggruppati per longitudine monotonica est così il globo ruota
      // di ~360° in totale durante la fase centrata.
      {
        stepIdx: 10,
        nodeKey: "writer",
        pinGroups: [
          // g0: Pacifico + Americas west — Sydney, SF, LasVegas, MexCity, Chicago, Lima
          [18, 10, 11, 20, 12, 21],
          // g1: Atlantico est + Europa west — NY, BA, SãoPaulo, London, Paris, Rome, Vienna
          [13, 22, 14, 0, 1, 4, 2],
          // g2: Europa centro/est + Africa + MO — Stockholm, CapeTown, Istanbul, Moscow, Dubai
          [3, 19, 5, 6, 23],
          // g3: Asia — Mumbai, Bangkok, Singapore, Beijing, Seoul, Tokyo
          [15, 17, 16, 7, 8, 9],
        ],
      },
    ];

    const computePinColors = (T: number): (string | null)[] => {
      const colors: (string | null)[] = Array(PIN_COUNT).fill(null);
      // Quando la pallina k arriva (T ≥ stepStart + (k+1)*DURATION),
      // tutti i pin del gruppo pinGroups[k] prendono il colore nodeKey.
      // L'iterazione preserva l'ordine di DB_STEPS, quindi l'ultimo
      // step che tocca un pin vince (giallo writer > viola scorer > ecc).
      for (const { stepIdx, nodeKey, pinGroups } of DB_STEPS) {
        for (let k = 0; k < pinGroups.length; k++) {
          const arrivalT = stepStarts[stepIdx] + (k + 1) * DURATION;
          if (T >= arrivalT) {
            for (const pinIdx of pinGroups[k]) {
              colors[pinIdx] = NODES[nodeKey].color;
            }
          }
        }
      }
      return colors;
    };

    // Sequenza cronologica di tutti gli "arrivi pallina al pin", ordinata
    // per T crescente. Tra un arrivo e il successivo, il globo ruota
    // linearmente in longitudine fino a centrare il pin successivo.
    type GlobeEvent = { arrivalT: number; lon: number };
    const globeEvents: GlobeEvent[] = [];
    for (const { stepIdx, pinGroups } of DB_STEPS) {
      for (let k = 0; k < pinGroups.length; k++) {
        // Centro il globo sul PRIMO pin del gruppo (gli altri pin
        // sono geograficamente vicini, quindi tutti visibili).
        const pos = LUXURY_POSITIONS[pinGroups[k][0]];
        if (!pos) continue;
        globeEvents.push({
          arrivalT: stepStarts[stepIdx] + (k + 1) * DURATION,
          lon: pos.lon,
        });
      }
    }
    globeEvents.sort((a, b) => a.arrivalT - b.arrivalT);

    // Lerp tra due longitudini SEMPRE verso est (positive). Mai cambio
    // direzione: scrollando giù il globo ruota solo nella stessa
    // direzione, anche quando il target sarebbe "geograficamente più
    // vicino" andando ovest (in quel caso facciamo il giro lungo est).
    const lerpLon = (a: number, b: number, t: number) => {
      let diff = b - a;
      // Forza diff > 0 (rotazione est).
      while (diff < 0) diff += 360;
      let out = a + diff * t;
      while (out > 180) out -= 360;
      while (out < -180) out += 360;
      return out;
    };

    // Dopo l'ultimo evento (fine pipeline) il globo continua a ruotare
    // est al ritmo POST_PIPELINE_DEG_PER_PX. Calibrato a 0.14 perché:
    // i lerp dei 4 eventi di round 2 sommano ~290°, e con un buffer
    // di ~500 px dopo la pipeline (ma sticky ancora agganciato fase 2)
    // arriviamo a ~70° → totale ~360°, esattamente un giro durante
    // la fase centrata. Dopo lo sblocco, la rotazione continua mentre
    // la tabella sale.
    const POST_PIPELINE_DEG_PER_PX = 0.14;

    const computeGlobeLon = (T: number): number => {
      if (globeEvents.length === 0) return LUXURY_POSITIONS[0]?.lon ?? 10;
      if (T <= globeEvents[0].arrivalT) return globeEvents[0].lon;
      const last = globeEvents[globeEvents.length - 1];
      if (T >= last.arrivalT) {
        const extra = (T - last.arrivalT) * POST_PIPELINE_DEG_PER_PX;
        let out = last.lon + extra;
        while (out > 180) out -= 360;
        while (out < -180) out += 360;
        return out;
      }
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

    // Vignette: ogni tanto, durante la fase 1, sopra un agente compare
    // una speech bubble con una frase breve. Sono distribuite con
    // "buchi" di silenzio tra una e l'altra (la dura ~360 px di scroll
    // ognuna). Tutte hanno endT < 6840 (fine fase 1).
    const CHATTER: Array<{
      nodeKey: NodeId;
      textKey: ChatterKey;
      startT: number;
      endT: number;
    }> = [
      { nodeKey: "captain", textKey: "chat_captain_go", startT: 60, endT: 360 },
      {
        nodeKey: "captain",
        textKey: "chat_captain_profile",
        startT: 420,
        endT: 720,
      },
      {
        nodeKey: "scout",
        textKey: "chat_scout_europe",
        startT: 720,
        endT: 1080,
      },
      {
        nodeKey: "scout",
        textKey: "chat_scout_asia",
        startT: 1440,
        endT: 1800,
      },
      { nodeKey: "scout", textKey: "chat_scout_usa", startT: 2160, endT: 2520 },
      {
        nodeKey: "analyst",
        textKey: "chat_analyst_check",
        startT: 2880,
        endT: 3240,
      },
      {
        nodeKey: "captain",
        textKey: "chat_captain_good",
        startT: 3600,
        endT: 3960,
      },
      {
        nodeKey: "scorer",
        textKey: "chat_scorer_top",
        startT: 4680,
        endT: 5040,
      },
      {
        nodeKey: "writer",
        textKey: "chat_writer_cvs",
        startT: 5760,
        endT: 6120,
      },
      {
        nodeKey: "critic",
        textKey: "chat_critic_reviewing",
        startT: 6480,
        endT: 6840,
      },
    ];

    let lastPinColorsKey = "";
    let lastGlobeLon: number | null = null;
    let lastChatterKey = "";

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
      // 1c) Vignetta attiva per il T corrente.
      const activeChat =
        CHATTER.find((c) => T >= c.startT && T < c.endT) ?? null;
      const chatKey = activeChat
        ? `${activeChat.nodeKey}|${activeChat.textKey}`
        : "";
      if (chatKey !== lastChatterKey) {
        lastChatterKey = chatKey;
        setChatter(activeChat);
      }

      // 2) Aggiorno le palline in volo.
      let stepIdx = -1;
      for (let i = 0; i < SEQUENCE.length; i++) {
        const dur = stepDurationOf(SEQUENCE[i]);
        if (T >= stepStarts[i] && T < stepStarts[i] + dur) {
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

      if (step.paths.length > 1) {
        // Step parallel: TUTTI i path emettono 1 pallina contemporanea
        // dello stesso progress (0 → 1 in DURATION).
        const progress = tRel / DURATION;
        if (progress <= 0 || progress >= 1) {
          setMessages([]);
          return;
        }
        const active: Message[] = [];
        for (let p = 0; p < step.paths.length; p++) {
          const path = step.paths[p];
          const el = document.getElementById(
            path.pathId,
          ) as unknown as SVGPathElement | null;
          const totalLength = el?.getTotalLength?.() ?? 220;
          active.push({
            key: stepIdx * 100 + p,
            pathId: path.pathId,
            color: NODES[path.nodeKey].color,
            progress,
            totalLength,
            reverse: path.reverse,
          });
        }
        setMessages(active);
        return;
      }

      // Step single (1 path), eventualmente multi-pallina sequenziale.
      const path = step.paths[0];
      const k = Math.floor(tRel / DURATION);
      const progress = (tRel - k * DURATION) / DURATION;
      if (progress <= 0 || progress >= 1) {
        setMessages([]);
        return;
      }
      const el = document.getElementById(
        path.pathId,
      ) as unknown as SVGPathElement | null;
      const totalLength = el?.getTotalLength?.() ?? 220;
      setMessages([
        {
          key: stepIdx * 100 + k,
          pathId: path.pathId,
          color: NODES[path.nodeKey].color,
          progress,
          totalLength,
          reverse: path.reverse,
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
    bubblePlacement: "top" | "bottom" = "top",
  ) => {
    const n = NODES[nodeId];
    const showChat = chatter?.nodeKey === nodeId;
    return (
      <div
        className={`relative inline-flex select-none flex-col items-center gap-2 shrink-0 ${extraClass}`}
      >
        {showChat && (
          <SpeechBubble
            key={chatter.textKey}
            text={t(chatter.textKey)}
            placement={bubblePlacement}
          />
        )}
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
          {agentName(nodeId)}
        </span>
      </div>
    );
  };

  return (
    <div ref={flowRef} className="relative mx-auto w-full max-w-[1080px]">
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

          {messages.map(
            ({ key, pathId, color, progress, totalLength, reverse }) => {
              // One-way. Normalmente: dal mittente (0) al destinatario (length).
              // Se reverse, si viaggia in direzione opposta sullo stesso path
              // (es. da Scout a Captain sul path captain-to-scout).
              const len = reverse
                ? (1 - progress) * totalLength
                : progress * totalLength;
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
            },
          )}
        </svg>
      )}

      {/* Top row: solo Captain, centrato sopra la pipeline. Bubble
          placement "bottom": il Capitano è in cima al pin sticky (top
          5rem), una bubble sopra di lui finisce sotto la nav. La
          mettiamo sotto, c'è spazio nel gap mt-24 verso la pipeline. */}
      <div className="flex justify-center items-end">
        {renderNode("captain", captainEmojiRef, "", captainNameRef, "bottom")}
      </div>

      {/* Pipeline row */}
      <div className="grid grid-cols-5 justify-items-center items-start mt-24">
        {PIPELINE.map((nodeId, idx) => {
          const showChat = chatter?.nodeKey === nodeId;
          return (
            <div key={nodeId}>
              <div className="relative inline-flex select-none flex-col items-center gap-2 shrink-0 min-w-[72px]">
                {showChat && (
                  <SpeechBubble
                    key={chatter.textKey}
                    text={t(chatter.textKey)}
                  />
                )}
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
                  {agentName(nodeId)}
                </span>
              </div>
            </div>
          );
        })}
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

// Speech bubble posizionata sopra l'emoji di un agente. Fade-in
// all'apparizione (key sul text fa rimontare il nodo → animazione
// riparte) e codina inferiore via div ruotato 45° col background del
// bubble (così copre il bordo della bubble).
function SpeechBubble({
  text,
  placement = "top",
}: {
  text: string;
  placement?: "top" | "bottom";
}) {
  const isBottom = placement === "bottom";
  return (
    <div
      className="absolute whitespace-nowrap select-none pointer-events-none"
      style={{
        ...(isBottom
          ? { top: "calc(100% + 8px)" }
          : { bottom: "calc(100% + 8px)" }),
        left: "50%",
        transform: "translateX(-50%)",
        animation: "chat-bubble-in 0.3s ease both",
        background: "var(--color-card)",
        color: "var(--color-bright)",
        border: "1px solid var(--color-border)",
        padding: "4px 10px",
        fontSize: 11,
        lineHeight: 1.3,
        boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
        zIndex: 5,
      }}
    >
      {text}
      {/* Codina: quadrato ruotato 45° col bg + bordi del bubble. Il lato
          dove sta la codina dipende da placement: top → codina sotto
          (punta verso emoji sotto), bottom → codina sopra. */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          ...(isBottom ? { top: -4 } : { bottom: -4 }),
          width: 7,
          height: 7,
          transform: "translateX(-50%) rotate(45deg)",
          background: "var(--color-card)",
          ...(isBottom
            ? {
                borderLeft: "1px solid var(--color-border)",
                borderTop: "1px solid var(--color-border)",
              }
            : {
                borderRight: "1px solid var(--color-border)",
                borderBottom: "1px solid var(--color-border)",
              }),
        }}
      />
    </div>
  );
}
