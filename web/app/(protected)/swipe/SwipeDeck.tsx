"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

// [JHT-POSITIONS-SWIPE-TRIAGE] Deck di carte stile Tinder per il triage
// rapido del backlog scored/ready. Gesture pointer-based (touch + mouse),
// bottoni e tastiera (←/→, Backspace = undo) per il desktop.
//
// Scritture — riusa le corsie ESISTENTI, nessuna route nuova:
//   swipe sinistra → POST /api/positions/[legacyId]/user-exclude
//     (reason 'not_interested': status → excluded, il team ci smette di
//      lavorare; reversibile con DELETE — usato dall'undo)
//   swipe destra   → POST /api/positions/[legacyId]/feedback
//     (action 'like' + direction 'more_like_this': lo Scout lo consuma già
//      come pattern steering. Event-log APPEND-ONLY: l'undo del like
//      ripristina solo la carta nella UI, il like resta registrato — un
//      eventuale swipe sinistra successivo prevale comunque via status.)
// Ottimistico: la carta vola subito, la POST viaggia dietro; su errore
// toast non bloccante con il titolo della posizione.

export type SwipeCardData = {
  id: string;
  legacy_id: number;
  title: string;
  company: string;
  location: string | null;
  loc_city: string | null;
  loc_country: string | null;
  remote_type: "full_remote" | "hybrid" | "onsite" | null;
  role_family: string | null;
  source: string | null;
  found_at: string;
  score: number | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  jd_summary: string | null;
};

type SwipeAction = "like" | "nope";

const T: Record<
  Locale,
  {
    title: string;
    subtitle: string;
    stampLike: string;
    stampNope: string;
    btnNope: string;
    btnLike: string;
    btnUndo: string;
    emptyTitle: string;
    emptySubtitle: string;
    doneKept: string;
    doneDiscarded: string;
    allPositions: string;
    details: string;
    remote: Record<string, string>;
    saveError: string;
    hintKeys: string;
  }
