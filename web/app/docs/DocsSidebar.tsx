"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "./docs-nav";

export default function DocsSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:block w-48 shrink-0">
      <nav className="sticky top-28 space-y-6" aria-label="Documentation">
        {DOCS_NAV.map((section) => (
          <div key={section.group}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-dim)] mb-2">
              {section.group}
            </div>
            <ul className="space-y-1.5">
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`block text-[12px] no-underline transition-colors ${
                        active
                          ? "text-[var(--color-white)] font-semibold"
                          : "text-[var(--color-muted)] hover:text-[var(--color-white)]"
                      }`}
                    >
                      {item.emoji ? `${item.emoji} ` : ""}
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
