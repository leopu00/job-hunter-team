import { createContext, useContext, type ComponentProps } from "react";
import { navigate } from "../../shell/router";

/**
 * The technical pages (hours, models, VPS link, backup, export, removal) are pages on their own and, in the
 * Settings sections, parts of a page: there they have no «back» of their own (the sections' column is the
 * way around) and their title is a heading of the second level under the page's.
 */
export const EmbeddedContext = createContext(false);
export const useEmbedded = () => useContext(EmbeddedContext);

/** The «← back to Settings» of a page opened on its own; nothing inside a section. */
export function BackToSettings({ label }: { label: string }) {
  if (useEmbedded()) return null;
  return (
    <button
      type="button"
      onClick={() => navigate("/settings")}
      className="self-start text-[11px] tracking-[0.14em] uppercase text-[var(--color-dim)] hover:text-[var(--color-bright)]"
    >
      ← {label}
    </button>
  );
}

/** The title of a page: the page's h1, or an h2 under the section's. */
export function PageTitle(props: ComponentProps<"h1">) {
  const Tag = useEmbedded() ? "h2" : "h1";
  return <Tag {...props} />;
}
