"use client";

// "Find the tests closest to your case": the visitor says their computer, service, budget and trade; the rounds of the benchmark and
// the case studies that match come first, then the closest ones, each with the reason written. The state lives in the query string.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  EMPTY_QUERY,
  SECTORS,
  matchCandidates,
  parseQuery,
  queryToParams,
  type Candidate,
  type Match,
  type Query,
  type ReasonCode,
} from "@/lib/benchmark-match";

export type FinderCopy = {
  title: string;
  lead: string;
  computer: string;
  service: string;
  budget: string;
  budgetHint: string;
  trade: string;
  tradeHint: string;
  sector: string;
  any: string;
  reset: string;
  searchLabel: string;
  prompt: string;
  matchTitle: string;
  closeTitle: string;
  none: string;
  count: string;
  roundKind: string;
  caseKind: string;
  openCase: string;
  nothingExact: string;
  disclaimer: string;
  whyLabel: string;
  estimateLabel: string;
  estimateMore: string;
  estimateLess: string;
  sectors: Record<string, string>;
  reasons: Record<ReasonCode, string>;
};

export type CandidateView = Candidate & {
  title: string;
  subtitle: string;
  /** a pill: the outcome of a round */
  pill?: { label: string; color: string };
  /** a few numbers, already formatted */
  stats: { label: string; value: string }[];
};

type Props = {
  copy: FinderCopy;
  candidates: CandidateView[];
  trades: string[];
  osOptions: { value: string; label: string }[];
  serviceOptions: { value: string; label: string }[];
  locale: string;
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}

