import type { ReactNode } from "react";

export function OverviewFacts({ children }: { children: ReactNode }) {
  return (
    <dl data-overview-facts="" className="grid w-full min-w-0 gap-y-1.5">
      {children}
    </dl>
  );
}

/** Una riga semantica label/valore. Il valore conserva sempre una larghezza
 * utile: prima entrambe le colonne erano `auto` e, accanto allo score, il
 * browser poteva comprimere il valore fino a una lettera per riga. */
export function OverviewFactRow({
  factId,
  label,
  children,
}: {
  factId: string;
  label: string;
  children: ReactNode;
}) {
  const labelId = `overview-fact-${factId}-label`;

  return (
    <div
      data-overview-fact-row={factId}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(7rem,auto)] items-baseline gap-x-3"
    >
      <dt
        id={labelId}
        data-overview-fact-label={factId}
        className="min-w-0 text-[10px] text-[var(--color-dim)]"
      >
        {label}
      </dt>
      <dd
        data-overview-fact-cell={factId}
        aria-labelledby={labelId}
        className="min-w-0 break-normal text-right text-[11px] text-[var(--color-base)]"
      >
        {children}
      </dd>
    </div>
  );
}
