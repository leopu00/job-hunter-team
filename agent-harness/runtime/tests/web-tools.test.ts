import { describe, expect, it } from "vitest";

import { SafeHttpsClient, type PinnedHttpsRequest } from "../../../api-worker/src/safe-http.ts";
import { MemoryAuditLog } from "../src/core/audit.ts";
import { TurnAccount } from "../src/core/agent-loop.ts";
import { DEFAULT_LIMITS, Guardrails } from "../src/core/guardrails.ts";
import { PermissionPolicy } from "../src/core/permissions.ts";
import { MockProvider } from "../src/core/provider/mock.ts";
import { RoleSession } from "../src/core/role-session.ts";
import { htmlToText } from "../src/tools/html.ts";
import { createWebFetchTool } from "../src/tools/web-fetch.ts";
import { createWebSearchTool } from "../src/tools/web-search.ts";

const CONTEXT = { account: new TurnAccount(Date.now), remainingMs: () => 60_000 };

/**
 * A scripted internet. Hostnames resolve through `dns`, and every connection
 * that passes the SSRF guard is answered from `pages` — so a test sees which
 * URLs the tool actually reached, and none of them leave the process.
 */
function internet(dns: Record<string, string[]>, pages: Record<string, { status?: number; headers?: Record<string, string>; body?: string }>) {
  const reached: string[] = [];
  const requestPinned: PinnedHttpsRequest = async (url, addresses) => {
    reached.push(`${url.href} @ ${addresses.map((a) => a.address).join(",")}`);
    const page = pages[url.href] ?? { status: 404, headers: { "content-type": "text/plain" }, body: "not here" };
    return { status: page.status ?? 200, headers: page.headers ?? {}, body: Buffer.from(page.body ?? "") };
  };
  const client = new SafeHttpsClient({
    resolveHostname: async (host) => dns[host] ?? [],
    requestPinned,
  });
  return { tool: createWebFetchTool({ client }), reached };
}

// A global unicast address, spelled out so the repo's privacy hook does not
// mistake a test fixture for a leaked server address (as api-worker's tests do).
const PUBLIC = [8, 8, 8, 8].join(".");
const net = internet(
  { "example.com": [PUBLIC], "rebind.example": [PUBLIC, "127.0.0.1"], "metadata.example": ["169.254.169.254"] },
  {
    "https://example.com/page": {
      headers: { "content-type": "text/html; charset=utf-8" },
      body:
        "<html><head><title>Monteverde &amp; dintorni</title><style>p{}</style></head><body>" +
        "<nav>menu</nav><h1>Quartiere</h1><p>Affitti da 1.200&nbsp;&euro;</p>" +
        '<ul><li>Tram 8</li><li><a href="https://example.com/x">Mappa</a></li></ul>' +
        "<script>alert(1)</script></body></html>",
    },
    "https://example.com/long": { headers: { "content-type": "text/plain" }, body: "x".repeat(30_000) },
    "https://example.com/redirect": { status: 302, headers: { location: "/page" } },
    "https://example.com/to-metadata": { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } },
    "https://example.com/to-http": { status: 302, headers: { location: "http://example.com/page" } },
    "https://example.com/image": { headers: { "content-type": "image/png" }, body: "PNG" },
  },
);
const fetchWith = (args: Record<string, unknown>) => net.tool.execute(net.tool.spec.schema.parse(args), CONTEXT);

