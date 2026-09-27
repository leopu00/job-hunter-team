import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileBlock } from "@/app/(protected)/profile/ProfileView";
import type { CandidateProfile } from "@/lib/types";

export type ProfileData = {
  profile: CandidateProfile | null;
  blocks: ProfileBlock[];
  contacts: Record<string, string | null> | null;
  /** Campi di contatto cifrati col segreto del server: qui non si aprono. */
  sealedContacts: string[];
};

// Formato di web/lib/pii-crypto.ts: `enc:v1:<base64(iv|tag|ciphertext)>`.
const SEALED_PREFIX = "enc:v1:";
const CONTACT_FIELDS = ["email", "phone", "linkedin", "github", "website", "address"] as const;

/**
 * I contatti vivono cifrati in candidate_contacts con JHT_PII_KEY, un
 * segreto del server che nell'app non entra. Un valore in chiaro (righe
 * scritte prima della cifratura) si mostra; uno cifrato no: il web senza
 * chiave mostrerebbe il testo cifrato, qui il campo resta vuoto e si dice.
 */
export function openContacts(row: Record<string, string | null | undefined> | null): {
  contacts: Record<string, string | null> | null;
  sealed: string[];
} {
  if (!row) return { contacts: null, sealed: [] };
  const contacts: Record<string, string | null> = {};
  const sealed: string[] = [];
  for (const field of CONTACT_FIELDS) {
    const value = row[field] ?? null;
    if (typeof value === "string" && value.startsWith(SEALED_PREFIX)) {
      contacts[field] = null;
      sealed.push(field);
    } else {
      contacts[field] = value;
    }
  }
  return { contacts, sealed };
}

/**
 * web/app/(protected)/profile/page.tsx, ramo cloud: profilo, blocchi e
 * contatti dell'utente, con la sua sessione (RLS). `null` = nessuna sessione.
 */
export async function loadProfile(client: SupabaseClient): Promise<ProfileData | null> {
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;
  const [profileRes, blocksRes, contactsRes] = await Promise.all([
    client.from("candidate_profiles").select("*").eq("user_id", userId).maybeSingle(),
    client
      .from("candidate_blocks")
      .select("key,kind,title,content,ord")
      .eq("user_id", userId)
      .order("ord", { ascending: true }),
    client
      .from("candidate_contacts")
      .select("email,phone,linkedin,github,website,address")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (profileRes.error) throw profileRes.error;
  const { contacts, sealed } = openContacts(
    (contactsRes.data as Record<string, string | null> | null) ?? null,
  );
  return {
    profile: (profileRes.data as CandidateProfile | null) ?? null,
    blocks: (blocksRes.data as ProfileBlock[] | null) ?? [],
    contacts,
    sealedContacts: sealed,
  };
}

/** Il file di web/app/api/profile/export/route.ts, fatto qui: stesso JSON, stesso nome. */
export function profileExport(profile: CandidateProfile, today: Date = new Date()): {
  json: string;
  fileName: string;
} {
  return {
    json: JSON.stringify(profile, null, 2),
    fileName: `profilo-candidato-${today.toISOString().slice(0, 10)}.json`,
  };
}
