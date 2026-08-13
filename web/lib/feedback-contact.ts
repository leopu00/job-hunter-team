/**
 * Contratto minimo del modulo pubblico di contatto.
 *
 * Vive fuori dal componente React perché il recapito deve essere verificabile
 * come dato consegnato, non soltanto come campo visibile. Il server ripete la
 * validazione: questo controllo serve a dare un errore utile prima della rete.
 */
export function validReplyEmail(value: unknown): boolean {
  if (typeof value !== "string") return value === undefined || value === null;
  const email = value.trim();
  if (!email) return true;
  if (email.length > 254 || /[\r\n]/.test(email)) return false;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
}

export function publicContactPayload({
  message,
  email,
  locale,
  website,
}: {
  message: string;
  email: string;
  locale: string;
  website: string;
}) {
  return {
    client: "web-contact",
    kind: "bug",
    happened: message,
    doing: "Public web report: /contact",
    platform: "web",
    locale,
    website,
    // Facoltativo per conservare l'invio anonimo. Quando presente, il server
    // lo usa esclusivamente come Reply-To e non lo copia nel testo o nei log.
    reply_to: email.trim(),
  };
}
