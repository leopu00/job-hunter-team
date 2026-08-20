import { describe, expect, it } from "vitest";

import { createPinnedLookup, isPublicAddress } from "../src/index.js";

const ipv4 = (...octets: number[]) => octets.join(".");

describe("safe HTTPS address policy", () => {
  it.each([
    "0.0.0.0",
    "10.255.255.255",
    ipv4(100, 127, 255, 255),
    "127.255.255.255",
    "169.254.169.254",
    "172.31.255.255",
    ipv4(192, 0, 0, 1),
    ipv4(192, 88, 99, 1),
    "192.168.255.255",
    ipv4(198, 19, 255, 255),
    "198.51.100.1",
    "203.0.113.1",
    ipv4(240, 0, 0, 1),
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:172.16.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe",
    "100::1",
    "2001::1",
    "2001:100::1",
    "2001:2::1",
    "2001:10::1",
    "2001:20::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
    "fc00::1",
    "fe80::1",
    "ff00::1",
  ])("rejects special address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([ipv4(8, 8, 8, 8), ipv4(1, 1, 1, 1), "2606:4700:4700::1111"])(
    "allows global address %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it("returns only the already validated addresses to the TLS connector", () => {
    const pinned = [
      { address: ipv4(8, 8, 8, 8), family: 4 as const },
      { address: "2606:4700:4700::1111", family: 6 as const },
    ];
    const lookup = createPinnedLookup(pinned);

    lookup("jobs.example.com", { all: true }, (error, addresses) => {
      expect(error).toBeNull();
      expect(addresses).toEqual(pinned);
    });
  });

  it("refuses a non-public address even at the socket lookup boundary", () => {
    expect(() =>
      createPinnedLookup([{ address: "127.0.0.1", family: 4 }]),
    ).toThrow("validated public addresses");
  });
});
