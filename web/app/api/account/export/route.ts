// Export dei dati cloud dell'utente loggato, in JSON.
//
// `/export` esiste da tempo ma legge i file locali di `JHT_HOME`, quindi
// sul cloud è nascosto: proprio dove i dati dell'utente vivono davvero —
// su Supabase — non c'era modo di riaverli. Questa route colma quel buco.
//
// Stesse tabelle che la cancellazione porta via, e non è una coincidenza:
// l'elenco è condiviso (`USER_DATA_TABLES`), così «cosa posso esportare» e
// «cosa viene cancellato» non possono divergere. Se domani nasce una
// tabella con i dati dell'utente e la si aggiunge a uno solo dei due
// elenchi, il test lo segnala.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { USER_DATA_TABLES } from "@/lib/account-data-tables";
import { EXPORT_COLUMNS } from "@/lib/account-export-columns";

export async function GET() {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ error: "not_cloud" }, { status: 501 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const data: Record<string, unknown[]> = {};
  const failed: string[] = [];

  for (const table of USER_DATA_TABLES) {
    // Allowlist esplicita, mai `select("*")`: una colonna aggiunta domani
    // non deve poter finire nell'export senza che nessuno lo decida. Se
    // una tabella non è nell'elenco, non si esporta affatto — è voluto, e
    // il test lo verifica.
    const columns = EXPORT_COLUMNS[table];
    if (!columns) {
      failed.push(table);
      continue;
    }
    const { data: rows, error } = await admin
      .from(table)
      .select(columns.join(","))
      .eq("user_id", user.id);
    if (error) {
      // Una tabella che non si legge non deve far fallire tutto l'export:
      // meglio consegnare il resto e dire cosa manca, che negare tutto.
      failed.push(table);
      continue;
    }
    data[table] = rows ?? [];
  }

  const payload = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email ?? null },
    // Dichiarato nel file stesso: chi lo apre fra un anno sa cosa NON c'è.
    note:
      "Contiene i dati sincronizzati sul cloud. I dati che restano solo " +
      "sulla tua macchina non sono qui: quelli si esportano dall'app.",
    incomplete: failed.length > 0 ? failed : undefined,
    data,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="jht-account-export.json"`,
      "Cache-Control": "no-store",
    },
  });
}
