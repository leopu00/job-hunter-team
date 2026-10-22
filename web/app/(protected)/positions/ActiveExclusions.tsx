"use client";

// Le esclusioni di profilo accettate (JHT-T24): cosa il team ha smesso di preferire, e da quando.
//
// Si vedono ovunque; si RITIRANO solo dall'app desktop (sul sito l'elenco è in sola lettura).
// Ritirare scrive `dismissed` sulla stessa riga della decisione: l'effetto cessa sul punteggio
// successivo, quelli già salvati non si toccano.

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import { useDesktopWrite } from "@/lib/desktop-write";
import { REASON_LABELS } from "./[id]/exclusion-reasons";

const T: Record<
  string,
  {
    title: string;
    acts: string;
    withdraw: string;
    withdrawn: string;
    desktopOnly: string;
  }
> = {
  it: {
    title: "Esclusioni attive",
    acts: "abbassa il punteggio di {points} punti",
    withdraw: "Ritira",
    withdrawn: "Esclusione ritirata.",
    desktopOnly: "Si ritirano nell'app desktop.",
  },
  en: {
    title: "Active exclusions",
    acts: "lowers the score by {points}",
    withdraw: "Withdraw",
    withdrawn: "Exclusion withdrawn.",
    desktopOnly: "You withdraw them in the desktop app.",
  },
  es: {
    title: "Exclusiones activas",
    acts: "baja la puntuación en {points}",
    withdraw: "Retirar",
    withdrawn: "Exclusión retirada.",
    desktopOnly: "Se retiran en la aplicación de escritorio.",
  },
  fr: {
    title: "Exclusions actives",
    acts: "baisse la note de {points}",
    withdraw: "Retirer",
    withdrawn: "Exclusion retirée.",
    desktopOnly: "Elles se retirent dans l'application de bureau.",
  },
  de: {
    title: "Aktive Ausschlüsse",
    acts: "senkt die Bewertung um {points}",
    withdraw: "Zurücknehmen",
    withdrawn: "Ausschluss zurückgenommen.",
    desktopOnly: "Du nimmst sie in der Desktop-App zurück.",
  },
  hu: {
    title: "Aktív kizárások",
    acts: "{points} ponttal csökkenti a pontszámot",
    withdraw: "Visszavonás",
    withdrawn: "Kizárás visszavonva.",
    desktopOnly: "Az asztali alkalmazásban vonhatod vissza.",
  },
  pt: {
    title: "Exclusões ativas",
    acts: "baixa a pontuação em {points}",
    withdraw: "Retirar",
    withdrawn: "Exclusão retirada.",
    desktopOnly: "Retiram-se na aplicação de ambiente de trabalho.",
  },
};

/** What an accepted exclusion takes off, per code: the same numbers as shared/skills/profile_exclusions.py. */
const POINTS: Record<string, number> = {
  company: 30,
  wrong_location: 15,
  salary_low: 15,
  wrong_stack: 15,
  too_senior: 15,
  too_junior: 15,
};

type Decision = {
  reason: string;
  status: "accepted" | "dismissed";
  positions_at_decision: number;
};

export default function ActiveExclusions() {
  const locale = useLocale();
  const t = T[locale] ?? T.en;
  const labels = REASON_LABELS[locale] ?? REASON_LABELS.en;
  const { canChange } = useDesktopWrite();
  const [accepted, setAccepted] = useState<Decision[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/profile-exclusions");
        if (!res.ok) return;
        const rows =
          ((await res.json()) as { exclusions?: Decision[] }).exclusions ?? [];
        if (alive) setAccepted(rows.filter((r) => r.status === "accepted"));
      } catch {
        // Senza rete o fuori dal cloud l'elenco semplicemente non c'è.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const withdraw = async (decision: Decision) => {
    if (busy || !canChange) return;
    setBusy(true);
    try {
      const res = await fetch("/api/profile-exclusions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: decision.reason,
          status: "dismissed",
          positions: decision.positions_at_decision,
        }),
      });
      if (res.ok) {
        setAccepted((all) => all.filter((d) => d.reason !== decision.reason));
        setNote(true);
      }
    } catch {
      // Resta nell'elenco: l'utente può riprovare.
    }
    setBusy(false);
  };

  if (accepted.length === 0) {
    return note ? (
      <p
        role="status"
        className="text-[12px] mb-3"
        style={{ color: "var(--color-muted)" }}
      >
        {t.withdrawn}
      </p>
    ) : null;
  }

  return (
    <section
      aria-label={t.title}
      data-active-exclusions
      className="rounded-lg border p-3 mb-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-row)",
      }}
    >
      <p
        className="text-[12px] font-semibold"
        style={{ color: "var(--color-text)" }}
      >
        {t.title}
      </p>
      <ul className="mt-1">
        {accepted.map((d) => (
          <li
            key={d.reason}
            data-exclusion={d.reason}
            className="flex items-center gap-2 text-[12px] mt-1"
            style={{ color: "var(--color-text)" }}
          >
            <span>
              {labels[d.reason as keyof typeof labels] ?? d.reason}
              {" — "}
              <span style={{ color: "var(--color-muted)" }}>
                {t.acts.replace("{points}", String(POINTS[d.reason] ?? 15))}
              </span>
            </span>
            {canChange && (
              <button
                type="button"
                disabled={busy}
                onClick={() => withdraw(d)}
                className="px-2 py-1 rounded-lg border text-[11px] disabled:opacity-60"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-muted)",
                }}
              >
                {t.withdraw}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!canChange && (
        <p className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>
          {t.desktopOnly}
        </p>
      )}
    </section>
  );
}
