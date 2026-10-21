/**
 * A failed step's own last line (runtime_log.rs failure_cause) is a sentence
 * when the script said why, and a piece of a command when it only echoed what
 * it ran: «t '%{http_code}' --proxy http://… = 403». The first is told to the
 * person; the second stays in the technical details.
 */
const COMMAND_PIECE = [
  /%\{|\$\{|\$\(|`/,
  /(^|\s)--?[a-z][\w-]*(=|\s|$)/i,
  /&&|\|\||\s2>|\s\|\s/,
  /\\\\/,
];

export function isReadableCause(cause: string): boolean {
  const line = cause.trim();
  if (line.length < 12 || !/\s/.test(line)) return false;
  // a sentence starts with a word, not with one letter cut from a command or a quote
  if (/^[^\p{L}\p{N}]/u.test(line) || /^\S{1,2}\s+['"]/.test(line)) return false;
  return !COMMAND_PIECE.some((piece) => piece.test(line));
}
