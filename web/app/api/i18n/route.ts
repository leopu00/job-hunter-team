/**
 * API i18n — Locale corrente, lista lingue, cambio locale
 */
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { JHT_HOME } from "@/lib/jht-paths";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

const PREFS_PATH = path.join(JHT_HOME, "i18n-prefs.json");

const SUPPORTED_LOCALES = [
  { code: "it", label: "Italiano", flag: "IT" },
  { code: "en", label: "English", flag: "EN" },
  { code: "hu", label: "Magyar", flag: "HU" },
  { code: "es", label: "Español", flag: "ES" },
  { code: "de", label: "Deutsch", flag: "DE" },
  { code: "fr", label: "Français", flag: "FR" },
  { code: "pt", label: "Português", flag: "PT" },
] as const;

type Locale = "it" | "en" | "hu" | "es" | "de" | "fr" | "pt";

function isLocale(v: unknown): v is Locale {
  return (
    v === "it" ||
    v === "en" ||
    v === "hu" ||
    v === "es" ||
    v === "de" ||
    v === "fr" ||
    v === "pt"
  );
}

function loadPrefs(): { locale: Locale } {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8"));
    if (isLocale(raw.locale)) return raw;
  } catch {
    /* default */
  }
  return { locale: "it" };
}

// Persistenza best-effort: in ambienti con filesystem read-only (Vercel
// serverless, dove scrivibile è solo /tmp) la scrittura fallisce, ma non deve
// bloccare il cambio lingua — la fonte primaria è il cookie NEXT_LOCALE.
function savePrefs(prefs: { locale: Locale }): void {
  try {
    const dir = path.dirname(PREFS_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = PREFS_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(prefs, null, 2), "utf-8");
    fs.renameSync(tmp, PREFS_PATH);
  } catch {
    /* filesystem read-only (es. Vercel): il cookie basta */
  }
}

// GET — locale corrente + lista lingue supportate. Il cookie NEXT_LOCALE è la
// fonte primaria; il file è il fallback persistente.
export async function GET(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  const cookieLocale = cookieMatch?.[1];
  const current = isLocale(cookieLocale) ? cookieLocale : loadPrefs().locale;
  return NextResponse.json({
    current,
    locales: SUPPORTED_LOCALES,
  });
}

// POST — cambia locale attivo. Persiste sia il file (~/.jht/i18n-prefs.json)
// sia il cookie NEXT_LOCALE letto server-side, così la prossima richiesta
// server-renderizza nella locale giusta senza flash.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const locale = body.locale as string;

    if (!isLocale(locale)) {
      return NextResponse.json(
        {
          error: `Locale non supportato: ${locale}. Validi: it, en, hu, es, de, fr, pt`,
        },
        { status: 400 },
      );
    }

    savePrefs({ locale });
    const res = NextResponse.json({
      locale,
      message: `Lingua cambiata a ${locale}`,
    });
    res.cookies.set("NEXT_LOCALE", locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    return res;
  } catch (err) {
    return sanitizedError(err, { scope: "i18n" });
  }
}