export default function BenchmarkFinder({
  copy,
  candidates,
  trades,
  osOptions,
  serviceOptions,
  locale,
}: Props) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const options = useMemo(
    () => ({
      os: osOptions.map((o) => o.value),
      service: serviceOptions.map((o) => o.value),
    }),
    [osOptions, serviceOptions],
  );
  const fromUrl = useMemo(() => parseQuery(params, options), [params, options]);
  const [budgetText, setBudgetText] = useState(
    fromUrl.budget ? String(fromUrl.budget) : "",
  );
  const [tradeText, setTradeText] = useState(fromUrl.trade);
  useEffect(() => {
    // a link opened or a back button: the fields follow the address
    setBudgetText(fromUrl.budget ? String(fromUrl.budget) : "");
    setTradeText(fromUrl.trade);
  }, [fromUrl.budget, fromUrl.trade]);

  const query: Query = fromUrl;
  function update(next: Partial<Query>) {
    const merged: Query = { ...query, ...next };
    const qs = queryToParams(merged).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const { exact, close } = useMemo(
    () => matchCandidates(candidates, query),
    [candidates, query],
  );
  const filled =
    query.os ||
    query.service ||
    query.budget ||
    query.trade.trim() ||
    query.sector;
  const nf = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const labelOf = (kind: "os" | "service" | "sector", value?: string) => {
    if (!value) return "";
    if (kind === "os")
      return osOptions.find((o) => o.value === value)?.label ?? value;
    if (kind === "service")
      return value
        .split("-")
        .map((v) => serviceOptions.find((o) => o.value === v)?.label ?? v)
        .join(" → ");
    return copy.sectors[value] ?? value;
  };
  const reasonText = (m: Match) =>
    m.reasons.map((r) => {
      const v = r.code.startsWith("os")
        ? labelOf("os", r.value)
        : r.code.startsWith("service")
          ? labelOf("service", r.value)
          : r.code.startsWith("sector")
            ? labelOf("sector", r.value)
            : r.code === "trade-similar"
              ? (r.value ?? "")
              : r.value
                ? nf.format(Number(r.value))
                : "";
      return fill(copy.reasons[r.code], {
        v,
        w: r.other ? nf.format(Number(r.other)) : "",
      });
    });

  const field =
    "block w-full border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-[13px] text-[var(--color-white)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5A4]";
  const labelCls =
    "block text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-1";
  const total = exact.length + close.length;

  const card = (m: Match, isExact: boolean) => {
    const c = m.candidate as CandidateView;
    const href = c.href;
    return (
      <li
        key={c.kind + c.id}
        className="border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            {c.kind === "case" ? copy.caseKind : copy.roundKind}
          </span>
          <span className="text-[14px] font-bold">{c.title}</span>
          {c.pill && (
            <span
              className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5"
              style={{
                color: c.pill.color,
                background: `color-mix(in srgb, ${c.pill.color} 16%, transparent)`,
              }}
            >
              {c.pill.label}
            </span>
          )}
          {isExact && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#22C55E]">
              ✓
            </span>
          )}
        </div>
        <p className="text-[12px] text-[var(--color-muted)]">{c.subtitle}</p>
        {c.stats.length > 0 && (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] tabular-nums">
            {c.stats.map((s) => (
              <div key={s.label} className="flex gap-1">
                <dt className="text-[var(--color-muted)]">{s.label}</dt>
                <dd className="font-semibold">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-[12px]">
          <span className="font-semibold">{copy.whyLabel}</span>{" "}
          {reasonText(m).join(" · ")}
        </p>
        {m.scale != null && c.cost ? (
          <p
            className="text-[12px] border-l-2 pl-3"
            style={{ borderColor: "#F59E0B" }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#F59E0B]">
              {copy.estimateLabel}
            </span>{" "}
            {fill(m.scale >= 1 ? copy.estimateMore : copy.estimateLess, {
              b: nf.format(query.budget ?? 0),
              c: nf.format(c.cost),
              x:
                m.scale >= 1
                  ? nf.format(m.scale)
                  : nf.format(Math.round(m.scale * 100)),
            })}
          </p>
        ) : null}
        {href && (
          <Link
            href={href}
            className="inline-block text-[12px] text-[#0EA5A4] underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-[#0EA5A4]"
          >
            {copy.openCase}
          </Link>
        )}
      </li>
    );
  };

  return (
    <section className="space-y-4" aria-labelledby="finder-title">
      <h2 id="finder-title" className="section-label">
        {copy.title}
      </h2>
      <p className="text-[12px] text-[var(--color-muted)] max-w-3xl">
        {copy.lead}
      </p>

      <form
        role="search"
        aria-label={copy.searchLabel}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 border border-[var(--color-border)] bg-[var(--color-card)] p-4"
        onSubmit={(e) => e.preventDefault()}
      >
        <div>
          <label htmlFor="f-os" className={labelCls}>
            {copy.computer}
          </label>
          <select
            id="f-os"
            className={field}
            value={query.os}
            onChange={(e) => update({ os: e.target.value })}
          >
            <option value="">{copy.any}</option>
            {osOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-service" className={labelCls}>
            {copy.service}
          </label>
          <select
            id="f-service"
            className={field}
            value={query.service}
            onChange={(e) => update({ service: e.target.value })}
          >
            <option value="">{copy.any}</option>
            {serviceOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-budget" className={labelCls}>
            {copy.budget}
          </label>
          <input
            id="f-budget"
            className={field}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="15"
            aria-describedby="f-budget-hint"
            value={budgetText}
            onChange={(e) => {
              setBudgetText(e.target.value);
              const n = Number(e.target.value.replace(",", "."));
              update({
                budget: Number.isFinite(n) && n > 0 && n <= 100000 ? n : null,
              });
            }}
          />
          <p
            id="f-budget-hint"
            className="mt-1 text-[10px] text-[var(--color-dim)]"
          >
            {copy.budgetHint}
          </p>
        </div>
        <div>
          <label htmlFor="f-trade" className={labelCls}>
            {copy.trade}
          </label>
          <input
            id="f-trade"
            className={field}
            type="text"
            list="f-trade-list"
            autoComplete="off"
            maxLength={80}
            aria-describedby="f-trade-hint"
            value={tradeText}
            onChange={(e) => {
              setTradeText(e.target.value);
              update({ trade: e.target.value });
            }}
          />
          <datalist id="f-trade-list">
            {trades.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <p
            id="f-trade-hint"
            className="mt-1 text-[10px] text-[var(--color-dim)]"
          >
            {copy.tradeHint}
          </p>
        </div>
        <div>
          <label htmlFor="f-sector" className={labelCls}>
            {copy.sector}
          </label>
          <select
            id="f-sector"
            className={field}
            value={query.sector}
            onChange={(e) => update({ sector: e.target.value })}
          >
            <option value="">{copy.any}</option>
            {SECTORS.map((s) => (
              <option key={s} value={s}>
                {copy.sectors[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-5">
          <button
            type="button"
            className="border border-[var(--color-border)] px-3 py-1.5 text-[12px] hover:bg-[var(--color-panel)] focus-visible:ring-2 focus-visible:ring-[#0EA5A4] disabled:opacity-40"
            disabled={!filled}
            onClick={() => {
              setBudgetText("");
              setTradeText("");
              update({ ...EMPTY_QUERY });
            }}
          >
            {copy.reset}
          </button>
        </div>
      </form>

      <div
        aria-live="polite"
        role="status"
        className="text-[12px] text-[var(--color-muted)]"
      >
        {!filled
          ? copy.prompt
          : total === 0
            ? copy.none
            : fill(copy.count, { n: String(total) })}
      </div>

      {filled && total > 0 && (
        <div className="space-y-5">
          <div className="space-y-2">
            <h3 className="text-[13px] font-bold">{copy.matchTitle}</h3>
            {exact.length === 0 ? (
              <p className="text-[12px] text-[var(--color-muted)]">
                {copy.nothingExact}
              </p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {exact.map((m) => card(m, true))}
              </ul>
            )}
          </div>
          {close.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[13px] font-bold">{copy.closeTitle}</h3>
              <ul className="grid gap-3 md:grid-cols-2">
                {close.map((m) => card(m, false))}
              </ul>
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] text-[var(--color-dim)] max-w-3xl">
        {copy.disclaimer}
      </p>
    </section>
  );
}
