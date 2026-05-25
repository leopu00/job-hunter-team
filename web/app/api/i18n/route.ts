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
] as const;

type Locale = "it" | "en" | "hu";

function loadPrefs(): { locale: Locale } {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8"));
    if (raw.locale === "it" || raw.locale === "en" || raw.locale === "hu")
      return raw;
  } catch {
    /* default */
  }
  return { locale: "it" };
}

function savePrefs(prefs: { locale: Locale }): void {
  const dir = path.dirname(PREFS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = PREFS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(prefs, null, 2), "utf-8");
  fs.renameSync(tmp, PREFS_PATH);
}

// GET — locale corrente + lista lingue supportate. Cookie NEXT_LOCALE è la
// fonte primaria (allineata a next-intl); il file è il fallback persistente.
export async function GET(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  const cookieLocale = cookieMatch?.[1];
  const current =
    cookieLocale === "it" || cookieLocale === "en" || cookieLocale === "hu"
      ? (cookieLocale as Locale)
      : loadPrefs().locale;
  return NextResponse.json({
    current,
    locales: SUPPORTED_LOCALES,
  });
}

// POST — cambia locale attivo. Persiste sia il file (~/.jht/i18n-prefs.json)
// sia il cookie NEXT_LOCALE letto da next-intl server-side, così la prossima
// richiesta server-renderizza nella locale giusta senza flash.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const locale = body.locale as string;

    if (locale !== "it" && locale !== "en" && locale !== "hu") {
      return NextResponse.json(
        { error: `Locale non supportato: ${locale}. Validi: it, en, hu` },
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
