/**
 * Health check — verifica che i servizi JHT siano raggiungibili.
 *
 * Servizi controllati:
 *   - web:      Next.js app (JHT_WEB_URL, default http://localhost:3000)
 *   - gateway:  gateway locale (JHT_GATEWAY_URL, default http://localhost:18789)
 *   - telegram: bridge Telegram (sessione tmux JHT-BOT o JHT-TELEGRAM)
 *
 * Uso:
 *   npx tsx shared/deploy/health-check.ts
 *   npx tsx shared/deploy/health-check.ts --json
 */

import { execSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 8_000;

export type ServiceStatus = "ok" | "error" | "timeout" | "unknown";

export type ServiceHealth = {
  name: string;
  url?: string;
  ok: boolean;
  status: ServiceStatus;
  httpStatus?: number;
  ms?: number;
  error?: string;
};

export type HealthReport = {
  ok: boolean;
  ts: number;
  durationMs: number;
  services: ServiceHealth[];
};

async function checkHttp(
  name: string,
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "jht-health/1.0" },
    });
    clearTimeout(timer);
    const ms = Date.now() - start;
    const ok = res.status < 500;
    return {
      name,
      url,
      ok,
      status: ok ? "ok" : "error",
      httpStatus: res.status,
      ms,
    };
  } catch (err) {
    const ms = Date.now() - start;
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      name,
      url,
      ok: false,
      status: isTimeout ? "timeout" : "error",
      ms,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkTmuxSession(sessionPattern: string): boolean {
  try {
    const output = execSync("tmux list-sessions -F '#{session_name}' 2>/dev/null || true", {
      encoding: "utf8",
    });
    return output.split("\n").some((line) => line.trim().includes(sessionPattern));
  } catch {
    return false;
  }
}

function checkTelegram(): ServiceHealth {
  const patterns = ["JHT-BOT", "JHT-TELEGRAM", "JHT-BRIDGE"];
  const found = patterns.find((p) => checkTmuxSession(p));
  return {
    name: "telegram",
    ok: Boolean(found),
    status: found ? "ok" : "error",
    error: found ? undefined : "Nessuna sessione tmux Telegram attiva",
  };
}

export async function checkAll(opts?: { timeoutMs?: number }): Promise<HealthReport> {
  const start = Date.now();
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const webUrl = process.env.JHT_WEB_URL ?? "http://localhost:3000";
  const gatewayUrl = process.env.JHT_GATEWAY_URL ?? "http://localhost:18789";

  const [web, gateway, telegram] = await Promise.all([
    checkHttp("web", webUrl, timeoutMs),
    checkHttp("gateway", gatewayUrl, timeoutMs),
    Promise.resolve(checkTelegram()),
  ]);

  const services: ServiceHealth[] = [web, gateway, telegram];
  const allOk = services.every((s) => s.ok);

  return {
    ok: allOk,
    ts: Date.now(),
    durationMs: Date.now() - start,
    services,
  };
}

function formatReport(report: HealthReport): void {
  const icon = (ok: boolean) => (ok ? "✓" : "✗");
  const ts = new Date(report.ts).toISOString();
  console.log(`\n[health] ${ts} — ${report.ok ? "OK" : "DEGRADED"} (${report.durationMs}ms)\n`);
  for (const svc of report.services) {
    const timing = svc.ms != null ? ` ${svc.ms}ms` : "";
    const http = svc.httpStatus != null ? ` HTTP ${svc.httpStatus}` : "";
    const err = svc.error ? ` — ${svc.error}` : "";
    console.log(`  ${icon(svc.ok)} ${svc.name}${timing}${http}${err}`);
  }
  console.log();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const json = process.argv.includes("--json");
  checkAll().then((report) => {
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      formatReport(report);
    }
    process.exit(report.ok ? 0 : 1);
  });
}
