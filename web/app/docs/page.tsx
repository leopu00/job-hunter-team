"use client";

import Link from "next/link";
import { DOCS_NAV } from "./docs-nav";

export default function DocsIndex() {
  return (
    <div>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
          📚 Documentation
        </h1>
        <p className="text-[var(--color-muted)] text-[12px] mt-3 leading-relaxed">
          Guides for setting up and running Job Hunter Team.
        </p>
      </div>

      {DOCS_NAV.map((section) => (
        <div key={section.group} className="mb-10">
          <h2 className="text-[13px] font-bold text-[var(--color-white)] mb-4">
            {section.group}
          </h2>
          <ul className="space-y-4">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="block no-underline group">
                  <span className="text-[13px] font-semibold text-[var(--color-white)] group-hover:underline">
                    {item.emoji ? `${item.emoji} ` : ""}
                    {item.title}
                  </span>
                  {item.description ? (
                    <span className="block text-[12px] text-[var(--color-muted)] mt-1 leading-relaxed">
                      {item.description}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
