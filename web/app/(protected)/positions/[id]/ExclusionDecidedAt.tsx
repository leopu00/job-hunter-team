interface ExclusionDecidedAtProps {
  label: string;
  excludedAt: string | null | undefined;
  formatted: string | null;
}

/**
 * Presenta il timestamp della decisione manuale già conservato sulla posizione.
 * Un dato assente o invalido resta invisibile: altre date della posizione
 * descrivono eventi diversi e non possono sostituire `user_excluded_at`.
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
