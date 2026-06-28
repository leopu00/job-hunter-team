import { describe, it, expect } from 'vitest';
import {
  WorkingHoursSchema,
  WorkingHoursWindowSchema,
  windowDurationHours,
  MIN_WINDOW_HOURS,
} from '../../../shared/config/schema';

// Vincoli orari di lavoro (decisione utente 2026-06-19): blocchi CONTIGUI,
// un solo blocco per giorno, minimo 4h; notte cross-midnight gestita.

describe('windowDurationHours', () => {
  it('blocco diurno 09:00→18:00 = 9h', () => {
    expect(windowDurationHours('09:00', '18:00')).toBeCloseTo(9);
  });
  it('notte 22:00→07:00 wrappa = 9h', () => {
    expect(windowDurationHours('22:00', '07:00')).toBeCloseTo(9);
  });
  it('blocco corto 09:00→11:30 = 2.5h', () => {
    expect(windowDurationHours('09:00', '11:30')).toBeCloseTo(2.5);
  });
  it('MIN_WINDOW_HOURS = 4', () => {
    expect(MIN_WINDOW_HOURS).toBe(4);
  });
});

describe('WorkingHoursWindowSchema — min 4h + no start==end', () => {
  const ok = (start: string, end: string) =>
    WorkingHoursWindowSchema.safeParse({ days: ['mon'], start, end }).success;
  it('accetta blocco >= 4h', () => expect(ok('09:00', '18:00')).toBe(true));
  it('accetta esattamente 4h', () => expect(ok('09:00', '13:00')).toBe(true));
  it('rifiuta blocco < 4h', () => expect(ok('09:00', '11:00')).toBe(false));
  it('accetta notte cross-midnight >= 4h (22:00→07:00)', () => expect(ok('22:00', '07:00')).toBe(true));
  it('rifiuta notte cross-midnight < 4h (23:00→02:00 = 3h)', () => expect(ok('23:00', '02:00')).toBe(false));
  it('rifiuta inizio = fine', () => expect(ok('09:00', '09:00')).toBe(false));
  it('rifiuta formato non HH:MM', () => expect(ok('9:00', '18:00')).toBe(false));
});

describe('WorkingHoursSchema — contiguità (1 blocco/giorno)', () => {
  const parse = (windows: unknown[]) => WorkingHoursSchema.safeParse({ timezone: 'UTC', windows });
  const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  it('default daytime 9h 7/7 valido', () => {
    expect(parse([{ days: ALL, start: '09:00', end: '18:00' }]).success).toBe(true);
  });
  it('giorni diversi con orari diversi: valido (1 blocco ciascuno)', () => {
    expect(
      parse([
        { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '18:00' },
        { days: ['sat'], start: '10:00', end: '16:00' },
      ]).success,
    ).toBe(true);
  });
  it('stesso giorno in due finestre: RIFIUTATO (blocchi sparsi)', () => {
    expect(
      parse([
        { days: ['mon'], start: '09:00', end: '13:00' },
        { days: ['mon'], start: '14:00', end: '18:00' },
      ]).success,
    ).toBe(false);
  });
  it('windows vuoto = 24/7 valido', () => {
    expect(parse([]).success).toBe(true);
  });
  it('un blocco < 4h fa fallire tutta la config', () => {
    expect(parse([{ days: ['mon'], start: '09:00', end: '11:00' }]).success).toBe(false);
  });
});
