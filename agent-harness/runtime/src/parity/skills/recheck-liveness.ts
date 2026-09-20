/**
 * `recheck_liveness.py` as a native tool (T14, analista.md RULE-03/12).
 *
 * The same tiers and verdict: 404/410 is CLOSED, a closing phrase in the
 * page is CLOSED, a 200 from a host that renders its status server-side is
 * OPEN, and anything else — an ATS that renders in JavaScript, LinkedIn's
 * wall, an odd status — needs a real browser. The harness has none, which is
 * the script's own case when Playwright is missing: OPEN_UNVERIFIED,
 * "do NOT mark as open". The page never reaches the model, only the verdict.
 *
 * Differences, on purpose: the page is fetched through the SSRF guard
 * (`safe-get.ts`) where the script ran `curl -L` to any address; so a plain
 * http posting, or one that redirects to a private address, is not fetched
 * and comes out OPEN_UNVERIFIED — never a false open.
 */

import { SafeHttpsClient } from "../../../../../api-worker/src/safe-http.ts";
import { pyJson } from "../../db/py-format.ts";
import type { ScriptResult } from "../../db/tools.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { argvTool } from "./argv-tool.ts";
import { safeGet } from "./safe-get.ts";

const CLOSED_MARKERS = [
  "no longer accepting applications",
  "not accepting applications",
  "this job is no longer available",
  "position (has been )?filled",
  "job (has )?expired",
  "applications (are )?closed",
  "no longer accepting",
  "posting (has been )?closed",
  "this position is (now )?closed",
  "vacancy (is )?closed",
  "offert[ae].{0,12}(chius|scadut|non più disponibil)",
  "posizion[ei].{0,12}(chius|scadut|non più disponibil)",
  "annunci[oi].{0,12}(scadut|chius|non più disponibil)",
  "candidature chiuse",
];
const CLOSED_RE = new RegExp(CLOSED_MARKERS.join("|"), "iu");
const JS_ATS_HOSTS = [
  "ashbyhq.com", "myworkdayjobs.com", "greenhouse.io", "boards.greenhouse", "lever.co", "workable.com",
  "linkedin.com", "smartrecruiters.com", "wd1.myworkdayjobs", "eightfold.ai",
];
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export interface Verdict {
  state: "OPEN" | "CLOSED" | "OPEN_UNVERIFIED";
  method: string;
  http: string | null;
  evidence: string;
}

/** `recheck` with the fetch's outcome given and no browser: the part that decides. */
export function classify(url: string, code: string | null, html: string): Verdict {
  const jsHost = JS_ATS_HOSTS.some((h) => url.toLowerCase().includes(h));
  if (code === "404" || code === "410") return { state: "CLOSED", method: "curl", http: code, evidence: `HTTP ${code}` };
  if (CLOSED_RE.test(html)) return { state: "CLOSED", method: "curl", http: code, evidence: "closed marker in raw HTML" };
  if (!jsHost && code === "200") return { state: "OPEN", method: "curl", http: code, evidence: "200, no closed marker (non-JS host)" };
  return { state: "OPEN_UNVERIFIED", method: "curl-only", http: code, evidence: "JS host or auth wall, but browser unavailable — do NOT mark as open" };
}

const EXIT = { OPEN: 0, CLOSED: 1, OPEN_UNVERIFIED: 2 } as const;

export async function recheckLiveness(argv: string[], client: SafeHttpsClient): Promise<ScriptResult> {
  if (argv.length < 1) {
    return { stdout: `${pyJson({ state: "OPEN_UNVERIFIED", evidence: "usage: recheck_liveness.py <url> [title]" })}\n`, exitCode: 3 };
  }
  const url = argv[0]!;
  let code: string | null = null;
  let html = "";
  try {
    const response = await safeGet(client, url, { userAgent: UA, maxBytes: 5_000_000, timeoutMs: 15_000, maxRedirects: 10 });
    code = String(response.status);
    html = new TextDecoder().decode(response.body);
  } catch {
    // curl's "000": nothing came back.
    code = "000";
  }
  const verdict = classify(url, code, html);
  return { stdout: `${pyJson(verdict, { ensureAscii: false })}\n`, exitCode: EXIT[verdict.state] };
}

export function createRecheckLivenessTool(options: { client?: SafeHttpsClient } = {}): ToolHandler {
  const client = options.client ?? new SafeHttpsClient();
  return argvTool({
    name: "recheck_liveness",
    script: "recheck_liveness.py",
    description:
      "Is a job posting still open? <url> [title] → {state: OPEN|CLOSED|OPEN_UNVERIFIED, method, http, evidence}; exit 0 open, 1 closed, 2 unverified. Decide from state only.",
    run: (args) => recheckLiveness(args, client),
    // Exit 1 and 2 are verdicts, not failures.
    okCodes: [0, 1, 2],
    classify: (args) => ({ risk: "network", paths: [], summary: args[0] ?? "" }),
  });
}
