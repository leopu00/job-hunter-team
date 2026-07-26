import { NextRequest, NextResponse } from "next/server";
import yaml from "js-yaml";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import {
  CANDIDATE_LIST_TABLES,
  reconstructCanonicalProfile,
  type CandidateListField,
  type ProfileTables,
} from "@/lib/profile-sync";
import { decryptContacts } from "@/lib/pii-crypto";

export const dynamic = "force-dynamic";

// GET /api/cloud-sync/pull-profile
//
// Inverso del push del profilo: il container (o un PC nuovo) chiama questo
// endpoint al boot per ricostruire ~/.jht/profile/candidate_profile.yml dal
// cloud quando il file locale manca (ambiente pulito / container ricreato).
// Legge candidate_profiles + tabelle normalizzate + candidate_blocks + contacts
// e serializza lo YAML canonico.
//
// Auth: Bearer jht_sync_ token. Rate limit 30/min (read-only).

export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin, tokenId } = auth.data;

  const rl = await checkCloudSyncRateLimit("pull-profile", tokenId, 30);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retry_after_sec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const { data: profile } = await admin
    .from("candidate_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ ok: true, yaml: null, configured: false });
  }

  const list = (table: string) =>
    admin
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .order("ord", { ascending: true });

  // Le tabelle normalizzate le elenca CANDIDATE_LIST_TABLES, la stessa
  // lista che usa il push: aggiungerne una lì la fa ricostruire anche qui.
  const [listRows, contacts] = await Promise.all([
    Promise.all(
      CANDIDATE_LIST_TABLES.map(
        async ([field, table]) =>
          [field, (await list(table)).data ?? []] as const,
      ),
    ),
    admin
      .from("candidate_contacts")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const canonical = reconstructCanonicalProfile({
    profile,
    // Le righe arrivano non tipizzate da Supabase, come prima di questa
    // riscrittura: il cast le riporta alla forma che ProfileTables attende.
    ...(Object.fromEntries(listRows) as Pick<
      ProfileTables,
      CandidateListField
    >),
    contacts: decryptContacts(contacts.data) ?? null,
  });

  const yamlStr = yaml.dump(canonical, { lineWidth: 100, noRefs: true });
  return NextResponse.json({ ok: true, yaml: yamlStr, configured: true });
}
