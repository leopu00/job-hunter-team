/**
 * `safe_fetch.py` as a native tool (T14, skill office-geocoding: Nominatim
 * and Photon; `--status` to check where a link lands).
 *
 * The same answer: the page's body, or with `--status` the line
 * `HTTP:<status> URL_FINALE:<url>`; `safe_fetch: refused: <reason>` with exit
 * 1 for an address the guard will not reach, `safe_fetch: <error>` with exit
 * 2 when the fetch fails. Every hop goes through the runtime's SSRF guard.
 *
 * Differences, on purpose:
 * - https only: the guard's transport has no plain http (refused, exit 1).
 * - The body is a third party's text, and reaches the model inside the
 *   external-content markers, as db_query prints a JD: the script wrote it
 *   bare for a `jq` pipe the API agent does not have.
 */

import { SafeHttpsClient } from "../../../../../api-worker/src/safe-http.ts";
import { parseArgv } from "../../db/argv.ts";
import { Fence } from "../../db/external-content.ts";
import type { ScriptResult } from "../../db/tools.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { argvTool } from "./argv-tool.ts";
import { safeGet, SafeGetError } from "./safe-get.ts";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const MAX_BYTES = 5_000_000;

export async function safeFetch(argv: string[], client: SafeHttpsClient, nonce?: string): Promise<ScriptResult> {
  const a = parseArgv(
    {
      prog: "safe_fetch.py",
      positionals: [{ name: "url" }],
      options: [{ flag: "--status", storeTrue: true }, { flag: "--user-agent", default: USER_AGENT }],
    },
    argv,
  );
  const refused = (reason: string): ScriptResult => ({ stdout: "", stderr: `safe_fetch: refused: ${reason}\n`, exitCode: 1 });
  const userAgent = a["user_agent"] as string;
  // str.isprintable(): no control or format character may become a header line.
  if (/[\p{C}\p{Z}]/u.test(userAgent.replaceAll(" ", ""))) return refused("user-agent contains control characters");
  let response;
  try {
    response = await safeGet(client, a["url"] as string, { userAgent, maxBytes: MAX_BYTES, timeoutMs: 20_000, maxRedirects: 5 });
  } catch (error) {
    const message = (error as Error).message;
    if (error instanceof SafeGetError) return refused(message);
    return { stdout: "", stderr: `safe_fetch: ${message}\n`, exitCode: 2 };
  }
  if (a["status"]) return { stdout: `HTTP:${response.status} URL_FINALE:${response.finalUrl}\n`, exitCode: 0 };
  const body = new TextDecoder().decode(response.body);
  return { stdout: `${new Fence(nonce).block(body, response.finalUrl)}\n`, exitCode: 0 };
}

export function createSafeFetchTool(options: { client?: SafeHttpsClient; nonce?: () => string } = {}): ToolHandler {
  const client = options.client ?? new SafeHttpsClient();
  return argvTool({
    name: "safe_fetch",
    script: "safe_fetch.py",
    description:
      "Fetch a public https page through the SSRF guard: <url> [--user-agent UA] prints its body (as external data); --status prints HTTP:<code> URL_FINALE:<url>.",
    run: (args) => safeFetch(args, client, options.nonce?.()),
    classify: (args) => ({ risk: "network", paths: [], summary: args.find((w) => !w.startsWith("-")) ?? "" }),
  });
}
