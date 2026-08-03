import { NextRequest, NextResponse } from "next/server";
import { JHT_USER_UPLOADS_DIR } from "@/lib/jht-paths";
import { isSupabaseConfigured } from "@/lib/workspace";
import { isLocalRequest, requireAuth, requireLocalWrite } from "@/lib/auth";
import { activeDemoPersona } from "@/lib/demo/mode";
import { createClient } from "@/lib/supabase/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// GET — lista dei file dell'utente.
//   • locale (container desktop): legge dal filesystem (allegati).
//   • cloud (Vercel, niente container): il filesystem non esiste, legge
//     l'INDICE candidate_files popolato dalla VPS. I binari NON sono nel DB;
//     per APRIRE un file si passa dal bridge on-demand (vedi
//     docs/internal/file-bridge-on-demand-2026-06-07.md).
export async function GET() {
  // Demo mode: il candidato fittizio non ha file sincronizzati — lista
  // vuota, MAI il filesystem locale (su dev :3002 mostrerebbe i CV veri
  // della macchina; feedback utente 23/07). Questa fixture pubblica deve
  // precedere l'auth: il layout demo non crea volutamente una sessione.
  if (await activeDemoPersona()) {
    return NextResponse.json({ files: [], mode: "cloud" });
  }
  const denied = await requireAuth();
  if (denied) return denied;
  if (isSupabaseConfigured && !(await isLocalRequest())) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ files: [] });
    const { data } = await supabase
      .from("candidate_files")
      .select("name, size, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    const rows = (data ?? []) as {
      name: string;
      size: number | null;
      updated_at: string | null;
    }[];
    const files = rows.map((f) => ({
      name: f.name,
      size: f.size ?? 0,
      modified: f.updated_at ? new Date(f.updated_at).getTime() : 0,
    }));
    // mode=cloud: il client apre i file via bridge on-demand, non con link diretto.
    return NextResponse.json({ files, mode: "cloud" });
  }

  const uploadsDir = JHT_USER_UPLOADS_DIR;
  if (!fs.existsSync(uploadsDir))
    return NextResponse.json({ files: [], mode: "local" });

  try {
    const entries = fs.readdirSync(uploadsDir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => {
        const stat = fs.statSync(path.join(uploadsDir, e.name));
        return { name: e.name, size: stat.size, modified: stat.mtimeMs };
      })
      .sort((a, b) => b.modified - a.modified);
    return NextResponse.json({ files, mode: "local" });
  } catch {
    return NextResponse.json({ files: [], mode: "local" });
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const ro = await requireLocalWrite();
  if (ro) return ro;
  const { name } = await req.json();
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "nome file richiesto" }, { status: 400 });
  }

  // Previeni path traversal
  const safeName = path.basename(name);
  const filePath = path.join(JHT_USER_UPLOADS_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "file non trovato" }, { status: 404 });
  }

  fs.unlinkSync(filePath);
  return NextResponse.json({ ok: true });
}
