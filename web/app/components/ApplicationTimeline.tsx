import type { ApplicationTimeline as Timeline } from "@/lib/application-timeline";

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
const H = 230;
const PAD_LEFT = 36;
const PAD_RIGHT = 14;
const PAD_TOP = 18;
const PAD_BOTTOM = 34;

function niceCeiling(value: number): number {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const nice = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * power;
}

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
  const maxY = niceCeiling(
    Math.max(...timeline.points.map((point) => point.count)),
  );
  const x = (index: number) =>
    timeline.points.length === 1
      ? PAD_LEFT + chartW / 2
      : PAD_LEFT + (index / (timeline.points.length - 1)) * chartW;
  const y = (count: number) => PAD_TOP + chartH - (count / maxY) * chartH;
  const line = timeline.points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.count)}`,
    )
    .join(" ");
  const area = `${line} L ${x(timeline.points.length - 1)} ${PAD_TOP + chartH} L ${x(0)} ${PAD_TOP + chartH} Z`;
  const yTicks = [...new Set([0, Math.ceil(maxY / 2), maxY])];
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

        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              x2={PAD_LEFT + chartW}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-border)"
              strokeWidth={1}
              strokeDasharray={tick === 0 ? undefined : "2 5"}
              opacity={tick === 0 ? 0.9 : 0.55}
            />
            <text
              x={PAD_LEFT - 9}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--color-dim)"
              style={{ fontFamily: "inherit" }}
            >
              {tick}
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
                y1={PAD_TOP + chartH}
                y2={PAD_TOP + chartH + 4}
                stroke="var(--color-dim)"
              />
              <text
                x={x(index)}
                y={PAD_TOP + chartH + 18}
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
          <path d={area} fill="var(--color-green)" opacity={0.08} />
        )}
        {timeline.points.length > 1 && (
          <path
            d={line}
            fill="none"
            stroke="var(--color-green)"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {timeline.points.map((point, index) => (
          <circle
            key={point.date}
            cx={x(index)}
            cy={y(point.count)}
            r={point.count > 0 ? 4 : 2.25}
            fill={point.count > 0 ? "var(--color-green)" : "var(--color-card)"}
            stroke="var(--color-green)"
            strokeWidth={point.count > 0 ? 1.5 : 1}
          >
            <title>{`${formatDate(point.date)}: ${point.count}`}</title>
          </circle>
        ))}
      </svg>

      <ol className="sr-only">
        {timeline.points.map((point) => (
          <li
            key={point.date}
          >{`${formatDate(point.date)}: ${point.count}`}</li>
        ))}
      </ol>
    </section>
  );
}
