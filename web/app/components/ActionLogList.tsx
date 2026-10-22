import type { Locale } from "@/i18n/config";
import { formatRelative } from "@/lib/message-display";
import {
  actionTitle,
  statusLabel,
  statusTone,
  type WebActionRow,
  type WebActionTone,
} from "@/lib/web-action-log";
import { WEB_ACTION_LOG_TEXT } from "@/lib/web-action-log.i18n";

const TONE_COLOR: Record<WebActionTone, string> = {
  good: "var(--color-green)",
  bad: "var(--color-red)",
  wait: "var(--color-yellow)",
  neutral: "var(--color-muted)",
};

/**
 * The rows of the action log, newest first. Text only (React escapes it:
 * nothing in a row is ever HTML). The status is a word with a colour, never a
 * colour alone; the level and the full time sit in the tooltip.
 */
export default function ActionLogList({
  rows,
  locale,
}: {
  rows: WebActionRow[];
  locale: Locale;
}) {
  const t = WEB_ACTION_LOG_TEXT[locale] ?? WEB_ACTION_LOG_TEXT.en;
  return (
    <ol
      aria-label={t.listLabel}
      data-testid="action-log-list"
      className="flex flex-col gap-px rounded border overflow-hidden"
      style={{ borderColor: "var(--color-border)" }}
    >
      {rows.map((row) => {
        const tone = statusTone(row.status);
        return (
          <li
            key={row.id}
            data-testid={`action-log-row-${row.id}`}
            data-status={row.status ?? "unknown"}
            className="px-3 py-2 flex flex-col gap-0.5"
            style={{ background: "var(--color-card)" }}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-[12px] font-semibold text-[var(--color-bright)] break-words min-w-0">
                {actionTitle(row, locale)}
                {row.target && (
                  <span className="font-normal text-[var(--color-muted)]"> · {row.target}</span>
                )}
              </span>
              <span
                data-testid="action-log-status"
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: TONE_COLOR[tone] }}
              >
                {statusLabel(row, locale)}
              </span>
              {row.level && (
                <span
                  className="text-[11px] text-[var(--color-dim)]"
                  title={t.levelHelp[row.level]}
                >
                  {t.level[row.level]}
                </span>
              )}
              <time
                dateTime={row.createdAt}
                title={new Date(row.createdAt).toLocaleString(locale, {
                  dateStyle: "short",
                  timeStyle: "medium",
                })}
                className="text-[11px] text-[var(--color-muted)] ml-auto"
              >
                {formatRelative(row.createdAt, locale)}
              </time>
            </div>
            {row.summary && (
              <p className="text-[11px] text-[var(--color-muted)] break-words">{row.summary}</p>
            )}
            {row.result && (
              <p className="text-[11px] text-[var(--color-muted)] break-words">
                {t.result}: {row.result}
              </p>
            )}
            {row.confirmedAt && (
              <p className="text-[11px] text-[var(--color-dim)]">
                {t.confirmed.replace(
                  "{time}",
                  new Date(row.confirmedAt).toLocaleTimeString(locale, { timeStyle: "short" }),
                )}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
