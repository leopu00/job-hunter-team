export type TicketErrorCopy = {
  networkError: string;
  attachmentUnavailable: string;
};

/** Never render server-provided error text in the user-facing ticket form. */
export function ticketErrorMessage(
  code: unknown,
  copy: TicketErrorCopy,
): string {
  return code === "attachment_unavailable"
    ? copy.attachmentUnavailable
    : copy.networkError;
}
