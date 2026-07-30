"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDashboardT } from "./DashboardI18n";
import { useFocusTrap } from "./AccessibilityProvider";

type ItemDef = {
  id: string;
  labelKey: string;
  detailKey: string;
  href: string;
  catKey: string;
};

const ITEM_DEFS: ItemDef[] = [
  {
    id: "dashboard",
    labelKey: "gs_dashboard_label",
    detailKey: "gs_dashboard_detail",
    catKey: "cat_pages",
    href: "/dashboard",
  },
  {
    id: "positions",
    labelKey: "gs_positions_label",
    detailKey: "gs_positions_detail",
    catKey: "cat_pages",
    href: "/positions",
  },
  {
    id: "profile",
    labelKey: "gs_profile_label",
    detailKey: "gs_profile_detail",
    catKey: "cat_pages",
    href: "/profile",
  },
  {
    id: "team",
    labelKey: "gs_team_label",
    detailKey: "gs_team_detail",
    catKey: "cat_pages",
    href: "/team",
  },
  {
    id: "integrations",
    labelKey: "gs_integrations_label",
    detailKey: "gs_integrations_detail",
    catKey: "cat_pages",
    href: "/integrations",
  },
  {
    id: "settings",
    labelKey: "gs_settings_label",
    detailKey: "gs_settings_detail",
    catKey: "cat_config",
    href: "/settings",
  },
  {
    id: "credentials",
    labelKey: "gs_credentials_label",
    detailKey: "gs_credentials_detail",
    catKey: "cat_config",
    href: "/credentials",
  },
  {
    id: "providers",
    labelKey: "gs_providers_label",
    detailKey: "gs_providers_detail",
    catKey: "cat_config",
    href: "/providers",
  },
  {
    id: "channels",
    labelKey: "gs_channels_label",
    detailKey: "gs_channels_detail",
    catKey: "cat_config",
    href: "/channels",
  },
];

type Item = {
  id: string;
  label: string;
  detail: string;
  href: string;
  category: string;
};

const RECENT_KEY = "jht:search:recent";
const MAX_RECENT = 5;

