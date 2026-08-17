interface ExclusionDecidedAtProps {
  label: string;
  excludedAt: string | null | undefined;
  formatted: string | null;
}

/**
 * Presenta l'ora in cui l'esclusione è stata decisa. La sceglie il chiamante,
 * perché le mani sono due: `user_excluded_at` se ha deciso l'utente, la
 * transizione a «esclusa» dell'event-log se ha deciso il team.
 *
 * Un dato assente o invalido resta invisibile: le altre date della posizione
 * (`updated_at`, `found_at`, `last_checked`) descrivono eventi diversi e non
 * possono sostituire quella della decisione.
 */
export function ExclusionDecidedAt({
  label,
  excludedAt,
  formatted,
}: ExclusionDecidedAtProps) {
  if (!excludedAt || !formatted) return null;

  return (
    <p
      data-exclusion-decided-at=""
      className="mb-1 text-[10px] leading-snug text-[var(--color-dim)]"
    >
      {label} <time dateTime={excludedAt}>{formatted}</time>
    </p>
  );
}
