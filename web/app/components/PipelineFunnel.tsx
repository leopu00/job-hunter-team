"use client";

type Step = {
  key: string;
  label: string;
  count: number;
  color: string;
};

type Props = {
  steps: Step[];
  title: string;
};

// Barre verticali (istogramma) con altezza proporzionale al count
// di ogni stato della pipeline: la colonna più alta = bottleneck.
// "found" è il totale e "review" è transitorio (verdetto Critico
// quasi istantaneo), entrambi esclusi dall'asse per leggibilità.
export default function PipelineFunnel({ steps, title }: Props) {
  const stages = steps.filter((s) => s.key !== "found" && s.key !== "review");
  const maxCount = Math.max(1, ...stages.map((s) => s.count));
  const totalActive = stages.reduce((a, s) => a + s.count, 0);

  // Altezza utile per le barre. Asse a 220px lascia spazio per label
  // sopra (count) e sotto (stage name).
  const BAR_AREA_H = 220;

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
      <div className="flex items-center justify-between mb-5">
        <span className="section-label">{title}</span>
        <span className="text-[10px] text-[var(--color-dim)]">
          <span className="text-[var(--color-bright)] font-semibold">
            {totalActive}
          </span>{" "}
          attive
        </span>
      </div>

      <div
        className="flex items-end gap-3"
        style={{ height: BAR_AREA_H + 50 /* +50 per count sopra + label sotto */ }}
      >
        {stages.map((s) => {
          const heightPct = (s.count / maxCount) * 100;
          const sharePct =
            totalActive > 0 ? Math.round((s.count / totalActive) * 100) : 0;
          return (
            <div
              key={s.key}
              className="flex-1 flex flex-col items-center min-w-0"
              title={`${s.label}: ${s.count} (${sharePct}%)`}
            >
              {/* Count sopra la barra */}
              <div
                className="text-[13px] font-bold tabular-nums leading-none mb-1.5"
                style={{ color: s.color }}
              >
                {s.count}
              </div>
              {/* Area barra: cresce dal basso */}
              <div
                className="w-full flex items-end"
                style={{ height: BAR_AREA_H }}
              >
                <div
                  className="w-full rounded-t-sm"
                  style={{
                    height: `${heightPct}%`,
                    background: s.color,
                    opacity: 0.85,
                    transition: "height 0.4s ease",
                    minHeight: s.count > 0 ? 2 : 0,
                  }}
                />
              </div>
              {/* Label stage + share% sotto la barra */}
              <div className="mt-2 w-full text-center">
                <div
                  className="text-[9px] font-semibold tracking-[0.14em] uppercase truncate"
                  style={{ color: "var(--color-dim)" }}
                >
                  {s.label}
                </div>
                <div className="text-[9px] text-[var(--color-dim)] tabular-nums mt-0.5">
                  {sharePct}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
