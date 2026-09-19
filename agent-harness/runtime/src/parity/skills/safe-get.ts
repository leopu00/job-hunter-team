/**
 * A GET through the runtime's SSRF guard, following redirects by hand.
 *
 * `api-worker/src/safe-http.ts` resolves the host, refuses any address that
 * is not public, and pins the socket to what it checked; every redirect is a
 * new URL checked again. Only https: the guard's transport has no http, and
 * a skill that `curl`s an http URL gets the honest failure here.
 */

import { SafeHttpsClient, type SafeHttpResponse } from "../../../../../api-worker/src/safe-http.ts";

export interface SafeGetResult extends SafeHttpResponse {
  finalUrl: string;
}

/** The guard refused the URL (scheme, local or private address, no public resolution): nothing was sent. */
export class SafeGetError extends Error {}

export async function safeGet(
  client: SafeHttpsClient,
  url: string,
  options: { userAgent: string; maxBytes: number; timeoutMs: number; maxRedirects: number },
): Promise<SafeGetResult> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new SafeGetError(`not a valid URL: ${url}`);
  }
  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    if (current.protocol !== "https:") throw new SafeGetError(`scheme not allowed: ${current.protocol.replace(/:$/, "")}`);
    // The guard's verdict on this hop, apart from the fetch's own failures: a refusal is not a network error.
    try {
      await client.assertUrl(current);
    } catch (error) {
      throw new SafeGetError((error as Error).message);
    }
    const response = await client.request(current, {
      headers: { "user-agent": options.userAgent },
      maxBytes: options.maxBytes,
      timeoutMs: options.timeoutMs,
    });
    const location = response.headers["location"];
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      try {
        current = new URL(location, current);
      } catch {
        throw new SafeGetError(`redirect to an invalid URL: ${location}`);
      }
      continue;
    }
    return { ...response, finalUrl: current.href };
  }
  throw new SafeGetError(`more than ${options.maxRedirects} redirects`);
}
