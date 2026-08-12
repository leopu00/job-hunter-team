interface ScoreAssessedAtProps {
  label: string;
  scoredAt: string | null | undefined;
  formatted: string | null;
}

/**
 * Presentazione soltanto: timestamp e testo formattato arrivano dalla stessa
 * riga `scores` gia' letta dalla pagina. Qui non esistono date alternative,
 * quindi un valore assente o invalido resta onestamente invisibile.
 */
export function ScoreAssessedAt({
  label,
  scoredAt,
  formatted,
}: ScoreAssessedAtProps) {
  if (!scoredAt || !formatted) return null;

  return (
    <div
      data-score-assessed-at=""
      className="mb-4 -mt-1 text-[10px] leading-snug text-[var(--color-dim)]"
    >
      {label} <time dateTime={scoredAt}>{formatted}</time>
    </div>
  );
}
