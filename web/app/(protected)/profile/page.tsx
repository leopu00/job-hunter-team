import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/workspace";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { readWorkspaceProfile } from "@/lib/profile-reader";
import { isLocalRequest } from "@/lib/auth";
import { activeDemoPersona } from "@/lib/demo/mode";
import { getDemoCandidate } from "@/lib/demo/profile";
import type { CandidateProfile } from "@/lib/types";
import { locales, defaultLocale, type Locale } from "@/i18n/config";
import { getProfileT } from "@/lib/profile-i18n";
import { decryptContacts } from "@/lib/pii-crypto";
import ProfileView, { type ProfileBlock } from "./ProfileView";

export default async function ProfilePage() {
  // Locale corrente dalla fonte unica: il cookie NEXT_LOCALE.
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: Locale =
    cookieLocale && (locales as string[]).includes(cookieLocale)
      ? (cookieLocale as Locale)
      : defaultLocale;
  const t = getProfileT(locale);

  let profile: CandidateProfile | null = null;
  let blocks: ProfileBlock[] = [];
  let cloudContacts: Record<string, string | null> | null = null;

  // In locale (desktop container su localhost) il profilo vive nel
  // workspace YAML, Supabase non viene interpellato — coerente con il
  // bypass auth in (protected)/layout.tsx e proxy.ts. Sul deploy CLOUD
  // invece la fonte è SEMPRE Supabase, anche se la richiesta arriva da
  // localhost (dev server in modalità cloud): decidere per origine
  // richiesta mandava il dev :3002 sul workspace vuoto → "nessun
  // profilo" con dati presenti sul cloud (21/07).
  // Demo mode: profilo candidato fittizio della persona attiva, così anche
  // /profile è dimostrabile prima del pairing (feedback utente 23/07).
  const demoPersona = await activeDemoPersona();
  if (demoPersona) {
    const d = getDemoCandidate(demoPersona);
    profile = d.profile;
    cloudContacts = d.contacts;
  } else if (
    isSupabaseConfigured &&
    (isCloudDeploy() || !(await isLocalRequest()))
  ) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return (
        <div className="p-12 text-center text-[var(--color-muted)]">
          {t("session_expired")}{" "}
          <Link href="/" className="text-[var(--color-green)]">
            {t("sign_in_again")}
          </Link>
        </div>
      );
    }
    const { data } = (await supabase
      .from("candidate_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single()) as { data: CandidateProfile | null };
    profile = data;
    const { data: blocksData } = await supabase
      .from("candidate_blocks")
      .select("key,kind,title,content,ord")
      .eq("user_id", user.id)
      .order("ord", { ascending: true });
    blocks = blocksData ?? [];
    // Contatti (PII): vivono in candidate_contacts (cifrata), non in positioning.
    const { data: contactsRow } = await supabase
      .from("candidate_contacts")
      .select("email,phone,linkedin,github,website,address")
      .eq("user_id", user.id)
      .maybeSingle();
    cloudContacts = decryptContacts(contactsRow) as Record<
      string,
      string | null
    > | null;
  } else {
    profile = readWorkspaceProfile();
  }

  return (
    <ProfileView
      profile={profile}
      blocks={blocks}
      cloudContacts={cloudContacts}
      locale={locale}
      canEdit={!isCloudDeploy()}
    />
  );
}
