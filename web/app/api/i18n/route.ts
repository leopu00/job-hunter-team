/**
 * API i18n — Locale corrente, lista lingue, cambio locale
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

export const dynamic = 'force-dynamic'

const PREFS_PATH = path.join(homedir(), '.jht', 'i18n-prefs.json');

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
  return { locale: 'it' };
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
  const prefs = loadPrefs();
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

    if (locale !== 'it' && locale !== 'en' && locale !== 'hu') {
      return NextResponse.json(
        { error: `Locale non supportato: ${locale}. Validi: it, en, hu` },
        { status: 400 },
      );
    }

    savePrefs({ locale });
    return NextResponse.json({ locale, message: `Lingua cambiata a ${locale}` });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