> = {
  it: {
    title: "Swipe",
    subtitle: "Destra se ti interessa, sinistra per scartare",
    stampLike: "INTERESSA",
    stampNope: "SCARTA",
    btnNope: "Scarta",
    btnLike: "Mi interessa",
    btnUndo: "Annulla ultima",
    emptyTitle: "Mazzo finito!",
    emptySubtitle: "Hai fatto il triage di tutte le posizioni in coda.",
    doneKept: "tenute",
    doneDiscarded: "scartate",
    allPositions: "Tutte le posizioni",
    details: "Dettagli",
    remote: { full_remote: "Remoto", hybrid: "Ibrido", onsite: "In sede" },
    saveError: "Errore di rete — azione non salvata per",
    hintKeys: "Tastiera: ← scarta · → interessa · ⌫ annulla",
  },
  en: {
    title: "Swipe",
    subtitle: "Right if interested, left to discard",
    stampLike: "LIKE",
    stampNope: "NOPE",
    btnNope: "Discard",
    btnLike: "Interested",
    btnUndo: "Undo last",
    emptyTitle: "Deck finished!",
    emptySubtitle: "You triaged every queued position.",
    doneKept: "kept",
    doneDiscarded: "discarded",
    allPositions: "All positions",
    details: "Details",
    remote: { full_remote: "Remote", hybrid: "Hybrid", onsite: "On-site" },
    saveError: "Network error — action not saved for",
    hintKeys: "Keyboard: ← discard · → like · ⌫ undo",
  },
  hu: {
    title: "Swipe",
    subtitle: "Jobbra, ha érdekel — balra, ha nem",
    stampLike: "ÉRDEKEL",
    stampNope: "NEM",
    btnNope: "Elvetés",
    btnLike: "Érdekel",
    btnUndo: "Visszavonás",
    emptyTitle: "A pakli elfogyott!",
    emptySubtitle: "Minden sorban álló állást átnéztél.",
    doneKept: "megtartva",
    doneDiscarded: "elvetve",
    allPositions: "Összes állás",
    details: "Részletek",
    remote: { full_remote: "Távoli", hybrid: "Hibrid", onsite: "Helyszíni" },
    saveError: "Hálózati hiba — nem mentett művelet:",
    hintKeys: "Billentyűk: ← elvetés · → érdekel · ⌫ visszavonás",
  },
  es: {
    title: "Swipe",
    subtitle: "Derecha si te interesa, izquierda para descartar",
    stampLike: "ME INTERESA",
    stampNope: "DESCARTAR",
    btnNope: "Descartar",
    btnLike: "Me interesa",
    btnUndo: "Deshacer",
    emptyTitle: "¡Mazo terminado!",
    emptySubtitle: "Has revisado todas las posiciones en cola.",
    doneKept: "guardadas",
    doneDiscarded: "descartadas",
    allPositions: "Todas las posiciones",
    details: "Detalles",
    remote: { full_remote: "Remoto", hybrid: "Híbrido", onsite: "Presencial" },
    saveError: "Error de red — acción no guardada para",
    hintKeys: "Teclado: ← descartar · → me interesa · ⌫ deshacer",
  },
  de: {
    title: "Swipe",
    subtitle: "Nach rechts bei Interesse, nach links zum Aussortieren",
    stampLike: "INTERESSANT",
    stampNope: "WEG",
    btnNope: "Aussortieren",
    btnLike: "Interessant",
    btnUndo: "Rückgängig",
    emptyTitle: "Stapel geschafft!",
    emptySubtitle: "Du hast alle anstehenden Stellen durchgesehen.",
    doneKept: "behalten",
    doneDiscarded: "aussortiert",
    allPositions: "Alle Stellen",
    details: "Details",
    remote: { full_remote: "Remote", hybrid: "Hybrid", onsite: "Vor Ort" },
    saveError: "Netzwerkfehler — Aktion nicht gespeichert für",
    hintKeys: "Tastatur: ← aussortieren · → interessant · ⌫ rückgängig",
  },
  fr: {
    title: "Swipe",
    subtitle: "À droite si intéressé, à gauche pour écarter",
    stampLike: "INTÉRESSÉ",
    stampNope: "ÉCARTER",
    btnNope: "Écarter",
    btnLike: "Intéressé",
    btnUndo: "Annuler",
    emptyTitle: "Paquet terminé !",
    emptySubtitle: "Vous avez trié tous les postes en attente.",
    doneKept: "gardés",
    doneDiscarded: "écartés",
    allPositions: "Tous les postes",
    details: "Détails",
    remote: { full_remote: "Télétravail", hybrid: "Hybride", onsite: "Sur site" },
    saveError: "Erreur réseau — action non enregistrée pour",
    hintKeys: "Clavier : ← écarter · → intéressé · ⌫ annuler",
  },
  pt: {
    title: "Swipe",
    subtitle: "Direita se interessar, esquerda para descartar",
    stampLike: "INTERESSA",
    stampNope: "DESCARTAR",
    btnNope: "Descartar",
    btnLike: "Interessa",
    btnUndo: "Desfazer",
    emptyTitle: "Baralho concluído!",
    emptySubtitle: "Você triou todas as vagas na fila.",
    doneKept: "mantidas",
    doneDiscarded: "descartadas",
    allPositions: "Todas as vagas",
    details: "Detalhes",
    remote: { full_remote: "Remoto", hybrid: "Híbrido", onsite: "Presencial" },
    saveError: "Erro de rede — ação não salva para",
    hintKeys: "Teclado: ← descartar · → interessa · ⌫ desfazer",
  },
};

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  CHF: "CHF",
  HUF: "Ft",
};

function formatSalary(
  min: number | null,
  max: number | null,
  currency: string,
): string | null {
  if (min == null && max == null) return null;
  const sym = CURRENCY_SYMBOL[currency] ?? currency;
  const k = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
  if (min != null && max != null && min !== max)
    return `${sym} ${k(min)}–${k(max)}`;
  return `${sym} ${k((min ?? max)!)}`;
}

