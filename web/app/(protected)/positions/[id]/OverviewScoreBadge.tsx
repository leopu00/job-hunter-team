import { scoreSpectrumCss } from "@/lib/score-color";

interface OverviewScoreBadgeProps {
  score: number;
}

/** La Panoramica mostra il valore corrente; data e semantica della
 * valutazione restano nel pannello Dettaglio punteggio. */
export function OverviewScoreBadge({ score }: OverviewScoreBadgeProps) {
  const color = scoreSpectrumCss(score);

  return (
    <div
      data-overview-score=""
      className="w-14 h-14 shrink-0 rounded-full border-2 flex items-center justify-center font-bold text-xl"
      style={{ borderColor: color, color }}
    >
      {score}
    </div>
  );
}
