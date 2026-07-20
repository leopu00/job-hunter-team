"use client";

// Rendering leggero del markdown inline nei messaggi agente→utente: gli
// agenti scrivono **grassetto**, *corsivo* e `code` (jht-notify-user non
// li strippa). Niente parser/dipendenze e niente dangerouslySetInnerHTML:
// tokenizzazione a regex → nodi React, il resto del testo resta com'è
// (i newline li rende il pre-wrap del contenitore).
import type { CSSProperties, ReactNode } from "react";
import { normalizeBody } from "@/lib/message-display";

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

export function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-bold text-[var(--color-bright)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={i}
          className="px-1 rounded text-[0.92em]"
          style={{
            background: "var(--color-panel)",
            border: "1px solid var(--color-border)",
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// Versione piatta per le anteprime a una riga (lista conversazioni):
// via i marker, resta il testo.
export function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*|\*|`/g, "");
}

export default function MessageBody({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    // overflowWrap anywhere: URL e token lunghi non devono mai produrre
    // scroll orizzontale nelle bolle chat.
    <p
      className={className}
      style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...style }}
    >
      {renderInlineMarkdown(normalizeBody(text))}
    </p>
  );
}
