import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { chromium } from "playwright-core";

import {
  SafeHttpsClient,
  type PinnedHttpsRequest,
  type ResolveHostname,
  type SafeHttpResponse,
} from "./safe-http.js";

import {
  ReadJobResultSchema,
  ReadWebJobEvidenceSchema,
  type ReadJobResult,
  type ReadWebJobEvidence,
} from "./tools.js";

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 3_000_000;
const MAX_PAGE_TEXT = 18_000;
const HTTP_TIMEOUT_MS = 15_000;
const BROWSER_TIMEOUT_MS = 25_000;
const MAX_BROWSER_REQUESTS = 96;
const MAX_BROWSER_BYTES = 12_000_000;
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
];

type PageSnapshot = {
  url: URL;
  status: number;
  html: string;
  title?: string;
};

export const CHROMIUM_SECURITY_ARGS = [
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-dev-shm-usage",
  "--disable-quic",
  "--disable-sync",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--host-resolver-rules=MAP * ~NOTFOUND",
  "--metrics-recording-only",
  "--no-first-run",
] as const;

export const CHROMIUM_CONTEXT_SECURITY = {
  serviceWorkers: "block" as const,
};

export type StructuredWebJobReaderOptions = {
  now?: () => Date;
  resolveHostname?: ResolveHostname;
  requestPinned?: PinnedHttpsRequest;
  chromePath?: string | null;
};

export interface ScoutWebJobReader {
  readUrl(url: string): Promise<ReadWebJobEvidence | null>;
}

export class WebJobReadError extends Error {
  readonly code = "no_usable_job_evidence";

  constructor(readonly sourceHost: string) {
    super("No usable public job evidence after HTTP and browser escalation");
    this.name = "WebJobReadError";
  }
}

export class StructuredWebJobReader implements ScoutWebJobReader {
  private readonly now: () => Date;
  private readonly chromePath: string | undefined;
  private readonly client: SafeHttpsClient;

  constructor(options: StructuredWebJobReaderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.chromePath =
      options.chromePath === null
        ? undefined
        : (options.chromePath ?? findChromeExecutable());
    this.client = new SafeHttpsClient({
      resolveHostname: options.resolveHostname,
      requestPinned: options.requestPinned,
    });
  }

  async readUrl(rawUrl: string): Promise<ReadWebJobEvidence | null> {
    const initialUrl = new URL(rawUrl);
    await this.client.assertUrl(initialUrl);

    for (let attempt = 0; attempt < USER_AGENTS.length; attempt += 1) {
      try {
        const snapshot = await this.fetchHttp(
          initialUrl,
          USER_AGENTS[attempt]!,
        );
        const evidence = buildEvidence(snapshot, "http", this.now());
        if (evidence) return evidence;
      } catch {
        // Escalate transport. One inaccessible source must not stop the run.
      }
    }

    if (!this.chromePath) throw new WebJobReadError(initialUrl.hostname);
    try {
      const snapshot = await this.fetchBrowser(initialUrl, this.chromePath);
      const evidence = buildEvidence(snapshot, "browser", this.now());
      if (evidence) return evidence;
    } catch {
      // Fall through to one sanitized failure after every transport failed.
    }
    throw new WebJobReadError(initialUrl.hostname);
  }

