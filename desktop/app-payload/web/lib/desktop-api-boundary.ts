import os from "node:os";
import path from "node:path";

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOOPBACK_IP = /^(::1|127\.\d+\.\d+\.\d+)$/;

/**
 * The desktop API is a local-machine control surface. Host alone is not an
 * authentication secret, so launchers also bind Next to 127.0.0.1; this guard
 * rejects requests addressed to a LAN/public host and untrusted proxy hops.
 */
export function isTrustedDesktopRequest(headers: Headers): boolean {
  if (!LOOPBACK_HOST.test(headers.get("host") ?? "")) return false;
  if (headers.get("forwarded") !== null) return false;

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstHop = forwardedFor.split(",")[0]?.trim() ?? "";
    if (!LOOPBACK_IP.test(firstHop)) return false;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp && !LOOPBACK_IP.test(realIp.trim())) return false;
  const forwardedHost = headers.get("x-forwarded-host");
  if (forwardedHost && !LOOPBACK_HOST.test(forwardedHost)) return false;
  return true;
}

/** Same authority order as shared/skills/_db.py and launcher/config.sh. */
export function resolveDesktopDbPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  if (env.JHT_DB) return env.JHT_DB;
  const jhtHome = env.JHT_HOME || path.join(home, ".jht");
  return path.join(jhtHome, "jobs.db");
}

export const DESKTOP_DB_PATH = resolveDesktopDbPath();
