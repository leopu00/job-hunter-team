import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { digestReports } from "@/lib/csp-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Dove il browser segnala ciò che la politica CSP STRETTA bloccherebbe (JHT «web capace», W6). La politica
 * va in `Content-Security-Policy-Report-Only`: non blocca niente, e qui arrivano i rapporti.
 *
 * Pubblica per costruzione: il browser non porta cookie né sessione in un rapporto. Per questo non fa
 * niente di più di una riga di log: nessuna tabella, nessun file, nessuna chiamata verso l'esterno, e della
 * riga entra solo ciò che `lib/csp-report.ts` lascia passare (direttiva, origin bloccato, percorso).
 * Risponde 204 a tutto, anche a un corpo che non capisce: non dice a chi manda cosa si legge.
 */
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PER_MINUTE = 60;
const TYPES = new Set([
  "application/csp-report",
  "application/reports+json",
  "application/json",
]);

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  const quiet = new NextResponse(null, { status: 204 });
  const rl = await checkRateLimit(
    "csp-report",
    "submit",
    clientIp(req),
    MAX_PER_MINUTE,
    60_000,
  );
  if (!rl.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSec) },
    });
  }
  const type = (req.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!TYPES.has(type)) return quiet;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return quiet;
  let text: string;
  try {
    text = await req.text();
  } catch {
    return quiet;
  }
  if (text.length > MAX_BODY_BYTES) return quiet;
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return quiet;
  }
  for (const line of digestReports(payload))
    console.warn(`[csp-report] ${line}`);
  return quiet;
}
