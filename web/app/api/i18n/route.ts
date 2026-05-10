/**
 * API i18n — Locale corrente, lista lingue, cambio locale
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { JHT_HOME } from '@/lib/jht-paths'
import { sanitizedError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

const PREFS_PATH = path.join(JHT_HOME, 'i18n-prefs.json');

const SUPPORTED_LOCALES = [
  { code: 'it', label: 'Italiano', flag: 'IT' },
  { code: 'en', label: 'English', flag: 'EN' },
  { code: 'hu', label: 'Magyar', flag: 'HU' },
] as const;

type Locale = 'it' | 'en' | 'hu';

function loadPrefs(): { locale: Locale } {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'));
    if (raw.locale === 'it' || raw.locale === 'en' || raw.locale === 'hu') return raw;
  } catch { /* default */ }
  return { locale: 'en' };
}

function savePrefs(prefs: { locale: Locale }): void {
  const dir = path.dirname(PREFS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = PREFS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(prefs, null, 2), 'utf-8');
  fs.renameSync(tmp, PREFS_PATH);
}

// GET — locale corrente + lista lingue supportate
export async function GET() {
  console.log('[API i18n] GET /api/i18n chiamato');
  const prefs = loadPrefs();
  console.log('[API i18n] Locale caricato:', prefs.locale);
  console.log('[API i18n] Locales supportate:', SUPPORTED_LOCALES);
  return NextResponse.json({
    current: prefs.locale,
    locales: SUPPORTED_LOCALES,
  });
}

// POST — cambia locale attivo
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const locale = body.locale as string;
    console.log('[API i18n] POST /api/i18n - locale richiesto:', locale);

    if (locale !== 'it' && locale !== 'en' && locale !== 'hu') {
      console.log('[API i18n] ERRORE: locale non supportato:', locale);
      return NextResponse.json(
        { error: `Locale non supportato: ${locale}. Validi: it, en, hu` },
        { status: 400 },
      );
    }

    savePrefs({ locale });
    console.log('[API i18n] Locale salvato:', locale);
    return NextResponse.json({ locale, message: `Lingua cambiata a ${locale}` });
  } catch (err) {
    console.log('[API i18n] ERRORE:', err);
    return sanitizedError(err, { scope: 'i18n' });
  }
}
