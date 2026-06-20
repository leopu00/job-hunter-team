import { NextRequest, NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import { JHT_HOME } from "@/lib/jht-paths";
import { requireAuth, requireLocalWrite } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Le credenziali della casella email del team vivono QUI, in locale (bind-mount
// del container). Le legge `shared/skills/email_monitor.py` (campi snake_case:
// user/password/imap_host/...). Mai sul cloud: write solo da localhost
// (requireLocalWrite) e la password non si espone mai in GET.
const CREDS_DIR = path.join(JHT_HOME, "credentials");
const CREDS_FILE = path.join(CREDS_DIR, "email_monitor.json");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface StoredCreds {
  imap_host: string;
  imap_port: number;
  user: string;
  password: string;
  folder: string;
  from_filters: string[];
  savedAt?: number;
}

function readCreds(): StoredCreds | null {
  if (!fs.existsSync(CREDS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CREDS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

/** GET — stato della casella (mai espone la password) */
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const creds = readCreds();
  return NextResponse.json({
    configured: !!creds?.user,
    email: creds?.user ?? null,
    host: creds?.imap_host ?? null,
    // from_filters vuoto = processa l'intera inbox dedicata (any-platform)
    anyPlatform: !creds?.from_filters || creds.from_filters.length === 0,
    savedAt: creds?.savedAt ?? null,
  });
}

/** POST — salva email + app-password della casella del team (solo localhost) */
export async function POST(req: NextRequest) {
  const ro = await requireLocalWrite();
  if (ro) return ro;
  const denied = await requireAuth();
  if (denied) return denied;

  let body: {
    email?: string;
    password?: string;
    imapHost?: string;
    imapPort?: number;
    folder?: string;
    fromFilters?: string[];
  } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }

  const email = (body.email ?? "").trim();
  // Le app-password Google sono mostrate a gruppi di 4 con spazi: rimuovili.
  const password = (body.password ?? "").replace(/\s+/g, "");

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "Indirizzo email non valido" },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { ok: false, error: "App password mancante o troppo corta" },
      { status: 400 },
    );
  }

  // Default Gmail; from_filters vuoto = any-platform (intera inbox dedicata).
  const host = (body.imapHost ?? "").trim() || "imap.gmail.com";
  const port =
    Number.isFinite(body.imapPort) && (body.imapPort as number) > 0
      ? (body.imapPort as number)
      : 993;
  const folder = (body.folder ?? "").trim() || "INBOX";
  const fromFilters = Array.isArray(body.fromFilters) ? body.fromFilters : [];

  const creds: StoredCreds = {
    imap_host: host,
    imap_port: port,
    user: email,
    password,
    folder,
    from_filters: fromFilters,
    savedAt: Date.now(),
  };

  fs.mkdirSync(CREDS_DIR, { recursive: true });
  // Scrittura atomica + permessi stretti (contiene una password).
  const tmp = `${CREDS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CREDS_FILE);

  return NextResponse.json({ ok: true, email, host }, { status: 201 });
}

/** DELETE — rimuove la casella del team (il poll smette, nessun blocco) */
export async function DELETE() {
  const ro = await requireLocalWrite();
  if (ro) return ro;
  const denied = await requireAuth();
  if (denied) return denied;
  if (!fs.existsSync(CREDS_FILE)) {
    return NextResponse.json(
      { ok: false, error: "Nessuna casella configurata" },
      { status: 404 },
    );
  }
  fs.unlinkSync(CREDS_FILE);
  return NextResponse.json({ ok: true });
}