function fuzzy(
  query: string,
  target: string,
): { match: boolean; indices: number[] } {
  const q = query.toLowerCase(),
    t = target.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      qi++;
    }
  }
  return { match: qi === q.length, indices };
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  const set = new Set(indices);
  return (
    <span>
      {text.split("").map((ch, i) =>
        set.has(i) ? (
          <span
            key={i}
            style={{ color: "var(--color-green)", fontWeight: 700 }}
          >
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </span>
  );
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { t } = useDashboardT();

  // Translate ITEM_DEFS to runtime items
  const ITEMS: Item[] = ITEM_DEFS.map((d) => ({
    id: d.id,
    label: t(d.labelKey),
    detail: t(d.detailKey),
    href: d.href,
    category: t(d.catKey),
  }));

  useEffect(() => {
    try {
      setRecentIds(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"));
    } catch {
      /* ignore */
    }
  }, []);

  const recent = recentIds
    .map((id) => ITEMS.find((i) => i.id === id))
    .filter(Boolean) as Item[];

  const openSearch = useCallback(() => {
    setOpen(true);
    setQuery("");
    setSelected(0);
  }, []);
  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    const onSearch = () => openSearch();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openSearch();
      }
      if (e.key === "Escape" && open) closeSearch();
    };
    document.addEventListener("jht:search" as never, onSearch);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("jht:search" as never, onSearch);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, openSearch, closeSearch]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useFocusTrap(dialogRef, open);

  const results: Array<Item & { indices: number[] }> =
    query.length < 1
      ? []
      : ITEMS.map((item) => {
          const { match, indices } = fuzzy(
            query,
            item.label + " " + item.detail,
          );
          return match ? { ...item, indices } : null;
        }).filter((x): x is Item & { indices: number[] } => x !== null);

  const displayList =
    results.length > 0
      ? results
      : query
        ? []
        : recent.map((r) => ({ ...r, indices: [] }));
  const showRecent = query.length === 0 && recent.length > 0;

  const execute = useCallback(
    (item: Item) => {
      setRecentIds((prev) => {
        const next = [item.id, ...prev.filter((id) => id !== item.id)].slice(
          0,
          MAX_RECENT,
        );
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      closeSearch();
      router.push(item.href);
    },
    [closeSearch, router],
  );

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, displayList.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && displayList[selected]) {
      e.preventDefault();
      execute(displayList[selected]);
    }
  };

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("gs_dialog_label")}
      className="fixed inset-0 flex items-start justify-center pt-[10vh] px-4 z-[9990]"
      style={{
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        animation: "fade-in 0.1s ease both",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSearch();
      }}
    >
      <div
        className="w-full max-w-xl rounded-xl overflow-hidden"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
        }}
      >
        <div
          className="flex items-center gap-2 px-4 py-3 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span
            style={{ color: "var(--color-dim)", fontSize: 14 }}
            aria-hidden="true"
          >
            🔍
          </span>
          <input
            ref={inputRef}
            value={query}
            placeholder={t("gs_input_placeholder")}
            role="combobox"
            aria-label={t("gs_input_label")}
            aria-expanded={displayList.length > 0}
            aria-controls="search-listbox"
            aria-activedescendant={
              displayList[selected]
                ? `search-item-${displayList[selected].id}`
                : undefined
            }
            aria-autocomplete="list"
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKey}
            className="flex-1 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)] rounded text-[13px]"
            style={{ color: "var(--color-bright)" }}
          />
          <kbd
            className="text-[9px] px-1.5 py-0.5 rounded"
            style={{
              background: "var(--color-border)",
              color: "var(--color-dim)",
            }}
          >
            esc
          </kbd>
        </div>

        <div
          id="search-listbox"
          role="listbox"
          className="overflow-y-auto"
          style={{ maxHeight: "55vh" }}
        >
          {showRecent && (
            <p
              className="px-4 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-widest"
              style={{ color: "var(--color-dim)" }}
            >
              {t("gs_recent")}
            </p>
          )}
          {displayList.length === 0 && query.length > 0 && (
            <p
              className="px-4 py-6 text-[11px] text-center"
              style={{ color: "var(--color-dim)" }}
            >
              {t("gs_no_results")} &ldquo;{query}&rdquo;
            </p>
          )}
          {displayList.map((item, i) => (
            <button
              key={item.id}
              id={`search-item-${item.id}`}
              role="option"
              aria-selected={i === selected}
              onClick={() => execute(item)}
              onMouseEnter={() => setSelected(i)}
              className="flex items-center gap-3 w-full px-4 py-2.5 text-left cursor-pointer transition-colors"
              style={{
                background:
                  i === selected ? "var(--color-deep)" : "transparent",
                border: "none",
              }}
            >
              <span
                className="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold shrink-0 w-14 text-center"
                style={{
                  background: "var(--color-card)",
                  color: "var(--color-dim)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {item.category}
              </span>
              <div className="flex-1 min-w-0">
                <p
                  className="text-[12px] font-semibold truncate"
                  style={{ color: "var(--color-bright)" }}
                >
                  {item.indices.length > 0 ? (
                    <Highlighted
                      text={item.label}
                      indices={item.indices.filter(
                        (idx) => idx < item.label.length,
                      )}
                    />
                  ) : (
                    item.label
                  )}
                </p>
                <p
                  className="text-[10px] truncate"
                  style={{ color: "var(--color-dim)" }}
                >
                  {item.detail}
                </p>
              </div>
              <span style={{ color: "var(--color-dim)", fontSize: 10 }}>↵</span>
            </button>
          ))}
        </div>

        <p
          className="px-4 py-2 text-[9px] border-t"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-dim)",
          }}
        >
          {t("gs_footer")}
        </p>
      </div>
    </div>
  );
}
