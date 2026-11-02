import Link from "../web-shims/next-link";
import { appLocale } from "../lib/app-locale";
import { useLocation } from "./router";
import { isItemActive, type NavItem, type NavLabel } from "./nav-items";
import { NAV_TEXT } from "./nav.i18n";
import { usePendingSetup } from "./pending-setup";

/** The words of a destination: the web's dictionary (`web`) or the desktop's own (`own`). */
export function navLabel(label: NavLabel, webText: (key: string) => string): string {
  return "web" in label ? webText(label.web) : NAV_TEXT[appLocale()][label.own];
}

/** The «!» of a setup that is still pending, as the web's NavLinks draws it. */
export function PendingMark() {
  return (
    <span
      aria-label={NAV_TEXT[appLocale()].setupPending}
      className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-3 h-3 rounded-full text-[8px] font-bold leading-none"
      style={{ background: "var(--color-yellow)", color: "#1a1500" }}
    >
      !
    </span>
  );
}

/**
 * The navbar's destinations (nav-items.ts), one link each, in the look of the web's NavLinks. A destination
 * whose page is not in the routes in force is left out: a link that would land on the dashboard is not shown.
 * NavStrip measures these anchors and moves the ones that do not fit into its «More» menu.
 */
export default function MainNav({
  items,
  hasPage,
  webText,
}: {
  items: NavItem[];
  hasPage: (href: string) => boolean;
  webText: (key: string) => string;
}) {
  const { path } = useLocation();
  const pending = usePendingSetup();
  return (
    <div className="flex items-center gap-1">
      {items
        .filter((item) => hasPage(item.href))
        .map((item) => {
          const active = isItemActive(path, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-tour={item.tour}
              aria-current={active ? "page" : undefined}
              className="relative px-2 xl:px-3 py-1.5 text-[11px] font-semibold tracking-widest hover:bg-[var(--color-card)] rounded transition-colors no-underline inline-block"
              style={{ color: active ? "var(--color-white)" : "var(--color-muted)" }}
            >
              {navLabel(item.label, webText)}
              {item.pending && pending[item.pending] && <PendingMark />}
            </Link>
          );
        })}
    </div>
  );
}
