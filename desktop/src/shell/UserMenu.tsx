import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "../web-shims/next-link";
import { appLocale } from "../lib/app-locale";
import { isItemActive, type NavItem } from "./nav-items";
import { navLabel, PendingMark } from "./MainNav";
import { NAV_TEXT } from "./nav.i18n";
import { usePendingSetup } from "./pending-setup";
import { useLocation } from "./router";

const itemCls =
  "block w-full text-left px-3 py-1.5 text-[11px] font-semibold tracking-widest hover:bg-[var(--color-card)] no-underline disabled:opacity-50";

/**
 * The account menu on the right of the navbar: the pages about the person and the app (profile, mail,
 * settings, help) and the two ways out, «leave the app» and «sign out». A menu, not a row of buttons:
 * the bar keeps the positions and the team.
 */
export default function UserMenu({
  items,
  webText,
  actions,
  className,
}: {
  items: NavItem[];
  webText: (key: string) => string;
  /** The ways out, after a divider: each is a button of the menu. */
  actions: { key: string; label: ReactNode; onSelect: () => void; disabled?: boolean; title?: string; testId?: string }[];
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { path } = useLocation();
  const pending = usePendingSetup();
  const text = NAV_TEXT[appLocale()];
  const lit = items.some((item) => isItemActive(path, item));
  const anyPending = items.some((item) => item.pending && pending[item.pending]);

  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
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

  return (
    <div ref={wrapRef} className="relative" data-testid="account-menu">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${className} relative`}
        data-testid="account-menu-button"
        style={lit ? { color: "var(--color-white)" } : undefined}
        onClick={() => setOpen((visible) => !visible)}
      >
        {text.account} ▾
        {anyPending && <PendingMark />}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={text.accountMenu}
          className="absolute right-0 top-full mt-1 z-40 min-w-[11rem] rounded border border-[var(--color-border)] bg-[var(--color-panel)] py-1 shadow-lg"
        >
          {items.map((item) => {
            const active = isItemActive(path, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                data-tour={item.tour}
                aria-current={active ? "page" : undefined}
                className={`${itemCls} relative`}
                style={{ color: active ? "var(--color-white)" : "var(--color-muted)" }}
              >
                {navLabel(item.label, webText)}
                {item.pending && pending[item.pending] && <PendingMark />}
              </Link>
            );
          })}
          {actions.length > 0 && <div role="separator" className="my-1 border-t border-[var(--color-border)]" />}
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              className={itemCls}
              style={{ color: "var(--color-muted)" }}
              disabled={action.disabled}
              title={action.title}
              data-testid={action.testId}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
