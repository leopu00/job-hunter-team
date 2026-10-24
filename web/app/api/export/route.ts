import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { requireAuth } from "@/lib/auth";
// Titoli e nomi azienda arrivano dagli annunci: chi li pubblica sceglie il
// primo carattere, e in un CSV il primo carattere decide se la cella è un
// dato o una formula. Il neutralizzatore sta in `shared/` perché il comando
// `jht export` ha lo stesso problema e non deve avere una risposta diversa.
import { toCsv } from "../../../../shared/export/csv.js";
// Le sorgenti sono le tabelle vive di jobs.db, le stesse del comando
// `jht export` e dell'esportazione dell'app: una sola lista in `shared/`.
import {
  EXPORT_SOURCES,
  exportRange,
  isExportSource,
  isRetiredExportSource,
  readExportRows,
  retiredExportNotice,
} from "../../../../shared/export/sources.js";

export const dynamic = "force-dynamic";

type ExportFormat = "json" | "csv";

/** GET /api/export?source=tasks&format=csv&from=2026-01-01&to=2026-12-31 */
export async function GET(req: NextRequest) {
  // Scarica in blocco candidature, contatti, aziende e colloqui: è
  // l'archivio personale dell'utente in un solo file.
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const source = sp.get("source");
  const format = (sp.get("format") ?? "json") as ExportFormat;

  // Una sorgente che non esiste più lo dice: un file vuoto sarebbe uno zero
  // indistinguibile da una squadra che non ha fatto niente.
  if (source && isRetiredExportSource(source)) {
    return NextResponse.json(
      { ok: false, error: retiredExportNotice(source), code: "source_retired" },
      { status: 410 },
    );
  }
  if (!source || !isExportSource(source)) {
    return NextResponse.json(
      {
        ok: false,
        error: `source obbligatorio: ${Object.keys(EXPORT_SOURCES).join(" | ")}`,
      },
      { status: 400 },
    );
  }
  if (format !== "json" && format !== "csv") {
    return NextResponse.json(
      { ok: false, error: "format: json | csv" },
      { status: 400 },
    );
  }

  const range = exportRange(sp.get("from"), sp.get("to"));
  if (!range) {
    return NextResponse.json(
      { ok: false, error: "date non valide (formato YYYY-MM-DD, from <= to)" },
      { status: 400 },
    );
  }

  // I dati stanno nel jobs.db del box: un sito nel cloud non li ha, e non deve
  // rispondere con un file vuoto (per i dati dell'account c'è /api/account/export).
  if (isCloudDeploy()) {
    return NextResponse.json(
      { ok: false, error: "export_local_only", code: "export_local_only" },
      { status: 409 },
    );
  }
  let rows: Record<string, unknown>[];
  try {
    rows = readExportRows(getDb(), source, range).rows;
  } catch (error) {
    // Nessun jobs.db = una squadra che non ha mai girato: lo si dice, non è un file vuoto.
    const missing =
      error instanceof Error &&
      error.message.startsWith("Database non trovato");
    return NextResponse.json(
      {
        ok: false,
        error: missing ? "export_no_database" : "read_failed",
        code: missing ? "export_no_database" : "read_failed",
      },
      { status: missing ? 404 : 500 },
    );
  }
  const filename = `jht-${source}-${new Date().toISOString().slice(0, 10)}.${format}`;

  if (format === "csv") {
    const csv = toCsv(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const body = JSON.stringify(
    {
      source,
      count: rows.length,
      exportedAt: new Date().toISOString(),
      data: rows,
    },
    null,
    2,
  );
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