  private async fetchHttp(
    initialUrl: URL,
    userAgent: string,
  ): Promise<PageSnapshot> {
    let url = initialUrl;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const response = await this.client.request(url, {
        maxBytes: MAX_HTML_BYTES,
        timeoutMs: HTTP_TIMEOUT_MS,
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-encoding": "identity",
          "accept-language": "en-US,en;q=0.8,it;q=0.6",
          "cache-control": "no-cache",
          "user-agent": userAgent,
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (!location || redirect === MAX_REDIRECTS) {
          return { url, status: response.status, html: "" };
        }
        url = new URL(location, url);
        continue;
      }
      const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml")
      ) {
        return { url, status: response.status, html: "" };
      }
      return {
        url,
        status: response.status,
        html: response.body.toString("utf8"),
      };
    }
    return { url, status: 0, html: "" };
  }

  private async fetchBrowser(
    initialUrl: URL,
    executablePath: string,
  ): Promise<PageSnapshot> {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [...CHROMIUM_SECURITY_ARGS],
    });
    try {
      const context = await browser.newContext({
        userAgent: USER_AGENTS[0],
        locale: "en-US",
        viewport: { width: 1365, height: 900 },
        ...CHROMIUM_CONTEXT_SECURITY,
      });
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        for (const api of [
          "RTCPeerConnection",
          "webkitRTCPeerConnection",
          "WebTransport",
          "WebSocket",
          "Worker",
          "SharedWorker",
        ]) {
          try {
            Object.defineProperty(globalThis, api, {
              configurable: false,
              get: () => undefined,
            });
          } catch {
            // A non-configurable direct-network API stays covered by Chromium's
            // process-level DNS/UDP blocks and explicit WebSocket routing.
          }
        }
      });
      const page = await context.newPage();
      let requestCount = 0;
      let transferredBytes = 0;
      await page.routeWebSocket("**/*", async (route) => {
        await route.close({ code: 1008, reason: "network disabled" });
      });
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (
          ["image", "media", "font", "serviceworker"].includes(
            request.resourceType(),
          ) ||
          request.method() !== "GET"
        ) {
          await route.abort();
          return;
        }
        try {
          const requestUrl = new URL(request.url());
          requestCount += 1;
          if (requestCount > MAX_BROWSER_REQUESTS) {
            throw new Error("Rendered page made too many requests");
          }
          const response = await this.client.request(requestUrl, {
            headers: browserProxyHeaders(request.headers()),
            maxBytes: Math.min(
              MAX_HTML_BYTES,
              MAX_BROWSER_BYTES - transferredBytes,
            ),
            timeoutMs: HTTP_TIMEOUT_MS,
          });
          transferredBytes += response.body.byteLength;
          if (transferredBytes > MAX_BROWSER_BYTES) {
            throw new Error("Rendered page transferred too much data");
          }
          await route.fulfill({
            status: response.status,
            headers: browserResponseHeaders(response),
            body: response.body,
          });
        } catch {
          await route.abort();
        }
      });
      const response = await page.goto(initialUrl.toString(), {
        waitUntil: "domcontentloaded",
        timeout: BROWSER_TIMEOUT_MS,
      });
      await page.waitForTimeout(1_500);
      const finalUrl = new URL(page.url());
      await this.client.assertUrl(finalUrl);
      const html = await page.content();
      if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
        throw new Error("Rendered job page is too large");
      }
      return {
        url: finalUrl,
        status: response?.status() ?? 0,
        html,
        title: await page.title(),
      };
    } finally {
      await browser.close();
    }
  }
}

function buildEvidence(
  snapshot: PageSnapshot,
  transport: "http" | "browser",
  now: Date,
): ReadWebJobEvidence | null {
  if (
    snapshot.status < 200 ||
    snapshot.status >= 300 ||
    !snapshot.html ||
    detectBlocked(snapshot.html)
  ) {
    return null;
  }
  const structured = parseJobPosting(snapshot.html, snapshot.url, now);
  let pageText = extractVisibleText(snapshot.html);
  const pageTitle =
    cleanText(snapshot.title ?? "") || extractPageTitle(snapshot.html);
  if (structured && pageText.length < 80) {
    pageText = [
      structured.title,
      structured.company,
      structured.location,
      structured.jdText,
      ...structured.requirements,
    ].join("\n");
  }
  if (!structured && !isLikelyJobPage(pageTitle, pageText)) return null;
  const sourceId = sourceIdFor(snapshot.url);
  return ReadWebJobEvidenceSchema.parse({
    sourceId,
    url: snapshot.url.toString(),
    source: snapshot.url.hostname.slice(0, 160),
    fetchMethod: `${transport}-${structured ? "json-ld" : "html"}`,
    pageTitle: pageTitle.slice(0, 300),
    pageText: pageText.slice(0, MAX_PAGE_TEXT),
    structured: structured ? { ...structured, sourceId } : undefined,
  });
}

function isLikelyJobPage(pageTitle: string, pageText: string): boolean {
  if (pageText.length < 500 || !pageTitle) return false;
  const haystack = `${pageTitle}\n${pageText}`.toLowerCase();
  const markers = [
    "responsibilities",
    "requirements",
    "qualifications",
    "what you will",
    "what you'll",
    "about the role",
    "job description",
    "employment type",
    "apply for",
    "apply now",
  ];
  return markers.filter((marker) => haystack.includes(marker)).length >= 2;
}

function detectBlocked(html: string): boolean {
  const sample = html.slice(0, 150_000).toLowerCase();
  return [
    "just a moment...",
    "cf-chl-",
    "cloudflare ray id",
    "access denied",
    "please verify you are a human",
    "g-recaptcha",
    "authwall",
  ].some((marker) => sample.includes(marker));
}

function browserProxyHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const blocked = new Set([
    "authorization",
    "connection",
    "content-length",
    "host",
    "proxy-authorization",
    "transfer-encoding",
  ]);
  return Object.fromEntries([
    ...Object.entries(headers)
      .filter(([name]) => !blocked.has(name.toLowerCase()))
      .map(([name, value]) => [name.toLowerCase(), value] as const),
    ["accept-encoding", "identity"],
  ]);
}

