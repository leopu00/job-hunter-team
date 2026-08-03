import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { JHT_CONFIG_PATH, JHT_HOME, JHT_USER_DIR } from "@/lib/jht-paths";
import { ACTIVE_PROVIDERS } from "@/lib/providers";
import { requireAuth, requireLocalWrite } from "@/lib/auth";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

const CONFIG_DIR = JHT_HOME;
const CONFIG_PATH = JHT_CONFIG_PATH;

// Provider accettati come `active_provider`: runtime canonici + alias legacy.
// I nomi delle credenziali OAuth non sono processi avviabili e quindi non
// appartengono a questo contratto.
const VALID_PROVIDERS = ACTIVE_PROVIDERS;

function sanitizeString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Chiavi il cui VALORE è un segreto. Il masking non può basarsi su una lista
 * di provider/canali noti: la config sul disco è scritta dagli agenti e dal
 * wizard e cresce (bot Telegram per ruolo, webhook multipli, provider nuovi).
 * Enumerare i posti dove guardare significa dimenticarne uno — e quello
 * dimenticato finisce in chiaro nella risposta HTTP. Qui invece guardiamo
 * ovunque e decidiamo sul NOME della chiave.
 */
const SECRET_KEY_RE =
  /(api[_-]?key|token|secret|password|passwd|webhook_url|credential)/i;

/** Mostra i primi 8 caratteri (bastano a riconoscere quale chiave è) e nasconde il resto. */
function maskValue(v: string): string {
  return v.slice(0, 8) + "••••••••";
}

/**
 * Maschera in-place ogni segreto raggiungibile da `node`, a qualunque
 * profondità: `providers.<qualunque>.api_key`,
 * `channels.telegram.bots.<ruolo>.bot_token`, `channels.slack.token`,
 * `channels.webhooks[].webhook_url`, ecc.
 */
function maskSecretsDeep(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) maskSecretsDeep(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") {
      if (v && SECRET_KEY_RE.test(k)) obj[k] = maskValue(v);
    } else {
      maskSecretsDeep(v);
    }
  }
}

export async function GET() {
  // Anche mascherata, questa config dice quali provider e quali canali
  // l'utente ha collegato: non è roba da servire a chiunque passi.
  const denied = await requireAuth();
  if (denied) return denied;
  if (!fs.existsSync(CONFIG_PATH)) {
    return NextResponse.json({ exists: false, config: null });
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    // Copia profonda: mascheriamo la copia, mai l'oggetto che rappresenta il
    // file su disco. `providers` E `channels`: i token dei bot Telegram, il
    // token Slack e le URL webhook sono segreti quanto una API key —
    // uscivano in chiaro perché il masking guardava solo i provider.
    const safe = JSON.parse(JSON.stringify(config));
    maskSecretsDeep(safe.providers);
    maskSecretsDeep(safe.channels);
    return NextResponse.json({ exists: true, config: safe });
  } catch {
    return NextResponse.json({
      exists: true,
      config: null,
      error: "config corrotta",
    });
  }
}

export async function POST(req: NextRequest) {
  // Riscrive ~/.jht/jht.config.json, incluse le credenziali dei provider:
  // è una scrittura di configurazione, quindi solo dall'app desktop.
  const denied = await requireAuth();
  if (denied) return denied;
  const ro = await requireLocalWrite();
  if (ro) return ro;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  const activeProvider = sanitizeString(body.active_provider);
  if (
    !activeProvider ||
    !(VALID_PROVIDERS as readonly string[]).includes(activeProvider)
  ) {
    return NextResponse.json(
      { error: "active_provider non valido" },
      { status: 400 },
    );
  }

  const providers = body.providers as Record<string, unknown> | undefined;
  if (!providers || typeof providers !== "object") {
    return NextResponse.json(
      { error: "providers obbligatorio" },
      { status: 400 },
    );
  }

  const activeConf = providers[activeProvider] as
    | Record<string, unknown>
    | undefined;
  if (!activeConf) {
    return NextResponse.json(
      { error: "configurazione per il provider attivo mancante" },
      { status: 400 },
    );
  }

  const authMethod = sanitizeString(activeConf.auth_method);
  if (authMethod === "api_key") {
    const key = sanitizeString(activeConf.api_key as string);
    if (!key)
      return NextResponse.json(
        { error: "api_key obbligatoria" },
        { status: 400 },
      );
    if (/[\n\r\0]/.test(key))
      return NextResponse.json(
        { error: "api_key contiene caratteri non validi" },
        { status: 400 },
      );
  } else if (authMethod === "subscription") {
    const sub = activeConf.subscription as Record<string, unknown> | undefined;
    if (!sub?.email)
      return NextResponse.json(
        { error: "email obbligatoria per subscription" },
        { status: 400 },
      );
  } else {
    return NextResponse.json(
      { error: "auth_method non valido" },
      { status: 400 },
    );
  }

  // Workspace path fisso — ignora qualsiasi override dal body
  const config = {
    version: 1,
    active_provider: activeProvider,
    providers,
    channels: body.channels ?? {},
    workspace: JHT_USER_DIR,
    workspacePath: JHT_USER_DIR,
  };

  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(config, null, 2) + "\n",
      "utf-8",
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return sanitizedError(err, {
      status: 500,
      scope: "setup",
      publicMessage: "config_write_failed",
    });
  }
}
