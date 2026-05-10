/**
 * Tests for the SSRF dispatcher.
 *
 * Coverage roughly mirrors OpenClaw `infra/net/ssrf.test.ts` and the
 * security-relevant cases of `fetch-guard.test.ts` and `ssrf.pinning.test.ts`,
 * adapted to JHT's distilled `safeFetch` contract.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isBlockedHostnameOrIp,
  isPrivateIpAddress,
  resolveAndAssertPublicHostname,
  safeFetch,
  SsrFBlockedError,
  validateUrl,
} from "./ssrf.js";

// ─────────────────────────────────────────────────────────────────────────────
// isBlockedHostnameOrIp / isPrivateIpAddress
// ─────────────────────────────────────────────────────────────────────────────

describe("isBlockedHostnameOrIp — reserved hostnames", () => {
  for (const hostname of [
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "api.localhost",
    "svc.local",
    "db.internal",
  ]) {
    it(`blocks ${hostname}`, () => {
      assert.equal(isBlockedHostnameOrIp(hostname), true);
    });
  }
});

describe("isBlockedHostnameOrIp — IP literals", () => {
  const cases: Array<[string, boolean]> = [
    ["198.18.0.1", true], // RFC2544 benchmark range
    ["198.20.0.1", false], // outside RFC2544
    ["100::1", true], // discard prefix (IPv6 100::/64)
    ["2001:2::1", true], // benchmarking
    ["2001:20::1", true], // ORCHIDv2
    ["2001:db8::1", true], // documentation
    ["::ffff:127.0.0.1", true], // IPv4-mapped loopback
    ["::ffff:169.254.169.254", true], // IPv4-mapped link-local (cloud metadata)
    ["64:ff9b::169.254.169.254", true], // NAT64-encoded link-local
    ["2002:7f00:0001::", true], // 6to4-encoded loopback (127.0.0.1)
    ["8.8.8.8", false], // public DNS
    ["1.1.1.1", false], // public DNS
  ];
  for (const [value, expected] of cases) {
    it(`${value} → ${expected ? "blocked" : "allowed"}`, () => {
      assert.equal(isBlockedHostnameOrIp(value), expected);
    });
  }
});

describe("isBlockedHostnameOrIp — RFC2544 benchmark policy", () => {
  it("blocks 198.18.0.1 by default", () => {
    assert.equal(isBlockedHostnameOrIp("198.18.0.1"), true);
  });

  it("allows 198.18.0.1 with allowRfc2544BenchmarkRange", () => {
    assert.equal(
      isBlockedHostnameOrIp("198.18.0.1", { allowRfc2544BenchmarkRange: true }),
      false,
    );
  });

  it("still blocks unrelated IPs even with RFC2544 allowance", () => {
    assert.equal(
      isBlockedHostnameOrIp("198.51.100.1", { allowRfc2544BenchmarkRange: true }),
      true,
    );
  });
});

describe("isPrivateIpAddress — legacy IPv4 literals fail-closed", () => {
  for (const literal of ["0177.0.0.1", "8.8.2056", "127.1", "2130706433", "0x7f000001"]) {
    it(`blocks ${literal}`, () => {
      assert.equal(isPrivateIpAddress(literal), true);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// validateUrl
// ─────────────────────────────────────────────────────────────────────────────

describe("validateUrl — scheme allowlist", () => {
  for (const scheme of ["ftp:", "file:", "data:", "javascript:", "gopher:"]) {
    it(`rejects ${scheme}`, () => {
      assert.throws(
        () => validateUrl(`${scheme}//example.com/x`),
        (err: unknown) => err instanceof SsrFBlockedError,
      );
    });
  }

  it("accepts http:", () => {
    assert.doesNotThrow(() => validateUrl("http://example.com/"));
  });

  it("accepts https:", () => {
    assert.doesNotThrow(() => validateUrl("https://example.com/"));
  });
});

describe("validateUrl — hostname / IP literal blocking", () => {
  for (const url of [
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://10.0.0.1/x",
    "http://192.168.1.1/x",
    "http://169.254.169.254/latest/meta-data/", // AWS metadata
    "http://metadata.google.internal/computeMetadata/v1/", // GCP metadata
    "http://[::1]/x",
    "http://[::ffff:127.0.0.1]/x",
    "http://api.local/x",
    "http://db.internal/x",
  ]) {
    it(`blocks ${url}`, () => {
      assert.throws(
        () => validateUrl(url),
        (err: unknown) =>
          err instanceof SsrFBlockedError && /private|special-use|hostname/.test(err.message),
      );
    });
  }

  it("allows public URLs", () => {
    assert.doesNotThrow(() => validateUrl("https://example.com/jd/123"));
    assert.doesNotThrow(() => validateUrl("https://api.greenhouse.io/v1/jobs"));
  });
});

describe("validateUrl — hostnameAllowlist", () => {
  it("allows hostname matching exact pattern", () => {
    assert.doesNotThrow(() =>
      validateUrl("https://api.example.com/x", { hostnameAllowlist: ["api.example.com"] }),
    );
  });

  it("allows hostname matching wildcard pattern", () => {
    assert.doesNotThrow(() =>
      validateUrl("https://api.example.com/x", { hostnameAllowlist: ["*.example.com"] }),
    );
  });

  it("rejects hostname not in allowlist", () => {
    assert.throws(
      () => validateUrl("https://evil.com/x", { hostnameAllowlist: ["*.example.com"] }),
      (err: unknown) => err instanceof SsrFBlockedError && /allowlist/.test(err.message),
    );
  });

  it("rejects bare domain when only wildcard pattern is set", () => {
    // *.example.com does NOT match example.com itself
    assert.throws(
      () => validateUrl("https://example.com/x", { hostnameAllowlist: ["*.example.com"] }),
      (err: unknown) => err instanceof SsrFBlockedError,
    );
  });
});

describe("validateUrl — allowPrivateNetwork", () => {
  it("allows loopback when allowPrivateNetwork=true", () => {
    assert.doesNotThrow(() =>
      validateUrl("http://127.0.0.1:3000/api", { allowPrivateNetwork: true }),
    );
  });
});

describe("validateUrl — allowedHostnames", () => {
  // The gateway route relies on this to whitelist localhost without flipping
  // the global allowPrivateNetwork escape hatch.
  it("allows a named loopback hostname while still blocking other private IPs", () => {
    const policy = { allowedHostnames: ["localhost", "127.0.0.1", "::1"] };
    assert.doesNotThrow(() => validateUrl("http://localhost:18789/status", policy));
    assert.doesNotThrow(() => validateUrl("http://127.0.0.1:18789/status", policy));
    assert.doesNotThrow(() => validateUrl("http://[::1]:18789/status", policy));

    assert.throws(
      () => validateUrl("http://10.0.0.1/status", policy),
      (err: unknown) => err instanceof SsrFBlockedError,
    );
    assert.throws(
      () => validateUrl("http://169.254.169.254/", policy),
      (err: unknown) => err instanceof SsrFBlockedError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveAndAssertPublicHostname (mocked DNS)
// ─────────────────────────────────────────────────────────────────────────────

type MockLookup = (hostname: string, opts?: { all?: boolean }) => Promise<unknown>;

function staticLookup(map: Record<string, Array<{ address: string; family: 4 | 6 }>>): MockLookup {
  return async (hostname, _opts) => {
    const entries = map[hostname];
    if (!entries) {
      throw Object.assign(new Error(`mock: no record for ${hostname}`), { code: "ENOTFOUND" });
    }
    return entries;
  };
}

describe("resolveAndAssertPublicHostname", () => {
  it("returns resolved addresses for a public hostname", async () => {
    const lookupFn = staticLookup({
      "example.com": [{ address: "93.184.216.34", family: 4 }],
    }) as unknown as Parameters<typeof resolveAndAssertPublicHostname>[1]["lookupFn"];

    const addresses = await resolveAndAssertPublicHostname("example.com", { lookupFn });
    assert.deepEqual(addresses, ["93.184.216.34"]);
  });

  it("blocks when DNS resolves to a private IP (rebinding defence)", async () => {
    const lookupFn = staticLookup({
      "evil.example.com": [{ address: "169.254.169.254", family: 4 }],
    }) as unknown as Parameters<typeof resolveAndAssertPublicHostname>[1]["lookupFn"];

    await assert.rejects(
      () => resolveAndAssertPublicHostname("evil.example.com", { lookupFn }),
      (err: unknown) =>
        err instanceof SsrFBlockedError && /resolves to private|special-use/.test(err.message),
    );
  });

  it("blocks when ANY resolved IP is private (mixed-record attack)", async () => {
    const lookupFn = staticLookup({
      "mixed.example.com": [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    }) as unknown as Parameters<typeof resolveAndAssertPublicHostname>[1]["lookupFn"];

    await assert.rejects(
      () => resolveAndAssertPublicHostname("mixed.example.com", { lookupFn }),
      (err: unknown) => err instanceof SsrFBlockedError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// safeFetch — mocked fetch + DNS
// ─────────────────────────────────────────────────────────────────────────────

function recordingFetch(
  responses: Array<{ url: string; status: number; headers?: Record<string, string> }>,
): {
  fetchImpl: NonNullable<Parameters<typeof safeFetch>[2]>["fetchImpl"];
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    fetchImpl: async (input, _init) => {
      calls.push(String(input));
      const next = responses[i++];
      if (!next) {
        throw new Error(`mock fetch exhausted at call ${calls.length}: ${input}`);
      }
      const headers = new Headers(next.headers ?? {});
      return new Response(null, { status: next.status, headers });
    },
  };
}

function publicLookup(): NonNullable<Parameters<typeof safeFetch>[2]>["lookupFn"] {
  return staticLookup({
    "example.com": [{ address: "93.184.216.34", family: 4 }],
    "other.example.com": [{ address: "93.184.216.35", family: 4 }],
    "rebind.example.com": [{ address: "10.0.0.1", family: 4 }],
  }) as unknown as NonNullable<Parameters<typeof safeFetch>[2]>["lookupFn"];
}

describe("safeFetch — happy path", () => {
  it("fetches a 200 response with no redirects", async () => {
    const { fetchImpl, calls } = recordingFetch([
      { url: "https://example.com/", status: 200 },
    ]);
    const { response, finalUrl } = await safeFetch(
      "https://example.com/",
      undefined,
      { fetchImpl, lookupFn: publicLookup() },
    );
    assert.equal(response.status, 200);
    assert.equal(finalUrl, "https://example.com/");
    assert.deepEqual(calls, ["https://example.com/"]);
  });
});

describe("safeFetch — redirect handling", () => {
  it("follows same-origin redirects up to maxRedirects", async () => {
    const { fetchImpl, calls } = recordingFetch([
      { url: "/a", status: 302, headers: { location: "/b" } },
      { url: "/b", status: 302, headers: { location: "/c" } },
      { url: "/c", status: 200 },
    ]);
    const { response, finalUrl } = await safeFetch(
      "https://example.com/a",
      undefined,
      { fetchImpl, lookupFn: publicLookup(), maxRedirects: 3 },
    );
    assert.equal(response.status, 200);
    assert.equal(finalUrl, "https://example.com/c");
    assert.equal(calls.length, 3);
  });

  it("rejects when redirects exceed maxRedirects", async () => {
    const { fetchImpl } = recordingFetch([
      { url: "/a", status: 302, headers: { location: "/b" } },
      { url: "/b", status: 302, headers: { location: "/c" } },
    ]);
    await assert.rejects(
      () =>
        safeFetch("https://example.com/a", undefined, {
          fetchImpl,
          lookupFn: publicLookup(),
          maxRedirects: 1,
        }),
      /Too many redirects/,
    );
  });

  it("rejects redirect loops", async () => {
    const { fetchImpl } = recordingFetch([
      { url: "/a", status: 302, headers: { location: "https://example.com/a" } },
    ]);
    await assert.rejects(
      () =>
        safeFetch("https://example.com/a", undefined, {
          fetchImpl,
          lookupFn: publicLookup(),
        }),
      /Redirect loop detected/,
    );
  });

  it("rejects redirect to a private IP after public start", async () => {
    const { fetchImpl } = recordingFetch([
      {
        url: "https://example.com/jd",
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      },
    ]);
    await assert.rejects(
      () =>
        safeFetch("https://example.com/jd", undefined, {
          fetchImpl,
          lookupFn: publicLookup(),
        }),
      (err: unknown) => err instanceof SsrFBlockedError,
    );
  });

  it("rejects redirect to a hostname that resolves to a private IP", async () => {
    const { fetchImpl } = recordingFetch([
      {
        url: "https://example.com/",
        status: 302,
        headers: { location: "https://rebind.example.com/" },
      },
    ]);
    await assert.rejects(
      () =>
        safeFetch("https://example.com/", undefined, {
          fetchImpl,
          lookupFn: publicLookup(),
        }),
      (err: unknown) =>
        err instanceof SsrFBlockedError && /resolves to private|special-use/.test(err.message),
    );
  });

  it("rejects redirect to a non-http(s) scheme", async () => {
    const { fetchImpl } = recordingFetch([
      {
        url: "https://example.com/",
        status: 302,
        headers: { location: "file:///etc/passwd" },
      },
    ]);
    await assert.rejects(
      () =>
        safeFetch("https://example.com/", undefined, {
          fetchImpl,
          lookupFn: publicLookup(),
        }),
      (err: unknown) => err instanceof SsrFBlockedError && /scheme/.test(err.message),
    );
  });
});

describe("safeFetch — initial URL validation", () => {
  it("rejects an invalid scheme on the initial request", async () => {
    await assert.rejects(
      () =>
        safeFetch("ftp://example.com/x", undefined, {
          fetchImpl: () => Promise.reject(new Error("should not be called")),
          lookupFn: publicLookup(),
        }),
      (err: unknown) => err instanceof SsrFBlockedError && /scheme/.test(err.message),
    );
  });

  it("rejects a literal private IP on the initial request", async () => {
    await assert.rejects(
      () =>
        safeFetch("http://10.0.0.1/admin", undefined, {
          fetchImpl: () => Promise.reject(new Error("should not be called")),
          lookupFn: publicLookup(),
        }),
      (err: unknown) => err instanceof SsrFBlockedError,
    );
  });

  it("rejects a hostname that resolves to a private IP on the initial request", async () => {
    await assert.rejects(
      () =>
        safeFetch("https://rebind.example.com/x", undefined, {
          fetchImpl: () => Promise.reject(new Error("should not be called")),
          lookupFn: publicLookup(),
        }),
      (err: unknown) => err instanceof SsrFBlockedError,
    );
  });
});
