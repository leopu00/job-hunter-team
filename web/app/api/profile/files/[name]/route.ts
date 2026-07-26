import { NextRequest, NextResponse } from "next/server";
import {
  JHT_USER_UPLOADS_DIR,
  JHT_USER_CV_DIR,
  JHT_USER_OUTPUT_DIR,
} from "@/lib/jht-paths";
import { safeResolveUnder } from "@/lib/fs-safety";
import { isLocalRequest, requireAuth } from "@/lib/auth";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

// Cartelle utente servibili in locale (mirror del file-bridge poller VPS):
// allegati (drop-zone), cv (CV/CL generati), output (altri artefatti).
const SERVE_DIRS = [JHT_USER_UPLOADS_DIR, JHT_USER_CV_DIR, JHT_USER_OUTPUT_DIR];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  // Stessa corsia della route sorella (`../route.ts`, che LISTA questi file):
  // in locale il filesystem è quello dell'utente che ha aperto l'app e si
  // serve senza login, altrimenti serve una sessione. Qui pesa di più: là si
  // espongono i nomi, qui i BYTE del CV.
  if (!(await isLocalRequest())) {
    const denied = await requireAuth();
    if (denied) return denied;
  }

  const { name } = await params;
  const safeName = path.basename(decodeURIComponent(name));

  // Cerca il file per basename nelle cartelle servibili. basename() neutralizza
  // ../ e safeResolveUnder chiude i symlink che escono da ciascuna cartella.
  // Il primo match vince (i basename CV includono id posizione → univoci).
  let realPath: string | null = null;
  for (const dir of SERVE_DIRS) {
    const resolved = safeResolveUnder(dir, path.join(dir, safeName));
    if (resolved) {
      realPath = resolved;
      break;
    }
  }
  if (!realPath) {
    return NextResponse.json({ error: "file non trovato" }, { status: 404 });
  }

  const ext = path.extname(safeName).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  const buf = fs.readFileSync(realPath);

  return new NextResponse(buf, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "no-cache",
    },
  });
}
