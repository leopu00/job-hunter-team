import { chromium } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHROMIUM_CONTEXT_SECURITY,
  CHROMIUM_SECURITY_ARGS,
  StructuredWebJobReader,
  type PinnedHttpsRequest,
} from "../src/index.js";

const publicAddress = [8, 8, 8, 8].join(".");
const jobPage = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Platform Engineer",
  "datePosted": "2026-08-19",
  "hiringOrganization": { "@type": "Organization", "name": "Acme Systems" },
  "jobLocationType": "TELECOMMUTE",
  "applicantLocationRequirements": { "@type": "Country", "name": "European Union" },
  "description": "<p>Build and operate a reliable cloud platform for a distributed engineering team.</p><p>You must have strong TypeScript and infrastructure automation experience.</p>",
  "qualifications": "Strong TypeScript and infrastructure automation experience"
}
</script></head><body>External page</body></html>`;

afterEach(() => vi.restoreAllMocks());

describe("structured public web job reader", () => {
  it("extracts a JobPosting through a connector pinned to validated DNS", async () => {
    const requestPinned = vi.fn<PinnedHttpsRequest>(async (_url, addresses) => {
      expect(addresses).toEqual([{ address: publicAddress, family: 4 }]);
      return htmlResponse(jobPage);
    });
    const reader = new StructuredWebJobReader({
      requestPinned,
      now: () => new Date("2026-08-20T10:00:00.000Z"),
      resolveHostname: async () => [publicAddress],
      chromePath: null,
    });

    const job = await reader.readUrl("https://jobs.example.com/platform");
    expect(job).toMatchObject({
      source: "jobs.example.com",
      fetchMethod: "http-json-ld",
      structured: {
        title: "Platform Engineer",
        company: "Acme Systems",
        location: "European Union",
        remoteType: "remote",
        postedAt: "2026-08-19T00:00:00.000Z",
      },
    });
    expect(job?.structured?.jdText).toContain("Build and operate");
    expect(job?.structured?.requirements[0]).toContain("TypeScript");
  });

  it("returns bounded visible evidence when a job page has no JSON-LD", async () => {
    const genericPage = `<!doctype html><html><head><title>Backend Engineer at Example Cloud</title></head><body>
      <main><h1>Backend Engineer</h1><p>Example Cloud</p><p>Remote within the European Union</p>
      <h2>About the role</h2><p>${"Build reliable Python services and APIs for our distributed cloud platform. ".repeat(8)}</p>
      <h2>Responsibilities</h2><p>Own backend services, tests, observability, and production operations.</p>
      <h2>Requirements</h2><p>Three years of Python experience, strong SQL, and professional English.</p>
      <button>Apply now</button></main></body></html>`;
    const reader = new StructuredWebJobReader({
      requestPinned: async () => htmlResponse(genericPage),
      now: () => new Date("2026-08-20T10:00:00.000Z"),
      resolveHostname: async () => [publicAddress],
      chromePath: null,
    });

    const evidence = await reader.readUrl(
      "https://careers.example.com/backend",
    );
    expect(evidence).toMatchObject({
      source: "careers.example.com",
      fetchMethod: "http-html",
      structured: undefined,
    });
    expect(evidence?.pageText).toContain("Three years of Python experience");
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    [100, 64, 0, 1].join("."),
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    [198, 18, 0, 1].join("."),
    "203.0.113.1",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:172.16.0.1",
  ])("rejects non-public DNS address %s before connect", async (address) => {
    const requestPinned = vi.fn<PinnedHttpsRequest>();
    const reader = new StructuredWebJobReader({
      requestPinned,
      resolveHostname: async () => [address],
      chromePath: null,
    });
    await expect(
      reader.readUrl("https://jobs.example.com/private"),
    ).rejects.toThrow("public addresses");
    expect(requestPinned).not.toHaveBeenCalled();
  });

  it.each([
    "https://[::ffff:172.16.0.1]/latest/meta-data",
    "https://169.254.169.254/latest/meta-data",
  ])("rejects private and metadata IP literals %s", async (url) => {
    const requestPinned = vi.fn<PinnedHttpsRequest>();
    const resolveHostname = vi.fn(async () => [publicAddress]);
    const reader = new StructuredWebJobReader({
      requestPinned,
      resolveHostname,
      chromePath: null,
    });

    await expect(reader.readUrl(url)).rejects.toThrow("public addresses");
    expect(resolveHostname).not.toHaveBeenCalled();
    expect(requestPinned).not.toHaveBeenCalled();
  });

  it("blocks a private redirect target before connecting to it", async () => {
    const requested: string[] = [];
    const requestPinned: PinnedHttpsRequest = async (url) => {
      requested.push(url.toString());
      return {
        status: 302,
        headers: { location: "https://metadata.example/latest/meta-data" },
        body: Buffer.alloc(0),
      };
    };
    const reader = new StructuredWebJobReader({
      requestPinned,
      resolveHostname: async (hostname) =>
        hostname === "metadata.example" ? ["169.254.169.254"] : [publicAddress],
      chromePath: null,
    });

    await expect(
      reader.readUrl("https://jobs.example.com/redirect"),
    ).rejects.toThrow("No usable public job evidence");
    expect(requested).toEqual([
      "https://jobs.example.com/redirect",
      "https://jobs.example.com/redirect",
    ]);
  });

  it("fails closed when DNS changes between admission and connection", async () => {
    let resolution = 0;
    const requestPinned = vi.fn<PinnedHttpsRequest>();
    const reader = new StructuredWebJobReader({
      requestPinned,
      resolveHostname: async () => {
        resolution += 1;
        return resolution === 1 ? [publicAddress] : ["169.254.169.254"];
      },
      chromePath: null,
    });

    await expect(
      reader.readUrl("https://jobs.example.com/rebinding"),
    ).rejects.toThrow("No usable public job evidence");
    expect(requestPinned).not.toHaveBeenCalled();
  });

  it("keeps Chromium sandboxing and disables autonomous browser networking", () => {
    expect(CHROMIUM_SECURITY_ARGS).not.toContain("--no-sandbox");
    expect(CHROMIUM_SECURITY_ARGS).toContain(
      "--host-resolver-rules=MAP * ~NOTFOUND",
    );
    expect(CHROMIUM_SECURITY_ARGS).toContain("--disable-quic");
    expect(CHROMIUM_SECURITY_ARGS).toContain(
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    );
    expect(CHROMIUM_CONTEXT_SECURITY.serviceWorkers).toBe("block");
  });

  it("rejects mixed public/private DNS answers before connect", async () => {
    const requestPinned = vi.fn<PinnedHttpsRequest>();
    const reader = new StructuredWebJobReader({
      requestPinned,
      resolveHostname: async () => [publicAddress, "127.0.0.1"],
      chromePath: null,
    });

    await expect(
      reader.readUrl("https://jobs.example.com/mixed-dns"),
    ).rejects.toThrow("public addresses");
    expect(requestPinned).not.toHaveBeenCalled();
  });

  it("proxies browser subrequests through validation and blocks service workers", async () => {
    type RouteHandler = (route: ReturnType<typeof fakeRoute>) => Promise<void>;
    let routeHandler: RouteHandler | undefined;
    let contextOptions: Record<string, unknown> | undefined;
    const safeSubrequest = fakeRoute("https://assets.example/app.js", "script");
    const privateSubrequest = fakeRoute(
      "https://metadata.example/latest/meta-data",
      "script",
    );
    const mainRequest = fakeRoute(
      "https://jobs.example.com/browser-job",
      "document",
    );
    const page = {
      routeWebSocket: vi.fn(async () => undefined),
      route: vi.fn(async (_pattern: string, handler: RouteHandler) => {
        routeHandler = handler;
      }),
      goto: vi.fn(async () => {
        await routeHandler!(mainRequest);
        await routeHandler!(safeSubrequest);
        await routeHandler!(privateSubrequest);
        return { status: () => 200 };
      }),
      waitForTimeout: vi.fn(async () => undefined),
      url: () => "https://jobs.example.com/browser-job",
      content: vi.fn(async () => jobPage),
      title: vi.fn(async () => "Platform Engineer"),
    };
    const close = vi.fn(async () => undefined);
    vi.spyOn(chromium, "launch").mockResolvedValue({
      newContext: async (options: Record<string, unknown>) => {
        contextOptions = options;
        return {
          addInitScript: async () => undefined,
          newPage: async () => page,
        };
      },
      close,
    } as never);
    const requested: string[] = [];
    const reader = new StructuredWebJobReader({
      chromePath: "synthetic-chrome",
      resolveHostname: async (hostname) =>
        hostname === "metadata.example" ? ["169.254.169.254"] : [publicAddress],
      requestPinned: async (url) => {
        requested.push(url.toString());
        if (requested.length <= 2) {
          return {
            status: 200,
            headers: { "content-type": "text/plain" },
            body: Buffer.from("not html"),
          };
        }
        return url.hostname === "assets.example"
          ? {
              status: 200,
              headers: { "content-type": "application/javascript" },
              body: Buffer.from("window.loaded = true"),
            }
          : htmlResponse(jobPage);
      },
    });

    const evidence = await reader.readUrl(
      "https://jobs.example.com/browser-job",
    );

    expect(evidence?.fetchMethod).toBe("browser-json-ld");
    expect(contextOptions).toMatchObject({ serviceWorkers: "block" });
    expect(requested).not.toContain(
      "https://metadata.example/latest/meta-data",
    );
    expect(mainRequest.fulfill).toHaveBeenCalledOnce();
    expect(safeSubrequest.fulfill).toHaveBeenCalledOnce();
    expect(privateSubrequest.abort).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

function htmlResponse(html: string) {
  return {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(html),
  };
}

function fakeRoute(url: string, resourceType: string) {
  return {
    request: () => ({
      url: () => url,
      resourceType: () => resourceType,
      method: () => "GET",
      headers: () => ({ accept: "*/*" }),
    }),
    abort: vi.fn(async () => undefined),
    fulfill: vi.fn(async () => undefined),
  };
}
