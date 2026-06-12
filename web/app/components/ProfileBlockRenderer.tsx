/**
 * ProfileBlockRenderer — rende un blocco di profilo (candidate_blocks) in base
 * al suo `kind`. Il `kind` è il "contratto" di rendering del modello a 3 livelli
 * (vedi docs/internal/candidate-profile-cloud-sync-redesign-2026-06-05.md): un
 * blocco nuovo (anche custom L3) si mostra senza toccare codice, basta il kind.
 *
 * Server component (nessuna interattività). `content` è JSONB: lo trattiamo in
 * modo difensivo (cast + fallback a narrative).
 */

type KV = { label?: string; value?: string };
type KP = { heading?: string; text?: string };
type TL = {
  title?: string;
  subtitle?: string;
  period?: string;
  detail?: string;
};
type Dist = { label?: string; value?: number };

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function Narrative({ text }: { text: unknown }) {
  const s = typeof text === "string" ? text : JSON.stringify(text);
  return (
    <p className="text-[12px] text-[var(--color-bright)] leading-relaxed whitespace-pre-wrap">
      {s}
    </p>
  );
}

function TagList({ content }: { content: unknown }) {
  const tags = asArray(content).filter(
    (x): x is string => typeof x === "string",
  );
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag, i) => (
        <span
          key={i}
          className="px-2.5 py-1 text-[10px] font-medium rounded-lg bg-[var(--color-panel)] text-[var(--color-muted)] border border-[var(--color-border)]"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function KeyValue({ content }: { content: unknown }) {
  const items = asArray(content).filter(
    (x): x is KV => !!x && typeof x === "object",
  );
  if (!items.length) return null;
  return (
    <div className="flex flex-col">
      {items.map((it, i) => (
        <div
          key={i}
          className="flex items-start justify-between gap-3 py-1.5 border-b border-[var(--color-border)] last:border-0"
        >
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-dim)] flex-shrink-0">
            {it.label}
          </span>
          <span className="text-[11px] text-[var(--color-bright)] text-right">
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function KeyPoints({ content }: { content: unknown }) {
  const items = asArray(content).filter(
    (x): x is KP => !!x && typeof x === "object",
  );
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {items.map((it, i) => (
        <div key={i}>
          <div className="text-[12px] font-semibold text-[var(--color-bright)] mb-0.5">
            {it.heading}
          </div>
          {it.text && (
            <p className="text-[11px] text-[var(--color-muted)] leading-relaxed m-0">
              {it.text}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Timeline({ content }: { content: unknown }) {
  const items = asArray(content).filter(
    (x): x is TL => !!x && typeof x === "object",
  );
  if (!items.length) return null;
  return (
    <div className="flex flex-col">
      {items.map((it, i) => (
        <div key={i} className="flex gap-3">
          <div
            className="flex flex-col items-center flex-shrink-0"
            style={{ width: "16px" }}
          >
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
              style={{
                background:
                  i === 0 ? "var(--color-green)" : "var(--color-border)",
              }}
            />
            {i < items.length - 1 && (
              <div
                className="w-px flex-1 min-h-[16px]"
                style={{ background: "var(--color-border)" }}
              />
            )}
          </div>
          <div className="pb-4 flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-0.5">
              <span className="text-[12px] font-semibold text-[var(--color-bright)]">
                {it.title || "—"}
              </span>
              {it.period && (
                <span className="text-[10px] text-[var(--color-dim)] flex-shrink-0 font-mono">
                  {it.period}
                </span>
              )}
            </div>
            {it.subtitle && (
              <span className="text-[11px] text-[var(--color-muted)]">
                {it.subtitle}
              </span>
            )}
            {it.detail && (
              <p className="text-[10px] text-[var(--color-dim)] mt-1 leading-relaxed">
                {it.detail}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Distribution({ content }: { content: unknown }) {
  const items = asArray(content).filter(
    (x): x is Dist =>
      !!x && typeof x === "object" && typeof (x as Dist).value === "number",
  );
  if (!items.length) return null;
  const max = Math.max(...items.map((it) => it.value ?? 0), 1);
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => (
        <div key={i}>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-[var(--color-muted)]">{it.label}</span>
            <span className="text-[var(--color-dim)] font-mono">
              {it.value}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--color-panel)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--color-green)]"
              style={{ width: `${((it.value ?? 0) / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ProfileBlockRenderer({
  kind,
  content,
}: {
  kind: string;
  content: unknown;
}) {
  switch (kind) {
    case "tag_list":
      return <TagList content={content} />;
    case "key_value":
      return <KeyValue content={content} />;
    case "key_points":
      return <KeyPoints content={content} />;
    case "timeline":
      return <Timeline content={content} />;
    case "distribution":
      return <Distribution content={content} />;
    case "narrative":
    default:
      return <Narrative text={content} />;
  }
}
