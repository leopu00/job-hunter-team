import type { ApplicationTimeline as Timeline } from "@/lib/application-timeline";
import {
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
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = H - PAD_TOP - PAD_BOTTOM;
  const scale = applicationTimelineScale(timeline.points);
  const x = (index: number) =>
    timeline.points.length === 1
      ? PAD_LEFT + chartW / 2
      : PAD_LEFT + (index / (timeline.points.length - 1)) * chartW;
  const y = (value: number) => projectTimelineY(value, scale, PAD_TOP, chartH);
  const zeroY = y(0);
  const pathFor = (value: (point: Timeline["points"][number]) => number) =>
    timeline.points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${x(index)} ${y(value(point))}`,
      )
      .join(" ");
  const submittedLine = pathFor((point) => point.submitted);
  const acceptedLine = pathFor((point) => point.accepted);
  const rejectedLine = pathFor((point) => -point.rejected);
  const submittedArea = `${submittedLine} L ${x(timeline.points.length - 1)} ${zeroY} L ${x(0)} ${zeroY} Z`;
  const rejectedArea = `${rejectedLine} L ${x(timeline.points.length - 1)} ${zeroY} L ${x(0)} ${zeroY} Z`;
  const xTicks = tickIndexes(timeline.points.length);
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  const formatDate = (date: string) =>
    dateFormatter.format(new Date(`${date}T00:00:00.000Z`));

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

        {timeline.points.length > 1 && (
          <path d={submittedArea} fill="var(--color-green)" opacity={0.08} />
        )}
        {timeline.points.length > 1 && (
          <path
            d={submittedLine}
            fill="none"
            stroke="var(--color-green)"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {timeline.points.length > 1 && (
          <path d={rejectedArea} fill="var(--color-red)" opacity={0.07} />
        )}
        {timeline.points.length > 1 && (
          <path
            d={acceptedLine}
            fill="none"
            stroke="var(--color-blue)"
            strokeWidth={1.75}
            strokeDasharray="5 4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {timeline.points.length > 1 && (
          <path
            d={rejectedLine}
            fill="none"
            stroke="var(--color-red)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {timeline.points.map((point, index) => (
          <circle
            key={point.date}
            cx={x(index)}
            cy={y(point.submitted)}
            r={point.submitted > 0 ? 4 : 2.25}
            fill={
              point.submitted > 0 ? "var(--color-green)" : "var(--color-card)"
            }
            stroke="var(--color-green)"
            strokeWidth={point.submitted > 0 ? 1.5 : 1}
          >
            <title>{`${formatDate(point.date)}: ${point.submitted}`}</title>
          </circle>
        ))}

        {timeline.points.map((point, index) => {
          const centerX = x(index);
          const centerY = y(point.accepted);
          const radius = point.accepted > 0 ? 4.5 : 2;
          return (
            <rect
              key={`accepted-${point.date}`}
              x={centerX - radius}
              y={centerY - radius}
              width={radius * 2}
              height={radius * 2}
              rx={1}
              fill={
                point.accepted > 0 ? "var(--color-blue)" : "var(--color-card)"
              }
              stroke="var(--color-blue)"
              strokeWidth={point.accepted > 0 ? 1.5 : 1}
              transform={`rotate(45 ${centerX} ${centerY})`}
            >
              <title>{`${formatDate(point.date)}: ${point.accepted}`}</title>
            </rect>
          );
        })}

        {timeline.points.map((point, index) => (
          <circle
            key={`rejected-${point.date}`}
            cx={x(index)}
            cy={y(-point.rejected)}
            r={point.rejected > 0 ? 4 : 2}
            fill={point.rejected > 0 ? "var(--color-red)" : "var(--color-card)"}
            stroke="var(--color-red)"
            strokeWidth={point.rejected > 0 ? 1.5 : 1}
          >
            <title>{`${formatDate(point.date)}: -${point.rejected}`}</title>
          </circle>
        ))}
      </svg>

      <ol className="sr-only">
        {timeline.points.map((point) => (
          <li
            key={point.date}
          >{`${formatDate(point.date)}: ${point.submitted}`}</li>
        ))}
      </ol>
    </section>
  );
}