function browserResponseHeaders(
  response: SafeHttpResponse,
): Record<string, string> {
  const blocked = new Set([
    "connection",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);
  return Object.fromEntries(
    Object.entries(response.headers).filter(
      ([name]) => !blocked.has(name.toLowerCase()),
    ),
  );
}

function parseJobPosting(
  html: string,
  url: URL,
  now: Date,
): ReadJobResult | null {
  const scripts = [
    ...html.matchAll(
      /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const match of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeJsonEntities(match[1] ?? ""));
    } catch {
      continue;
    }
    for (const node of flattenJsonLd(parsed)) {
      if (!hasType(node, "JobPosting")) continue;
      const result = jobPostingToResult(node, url, now);
      if (result) return result;
    }
  }
  return null;
}

function jobPostingToResult(
  node: Record<string, unknown>,
  url: URL,
  now: Date,
): ReadJobResult | null {
  const title = textValue(node.title);
  const company = textValue(asRecord(node.hiringOrganization)?.name);
  const description = cleanText(textValue(node.description));
  const postedAt = parseDate(textValue(node.datePosted));
  const location = extractLocation(node);
  if (!title || !company || !postedAt || !location || description.length < 80)
    return null;
  const requirements = extractRequirements(node, description);
  const remoteType = inferRemoteType(node, location, description);
  const finalUrl = url.toString();
  return ReadJobResultSchema.parse({
    sourceId: sourceIdFor(url),
    title: title.slice(0, 160),
    company: company.slice(0, 160),
    location: location.slice(0, 160),
    remoteType,
    source: url.hostname.slice(0, 160),
    postedAt,
    url: finalUrl,
    jdText: description.slice(0, 20_000),
    requirements: requirements.slice(0, 40),
  });
}

function extractVisibleText(html: string): string {
  return cleanText(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
      .replace(
        /<(?:nav|header|footer)\b[\s\S]*?<\/(?:nav|header|footer)>/gi,
        " ",
      )
      .replace(
        /<\/?(?:p|div|li|ul|ol|br|h[1-6]|section|article|main|aside|tr|td)\b[^>]*>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, " "),
  );
}

function extractPageTitle(html: string): string {
  const candidates = [
    html.match(
      /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
    )?.[1],
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1],
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1],
  ];
  return cleanText(candidates.find(Boolean) ?? "");
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  const record = asRecord(value);
  if (!record) return [];
  const graph = Array.isArray(record["@graph"])
    ? flattenJsonLd(record["@graph"])
    : [];
  return [record, ...graph];
}

function hasType(node: Record<string, unknown>, expected: string): boolean {
  const value = node["@type"];
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}

function extractLocation(node: Record<string, unknown>): string {
  const applicant = locationName(node.applicantLocationRequirements);
  const actual = locationName(node.jobLocation);
  const remote = textValue(node.jobLocationType)
    .toUpperCase()
    .includes("TELECOMMUTE");
  return actual || applicant || (remote ? "Remote" : "");
}

function locationName(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  const record = asRecord(first);
  if (!record) return textValue(first);
  const direct = textValue(record.name);
  const address = asRecord(record.address);
  if (!address) return direct;
  return [
    address.addressLocality,
    address.addressRegion,
    address.addressCountry,
  ]
    .map(textValue)
    .filter(Boolean)
    .join(", ");
}

function inferRemoteType(
  node: Record<string, unknown>,
  location: string,
  description: string,
): "remote" | "hybrid" | "onsite" | "unspecified" {
  const haystack =
    `${textValue(node.jobLocationType)} ${location} ${description.slice(0, 2_000)}`.toLowerCase();
  if (haystack.includes("hybrid")) return "hybrid";
  if (haystack.includes("telecommute") || /\bremote\b/.test(haystack)) {
    return "remote";
  }
  if (location) return "onsite";
  return "unspecified";
}

function extractRequirements(
  node: Record<string, unknown>,
  description: string,
): string[] {
  const explicit = [
    node.qualifications,
    node.skills,
    node.experienceRequirements,
  ]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(textValue)
    .map(cleanText)
    .filter((value) => value.length > 0);
  if (explicit.length > 0) {
    return unique(explicit.map((value) => value.slice(0, 160)));
  }
  const candidates = description
    .split(/\n+|(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter((value) =>
      /\b(required|requirements?|must|qualification|experience|years?)\b/i.test(
        value,
      ),
    )
    .filter((value) => value.length >= 8)
    .map((value) => value.slice(0, 160));
  const uniqueCandidates = unique(candidates).slice(0, 40);
  return uniqueCandidates.length > 0
    ? uniqueCandidates
    : [description.slice(0, 160)];
}

function decodeJsonEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function parseDate(value: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  const record = asRecord(value);
  return record ? textValue(record.name ?? record.value) : "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sourceIdFor(url: URL): string {
  return `web-${createHash("sha256").update(url.toString()).digest("hex").slice(0, 32)}`;
}

function findChromeExecutable(): string | undefined {
  const candidates = [
    process.env.SCOUT_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate));
}
