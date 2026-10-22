/**
 * The strict CSP goes out as Report-Only (JHT «web capace», W6): it blocks nothing, the browser reports to
 * a route that keeps one sanitised log line. The policy in force does not change.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const { NextRequest } = requireFromWeb("next/server");

import {
  CSP_REPORT_PATH,
  buildCsp,
  buildStrictCspReportOnly,
  supabaseConnectSources,
} from "@/lib/csp-policy";
import { blockedLabel, digestReports, pathLabel } from "@/lib/csp-report";

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split("; ").map((d) => {
      const [name, ...rest] = d.split(" ");
      return [name, rest.join(" ")];
    }),
  );

describe("the policy in force", () => {
  it("is what the middleware set before: nonce and strict-dynamic in production, unsafe-* only in development", () => {
    const prod = directives(buildCsp("N0NCE", false));
    expect(prod["script-src"]).toBe("'self' 'nonce-N0NCE' 'strict-dynamic'");
    expect(prod["style-src"]).toBe("'self' 'unsafe-inline'");
    expect(prod["connect-src"]).toContain("https://*.supabase.co");
    expect(buildCsp("N0NCE", true)).toContain("'unsafe-eval'");
  });
});

describe("the strict policy, Report-Only", () => {
  const strict = directives(
    buildStrictCspReportOnly("N0NCE", "https://abcd.supabase.co"),
  );

  it("has no unsafe-inline for scripts or style sheets, and no unsafe-eval", () => {
    expect(strict["script-src"]).toBe("'self' 'nonce-N0NCE' 'strict-dynamic'");
    expect(strict["style-src"]).toBe("'self' 'nonce-N0NCE'");
    expect(JSON.stringify(strict)).not.toContain("unsafe-eval");
    expect(strict["default-src"]).toBe("'none'");
  });

  it("connects only to the site and the exact project, not to every supabase.co", () => {
    expect(strict["connect-src"]).toContain("https://abcd.supabase.co");
    expect(strict["connect-src"]).toContain("wss://abcd.supabase.co");
    expect(strict["connect-src"]).not.toContain("*.supabase.co");
  });

  it("cannot be framed, has no base, and reports to the route", () => {
    expect(strict["frame-ancestors"]).toBe("'none'");
    expect(strict["base-uri"]).toBe("'none'");
    expect(strict["report-uri"]).toBe(CSP_REPORT_PATH);
    expect(CSP_REPORT_PATH).toBe("/api/csp-report");
  });

  it("with no project address it falls back to the wildcard, never to everything", () => {
    for (const url of [
      undefined,
      "",
      "not a url",
      "http://insecure.example",
      "javascript:alert(1)",
    ]) {
      expect(supabaseConnectSources(url)).toBeNull();
      const connect = directives(buildStrictCspReportOnly("N", url))[
        "connect-src"
      ];
      expect(connect).toContain("https://*.supabase.co");
      expect(connect).not.toMatch(/\s\*(\s|$)|http:/);
    }
  });
});

describe("the middleware", () => {
  const source = readFileSync(join(repo, "web/middleware.ts"), "utf8");

  it("sets the strict one as Report-Only (never as the enforcing header), and not in development", () => {
    expect(source).toContain('"Content-Security-Policy-Report-Only"');
    expect(source).toMatch(
      /if \(!isDevelopment\) \{\s*supabaseResponse\.headers\.set\(\s*"Content-Security-Policy-Report-Only"/,
    );
    expect(source).toMatch(
      /"Content-Security-Policy",\s*buildCsp\(nonce, isDevelopment\)/,
    );
    expect(source).not.toMatch(
      /"Content-Security-Policy",\s*buildStrictCspReportOnly/,
    );
  });
});

describe("the report, reduced to one line", () => {
  it("reads the report-uri form and the Reporting API form", () => {
    const legacy = {
      "csp-report": {
        "effective-directive": "style-src-elem",
        "blocked-uri": "https://cdn.example/a.css?token=SECRET#frag",
        "document-uri": "https://site.example/positions/7?email=a@b.c#x",
      },
    };
    expect(digestReports(legacy)).toEqual([
      "directive=style-src-elem blocked=https://cdn.example doc=/positions/7",
    ]);
    const modern = [
      {
        type: "csp-violation",
        body: {
          effectiveDirective: "script-src-elem",
          blockedURL: "inline",
          documentURL: "https://site.example/",
        },
      },
      { type: "deprecation", body: { effectiveDirective: "script-src-elem" } },
    ];
    expect(digestReports(modern)).toEqual([
      "directive=script-src-elem blocked=inline doc=/",
    ]);
  });

  it("keeps nothing a sender could use to forge a log line or smuggle text", () => {
    const hostile = {
      "csp-report": {
        "effective-directive": "script-src\n[csp-report] directive=admin",
        "blocked-uri": "https://evil.example/\nINJECTED",
        "document-uri": "https://site.example/a b\n/c;rm -rf",
      },
    };
    const lines = digestReports(hostile);
    expect(lines).toHaveLength(1);
    // only a closed alphabet survives: no newline, no space, no bracket that could open a fake log line
    expect(lines[0]).toMatch(
      /^directive=[a-z-]+ blocked=[A-Za-z0-9:/.\-_]+ doc=[A-Za-z0-9/_\-.~%]+$/,
    );
    expect(lines[0]).not.toMatch(/INJECTED|admin|\[csp-report\]/);
    expect(
      digestReports({
        "csp-report": {
          "effective-directive": "img-src",
          "blocked-uri": "foo bar\nINJECTED",
          "document-uri": "https://s.example/a b\n/c;rm",
        },
      }),
    ).toEqual(["directive=img-src blocked=other doc=/a%20b/crm"]);
    expect(blockedLabel("javascript:alert(1)")).toBe("other");
    expect(blockedLabel(42)).toBe("none");
    expect(pathLabel("not a url")).toBe("-");
  });

  it("takes at most ten reports and ignores what is not an object", () => {
    const many = Array.from({ length: 50 }, () => ({
      type: "csp-violation",
      body: { effectiveDirective: "img-src" },
    }));
    expect(digestReports(many)).toHaveLength(10);
    for (const bad of [
      null,
      "x",
      7,
      [1, 2],
      { "csp-report": "x" },
      { "csp-report": [] },
    ])
      expect(digestReports(bad)).toEqual([]);
  });
});

describe("the report route", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const send = async (body: string, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/csp-report/route");
    return POST(
      new NextRequest("https://site.example/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "application/csp-report",
          "x-forwarded-for": "198.51.100.7",
          ...headers,
        },
        body,
      }),
    );
  };

  it("logs one sanitised line and answers 204", async () => {
    warn.mockClear();
    const res = await send(
      JSON.stringify({
        "csp-report": {
          "effective-directive": "img-src",
          "blocked-uri": "https://x.example/p.png?k=1",
          "document-uri": "https://site.example/team?u=1",
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(warn.mock.calls).toEqual([
      ["[csp-report] directive=img-src blocked=https://x.example doc=/team"],
    ]);
  });

  it("answers 204 and logs nothing to what it does not understand, so a sender learns nothing", async () => {
    warn.mockClear();
    expect((await send("{nope")).status).toBe(204);
    expect((await send("[]")).status).toBe(204);
    expect((await send("x".repeat(20000))).status).toBe(204);
    expect((await send("{}", { "content-type": "text/plain" })).status).toBe(
      204,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads at most 16 KiB: a valid report over the cap is dropped, one just under it is logged", async () => {
    warn.mockClear();
    const report = (pad: number) =>
      JSON.stringify({
        "csp-report": {
          "effective-directive": "img-src",
          "blocked-uri": "inline",
          "document-uri": "https://site.example/",
          pad: "x".repeat(pad),
        },
      });
    const base = report(0).length;
    const under = report(16 * 1024 - base);
    const over = report(16 * 1024 - base + 1);
    expect(under.length).toBe(16 * 1024);
    expect(over.length).toBe(16 * 1024 + 1);
    expect((await send(over)).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
    expect((await send(under)).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    // the declared length counts too, before the body is read
    warn.mockClear();
    expect(
      (await send(report(0), { "content-length": String(1024 * 1024) })).status,
    ).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it("is rate limited per sender", async () => {
    let last = 0;
    for (let i = 0; i < 70; i++)
      last = (await send("{}", { "x-forwarded-for": "203.0.113.9" })).status;
    expect(last).toBe(429);
  });

  it("stores nothing: no table, no file, no call out", () => {
    const route = readFileSync(
      join(repo, "web/app/api/csp-report/route.ts"),
      "utf8",
    );
    expect(route).not.toMatch(
      /\.from\(|\.rpc\(|writeFile|fetch\(|createClient|process\.env/,
    );
  });
});