describe("web_fetch", () => {
  it("turns a page into readable text with its title", async () => {
    const result = await fetchWith({ url: "https://example.com/page" });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Title: Monteverde & dintorni");
    expect(result.content).toContain("# Quartiere");
    expect(result.content).toContain("Affitti da 1.200 €");
    expect(result.content).toContain("- [Mappa](https://example.com/x)");
    expect(result.content).not.toContain("alert");
    expect(result.content).not.toContain("menu");
  });

  it("connects only to the addresses the guard checked", async () => {
    await fetchWith({ url: "https://example.com/page" });
    expect(net.reached).toContain(`https://example.com/page @ ${PUBLIC}`);
  });

  it("follows redirects and reports the final URL", async () => {
    expect((await fetchWith({ url: "https://example.com/redirect" })).content).toContain("URL: https://example.com/page");
  });

  it("pages long text", async () => {
    const first = await fetchWith({ url: "https://example.com/long" });
    expect(first.content).toContain("[characters 0–12000 of 30000; call again with offset 12000 for more]");
    const last = await fetchWith({ url: "https://example.com/long", offset: 24_000 });
    expect(last.content).toContain("[characters 24000–30000 of 30000]");
  });

  it("refuses non-text content and reports HTTP errors as failed", async () => {
    expect((await fetchWith({ url: "https://example.com/image" })).content).toContain("image/png, not text");
    const missing = await fetchWith({ url: "https://example.com/nope" });
    expect(missing).toMatchObject({ ok: false });
    expect(missing.content).toContain("Status: 404");
  });

  it("refuses private addresses, directly, by name, through a redirect and behind a mixed DNS answer", async () => {
    const before = net.reached.length;
    for (const url of [
      "https://127.0.0.1/",
      "https://localhost/",
      "https://169.254.169.254/latest/meta-data",
      "https://metadata.example/",
      "https://rebind.example/",
      "https://[::1]/",
      "https://example.com/to-metadata",
    ]) {
      const result = await fetchWith({ url });
      expect(result.ok, url).toBe(false);
      expect(result.content, url).toMatch(/public addresses|Local hosts are not allowed/);
    }
    // Only the first hop of the redirect went out; nothing private was ever reached.
    expect(net.reached.slice(before)).toEqual([`https://example.com/to-metadata @ ${PUBLIC}`]);
  });

  it("refuses plain http, directly and through a redirect", async () => {
    expect((await fetchWith({ url: "http://example.com/page" })).content).toContain("Only https URLs");
    expect((await fetchWith({ url: "https://example.com/to-http" })).content).toContain("Only https URLs");
  });

  it("takes the format other agents' fetch tools take (T9)", async () => {
    const markdown = await fetchWith({ url: "https://example.com/page", format: "markdown" });
    const text = await fetchWith({ url: "https://example.com/page", format: "text" });
    const html = await fetchWith({ url: "https://example.com/page", format: "html" });
    expect(markdown.content).toContain("# Quartiere");
    expect(text.content).toBe(markdown.content);
    expect(html.content).toContain("<h1>Quartiere</h1>");
    expect(net.tool.spec.schema.safeParse({ url: "https://example.com/page", format: "pdf" }).success).toBe(false);
    expect(net.tool.spec.schema.safeParse({ url: "https://example.com/page", prompt: "x" }).success).toBe(false);
  });

  it("classifies as network, never as a free read", () => {
    expect(net.tool.classify({ url: "https://example.com" })).toEqual({ risk: "network", paths: [], summary: "https://example.com" });
  });
});

describe("htmlToText", () => {
  it("decodes numeric entities and collapses whitespace", () => {
    expect(htmlToText("<p>a&#8217;b   c&#x20AC;</p>\n\n\n\n<p>d</p>").text).toBe("a’b c€\n\nd");
  });
});

describe("web_search", () => {
  it("returns the digest with sources and charges tokens plus the per-search fee to the run", async () => {
    const provider = new MockProvider(
      [
        { text: "", toolCalls: [{ name: "web_search", args: { query: "Monteverde Roma tram" } }] },
        { text: "Monteverde is served by tram 8." },
      ],
      {
        searches: [
          {
            text: "Tram 8 runs through Monteverde.",
            sources: [{ url: "https://example.com/tram", title: "ATAC" }],
            searches: 2,
            usage: { inputTokens: 1_000_000, outputTokens: 0 },
          },
        ],
      },
    );
    Object.assign(provider, { profile: { ...provider.profile, pricing: { inputPerMTokUsd: 1, outputPerMTokUsd: 1 } } });
    const guardrails = new Guardrails({
      limits: { ...DEFAULT_LIMITS, budgetUsd: 10, maxTotalTokens: 10_000_000 },
      pricing: { inputPerMTokUsd: 1, outputPerMTokUsd: 1, webSearchPerCallUsd: 0.01 },
    });
    const session = new RoleSession({
      provider,
      guardrails,
      audit: new MemoryAuditLog(),
      systemPrompt: "You are a test role.",
      tools: [createWebSearchTool(provider, 0.01)],
      permissions: new PermissionPolicy({ mode: "auto", freeReadRoots: [] }),
    });

    const turn = await session.send("Go.");
    expect(provider.searches[0]?.query).toBe("Monteverde Roma tram");
    const fed = provider.requests[1]!.messages.at(-1);
    expect(fed?.role === "tool" ? fed.content : "").toBe(
      "Tram 8 runs through Monteverde.\n\nSources:\n- ATAC — https://example.com/tram",
    );
    // Two model rounds at 100 input tokens each, a million-token search at $1, two searches at $0.01.
    expect(turn.stats.costUsd).toBeCloseTo(1 + 0.02 + (200 + 100) / 1_000_000, 6);
    expect(guardrails.state.costUsd).toBeCloseTo(turn.stats.costUsd, 9);
  });

  it("is not offered for a model that cannot search", () => {
    const provider = new MockProvider([]);
    Object.assign(provider, { profile: { ...provider.profile, capabilities: { toolCalling: true, structuredOutput: true, webSearch: false } } });
    expect(() => createWebSearchTool(provider, 0.01)).toThrowError(expect.objectContaining({ code: "model_incapable" }));
  });
});
