/**
 * web_fetch: read a page on the internet.
 *
 * The runtime's own HTTP client rather than the provider's, so a page reaches
 * the model through the same caps as a file. The network half is
 * `api-worker/src/safe-http.ts`, the SSRF guard the API worker already ships —
 * reused, not rewritten, so the repository keeps one address policy. Rules:
 *
 * - **https only, public addresses only**: every hop, redirects included, is
 *   resolved and refused unless every address is public; the socket then
 *   connects to exactly the addresses that were checked, so a second DNS
 *   answer cannot swap in the local network or a cloud metadata endpoint.
 *   Local services are reachable with bash, which the permission gate sees.
 * - **A deadline and a size limit**: 30 seconds per hop, 5 MB.
 * - **Text only**: HTML becomes readable text; JSON, XML and plain text pass
 *   through; anything else is refused with a pointer to bash.
 * - **Paged**: a long page comes back in windows, with the offset of the next.
 * - **`format`**, as other agents' fetch tools take it (models pass it
 *   unasked; refusing the key cost a round for nothing). Every value gives the
 *   readable text above, `html` included: the markup is never handed over —
 *   scripts, styles, comments and attributes are where injected instructions
 *   hide, and they are tokens the model pays for and cannot use.
 */

import { z } from "zod";

import { SafeHttpsClient, type SafeHttpResponse } from "../../../../api-worker/src/safe-http.ts";
import { htmlToText } from "./html.ts";
import type { ToolExecution, ToolHandler } from "./registry.ts";

export interface WebFetchOptions {
  /**
   * Test seam: a client with a scripted resolver and transport. Production
   * uses the default one, which resolves with the system DNS and pins it.
   */
  client?: SafeHttpsClient;
  timeoutMs?: number;
}

const MAX_BYTES = 5_000_000;
const MAX_REDIRECTS = 5;
const WINDOW_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT = "JobHunterTeam-agent/0.1 (+https://github.com/leopu00/job-hunter-team)";

export function createWebFetchTool(options: WebFetchOptions = {}): ToolHandler {
  const client = options.client ?? new SafeHttpsClient();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    spec: {
      name: "web_fetch",
      description:
        "Fetch a web page over https and return it as readable text, with its title and final URL. " +
        `Long pages come back ${WINDOW_CHARS} characters at a time; pass offset to read further. ` +
        "Plain http, private and local addresses are refused.",
      schema: z
        .object({
          url: z.string().url().max(2_000),
          offset: z.number().int().min(0).optional(),
          format: z
            .enum(["markdown", "text", "html"])
            .optional()
            .describe("accepted for compatibility; every value returns the page as readable text"),
        })
        .strict(),
    },

    classify(args) {
      const { url } = args as { url: string };
      return { risk: "network", paths: [], summary: url };
    },

    async execute(args, context) {
      const { url, offset = 0 } = args as { url: string; offset?: number };

      let current: URL;
      try {
        current = new URL(url);
      } catch {
        return fail(`"${url}" is not a valid URL.`);
      }

      let response: SafeHttpResponse | undefined;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (current.protocol !== "https:") {
          return fail(`Only https URLs can be fetched, not ${current.protocol} (${current.href}).`);
        }
        try {
          // `request` validates the URL and pins its addresses on every hop:
          // a redirect is a new, untrusted URL.
          response = await client.request(current, {
            headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/*;q=0.9,*/*;q=0.5" },
            maxBytes: MAX_BYTES,
            timeoutMs: Math.max(1, Math.min(timeoutMs, context.remainingMs())),
          });
        } catch (error) {
          return fail(`Could not fetch ${current.href}: ${errorMessage(error)}.`);
        }
        const location = response.headers["location"];
        if (response.status >= 300 && response.status < 400 && location) {
          try {
            current = new URL(location, current);
          } catch {
            return fail(`${current.href} redirects to "${location}", which is not a valid URL.`);
          }
          response = undefined;
          continue;
        }
        break;
      }
      if (!response) return fail(`Gave up after ${MAX_REDIRECTS} redirects.`);

      const type = (response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      const textual = type === "" || type.startsWith("text/") || /json|xml|javascript/.test(type);
      if (!textual) {
        return fail(
          `${current.href} is ${type}, not text, and was not read. To save it to a file, use bash with curl.`,
        );
      }

      const body = new TextDecoder().decode(response.body);
      const isHtml = type.includes("html") || (type === "" && /<html[\s>]/i.test(body));
      const { title, text } = isHtml ? htmlToText(body) : { title: undefined, text: body };

      const header = [
        `URL: ${current.href}`,
        `Status: ${response.status}`,
        ...(title ? [`Title: ${title}`] : []),
      ].join("\n");

      if (offset >= text.length && text.length > 0) {
        return fail(`${current.href} has ${text.length} characters of text; offset ${offset} is past the end.`);
      }
      const window = text.slice(offset, offset + WINDOW_CHARS);
      const end = offset + window.length;
      const note =
        end < text.length || offset > 0
          ? `\n\n[characters ${offset}–${end} of ${text.length}${end < text.length ? `; call again with offset ${end} for more` : ""}]`
          : "";
      return {
        ok: response.status >= 200 && response.status < 300,
        content: `${header}\n\n${window || "(the page has no readable text)"}${note}`,
      };
    },
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : error.message;
  }
  return String(error);
}

function fail(content: string): ToolExecution {
  return { ok: false, content };
}
