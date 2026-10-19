import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "../web-shims/next-link";
import { appLocale } from "../lib/app-locale";
import { fitCount } from "./nav-fit";
import { useLocation } from "./router";
import { SHELL_TEXT } from "./shell.i18n";

/** Space between two links: the `gap-1` of the row. */
const GAP = 4;
/** Room kept for the «More» button once a link does not fit. */
const MORE_RESERVE = 72;

type Hidden = { href: string; label: string };

const sameHidden = (a: Hidden[], b: Hidden[]) =>
  a.length === b.length && a.every((item, i) => item.href === b[i].href && item.label === b[i].label);

/**
 * The navbar's links, as many as fit the strip, and a «More» menu with the rest.
 *
 * The links come from two places the strip does not own (the web's NavLinks and
 * the desktop's own pages), so it works on what they render: every `<a>` in the
 * row is measured, the ones that do not fit are taken out of the layout, and
 * the menu lists them with the same href and label. Nothing is measured where
 * there is no layout (width 0 = everything fits), so a test without a browser
 * sees every link. A new page, a longer language or a smaller window changes
 * how many are in the menu, never whether the last one is cut.
 */
export default function NavStrip({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Hidden[]>([]);
  const [open, setOpen] = useState(false);
  const { path } = useLocation();
  const text = SHELL_TEXT[appLocale()];

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const row = rowRef.current;
    if (!wrap || !row) return;
    const measure = () => {
      const anchors = [...row.querySelectorAll<HTMLAnchorElement>("a")];
      // Natural widths: put every link back before measuring.
      for (const a of anchors) a.style.display = "";
      const fits = fitCount(
        anchors.map((a) => a.offsetWidth),
        GAP,
        wrap.clientWidth,
        Math.max(MORE_RESERVE, (moreRef.current?.offsetWidth ?? 0) + GAP),
      );
      anchors.forEach((a, i) => {
        a.style.display = i < fits ? "" : "none";
      });
      const next = anchors.slice(fits).map((a) => ({
        href: (a.getAttribute("href") ?? "").replace(/^#/, ""),
        label: (a.textContent ?? "").trim(),
      }));
      setHidden((current) => (sameHidden(current, next) ? current : next));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(wrap);
    window.addEventListener("resize", measure);
    // The web fonts change every width once they are in.
    void document.fonts?.ready.then(measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  });

  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const isActive = (href: string) => path === href || path.startsWith(href + "/");
  const moreActive = hidden.some((item) => isActive(item.href));

  return (
    <div ref={wrapRef} className="min-w-0 flex-1 flex items-center gap-1" data-testid="navbar-links">
      <div
        className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain"
        // the strip never scrolls once the overflow goes in the menu; this is the net under it
        data-testid="navbar-links-scroll"
      >
        <div ref={rowRef} className="flex w-max items-center gap-1 mx-auto">
          {children}
        </div>
      </div>
      {hidden.length > 0 && (
        <div ref={moreRef} className="relative flex-shrink-0" data-testid="navbar-more">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((visible) => !visible)}
            className="px-2 xl:px-3 py-1.5 text-[11px] font-semibold tracking-widest hover:bg-[var(--color-card)] rounded transition-colors"
            style={{ color: moreActive ? "var(--color-white)" : "var(--color-muted)" }}
          >
            {text.more} ▾
          </button>
          {open && (
            <div
              role="menu"
              aria-label={text.more}
              className="absolute right-0 top-full mt-1 z-40 min-w-[9rem] rounded border border-[var(--color-border)] bg-[var(--color-panel)] py-1 shadow-lg"
            >
              {hidden.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className="block px-3 py-1.5 text-[11px] font-semibold tracking-widest hover:bg-[var(--color-card)] no-underline"
                  style={{ color: isActive(item.href) ? "var(--color-white)" : "var(--color-muted)" }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
