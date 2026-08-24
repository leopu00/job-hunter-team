const DAY_MS = 24 * 60 * 60 * 1000;

export const APPLICATION_TIMELINE_MAX_DAYS = 30;

export type ApplicationTimelinePoint = {
  date: string;
  count: number;
};

export type ApplicationTimeline = {
  points: ApplicationTimelinePoint[];
  rangeStart: string;
  rangeEnd: string;
  rangeDays: number;
  visibleTotal: number;
  allTimeTotal: number;
  isCapped: boolean;
};

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
  appliedAt: readonly string[],
  today = new Date(),
): ApplicationTimeline | null {
  const todayEpoch = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const counts = new Map<number, number>();

  for (const value of appliedAt) {
    const epoch = parseCalendarDay(value);
    // Timestamp futuri o malformati non devono estendere la timeline.
    if (epoch == null || epoch > todayEpoch) continue;
    counts.set(epoch, (counts.get(epoch) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  const applicationDays = [...counts.keys()].sort((a, b) => a - b);
  const firstApplicationEpoch = applicationDays[0];
  const cappedStart =
    todayEpoch - (APPLICATION_TIMELINE_MAX_DAYS - 1) * DAY_MS;
  const startEpoch = Math.max(firstApplicationEpoch, cappedStart);
  const points: ApplicationTimelinePoint[] = [];

  for (let epoch = startEpoch; epoch <= todayEpoch; epoch += DAY_MS) {
    points.push({ date: dayKey(epoch), count: counts.get(epoch) ?? 0 });
  }

  return {
    points,
    rangeStart: dayKey(startEpoch),
    rangeEnd: dayKey(todayEpoch),
    rangeDays: points.length,
    visibleTotal: points.reduce((sum, point) => sum + point.count, 0),
    allTimeTotal: [...counts.values()].reduce((sum, count) => sum + count, 0),
    isCapped: startEpoch > firstApplicationEpoch,
  };
}
