import { NextRequest, NextResponse } from "next/server";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { isDemoPersonaKey } from "@/lib/demo/data";
import {
  DEMO_PERSONA_COOKIE,
  DEMO_FEEDBACK_COOKIE,
  WELCOME_SEEN_COOKIE,
  activeDemoPersona,
} from "@/lib/demo/mode";
import { hasSyncedData } from "@/lib/demo/pairing";
import { invalidJsonBody } from "@/app/api/_lib/error-body";

export const dynamic = "force-dynamic";

// [JHT-WEB-DEMO] Attiva/disattiva la modalità demo dell'area riservata.
// POST { persona } dal wizard /welcome → cookie jht_demo_persona: da quel
// momento lib/queries.ts serve il dataset statico della persona. DELETE
// (banner "Esci dalla demo") rimuove persona + giudizi demo. Cloud-only:
// sul deploy locale/desktop l'utente ha i dati veri, la demo non esiste.

const YEAR = 60 * 60 * 24 * 365;

// Stato demo/pairing per i client component (card in Impostazioni).
export async function GET() {
  if (!isCloudDeploy()) {
    return NextResponse.json({ persona: null, synced: true });
  }
  const [persona, synced] = await Promise.all([
    activeDemoPersona(),
    hasSyncedData(),
  ]);
  return NextResponse.json({ persona, synced });
}

export async function POST(req: NextRequest) {
  if (!isCloudDeploy()) {
    return NextResponse.json({ error: "demo solo su cloud" }, { status: 404 });
  }
  let persona: unknown;
  try {
    ({ persona } = await req.json());
  } catch {
    return invalidJsonBody();
  }
  if (!isDemoPersonaKey(persona)) {
    return NextResponse.json({ error: "persona invalida" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true, persona });
  const opts = { path: "/", maxAge: YEAR, sameSite: "lax" as const };
  res.cookies.set(DEMO_PERSONA_COOKIE, persona, { ...opts, httpOnly: true });
  // Cambiare persona invalida i giudizi della precedente (legacy_id diversi).
  res.cookies.set(DEMO_FEEDBACK_COOKIE, "", { ...opts, maxAge: 0 });
  res.cookies.set(WELCOME_SEEN_COOKIE, "1", opts);
  return res;
}

export async function DELETE() {
  if (!isCloudDeploy()) {
    return NextResponse.json({ error: "demo solo su cloud" }, { status: 404 });
  }
  const res = NextResponse.json({ ok: true });
  const gone = { path: "/", maxAge: 0 };
  res.cookies.set(DEMO_PERSONA_COOKIE, "", gone);
  res.cookies.set(DEMO_FEEDBACK_COOKIE, "", gone);
  // WELCOME_SEEN resta: uscire dalla demo non deve riproporre il wizard
  // a ogni visita — si riapre da /welcome quando l'utente vuole.
  return res;
}
