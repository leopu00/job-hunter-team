import {
  PUBLIC_STATE_COLORS,
  publicPositionState,
  publicPositionStateLabel,
  ticketIndicatorLabel,
} from "@/lib/position-state";

export default function PositionStateCell({
  status,
  hasOpenTicket,
  locale,
}: {
  status: unknown;
  hasOpenTicket?: boolean;
  locale: string;
}) {
  const state = publicPositionState(status);
  const color = PUBLIC_STATE_COLORS[state];
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <span
        data-position-state={state}
        className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap"
        style={{ color, borderColor: color, background: `${color}18` }}
      >
        {publicPositionStateLabel(state, locale)}
      </span>
      {hasOpenTicket ? (
        <span
          data-ticket-indicator="pending"
          className="text-[8.5px] font-semibold whitespace-nowrap"
          style={{ color: "var(--color-yellow)" }}
        >
          {ticketIndicatorLabel(locale)}
        </span>
      ) : null}
    </div>
  );
}
