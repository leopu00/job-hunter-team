import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { JHT_HOME } from "@/lib/jht-paths";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const PREFS_PATH = path.join(JHT_HOME, "preferences.json");

// tour_done vive sul DB (user_onboarding_state.tour_done_at) per
// l'utente loggato: il file locale e' ephemeral su Vercel Lambda e
// non sopravvive a cold start, quindi il wizard si riapriva ogni
// volta. Le altre preferenze (theme, language, notifications,
// shortcuts) restano sul file: sono dev-local-only.

async function readTourDoneFromDb(): Promise<boolean | null> {
  try {
    const supabase = await createServerSupabase();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return null;
    const { data, error } = await supabase
      .from("user_onboarding_state")
      .select("tour_done_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return null;
    return Boolean(data?.tour_done_at);
  } catch {
    return null;
  }
}

async function writeTourDoneToDb(done: boolean): Promise<boolean> {
  try {
    const supabase = await createServerSupabase();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return false;
    const admin = createAdminClient();
    const { error } = await admin.from("user_onboarding_state").upsert(
      {
        user_id: user.id,
        tour_done_at: done ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    return !error;
  } catch {
    return false;
  }
}

type ShortcutMap = Record<string, string>;

type UiState = {
  tour_done: boolean;
};

type UserPreferences = {
  theme: "dark" | "light";
  language: "it" | "en";
  notifications: {
    enabled: boolean;
    sound: boolean;
    desktop: boolean;
  };
  shortcuts: ShortcutMap;
  ui_state: UiState;
};

const DEFAULTS: UserPreferences = {
  theme: "dark",
  language: "it",
  notifications: { enabled: true, sound: false, desktop: false },
  shortcuts: {},
  ui_state: { tour_done: false },
};

function load(): UserPreferences {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8"));
    return {
      ...DEFAULTS,
      ...raw,
      notifications: {
        ...DEFAULTS.notifications,
        ...(raw.notifications ?? {}),
      },
      ui_state: { ...DEFAULTS.ui_state, ...(raw.ui_state ?? {}) },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(prefs: UserPreferences): void {
  fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
  const tmp = PREFS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(prefs, null, 2), "utf-8");
  fs.renameSync(tmp, PREFS_PATH);
}

// APERTE DI PROPOSITO — né requireAuth né requireLocalWrite.
// Sono preferenze di CHROME (tema, lingua, suoni, scorciatoie, "tour già
// visto"), non dati personali. Due ragioni concrete per non chiuderle:
//
//   1. la PATCH parte dal `ThemeProvider`, che sta nel layout ROOT: il toggle
//      chiaro/scuro esiste anche sulla landing pubblica, senza sessione.
//   2. l'unico dato che sopravvive davvero sul cloud è `tour_done`, e quello
//      è GIÀ legato all'utente della sessione (`user_onboarding_state`,
//      filtrata per user.id): senza login la scrittura non tocca nessuno.
//
// Il file locale è l'altra metà: su Vercel il filesystem è read-only e la
// `save()` fallisce in silenzio per costruzione (vedi i try/catch sotto).
export async function GET() {
  const prefs = load();
  const dbDone = await readTourDoneFromDb();
  if (dbDone !== null) {
    prefs.ui_state = { ...prefs.ui_state, tour_done: dbDone };
  }
  return NextResponse.json(prefs);
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body non valido" }, { status: 400 });
  }

  const prefs = load();

  if (body.theme === "dark" || body.theme === "light") prefs.theme = body.theme;
  if (body.language === "it" || body.language === "en")
    prefs.language = body.language;
  if (body.notifications && typeof body.notifications === "object") {
    const n = body.notifications as Record<string, unknown>;
    if (typeof n.enabled === "boolean") prefs.notifications.enabled = n.enabled;
    if (typeof n.sound === "boolean") prefs.notifications.sound = n.sound;
    if (typeof n.desktop === "boolean") prefs.notifications.desktop = n.desktop;
  }
  if (body.shortcuts && typeof body.shortcuts === "object") {
    prefs.shortcuts = {
      ...prefs.shortcuts,
      ...(body.shortcuts as ShortcutMap),
    };
  }
  let tourDoneFromBody: boolean | undefined;
  if (body.ui_state && typeof body.ui_state === "object") {
    const u = body.ui_state as Record<string, unknown>;
    if (typeof u.tour_done === "boolean") {
      prefs.ui_state.tour_done = u.tour_done;
      tourDoneFromBody = u.tour_done;
    }
  }

  if (tourDoneFromBody !== undefined) {
    const ok = await writeTourDoneToDb(tourDoneFromBody);
    if (ok) {
      prefs.ui_state.tour_done = tourDoneFromBody;
    }
  }

  // Best-effort: il file fallisce silenziosamente in env senza FS
  // scrivibile (Vercel). tour_done e' gia' persistito sul DB sopra.
  try {
    save(prefs);
  } catch {
    /* read-only FS — ignora */
  }
  return NextResponse.json(prefs);
}

export async function DELETE() {
  // Reset anche del tour DB per simmetria con DEFAULTS (tour_done=false)
  await writeTourDoneToDb(false);
  try {
    save({ ...DEFAULTS });
  } catch {
    /* read-only FS — ignora */
  }
  return NextResponse.json({ ok: true });
}
