/**
 * `logo_fetch.py` as a native tool (T14, skill logo-extraction).
 *
 * The same search and verdict: the company row by exact name (NOCASE), the
 * enrichment policy's brake and score gate, then the home page's icons in
 * the script's order (apple-touch-icon, a large icon, og:image, any icon,
 * then the four conventional paths), each downloaded and accepted only as a
 * PNG, JPEG, ICO or WebP between 200 bytes and 35 KB and at least 32 px a
 * side where the header tells. The logo is stored as a data URI; the image
 * never reaches the model, only the JSON line.
 *
 * Differences, on purpose:
 * - Every download goes through the runtime's SSRF guard (`safe-get.ts`):
 *   https only, public addresses only, every redirect checked. The website
 *   comes from a scraped ad.
 * - `--force` is refused: it bypasses the person's spending brake, which is
 *   "an explicit manual action" in the script's words, and an autonomous
 *   agent is not a manual action.
 * - Entities in an icon's href are decoded for the forms a URL carries
 *   (numeric, `&amp;` `&lt;` `&gt;` `&quot;` `&apos;`), not HTML5's whole table.
 */

import { SafeHttpsClient } from "../../../../../api-worker/src/safe-http.ts";
import { parseArgv, pyRepr } from "../../db/argv.ts";
import type { EnrichmentPolicy } from "../../db/enrichment-policy.ts";
import type { Database } from "../../db/jobs-db.ts";
import { pyJson, pyStr } from "../../db/py-format.ts";
import type { ScriptResult } from "../../db/tools.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { argvTool } from "./argv-tool.ts";
import { safeGet, SafeGetError } from "./safe-get.ts";

const MAX_LOGO_BYTES = 35_000;
const MIN_LOGO_BYTES = 200;
const MIN_LOGO_DIM = 32;
const MAX_HTML_BYTES = 512_000;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

export interface LogoFetchOptions {
  db: () => Database;
  client: SafeHttpsClient;
  policy: EnrichmentPolicy | undefined;
}

/** `sniff_mime`: the format from the magic bytes, never from Content-Type. */
export function sniffMime(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (data.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))) return "image/x-icon";
  if (data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** `image_dims`: width and height from the header where it is readable without an image library. */
export function imageDims(data: Buffer, mime: string): [number, number] | null {
  if (mime === "image/png" && data.length >= 24) return [data.readUInt32BE(16), data.readUInt32BE(20)];
  if (mime === "image/x-icon" && data.length >= 8) return [data[6] || 256, data[7] || 256];
  if (mime === "image/webp" && data.length >= 30) {
    const chunk = data.subarray(12, 16).toString("latin1");
    if (chunk === "VP8X") return [data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1];
    if (chunk === "VP8L") {
      const bits = data.readUInt32LE(21);
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    if (chunk === "VP8 ") return [data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff];
  }
  return null;
}

/** `validate_image`. */
function validateImage(raw: Buffer | null): [Buffer, string] | null {
  if (raw === null || raw.length < MIN_LOGO_BYTES || raw.length > MAX_LOGO_BYTES) return null;
  const mime = sniffMime(raw);
  if (mime === null) return null;
  const dims = imageDims(raw, mime);
  if (dims !== null && Math.min(...dims) < MIN_LOGO_DIM) return null;
  return [raw, mime];
}

function unescapeHref(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);?/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return named[body] ?? whole;
  });
}

/** `urljoin`, or null when the result is not a URL. */
function join(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/** `collect_candidates`: (priority, -size hint, url) from the home page's <link> and <meta> tags. */
export function collectCandidates(html: string, baseUrl: string): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  for (const [tag] of html.matchAll(/<(?:link|meta)\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*["']([^"']*)["']/g)) attrs[m[1]!.toLowerCase()] = unescapeHref(m[2]!);
    const rel = (attrs["rel"] || "").toLowerCase();
    const prop = (attrs["property"] || attrs["name"] || "").toLowerCase();
    const href = attrs["href"] || attrs["content"] || "";
    if (!href || href.startsWith("data:")) continue;
    const m = /^(\d+)/.exec(attrs["sizes"] || "");
    const size = m ? Number(m[1]) : 0;
    const url = join(baseUrl, href.trim());
    if (url === null) continue;
    if (rel.includes("apple-touch-icon")) out.push([1, -(size || 180), url]);
    else if (rel.includes("icon")) out.push([size >= 96 ? 2 : 4, -size, url]);
    else if (prop === "og:image") out.push([3, 0, url]);
  }
  return out;
}

