import type { DirectChatMessage } from "./direct-chat-contract";

/**
 * What a system line says: its closed code in the person's language when the catalog has that code as
 * its OWN entry, else the words it came with. `codes` is a plain object, so a code that is the name of
 * something every object has (`__proto__`, `constructor`) must not find it.
 */
export function systemLineText(message: DirectChatMessage, codes: Record<string, string>): string {
  const code = message.role === "system" ? message.code : undefined;
  if (code && Object.prototype.hasOwnProperty.call(codes, code) && typeof codes[code] === "string") {
    return codes[code];
  }
  return message.role === "user" ? withoutAttachmentPath(message.text) : message.text;
}

/**
 * An attachment goes to the Assistant with the path of its copy in the container, closing the person's
 * sentence in one bracket (`direct_chat.rs`, `attachment_message`). The person reads the sentence only:
 * this takes off that bracket, and only that exact shape at the very end — the app's folder, the name
 * the app gives its copies — never any other brackets or paths in what someone wrote.
 */
export function withoutAttachmentPath(text: string): string {
  return text.replace(/ \[attachment for my profile: \/jht_user\/allegati\/cv-\d{8}-\d{6}(?:-\d{1,3})?\.[a-z]{2,4}\]$/, "");
}
