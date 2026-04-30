/**
 * Tests for IP address classification.
 *
 * Cases are ported from OpenClaw `src/infra/net/ssrf.test.ts` — the
 * IP-classification half of that suite, which exercises `ip.ts` directly.
 * Keeping the fixture set aligned with upstream is what makes "no drift"
 * a verifiable claim.
 *
 * Test runner is JHT's standard `node:test` + `node:assert/strict`, so
 * the upstream Vitest assertions are translated; the input fixtures are
 * unchanged.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractEmbeddedIpv4FromIpv6,
  isBlockedSpecialUseIpv4Address,
  isBlockedSpecialUseIpv6Address,
  isCanonicalDottedDecimalIPv4,
  isIpInCidr,
  isIpv4Address,
  isLegacyIpv4Literal,
  isLoopbackIpAddress,
  isRfc1918Ipv4Address,
  normalizeIpAddress,
  parseCanonicalIpAddress,
  parseLooseIpAddress,
} from "./ip.js";

const blockedIpv6MulticastLiterals = ["ff02::1", "ff05::1:3", "[ff02::1]"] as const;

const privateIpCases = [
  "198.18.0.1",
  "198.19.255.254",
  "198.51.100.42",
  "203.0.113.10",
  "192.0.0.8",
  "192.0.2.1",
  "192.88.99.1",
  "224.0.0.1",
  "239.255.255.255",
  "240.0.0.1",
  "255.255.255.255",
  "::ffff:127.0.0.1",
  "::ffff:198.18.0.1",
  "64:ff9b::198.51.100.42",
  "0:0:0:0:0:ffff:7f00:1",
  "0000:0000:0000:0000:0000:ffff:7f00:0001",
  "::127.0.0.1",
  "0:0:0:0:0:0:7f00:1",
  "[0:0:0:0:0:ffff:7f00:1]",
  "::ffff:169.254.169.254",
  "0:0:0:0:0:ffff:a9fe:a9fe",
  "64:ff9b::127.0.0.1",
  "64:ff9b::169.254.169.254",
  "64:ff9b:1::192.168.1.1",
  "64:ff9b:1::10.0.0.1",
  "2002:7f00:0001::",
  "2002:a9fe:a9fe::",
  "2001:0000:0:0:0:0:80ff:fefe",
  "2001:0000:0:0:0:0:3f57:fefe",
  "2002:c612:0001::",
  "::",
  "::1",
  "fe80::1%lo0",
  "fd00::1",
  "fec0::1",
  "100::1",
  ...blockedIpv6MulticastLiterals,
  "2001:2::1",
  "2001:20::1",
  "2001:db8::1",
  "2001:db8:1234::5efe:127.0.0.1",
  "2001:db8:1234:1:200:5efe:7f00:1",
];

const publicIpCases = [
  "93.184.216.34",
  "198.17.255.255",
  "198.20.0.1",
  "198.51.99.1",
  "198.51.101.1",
  "203.0.112.1",
  "203.0.114.1",
  "223.255.255.255",
  "2606:4700:4700::1111",
  "64:ff9b::8.8.8.8",
  "64:ff9b:1::8.8.8.8",
  "2002:0808:0808::",
  "2001:0000:0:0:0:0:f7f7:f7f7",
  "2001:4860:1234::5efe:8.8.8.8",
  "2001:4860:1234:1:1111:5efe:7f00:1",
];

const unsupportedLegacyIpv4Cases = [
  "0177.0.0.1",
  "0x7f.0.0.1",
  "127.1",
  "2130706433",
  "0x7f000001",
  "017700000001",
  "8.8.2056",
  "0x08080808",
  "08.0.0.1",
  "127..0.1",
];

const nonIpHostnameCases = ["example.com", "abc.123.example", "1password.com", "0x.example.com"];

/**
 * Mirror of OpenClaw's `isPrivateIpAddress` (in `infra/net/ssrf.ts`).
 * Re-implemented here as a test helper so `ip.ts` can be exercised in
 * isolation; the production composition lives in `ssrf.ts` once that
 * module lands.
 */
function classifyAsPrivateOrSpecialUse(address: string): boolean {
  const strictIp = parseCanonicalIpAddress(address);
  if (strictIp) {
    if (isIpv4Address(strictIp)) {
      return isBlockedSpecialUseIpv4Address(strictIp);
    }
    if (isBlockedSpecialUseIpv6Address(strictIp)) {
      return true;
    }
    const embeddedIpv4 = extractEmbeddedIpv4FromIpv6(strictIp);
    if (embeddedIpv4) {
      return isBlockedSpecialUseIpv4Address(embeddedIpv4);
    }
    return false;
  }

  if (address.includes(":") && !parseLooseIpAddress(address)) {
    return true;
  }

  if (!isCanonicalDottedDecimalIPv4(address) && isLegacyIpv4Literal(address)) {
    return true;
  }
  return looksLikeUnsupportedIpv4Literal(address);
}

