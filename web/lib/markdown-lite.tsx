// ── MarkdownLite ───────────────────────────────────────────────────────
// Renderer markdown MINIMALE e sicuro per i testi scritti dagli agenti
// (razionale dello Scorer, prosa dell'Analista, sintesi JD). Gli agenti
// formattano con un sottoinsieme di markdown — paragrafi, a-capo, grassetto,
// corsivo, bullet list — più emoji (Unicode, passano inalterate).
//
// Volutamente NON è un parser markdown completo: niente dipendenze, niente
// `dangerouslySetInnerHTML` (zero superficie XSS), niente HTML grezzo. Rende
// solo costrutti React. Usabile lato server (RSC) perché è una funzione pura.
//
// Robustezza dati: normalizza anche le sequenze di escape LETTERALI ("\n",
// "\t") che alcuni run vecchi hanno salvato nel DB come stringa invece che
// come carattere reale (vedi anche lib/parse-analysis.ts).

import { Fragment, type ReactNode } from "react";

// Inline: **grassetto**, *corsivo* / _corsivo_. Niente annidamento (sufficiente
// per l'output degli agenti). Tutto il resto è testo (emoji incluse).
const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(INLINE_RE);
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i];
    if (!tok) continue;
    if (tok.startsWith("**") && tok.endsWith("**")) {
      out.push(<strong key={`${keyBase}-${i}`}>{tok.slice(2, -2)}</strong>);
    } else if (
      (tok.startsWith("*") && tok.endsWith("*")) ||
      (tok.startsWith("_") && tok.endsWith("_"))
    ) {
      out.push(<em key={`${keyBase}-${i}`}>{tok.slice(1, -1)}</em>);
    } else {
      out.push(<Fragment key={`${keyBase}-${i}`}>{tok}</Fragment>);
    }
  }
  return out;
}

const BULLET_RE = /^\s*[-*•]\s+/;

export function MarkdownLite({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  if (!text || !text.trim()) return null;

  // Normalizza newline reali + escape letterali ("\n", "\r\n", "\t").
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .trim();

  // Blocchi separati da riga vuota → paragrafo o lista.
  const blocks = normalized.split(/\n{2,}/);

  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const nonEmpty = lines.filter((l) => l.trim());
        const bulletLines = nonEmpty.filter((l) => BULLET_RE.test(l));

        // Lista solo se TUTTE le righe non vuote sono bullet.
        if (bulletLines.length > 0 && bulletLines.length === nonEmpty.length) {
          return (
            <ul key={bi} className="space-y-1 my-1 list-none">
              {bulletLines.map((l, li) => (
                <li key={li} className="flex gap-2">
                  <span className="shrink-0 mt-px opacity-60">•</span>
                  <span className="min-w-0">
                    {renderInline(l.replace(BULLET_RE, ""), `${bi}-${li}`)}
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        // Paragrafo: a-capo singoli → <br/>.
        return (
          <p key={bi} className="my-1.5 first:mt-0 last:mb-0">
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {renderInline(l, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
