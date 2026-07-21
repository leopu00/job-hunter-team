"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import {
  IconX,
  IconThumbsMeh,
  IconThumbsUp,
  IconStar,
} from "@/app/(protected)/swipe/icons";

// Giudizio a 4 livelli dalla pagina posizione — stessa semantica della
// pagina /swipe (event-log position_feedback, l'ultimo evento prevale):
//   no         → dislike/1/less_like_this + esclusione utente (reversibile)
//   review_low → like/2 (keep con entusiasmo basso, NIENTE esclusione)
//   review_ok  → like/4/more_like_this
//   top        → star/5/more_like_this
// Il ri-giudizio riconcilia l'esclusione (no→altro: DELETE; altro→no: POST).
export type Verdict = "no" | "review_low" | "review_ok" | "top";

const VERDICTS: Record<
  Verdict,
  {
    Icon: (p: { size?: number }) => React.ReactElement;
    color: string;
    action: "like" | "dislike" | "star";
    score: number;
    direction: "more_like_this" | "less_like_this" | null;
    exclude?: boolean;
  }
> = {
  no: {
    Icon: IconX,
    color: "var(--color-red)",
    action: "dislike",
    score: 1,
    direction: "less_like_this",
    exclude: true,
  },
  review_low: {
    Icon: IconThumbsMeh,
    color: "var(--color-orange)",
    action: "like",
    score: 2,
    direction: null,
  },
  review_ok: {
    Icon: IconThumbsUp,
    color: "var(--color-blue)",
    action: "like",
    score: 4,
    direction: "more_like_this",
  },
  top: {
    Icon: IconStar,
    color: "var(--color-green)",
    action: "star",
    score: 5,
    direction: "more_like_this",
  },
};

const ORDER: Verdict[] = ["no", "review_low", "review_ok", "top"];

const T: Record<
  Locale,
  { verdicts: Record<Verdict, string>; networkError: string }
> = {
  it: {
    verdicts: {
      no: "Non interessante",
      review_low: "Poco interessante",
      review_ok: "Interessante",
      top: "Molto interessante",
    },
    networkError: "Errore di rete",
  },
  en: {
    verdicts: {
      no: "Not interesting",
      review_low: "Slightly interesting",
      review_ok: "Interesting",
      top: "Very interesting",
    },
    networkError: "Network error",
  },
  hu: {
    verdicts: {
      no: "Nem érdekes",
      review_low: "Kevéssé érdekes",
      review_ok: "Érdekes",
      top: "Nagyon érdekes",
    },
    networkError: "Hálózati hiba",
  },
  es: {
    verdicts: {
      no: "No interesante",
      review_low: "Poco interesante",
      review_ok: "Interesante",
      top: "Muy interesante",
    },
    networkError: "Error de red",
  },
  de: {
    verdicts: {
      no: "Uninteressant",
      review_low: "Wenig interessant",
      review_ok: "Interessant",
      top: "Sehr interessant",
    },
    networkError: "Netzwerkfehler",
  },
  fr: {
    verdicts: {
      no: "Pas intéressant",
      review_low: "Peu intéressant",
      review_ok: "Intéressant",
      top: "Très intéressant",
    },
    networkError: "Erreur réseau",
  },
  pt: {
    verdicts: {
      no: "Não interessante",
      review_low: "Pouco interessante",
      review_ok: "Interessante",
      top: "Muito interessante",
    },
    networkError: "Erro de rede",
  },
};

export function FeedbackButtons({
  legacyId,
  initialVerdict,
}: {
  legacyId: number;
  initialVerdict: Verdict | null;
}) {
  const t = T[useLocale()];
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [verdict, setVerdict] = useState<Verdict | null>(initialVerdict);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const give = async (v: Verdict) => {
    if (busy) return;
    const prev = verdict;
    setError(null);
    setBusy(true);
    setVerdict(v);
    const cfg = VERDICTS[v];
    try {
      const res = await fetch(`/api/positions/${legacyId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: cfg.action,
          score: cfg.score,
          ...(cfg.direction ? { direction: cfg.direction } : {}),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const wasExcluded = prev ? Boolean(VERDICTS[prev].exclude) : false;
      if (cfg.exclude && !wasExcluded) {
        const ex = await fetch(`/api/positions/${legacyId}/user-exclude`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "not_interested" }),
        });
        if (!ex.ok) throw new Error(String(ex.status));
      } else if (!cfg.exclude && wasExcluded) {
        const ex = await fetch(`/api/positions/${legacyId}/user-exclude`, {
          method: "DELETE",
        });
        if (!ex.ok) throw new Error(String(ex.status));
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setVerdict(prev);
      setError(
        e instanceof Error
          ? `${t.networkError} (${e.message})`
          : t.networkError,
      );
    }
    setBusy(false);
  };

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {ORDER.map((v) => {
          const { Icon, color } = VERDICTS[v];
          const selected = verdict === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => give(v)}
              disabled={busy}
              aria-pressed={selected}
              className="flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 transition-colors disabled:opacity-60"
              style={{
                color,
                borderColor: selected ? color : "var(--color-border)",
                background: selected
                  ? `color-mix(in srgb, ${color} 12%, transparent)`
                  : "transparent",
              }}
            >
              <Icon size={20} />
              <span className="text-[9px] font-semibold leading-tight text-center text-[var(--color-muted)]">
                {t.verdicts[v]}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 text-[10px]" style={{ color: "var(--color-red)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
