"use client";

type Props = {
  page: number;
  totalCompanys: number;
  perCompany: number;
  totalItems: number;
  onCompany: (p: number) => void;
  onPerCompany?: (n: number) => void;
  perCompanyOptions?: number[];
};

const PER_PAGE_DEFAULTS = [10, 25, 50, 100];

function CompanyBtn({
  label,
  onClick,
  active,
  disabled,
  "aria-label": ariaLabel,
}: {
  label: string | number;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="min-w-[36px] h-[36px] sm:min-w-[30px] sm:h-[30px] px-2 rounded text-[10px] font-mono font-semibold cursor-pointer transition-all disabled:opacity-30 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-void)]"
      style={{
        border: `1px solid ${active ? "var(--color-green)" : "var(--color-border)"}`,
        color: active ? "var(--color-green)" : "var(--color-muted)",
        background: active ? "rgba(0,232,122,0.08)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

export function Pagination({
  page,
  totalCompanys,
  perCompany,
  totalItems,
  onCompany,
  onPerCompany,
  perCompanyOptions = PER_PAGE_DEFAULTS,
}: Props) {
  if (totalCompanys <= 0) return null;
  const pages: (number | "…")[] = [];
  if (totalCompanys <= 7) {
    for (let i = 1; i <= totalCompanys; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (
      let i = Math.max(2, page - 1);
      i <= Math.min(totalCompanys - 1, page + 1);
      i++
    )
      pages.push(i);
    if (page < totalCompanys - 2) pages.push("…");
    pages.push(totalCompanys);
  }
  const start = (page - 1) * perCompany + 1;
  const end = Math.min(page * perCompany, totalItems);
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between flex-wrap gap-3 text-[10px]"
    >
      <span style={{ color: "var(--color-dim)" }}>
        {start}–{end} of {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <CompanyBtn
          label="←"
          onClick={() => onCompany(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        />
        {pages.map((p, i) =>
          p === "…" ? (
            <span
              key={`e${i}`}
              className="px-1"
              style={{ color: "var(--color-dim)" }}
            >
              …
            </span>
          ) : (
            <CompanyBtn
              key={p}
              label={p}
              onClick={() => onCompany(p as number)}
              active={p === page}
            />
          ),
        )}
        <CompanyBtn
          label="→"
          onClick={() => onCompany(page + 1)}
          disabled={page >= totalCompanys}
          aria-label="Next page"
        />
      </div>
      {onPerCompany && (
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--color-dim)" }}>per page</span>
          <select
            aria-label="Rows per page"
            value={perCompany}
            onChange={(e) => onPerCompany(Number(e.target.value))}
            className="px-2 py-1 rounded text-[10px] font-mono cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-void)]"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
              color: "var(--color-muted)",
            }}
          >
            {perCompanyOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}
    </nav>
  );
}
