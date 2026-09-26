/**
 * Placeholder of a page that is registered in the shell but not ported yet.
 * Replace the page's index.tsx with the real page; keep the default export.
 */
export default function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <div className="max-w-6xl mx-auto px-5 pt-8 pb-8" style={{ animation: "fade-in 0.35s ease both" }}>
      <h1
        className="text-xl font-bold uppercase tracking-[0.18em] leading-none mb-2"
        style={{ color: "var(--color-white)" }}
      >
        {title}
      </h1>
      <p className="text-[11px] text-[var(--color-muted)]">{note ?? "In arrivo nella desktop."}</p>
    </div>
  );
}
