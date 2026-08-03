import fs from "fs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/workspace";
import { isProfileComplete, readWorkspaceProfile } from "@/lib/profile-reader";
import { isLocalRequest, requireAuth } from "@/lib/auth";
import { JHT_PROFILE_READY_FLAG } from "@/lib/jht-paths";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  // Due sorgenti, una per corsia: sul cloud il profilo è la riga
  // `candidate_profiles` dell'utente loggato, in locale è il YAML nel
  // workspace di chi ha aperto l'app.
  //
  // [JHT-DASHBOARD-NATIVE, rimosso 24/07] Qui c'era una terza via: un
  // local-token (Bearer o cookie `jht_local_token`) valeva come "locale" per
  // la dashboard nativa Electron, che chiamava questa route via
  // `window.dashboardApi`. Electron è stato eliminato (19/07) — il desktop
  // ora è il gioco Godot, che parla direttamente con Supabase e non passa mai
  // di qui. Anche l'altra giustificazione, la chat /onboarding, è caduta con
  // la pagina (l'onboarding vive nel wizard del gioco). Nessun chiamante
  // resta, e il cookie citato non lo scriveva comunque nessuno: la corsia era
  // solo superficie d'attacco in più su un endpoint che serve nome, email,
  // telefono e storia lavorativa dell'utente.
  const useCloudAuth = isSupabaseConfigured && !(await isLocalRequest());

  if (useCloudAuth) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json(
        { profile: null, ready: false },
        { status: 401 },
      );

    const { data } = await supabase
      .from("candidate_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    return NextResponse.json({ profile: data ?? null, ready: false });
  }

  const profile = readWorkspaceProfile();
  // Il bottone "Vai alla dashboard" si abilita se uno dei due è vero:
  //   (a) l'assistente ha creato ~/.jht/profile/ready.flag (canale esplicito).
  //   (b) il YAML soddisfa già la checklist minima (nome, ruolo, città,
  //       anni, email, ≥2 skill, ≥1 lingua, ≥1 esperienza, ≥1 titolo).
  // Il fallback (b) evita il bug classico in cui l'assistente annuncia in
  // chat "ho sbloccato" senza aver effettivamente eseguito il comando shell
  // che crea il flag: con la checklist completa, da qui `ready` è già true
  // e l'utente non resta bloccato per un'allucinazione del modello.
  const ready =
    fs.existsSync(JHT_PROFILE_READY_FLAG) || isProfileComplete(profile);
  return NextResponse.json({ profile, ready });
}
