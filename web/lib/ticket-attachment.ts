export const TICKET_ATTACHMENT_MARKER = "[FILE ALLEGATI]";
const UPLOAD_PATH = /^\/jht_user\/allegati\/([A-Za-z0-9._-]+)$/;

export type TicketRequestParts = {
  text: string;
  attachmentPath: string | null;
  attachmentName: string | null;
};

/**
 * Il ticket sincronizza già `request_text` in entrambi i versi. Il riferimento
 * al file usa quindi lo stesso protocollo dell'Assistente, non una seconda
 * tabella che web, box e cloud dovrebbero mantenere coerente.
 */
export function ticketRequestWithAttachment(
  text: string,
  attachmentPath?: string | null,
): string {
  const request = text.trim();
  if (!attachmentPath) return request;
  if (!UPLOAD_PATH.test(attachmentPath)) {
    throw new Error("invalid attachment path");
  }
  return `${request}\n\n${TICKET_ATTACHMENT_MARKER}\n${attachmentPath}`;
}

/** Separa la presentazione utente dal path operativo che legge il team. */
export function splitTicketRequest(request: string): TicketRequestParts {
  const separator = `\n\n${TICKET_ATTACHMENT_MARKER}\n`;
  const markerAt = request.lastIndexOf(separator);
  if (markerAt < 0) {
    return { text: request, attachmentPath: null, attachmentName: null };
  }
  const attachmentPath = request.slice(markerAt + separator.length);
  const match = UPLOAD_PATH.exec(attachmentPath);
  if (!match) {
    return { text: request, attachmentPath: null, attachmentName: null };
  }
  return {
    text: request.slice(0, markerAt),
    attachmentPath,
    attachmentName: match[1],
  };
}
