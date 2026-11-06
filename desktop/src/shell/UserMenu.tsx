import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "../web-shims/next-link";
import { appLocale } from "../lib/app-locale";
import { isItemActive, type NavItem } from "./nav-items";
import { navLabel, PendingMark } from "./MainNav";
import { NAV_TEXT } from "./nav.i18n";
import { usePendingSetup } from "./pending-setup";
import { useLocation } from "./router";
import { AccountIcon } from "./icons";

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
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Where the list hangs: under the button, in window coordinates. The list is drawn on the page's body, not inside
  // the bar, so nothing the bar sits in (its overflow, the bands under it, a scrolling box) can clip it or cover it.
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const { path } = useLocation();
  const pending = usePendingSetup();
  const text = NAV_TEXT[appLocale()];
  const lit = items.some((item) => isItemActive(path, item));
  const anyPending = items.some((item) => item.pending && pending[item.pending]);

  useEffect(() => setOpen(false), [path]);

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const box = buttonRef.current?.getBoundingClientRect();
      if (!box) return;
      setPlace({ top: Math.round(box.bottom + 4), right: Math.max(0, Math.round(document.documentElement.clientWidth - box.right)) });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
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
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${className} relative`}
        data-testid="account-menu-button"
        style={lit ? { color: "var(--color-white)" } : undefined}
        onClick={() => setOpen((visible) => !visible)}
      >
        <AccountIcon />
        {text.account} ▾
        {anyPending && <PendingMark />}
      </button>
      {open && place && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={text.accountMenu}
          data-testid="account-menu-list"
          className="min-w-[11rem] overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-panel)] py-1 shadow-lg"
          style={{ position: "fixed", top: place.top, right: place.right, zIndex: 60, maxHeight: `calc(100vh - ${place.top + 8}px)` }}
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
        </div>,
        document.body,
      )}
    </div>
  );
}