/** `with_scheme`: a website stored without one is https. */
function withScheme(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website.replace(/^\/+/, "")}`;
}

/** Python's tuple order: priority, then -size, then the URL. */
const byTuple = (x: [number, number, string], y: [number, number, string]) =>
  x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);

export async function logoFetch(argv: string[], options: LogoFetchOptions): Promise<ScriptResult> {
  const a = parseArgv(
    {
      prog: "logo_fetch.py",
      positionals: [{ name: "company" }],
      options: [
        { flag: "--website" },
        { flag: "--from-url" },
        { flag: "--force", storeTrue: true },
        { flag: "--mark-attempted", storeTrue: true },
        { flag: "--dry-run", storeTrue: true },
      ],
    },
    argv,
  );
  const print = (result: Record<string, unknown>): ScriptResult => ({
    stdout: `${pyJson(result, { ensureAscii: false })}\n`,
    exitCode: result["ok"] ? 0 : 1,
  });
  if (a["force"]) {
    return print({
      ok: false,
      error: "--force bypasses the person's spending brake and is a manual action: not available to this agent. Without it, a present logo is kept and the policy decides.",
      status_code: "POLICY_DISABLED",
    });
  }
  const get = async (url: string): Promise<{ status: number; finalUrl: string; body: Buffer } | null> => {
    try {
      return await safeGet(options.client, url, { userAgent: USER_AGENT, maxBytes: 5_000_000, timeoutMs: 20_000, maxRedirects: 5 });
    } catch {
      return null;
    }
  };
  const fetchBytes = async (url: string): Promise<Buffer | null> => {
    const r = await get(url);
    return r && r.status === 200 && r.body.length <= MAX_LOGO_BYTES ? r.body : null;
  };
  const refusal = async (url: string): Promise<ScriptResult | null> => {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") throw new SafeGetError(`scheme not allowed: ${u.protocol.replace(/:$/, "")}`);
      await options.client.assertUrl(u);
      return null;
    } catch (error) {
      return print({ ok: false, error: `URL refused before any fetch: ${(error as Error).message}`, status_code: "URL_REFUSED" });
    }
  };

  const db = options.db();
  try {
    const row = db.prepare("SELECT id, name, website, logo, logo_fetched FROM companies WHERE name = ? COLLATE NOCASE").get(a["company"] as string) as
      | { id: number; name: string; website: string | null; logo: string | null }
      | undefined;
    if (!row) {
      return print({
        ok: false,
        error: `Company ${pyRepr(a["company"] as string)} is not in companies (first run: db_insert.py company --name ...)`,
        status_code: "NOT_FOUND",
      });
    }
    if (row.logo) return print({ ok: true, company: row.name, written: false, note: "logo already present (use --force to fetch it again)" });

    const policy = options.policy;
    if (!policy || !policy.isEnabled("logo")) {
      const reason = policy ? policy.disabledReason("logo") : "the enrichment policy cannot be read here";
      return print({ ok: false, error: `Logo fetch blocked: ${reason}`, status_code: "POLICY_DISABLED" });
    }
    const ms = policy.logoMinScore();
    if (ms !== null) {
      const best = (
        db
          .prepare("SELECT MAX(s.total_score) AS best FROM positions p JOIN scores s ON s.position_id = p.id WHERE p.company_id = ? AND p.status != 'excluded'")
          .get(row.id) as { best: number | null }
      ).best;
      if (best === null || best < Number(ms)) {
        const shown = typeof ms === "boolean" ? (ms ? "True" : "False") : String(ms);
        return print({
          ok: false,
          error: `Below policy threshold (logo.min_score=${shown}, best company score=${pyStr(best)}): do not fetch now`,
          status_code: "POLICY_SCORE_GATE",
        });
      }
    }

    let picked: [Buffer, string, string] | null = null;
    const fromUrl = a["from_url"] as string | null;
    if (fromUrl) {
      const refused = await refusal(withScheme(fromUrl));
      if (refused) return refused;
      // The script fetches the value as given; a schemeless one fails there, and here too.
      const raw = validateImage(await fetchBytes(fromUrl));
      if (raw) picked = [raw[0], raw[1], fromUrl];
    } else {
      let website = (a["website"] as string | null) || row.website;
      if (!website) {
        return print({ ok: false, error: "No known website for the company: pass --website or --from-url, or update companies", status_code: "NO_WEBSITE" });
      }
      const refused = await refusal(withScheme(website));
      if (refused) return refused;
      website = withScheme(website);
      let html = "";
      const home = await get(website);
      if (home && home.status === 200) {
        html = new TextDecoder().decode(home.body.subarray(0, MAX_HTML_BYTES));
        website = home.finalUrl;
      }
      const candidates = html ? collectCandidates(html, website) : [];
      for (const path of ["/apple-touch-icon.png", "/favicon-192x192.png", "/favicon.png", "/favicon.ico"]) {
        const url = join(website, path);
        if (url) candidates.push([5, 0, url]);
      }
      const seen = new Set<string>();
      for (const [, , url] of candidates.sort(byTuple)) {
        if (seen.has(url)) continue;
        seen.add(url);
        const data = validateImage(await fetchBytes(url));
        if (data) {
          picked = [data[0], data[1], url];
          break;
        }
      }
    }

    const dryRun = Boolean(a["dry_run"]);
    if (picked === null) {
      const mark = Boolean(a["mark_attempted"]) && !dryRun;
      if (mark) db.prepare("UPDATE companies SET logo_fetched = 1 WHERE id = ?").run(row.id);
      return print({ ok: false, error: "No valid candidate (format, size, or dimensions)", status_code: "NO_CANDIDATE", marked_attempted: mark });
    }
    const [raw, mime, source] = picked;
    const dims = imageDims(raw, mime);
    if (!dryRun) {
      db.prepare("UPDATE companies SET logo = ?, logo_source = ?, logo_fetched = 1 WHERE id = ?").run(`data:${mime};base64,${raw.toString("base64")}`, source, row.id);
    }
    return print({ ok: true, company: row.name, source, mime, bytes: raw.length, width: dims ? dims[0] : null, height: dims ? dims[1] : null, written: !dryRun });
  } catch (error) {
    return print({ ok: false, error: (error as Error).message, status_code: "DB_ERROR" });
  }
}

export function createLogoFetchTool(options: LogoFetchOptions): ToolHandler {
  return argvTool({
    name: "logo_fetch",
    script: "logo_fetch.py",
    description:
      "Find, validate and save a company's logo: \"<Company>\" [--website URL | --from-url IMAGE_URL] [--mark-attempted] [--dry-run]. One JSON line; exit 1 with a status_code when nothing was saved.",
    run: (args) => logoFetch(args, options),
    classify: (args) => ({ risk: "network", paths: [], summary: args[0] ?? "" }),
  });
}