// jd_summary arriva in markdown leggero (grassetti, heading): sulla card lo
// mostriamo come testo piano — via marker, non vale un renderer completo.
function stripMd(s: string): string {
  return s
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

function scoreColor(score: number | null): string {
  if (score == null) return "var(--color-dim)";
  if (score >= 70) return "var(--color-green)";
  if (score >= 50) return "var(--color-yellow)";
  return "var(--color-muted)";
}

// Soglia di commit dello swipe (px orizzontali).
const SWIPE_THRESHOLD = 110;
// Durata dell'animazione di uscita — deve combaciare con la transition CSS.
const FLY_MS = 280;

export default function SwipeDeck({ cards }: { cards: SwipeCardData[] }) {
  const locale = useLocale();
  const t = T[locale] ?? T.en;

  const [deck, setDeck] = useState<SwipeCardData[]>(cards);
  const [history, setHistory] = useState<
    { card: SwipeCardData; action: SwipeAction }[]
  >([]);
  const [drag, setDrag] = useState({ dx: 0, dy: 0, dragging: false });
  const [fly, setFly] = useState<{ x: number; rot: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flyingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = cards.length;
  const done = total - deck.length;
  const kept = history.filter((h) => h.action === "like").length;
  const discarded = history.filter((h) => h.action === "nope").length;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const persist = useCallback(
    async (card: SwipeCardData, action: SwipeAction) => {
      try {
        const res =
          action === "nope"
            ? await fetch(`/api/positions/${card.legacy_id}/user-exclude`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: "not_interested" }),
              })
            : await fetch(`/api/positions/${card.legacy_id}/feedback`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "like",
                  direction: "more_like_this",
                }),
              });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        showToast(`${t.saveError} «${card.title}»`);
      }
    },
    [showToast, t.saveError],
  );

  const commit = useCallback(
    (action: SwipeAction) => {
      if (flyingRef.current || deck.length === 0) return;
      flyingRef.current = true;
      const card = deck[0];
      const dir = action === "like" ? 1 : -1;
      const width = typeof window !== "undefined" ? window.innerWidth : 800;
      setFly({ x: dir * (width + 200), rot: dir * 22 });
      setTimeout(() => {
        setDeck((d) => d.slice(1));
        setHistory((h) => [...h, { card, action }]);
        setDrag({ dx: 0, dy: 0, dragging: false });
        setFly(null);
        flyingRef.current = false;
      }, FLY_MS);
      void persist(card, action);
    },
    [deck, persist],
  );

  const undo = useCallback(() => {
    if (flyingRef.current || history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setDeck((d) => [last.card, ...d]);
    // Solo lo scarto è reversibile lato server (DELETE ripristina lo status
    // pre-esclusione). Il like è un event-log immutabile: resta registrato.
    if (last.action === "nope") {
      void fetch(`/api/positions/${last.card.legacy_id}/user-exclude`, {
        method: "DELETE",
      }).catch(() => showToast(`${t.saveError} «${last.card.title}»`));
    }
  }, [history, showToast, t.saveError]);

  // Tastiera per il desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
      )
        return;
      if (e.key === "ArrowLeft") commit("nope");
      else if (e.key === "ArrowRight") commit("like");
      else if (e.key === "Backspace") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, undo]);

  // ── Gesture (pointer events: touch + mouse unificati) ────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (flyingRef.current) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ dx: 0, dy: 0, dragging: true });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current || flyingRef.current) return;
    setDrag({
      dx: e.clientX - startRef.current.x,
      dy: e.clientY - startRef.current.y,
      dragging: true,
    });
  };
  const onPointerUp = () => {
    if (!startRef.current) return;
    const { dx } = drag;
    startRef.current = null;
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      commit(dx > 0 ? "like" : "nope");
    } else {
      setDrag({ dx: 0, dy: 0, dragging: false });
    }
  };

  const likeOpacity = Math.min(Math.max(drag.dx, 0) / 90, 1);
  const nopeOpacity = Math.min(Math.max(-drag.dx, 0) / 90, 1);

  return (
    <div className="max-w-md mx-auto select-none">
      {/* Header */}
      <div className="flex items-end justify-between mb-3">
        <div>
          <h1
            className="text-lg font-bold tracking-wide"
            style={{ color: "var(--color-white)" }}
          >
            🃏 {t.title}
          </h1>
          <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
            {t.subtitle}
          </p>
        </div>
        {total > 0 && (
          <span
            className="text-[11px] font-semibold tabular-nums"
            style={{ color: "var(--color-muted)" }}
          >
            {done}/{total}
          </span>
        )}
      </div>

      {/* Deck */}
      {deck.length === 0 ? (
        <div
          className="rounded-xl border px-6 py-14 text-center"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-card)",
          }}
        >
          <div className="text-3xl mb-3">🎉</div>
          <div
            className="text-base font-bold mb-1"
            style={{ color: "var(--color-white)" }}
          >
            {t.emptyTitle}
          </div>
          <p className="text-[12px] mb-1" style={{ color: "var(--color-muted)" }}>
            {t.emptySubtitle}
          </p>
          {(kept > 0 || discarded > 0) && (
            <p
              className="text-[12px] font-semibold mb-4"
              style={{ color: "var(--color-base)" }}
            >
              <span style={{ color: "var(--color-green)" }}>
                {kept} {t.doneKept}
              </span>
              {" · "}
              <span style={{ color: "var(--color-red)" }}>
                {discarded} {t.doneDiscarded}
              </span>
            </p>
          )}
          <Link
            href="/positions"
            className="inline-block text-[12px] font-semibold px-4 py-2 rounded no-underline"
            style={{
              background: "var(--color-row)",
              color: "var(--color-bright)",
              border: "1px solid var(--color-border)",
            }}
          >
            {t.allPositions} →
          </Link>
        </div>
      ) : (
        <>
          <div
            className="relative"
            style={{ height: "min(62dvh, 560px)", touchAction: "none" }}
          >
            {/* Le 3 carte in cima, dal fondo verso la cima dello stack */}
            {deck
              .slice(0, 3)
              .map((card, i) => {
                const isTop = i === 0;
                const transform = isTop
                  ? fly
                    ? `translate(${fly.x}px, ${drag.dy}px) rotate(${fly.rot}deg)`
                    : `translate(${drag.dx}px, ${drag.dy * 0.4}px) rotate(${drag.dx * 0.06}deg)`
                  : `translateY(${i * 10}px) scale(${1 - i * 0.035})`;
                return (
                  <div
                    key={card.id}
                    className="absolute inset-0 rounded-xl border flex flex-col overflow-hidden"
                    style={{
                      borderColor: "var(--color-border)",
                      background: "var(--color-card)",
                      transform,
                      transition:
                        isTop && (fly || !drag.dragging)
                          ? `transform ${fly ? FLY_MS : 200}ms ease`
                          : isTop
                            ? "none"
                            : "transform 200ms ease",
                      zIndex: 10 - i,
                      cursor: isTop ? "grab" : "default",
                      boxShadow: isTop
                        ? "0 12px 32px rgba(0,0,0,0.35)"
                        : "none",
                    }}
                    onPointerDown={isTop ? onPointerDown : undefined}
                    onPointerMove={isTop ? onPointerMove : undefined}
                    onPointerUp={isTop ? onPointerUp : undefined}
                    onPointerCancel={isTop ? onPointerUp : undefined}
                  >
                    {/* Stamps LIKE/NOPE sulla carta in cima */}
                    {isTop && (
                      <>
                        <div
                          className="absolute top-5 left-4 px-2 py-1 rounded border-2 text-sm font-black tracking-widest"
                          style={{
                            color: "var(--color-green)",
                            borderColor: "var(--color-green)",
                            transform: "rotate(-14deg)",
                            opacity: likeOpacity,
                            zIndex: 20,
                          }}
                        >
                          {t.stampLike}
                        </div>
                        <div
                          className="absolute top-5 right-4 px-2 py-1 rounded border-2 text-sm font-black tracking-widest"
                          style={{
                            color: "var(--color-red)",
                            borderColor: "var(--color-red)",
                            transform: "rotate(14deg)",
                            opacity: nopeOpacity,
                            zIndex: 20,
                          }}
                        >
                          {t.stampNope}
                        </div>
                      </>
                    )}

                    {/* Contenuto card */}
                    <div className="p-5 flex flex-col gap-3 flex-1 min-h-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div
                            className="text-[15px] font-bold leading-snug"
                            style={{
                              color: "var(--color-white)",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {card.title}
                          </div>
                          <div
                            className="text-[13px] font-semibold mt-0.5 truncate"
                            style={{ color: "var(--color-base)" }}
                          >
                            {card.company}
                          </div>
                        </div>
                        <div
                          className="shrink-0 w-11 h-11 rounded-full border-2 flex items-center justify-center text-[14px] font-black tabular-nums"
                          style={{
                            color: scoreColor(card.score),
                            borderColor: scoreColor(card.score),
                          }}
                        >
                          {card.score ?? "—"}
                        </div>
                      </div>

                      {/* Meta chips */}
                      <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                        {(card.loc_city || card.loc_country || card.location) && (
                          <Chip>
                            📍{" "}
                            {card.loc_city
                              ? `${card.loc_city}${card.loc_country ? `, ${card.loc_country}` : ""}`
                              : (card.loc_country ?? card.location)}
                          </Chip>
                        )}
                        {card.remote_type && (
                          <Chip>{t.remote[card.remote_type] ?? card.remote_type}</Chip>
                        )}
                        {formatSalary(
                          card.salary_min,
                          card.salary_max,
                          card.salary_currency,
                        ) && (
                          <Chip color="var(--color-green)">
                            {formatSalary(
                              card.salary_min,
                              card.salary_max,
                              card.salary_currency,
                            )}
                          </Chip>
                        )}
                        {card.role_family && <Chip>{card.role_family}</Chip>}
                      </div>

                      {/* Sintesi JD */}
                      {card.jd_summary && (
                        <p
                          className="text-[12px] leading-relaxed flex-1 min-h-0"
                          style={{
                            color: "var(--color-base)",
                            display: "-webkit-box",
                            WebkitLineClamp: 9,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {stripMd(card.jd_summary)}
                        </p>
                      )}

                      {/* Footer */}
                      <div className="mt-auto flex items-center justify-between text-[11px]">
                        <span style={{ color: "var(--color-dim)" }}>
                          {card.source ?? ""}
                        </span>
                        <Link
                          href={`/positions/${card.id}`}
                          target="_blank"
                          className="font-semibold no-underline"
                          style={{ color: "var(--color-blue)" }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          {t.details} ↗
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })
              .reverse()}
          </div>

          {/* Bottoni azione */}
          <div className="flex items-center justify-center gap-5 mt-5">
            <ActionButton
              label={t.btnNope}
              color="var(--color-red)"
              size={56}
              onClick={() => commit("nope")}
            >
              ✕
            </ActionButton>
            <ActionButton
              label={t.btnUndo}
              color="var(--color-yellow)"
              size={42}
              disabled={history.length === 0}
              onClick={undo}
            >
              ↩
            </ActionButton>
            <ActionButton
              label={t.btnLike}
              color="var(--color-green)"
              size={56}
              onClick={() => commit("like")}
            >
              ♥
            </ActionButton>
          </div>

          <p
            className="hidden md:block text-center text-[10px] mt-3"
            style={{ color: "var(--color-dim)" }}
          >
            {t.hintKeys}
          </p>
        </>
      )}

      {/* Toast errori rete (non bloccante) */}
      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded text-[12px] font-semibold max-w-[90vw] truncate"
          style={{
            background: "var(--color-panel)",
            color: "var(--color-red)",
            border: "1px solid var(--color-red)",
            zIndex: 100,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function Chip({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      className="px-2 py-0.5 rounded-full border"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-row)",
        color: color ?? "var(--color-base)",
      }}
    >
      {children}
    </span>
  );
}

function ActionButton({
  children,
  label,
  color,
  size,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  color: string;
  size: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-full border-2 flex items-center justify-center font-bold transition-transform active:scale-90"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        color,
        borderColor: color,
        background: "var(--color-card)",
        opacity: disabled ? 0.3 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
