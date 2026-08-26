"use client";

import { useId, useState } from "react";
import type { ApplicationTimeline as Timeline } from "@/lib/application-timeline";
import {
  applicationTimelineBarLayout,
  applicationTimelineScale,
  projectTimelineY,
} from "@/lib/application-timeline-chart";

type Props = {
  timeline: Timeline;
  locale: string;
  labels: {
    title: string;
    range: string;
    total: string;
    description: string;
    submitted: string;
    accepted: string;
    rejected: string;
  };
};

const W = 960;
const H = 270;
const PAD_LEFT = 36;
const PAD_RIGHT = 14;
const PAD_TOP = 18;
const PAD_BOTTOM = 38;

function tickIndexes(length: number): number[] {
  if (length <= 7) return Array.from({ length }, (_, index) => index);
  return [
    ...new Set(
      [0, 0.25, 0.5, 0.75, 1].map((p) => Math.round((length - 1) * p)),
    ),
  ];
}

export default function ApplicationTimeline({
  timeline,
  locale,
  labels,
}: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const tooltipId = useId();
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = H - PAD_TOP - PAD_BOTTOM;
  const scale = applicationTimelineScale(timeline.points);
  const barLayout = applicationTimelineBarLayout(
    timeline.points.length,
    chartW,
  );
  const x = (index: number) => PAD_LEFT + barLayout.slotWidth * (index + 0.5);
  const y = (value: number) => projectTimelineY(value, scale, PAD_TOP, chartH);
  const zeroY = y(0);
  const barX = (index: number, seriesIndex: number) =>
    x(index) -
    barLayout.groupWidth / 2 +
    seriesIndex * (barLayout.barWidth + barLayout.gap);
  const xTicks = tickIndexes(timeline.points.length);
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  const formatDate = (date: string) =>
    dateFormatter.format(new Date(`${date}T00:00:00.000Z`));
  const detailDateFormatter = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const formatDetailDate = (date: string) =>
    detailDateFormatter.format(new Date(`${date}T00:00:00.000Z`));
  const pointLabel = (point: Timeline["points"][number]) =>
    `${formatDetailDate(point.date)}. ${labels.submitted}: ${point.submitted}. ${labels.accepted}: ${point.accepted}. ${labels.rejected}: ${point.rejected}.`;
  const activePoint =
    activeIndex == null ? null : (timeline.points[activeIndex] ?? null);
  const activeX = activeIndex == null ? null : x(activeIndex);
  const tooltipLeft =
    activeX == null ? 50 : Math.min(88, Math.max(12, (activeX / W) * 100));
  const tooltipTop = activePoint
    ? Math.max(
        20,
        (Math.min(y(activePoint.submitted), y(activePoint.accepted), zeroY) /
          H) *
          100,
      )
    : 50;

  return (
    <section
      className="mb-8 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]"
      aria-labelledby="application-timeline-title"
    >
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 id="application-timeline-title" className="section-label">
          {labels.title}
        </h2>
        <div className="flex items-center gap-3 text-[10px] text-[var(--color-muted)] tabular-nums">
          <span>{labels.range}</span>
          <span className="font-semibold text-[var(--color-green)]">
            {labels.total}
          </span>
        </div>
      </div>

      <ul
        className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] text-[var(--color-muted)] tabular-nums"
        aria-label={labels.description}
      >
        {[
          {
            label: labels.submitted,
            total: timeline.visibleSubmitted,
            color: "var(--color-green)",
          },
          {
            label: labels.accepted,
            total: timeline.visibleAccepted,
            color: "var(--color-blue)",
          },
          {
            label: labels.rejected,
            total: -timeline.visibleRejected,
            color: "var(--color-red)",
          },
        ].map((series) => (
          <li key={series.label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-1.5 rounded-[1px]"
              style={{ background: series.color }}
            />
            <span>{series.label}</span>
            <strong style={{ color: series.color }}>{series.total}</strong>
          </li>
        ))}
      </ul>

      <div className="relative">
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={labels.description}
          style={{ overflow: "visible" }}
        >
          <title>{labels.description}</title>
          <desc>
            {labels.range}. {labels.total}.
          </desc>

          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD_LEFT}
                x2={PAD_LEFT + chartW}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--color-border)"
                strokeWidth={1}
                strokeDasharray={tick === 0 ? undefined : "2 5"}
                opacity={tick === 0 ? 1 : 0.45}
              />
              <text
                x={PAD_LEFT - 9}
                y={y(tick) + 3}
                textAnchor="end"
                fontSize={9}
                fill="var(--color-dim)"
                style={{ fontFamily: "inherit" }}
              >
                {tick > 0 ? `+${tick}` : tick}
              </text>
            </g>
          ))}

          {xTicks.map((index) => {
            const point = timeline.points[index];
            return (
              <g key={point.date}>
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1={zeroY - 2}
                  y2={zeroY + 2}
                  stroke="var(--color-dim)"
                />
                <text
                  x={x(index)}
                  y={PAD_TOP + chartH + 21}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--color-dim)"
                  style={{ fontFamily: "inherit" }}
                >
                  {formatDate(point.date)}
                </text>
              </g>
            );
          })}

          {timeline.points.map((point, index) => {
            return (
              <g key={`bars-${point.date}`}>
                {point.submitted > 0 && (
                  <rect
                    x={barX(index, 0)}
                    y={y(point.submitted)}
                    width={barLayout.barWidth}
                    height={zeroY - y(point.submitted)}
                    rx={Math.min(2, barLayout.barWidth / 3)}
                    fill="var(--color-green)"
                    opacity={0.92}
                  />
                )}
                {point.accepted > 0 && (
                  <rect
                    x={barX(index, 1)}
                    y={y(point.accepted)}
                    width={barLayout.barWidth}
                    height={zeroY - y(point.accepted)}
                    rx={Math.min(2, barLayout.barWidth / 3)}
                    fill="var(--color-blue)"
                    opacity={0.92}
                  />
                )}
                {point.rejected > 0 && (
                  <rect
                    x={barX(index, 2)}
                    y={zeroY}
                    width={barLayout.barWidth}
                    height={y(-point.rejected) - zeroY}
                    rx={Math.min(2, barLayout.barWidth / 3)}
                    fill="var(--color-red)"
                    opacity={0.92}
                  />
                )}
              </g>
            );
          })}

          {activeIndex != null && activeX != null && (
            <line
              x1={activeX}
              x2={activeX}
              y1={PAD_TOP}
              y2={PAD_TOP + chartH}
              stroke="var(--color-bright)"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.45}
              pointerEvents="none"
            />
          )}

          {timeline.points.map((point, index) => {
            const hitLeft = PAD_LEFT + index * barLayout.slotWidth;
            return (
              <g
                key={`hit-${point.date}`}
                tabIndex={0}
                role="img"
                aria-label={pointLabel(point)}
                aria-describedby={activeIndex === index ? tooltipId : undefined}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "touch") setActiveIndex(index);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType !== "touch") setActiveIndex(null);
                }}
                onPointerDown={(event) => {
                  if (event.pointerType !== "mouse") {
                    setActiveIndex((current) =>
                      current === index ? null : index,
                    );
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setActiveIndex(null);
                    event.currentTarget.blur();
                  }
                }}
                className="outline-none"
              >
                <rect
                  x={hitLeft}
                  y={PAD_TOP}
                  width={barLayout.slotWidth}
                  height={chartH}
                  fill="transparent"
                  stroke={
                    activeIndex === index
                      ? "var(--color-border-glow)"
                      : "transparent"
                  }
                  strokeWidth={1}
                  rx={3}
                />
              </g>
            );
          })}
        </svg>

        {activePoint && (
          <div
            id={tooltipId}
            role="tooltip"
            aria-live="polite"
            className="pointer-events-none absolute z-10 min-w-[190px] max-w-[240px] -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--color-border-glow)] bg-[var(--color-panel)] px-3 py-2.5 shadow-xl"
            style={{ left: `${tooltipLeft}%`, top: `${tooltipTop}%` }}
          >
            <div className="mb-2 border-b border-[var(--color-border)] pb-1.5 text-[11px] font-semibold capitalize text-[var(--color-bright)]">
              {formatDetailDate(activePoint.date)}
            </div>
            <div className="space-y-1.5">
              {[
                {
                  label: labels.submitted,
                  value: activePoint.submitted,
                  color: "var(--color-green)",
                },
                {
                  label: labels.accepted,
                  value: activePoint.accepted,
                  color: "var(--color-blue)",
                },
                {
                  label: labels.rejected,
                  value: -activePoint.rejected,
                  color: "var(--color-red)",
                },
              ].map((series) => {
                const dailyMax = Math.max(
                  1,
                  activePoint.submitted,
                  activePoint.accepted,
                  activePoint.rejected,
                );
                const width = `${(Math.abs(series.value) / dailyMax) * 100}%`;
                return (
                  <div
                    key={series.label}
                    className="grid grid-cols-[1fr_58px_24px] items-center gap-2 text-[10px]"
                  >
                    <span className="text-[var(--color-muted)]">
                      {series.label}
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
                      <span
                        className="block h-full rounded-full"
                        style={{ background: series.color, width }}
                      />
                    </span>
                    <strong
                      className="text-right tabular-nums"
                      style={{ color: series.color }}
                    >
                      {series.value}
                    </strong>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <ol className="sr-only">
        {timeline.points.map((point) => (
          <li key={point.date}>{pointLabel(point)}</li>
        ))}
      </ol>
    </section>
  );
}
