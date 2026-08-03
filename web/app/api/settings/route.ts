import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireLocalWrite } from "@/lib/auth";
import fs from "fs";
import path from "path";
import { JHT_CONFIG_PATH, JHT_HOME, JHT_USER_DIR } from "@/lib/jht-paths";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

const CONFIG_DIR = JHT_HOME;
const CONFIG_PATH = JHT_CONFIG_PATH;
const PROVIDERS = ["anthropic", "claude", "openai", "kimi", "kimi"] as const;

function sanitize(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 && !/[\n\r\0]/.test(s) ? s : undefined;
}

function maskKeys(config: Record<string, unknown>): Record<string, unknown> {
  const safe = JSON.parse(JSON.stringify(config));
  for (const p of PROVIDERS) {
    const prov = safe.providers?.[p];
    if (prov?.api_key) {
      prov.api_key = (prov.api_key as string).slice(0, 8) + "••••••••";
    }
  }
  return safe;
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  if (!fs.existsSync(CONFIG_PATH)) {
    return NextResponse.json({ exists: false, config: null });
  }
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    return NextResponse.json({ exists: true, config: maskKeys(config) });
  } catch {
    return NextResponse.json(
      { exists: true, config: null, error: "config corrotta" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
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

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
      /* usa default */
    }
  }
  const app = (body.app ?? {}) as Record<string, unknown>;
  const notif = (body.notifications ?? {}) as Record<string, unknown>;
  const dashboard = (body.dashboard ?? {}) as Record<string, unknown>;
  const updated = {
    ...existing,
    app: { ...((existing.app as Record<string, unknown>) ?? {}), ...app },
    notifications: {
      ...((existing.notifications as Record<string, unknown>) ?? {}),
      ...notif,
    },
    dashboard: {
      ...((existing.dashboard as Record<string, unknown>) ?? {}),
      ...dashboard,
    },
  };
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(updated, null, 2) + "\n",
      "utf-8",
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return sanitizedError(err, {
      status: 500,
      scope: "settings",
      publicMessage: "config_write_failed",
    });
  }
}

export async function POST(req: NextRequest) {
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

  // Danger zone actions
  if (body._action === "reset_config") {
    try {
      const defaults = {
        version: 1,
        providers: {},
        channels: {},
        workspace: JHT_USER_DIR,
        workspacePath: JHT_USER_DIR,
        cron_enabled: false,
      };
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(
        CONFIG_PATH,
        JSON.stringify(defaults, null, 2) + "\n",
        "utf-8",
      );
      return NextResponse.json({ ok: true });
    } catch (err) {
      return sanitizedError(err, {
        status: 500,
        scope: "settings",
        publicMessage: "config_reset_failed",
      });
    }
  }
  if (body._action === "clear_cache") {
    const cacheDir = path.join(CONFIG_DIR, "cache");
    try {
      if (fs.existsSync(cacheDir))
        fs.rmSync(cacheDir, { recursive: true, force: true });
      fs.mkdirSync(cacheDir, { recursive: true });
      return NextResponse.json({ ok: true });
    } catch (err) {
      return sanitizedError(err, {
        status: 500,
        scope: "settings",
        publicMessage: "cache_clear_failed",
      });
    }
  }

  // Leggi config esistente come base
  let existing: Record<string, unknown> = {
    version: 1,
    providers: {},
    channels: {},
    workspace: JHT_USER_DIR,
  };
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
      /* usa default */
    }
  }

  const activeProvider =
    sanitize(body.active_provider) ??
    String(existing.active_provider ?? "anthropic");
  if (!(PROVIDERS as readonly string[]).includes(activeProvider)) {
    return NextResponse.json(
      { error: "active_provider non valido" },
      { status: 400 },
    );
  }

  // Aggiorna providers: merge con esistente, non sovrascrivere api_key mascherate
  const incomingProviders = (body.providers ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const existingProviders = (existing.providers ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const mergedProviders: Record<string, unknown> = { ...existingProviders };
  for (const [name, conf] of Object.entries(incomingProviders)) {
    const base = existingProviders[name] ?? {};
    const apiKey = sanitize(conf.api_key as string);
    mergedProviders[name] = {
      ...base,
      ...conf,
      // Non sovrascrivere se è mascherata (contiene ••••)
      ...(apiKey && !apiKey.includes("•")
        ? { api_key: apiKey }
        : { api_key: base.api_key }),
    };
  }

  // Telegram
  const channels = (body.channels ?? existing.channels ?? {}) as Record<
    string,
    unknown
  >;

  // Cron
  const cronEnabled =
    typeof body.cron_enabled === "boolean"
      ? body.cron_enabled
      : ((existing as Record<string, unknown>).cron_enabled ?? false);

  const config = {
    ...existing,
    version: 1,
    active_provider: activeProvider,
    providers: mergedProviders,
    channels,
    // workspace e' fisso — ignora eventuali override dal body
    workspace: JHT_USER_DIR,
    workspacePath: JHT_USER_DIR,
    cron_enabled: cronEnabled,
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
      scope: "settings",
      publicMessage: "config_write_failed",
    });
  }
}
