const DAY_MS = 24 * 60 * 60 * 1000;

export const APPLICATION_TIMELINE_MAX_DAYS = 30;

export type ApplicationTimelineEvent = {
  appliedAt: string;
  response: string | null;
  responseAt: string | null;
};

export type ApplicationTimelinePoint = {
  date: string;
  /** Alias retrocompatibile della serie invii. */
  count: number;
  submitted: number;
  accepted: number;
  rejected: number;
};

export type ApplicationTimeline = {
  points: ApplicationTimelinePoint[];
  rangeStart: string;
  rangeEnd: string;
  rangeDays: number;
  /** Alias retrocompatibile di visibleSubmitted. */
  visibleTotal: number;
  /** Alias retrocompatibile di allTimeSubmitted. */
  allTimeTotal: number;
  visibleSubmitted: number;
  visibleAccepted: number;
  visibleRejected: number;
  allTimeSubmitted: number;
  allTimeAccepted: number;
  allTimeRejected: number;
  isCapped: boolean;
};

export type TimelineOutcome = "accepted" | "rejected";

/**
 * `applications.response` usa il vocabolario canonico del Mentor/UI:
 * `interview` e' l'esito positivo osservabile, `rejected` quello negativo.
 * `ghosted` e valori legacy non sono eventi accettati/rifiutati sulla linea.
 */
export function timelineOutcome(
  response: string | null,
): TimelineOutcome | null {
  if (response === "interview") return "accepted";
  if (response === "rejected") return "rejected";
  return null;
}

function dayKey(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10);
}

function parseCalendarDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const epoch = Date.UTC(year, month - 1, day);
  const parsed = new Date(epoch);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return epoch;
}

/**
 * Costruisce il conteggio giornaliero delle candidature inviate.
 *
 * La finestra parte dal primo invio finché l'anzianità è inferiore a 30
 * giorni; oltre quel limite scorre sugli ultimi 30 giorni, includendo oggi.
 * I giorni senza invii restano nella serie con count=0, così la linea non
 * suggerisce una continuità che nei dati non esiste.
 */
export function buildApplicationTimeline(
  values: readonly (ApplicationTimelineEvent | string)[],
  today = new Date(),
): ApplicationTimeline | null {
  const todayEpoch = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const submissions = new Map<number, number>();
  const accepted = new Map<number, number>();
  const rejected = new Map<number, number>();

  for (const value of values) {
    const event: ApplicationTimelineEvent =
      typeof value === "string"
        ? { appliedAt: value, response: null, responseAt: null }
        : value;
    const epoch = parseCalendarDay(event.appliedAt);
    // Timestamp futuri o malformati non devono estendere la timeline.
    if (epoch == null || epoch > todayEpoch) continue;
    submissions.set(epoch, (submissions.get(epoch) ?? 0) + 1);

    const outcome = timelineOutcome(event.response);
    const responseEpoch = event.responseAt
      ? parseCalendarDay(event.responseAt)
      : null;
    // Un esito precede logicamente mai l'invio e non puo' stare nel futuro.
    if (
      outcome == null ||
      responseEpoch == null ||
      responseEpoch < epoch ||
      responseEpoch > todayEpoch
    ) {
      continue;
    }
    const outcomeCounts = outcome === "accepted" ? accepted : rejected;
    outcomeCounts.set(
      responseEpoch,
      (outcomeCounts.get(responseEpoch) ?? 0) + 1,
    );
  }

  if (submissions.size === 0) return null;

  const applicationDays = [...submissions.keys()].sort((a, b) => a - b);
  const firstApplicationEpoch = applicationDays[0];
  const cappedStart = todayEpoch - (APPLICATION_TIMELINE_MAX_DAYS - 1) * DAY_MS;
  const startEpoch = Math.max(firstApplicationEpoch, cappedStart);
  const points: ApplicationTimelinePoint[] = [];

  for (let epoch = startEpoch; epoch <= todayEpoch; epoch += DAY_MS) {
    const submitted = submissions.get(epoch) ?? 0;
    points.push({
      date: dayKey(epoch),
      count: submitted,
      submitted,
      accepted: accepted.get(epoch) ?? 0,
      rejected: rejected.get(epoch) ?? 0,
    });
  }

  const visibleSubmitted = points.reduce(
    (sum, point) => sum + point.submitted,
    0,
  );
  const allTimeSubmitted = [...submissions.values()].reduce(
    (sum, count) => sum + count,
    0,
  );

  return {
    points,
    rangeStart: dayKey(startEpoch),
    rangeEnd: dayKey(todayEpoch),
    rangeDays: points.length,
    visibleTotal: visibleSubmitted,
    allTimeTotal: allTimeSubmitted,
    visibleSubmitted,
    visibleAccepted: points.reduce((sum, point) => sum + point.accepted, 0),
    visibleRejected: points.reduce((sum, point) => sum + point.rejected, 0),
    allTimeSubmitted,
    allTimeAccepted: [...accepted.values()].reduce(
      (sum, count) => sum + count,
      0,
    ),
    allTimeRejected: [...rejected.values()].reduce(
      (sum, count) => sum + count,
      0,
    ),
    isCapped: startEpoch > firstApplicationEpoch,
  };
}