function looksLikeUnsupportedIpv4Literal(address: string): boolean {
  const parts = address.split(".");
  if (parts.length === 0 || parts.length > 4) {
    return false;
  }
  if (parts.some((part) => part.length === 0)) {
    return true;
  }
  return parts.every((part) => /^[0-9]+$/.test(part) || /^0x/i.test(part));
}

describe("ip classification — private/special-use", () => {
  it("classifies blocked IP literals as private/special-use", () => {
    for (const address of privateIpCases) {
      assert.equal(
        classifyAsPrivateOrSpecialUse(address),
        true,
        `expected ${address} to be private/special-use`,
      );
    }
  });

  it("classifies legacy/malformed IPv4 literals as fail-closed", () => {
    for (const address of unsupportedLegacyIpv4Cases) {
      assert.equal(
        classifyAsPrivateOrSpecialUse(address),
        true,
        `expected ${address} to be fail-closed`,
      );
    }
  });

  it("classifies public IP literals as non-private", () => {
    for (const address of publicIpCases) {
      assert.equal(
        classifyAsPrivateOrSpecialUse(address),
        false,
        `expected ${address} to be public`,
      );
    }
  });

  it("does not treat plain hostnames as IP literals", () => {
    for (const hostname of nonIpHostnameCases) {
      assert.equal(
        classifyAsPrivateOrSpecialUse(hostname),
        false,
        `expected hostname ${hostname} to not classify as IP`,
      );
    }
  });
});

describe("isBlockedSpecialUseIpv4Address — RFC2544 benchmark policy", () => {
  it("blocks 198.18.0.1 by default", () => {
    const parsed = parseCanonicalIpAddress("198.18.0.1");
    assert.ok(parsed && isIpv4Address(parsed));
    assert.equal(isBlockedSpecialUseIpv4Address(parsed), true);
  });

  it("allows 198.18.0.1 when allowRfc2544BenchmarkRange is true", () => {
    const parsed = parseCanonicalIpAddress("198.18.0.1");
    assert.ok(parsed && isIpv4Address(parsed));
    assert.equal(
      isBlockedSpecialUseIpv4Address(parsed, { allowRfc2544BenchmarkRange: true }),
      false,
    );
  });

  it("still blocks unrelated special-use IPs even with RFC2544 allowance", () => {
    const parsed = parseCanonicalIpAddress("198.51.100.1");
    assert.ok(parsed && isIpv4Address(parsed));
    assert.equal(
      isBlockedSpecialUseIpv4Address(parsed, { allowRfc2544BenchmarkRange: true }),
      true,
    );
  });
});

describe("isLoopbackIpAddress / isRfc1918Ipv4Address", () => {
  it("recognizes IPv4 loopback", () => {
    assert.equal(isLoopbackIpAddress("127.0.0.1"), true);
    assert.equal(isLoopbackIpAddress("127.255.255.254"), true);
  });

  it("recognizes IPv6 loopback", () => {
    assert.equal(isLoopbackIpAddress("::1"), true);
  });

  it("recognizes RFC1918 IPv4 ranges", () => {
    for (const address of ["10.0.0.1", "172.16.5.5", "192.168.1.1"]) {
      assert.equal(isRfc1918Ipv4Address(address), true, `expected ${address}`);
    }
  });

  it("does not flag public IPs as RFC1918", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
      assert.equal(isRfc1918Ipv4Address(address), false, `expected ${address}`);
    }
  });
});

describe("normalizeIpAddress", () => {
  it("normalizes IPv4-mapped IPv6 to plain IPv4", () => {
    assert.equal(normalizeIpAddress("::ffff:127.0.0.1"), "127.0.0.1");
    assert.equal(normalizeIpAddress("::ffff:8.8.8.8"), "8.8.8.8");
  });

  it("returns undefined for invalid input", () => {
    assert.equal(normalizeIpAddress(""), undefined);
    assert.equal(normalizeIpAddress("not-an-ip"), undefined);
    assert.equal(normalizeIpAddress(undefined), undefined);
  });
});

describe("isIpInCidr", () => {
  it("matches exact IPv4 addresses", () => {
    assert.equal(isIpInCidr("8.8.8.8", "8.8.8.8"), true);
    assert.equal(isIpInCidr("8.8.8.8", "8.8.8.9"), false);
  });

  it("matches IPv4 CIDR ranges", () => {
    assert.equal(isIpInCidr("10.0.0.5", "10.0.0.0/8"), true);
    assert.equal(isIpInCidr("11.0.0.5", "10.0.0.0/8"), false);
  });

  it("matches IPv6 CIDR ranges", () => {
    assert.equal(isIpInCidr("fd00::1", "fd00::/8"), true);
    assert.equal(isIpInCidr("2606:4700::1", "fd00::/8"), false);
  });

  it("returns false for invalid input", () => {
    assert.equal(isIpInCidr("not-an-ip", "10.0.0.0/8"), false);
    assert.equal(isIpInCidr("10.0.0.1", "not-a-cidr"), false);
  });
});
