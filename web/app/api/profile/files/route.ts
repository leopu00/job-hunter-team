import { NextRequest, NextResponse } from "next/server";
import { JHT_USER_UPLOADS_DIR } from "@/lib/jht-paths";
import { isSupabaseConfigured } from "@/lib/workspace";
import { isLocalRequest } from "@/lib/auth";
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
    const files = (data ?? []).map((f) => ({
      name: f.name as string,
      size: (f.size as number) ?? 0,
      modified: f.updated_at ? new Date(f.updated_at as string).getTime() : 0,
    }));
    return NextResponse.json({ files });
  }

  const uploadsDir = JHT_USER_UPLOADS_DIR;
  if (!fs.existsSync(uploadsDir)) return NextResponse.json({ files: [] });

  try {
    const entries = fs.readdirSync(uploadsDir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => {
        const stat = fs.statSync(path.join(uploadsDir, e.name));
        return { name: e.name, size: stat.size, modified: stat.mtimeMs };
      })
      .sort((a, b) => b.modified - a.modified);
    return NextResponse.json({ files });
  } catch {
    return NextResponse.json({ files: [] });
  }
}

export async function DELETE(req: NextRequest) {
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
