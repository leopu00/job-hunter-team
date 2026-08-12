import type { PositionTicket } from "@/lib/types";

export const RESCORE_TICKET_KIND = "rescore";

export type ActiveRescoreStatus = "open" | "assigned";

export function activeRescoreTicket(
  tickets: PositionTicket[],
): PositionTicket | null {
  return (
    tickets.find(
      (ticket) =>
        ticket.kind === RESCORE_TICKET_KIND &&
        (ticket.status === "open" || ticket.status === "assigned"),
    ) ?? null
  );
}
