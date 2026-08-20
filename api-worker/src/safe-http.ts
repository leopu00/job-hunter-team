import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

const DNS_TIMEOUT_MS = 2_500;

export type ResolveHostname = (hostname: string) => Promise<string[]>;

export type PinnedAddress = {
  address: string;
  family: 4 | 6;
};

export type SafeHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export type PinnedHttpsRequest = (
  url: URL,
  addresses: readonly PinnedAddress[],
  options: {
    headers: Record<string, string>;
    maxBytes: number;
    timeoutMs: number;
  },
) => Promise<SafeHttpResponse>;

export type SafeHttpsClientOptions = {
  resolveHostname?: ResolveHostname;
  requestPinned?: PinnedHttpsRequest;
};

export class SafeHttpsClient {
  private readonly resolveHostname: ResolveHostname;
  private readonly requestPinned: PinnedHttpsRequest;

  constructor(options: SafeHttpsClientOptions = {}) {
    this.resolveHostname = options.resolveHostname ?? defaultResolveHostname;
    this.requestPinned = options.requestPinned ?? requestPinnedHttps;
  }

  async assertUrl(url: URL): Promise<readonly PinnedAddress[]> {
    assertHttpsUrlShape(url);
    const hostname = normalizedHostname(url);
    const rawAddresses = isIP(hostname)
      ? [hostname]
      : await withTimeout(
          this.resolveHostname(hostname),
          DNS_TIMEOUT_MS,
          "DNS resolution timed out",
        );
    const addresses = rawAddresses.map(toPinnedAddress);
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => !isPublicAddress(address))
    ) {
      throw new Error(
        "Job URL did not resolve exclusively to public addresses",
      );
    }
    return addresses;
  }

  async request(
    url: URL,
    options: {
      headers: Record<string, string>;
      maxBytes: number;
      timeoutMs: number;
    },
  ): Promise<SafeHttpResponse> {
    // The exact set that passed validation is handed to the socket lookup.
    // No second, untrusted DNS lookup occurs between the check and connect.
    const addresses = await this.assertUrl(url);
    return this.requestPinned(url, addresses, options);
  }
}

export function createPinnedLookup(
  addresses: readonly PinnedAddress[],
): LookupFunction {
  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) =>
        isIP(address) !== family || !isPublicAddress(address),
    )
  ) {
    throw new Error("Cannot connect without validated public addresses");
  }
  const frozen = addresses.map((entry) => ({ ...entry }));
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(
        null,
        frozen.map((entry) => ({ ...entry })),
      );
      return;
    }
    const requestedFamily = options.family;
    const selected =
      frozen.find(
        ({ family }) => !requestedFamily || family === requestedFamily,
      ) ?? frozen[0]!;
    callback(null, selected.address, selected.family);
  };
}

export function isPublicAddress(rawAddress: string): boolean {
  const address = stripIpv6Brackets(rawAddress).toLowerCase();
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;
  const bytes = parseIpv6(address);
  if (!bytes) return false;

  // IPv4-mapped IPv6 must inherit the embedded IPv4 policy. All other
  // IPv4-compatible forms are deprecated transition space and fail closed.
  if (bytes.slice(0, 10).every((byte) => byte === 0)) {
    if (bytes[10] === 0xff && bytes[11] === 0xff) {
      return isPublicIpv4(bytes.slice(12).join("."));
    }
    return false;
  }

  // Accept only global-unicast IPv6, then remove non-global/documentation and
  // deprecated transition allocations that sit inside 2000::/3.
  if ((bytes[0]! & 0xe0) !== 0x20) return false;
  return ![
    ["2001::", 23], // IETF protocol assignments; fail closed on exceptions
    ["2001:0db8::", 32], // documentation
    ["2002::", 16], // deprecated 6to4 transition space
    ["3fff::", 20], // documentation
  ].some(([network, prefix]) =>
    ipv6InCidr(bytes, parseIpv6(String(network))!, Number(prefix)),
  );
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  return (await lookup(hostname, { all: true, verbatim: true })).map(
    ({ address }) => address,
  );
}

function assertHttpsUrlShape(url: URL): void {
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Only unauthenticated HTTPS job URLs are allowed");
  }
  const hostname = normalizedHostname(url);
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  ) {
    throw new Error("Local hosts are not allowed");
  }
}

function normalizedHostname(url: URL): string {
  return stripIpv6Brackets(url.hostname).toLowerCase().replace(/\.$/, "");
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
}

function toPinnedAddress(address: string): PinnedAddress {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  const family = isIP(normalized);
  if (family !== 4 && family !== 6) {
    throw new Error("DNS returned an invalid address");
  }
  return { address: normalized, family };
}

function requestPinnedHttps(
  url: URL,
  addresses: readonly PinnedAddress[],
  options: {
    headers: Record<string, string>;
    maxBytes: number;
    timeoutMs: number;
  },
): Promise<SafeHttpResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: options.headers,
        lookup: createPinnedLookup(addresses),
        signal: AbortSignal.timeout(options.timeoutMs),
      },
      (response) => {
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          response.destroy(new Error("Remote response is too large"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.byteLength;
          if (size > options.maxBytes) {
            response.destroy(new Error("Remote response is too large"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: normalizeResponseHeaders(response.headers),
            body: Buffer.concat(chunks, size),
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function normalizeResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    normalized[name.toLowerCase()] = Array.isArray(value)
      ? value.join("\n")
      : value;
  }
  return normalized;
}

function isPublicIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [a, b] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && octets[2] === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a! >= 224
  );
}

function parseIpv4(address: string): number[] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return undefined;
  const octets = address.split(".").map(Number);
  return octets.every(
    (part) => Number.isInteger(part) && part >= 0 && part <= 255,
  )
    ? octets
    : undefined;
}

function parseIpv6(address: string): number[] | undefined {
  if (address.includes("%") || address.split("::").length > 2) return undefined;
  let normalized = address;
  const ipv4Match = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Match) {
    const ipv4 = parseIpv4(ipv4Match[1]!);
    if (!ipv4) return undefined;
    const replacement = `${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
    normalized = normalized.slice(0, -ipv4Match[1]!.length) + replacement;
  }
  const [leftRaw, rightRaw] = normalized.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  if (![...left, ...right].every((part) => /^[0-9a-f]{1,4}$/i.test(part))) {
    return undefined;
  }
  const omitted = 8 - left.length - right.length;
  if (
    (normalized.includes("::") && omitted < 1) ||
    (!normalized.includes("::") && omitted !== 0)
  ) {
    return undefined;
  }
  const words = [
    ...left,
    ...Array.from({ length: omitted }, () => "0"),
    ...right,
  ].map((part) => Number.parseInt(part, 16));
  if (words.length !== 8) return undefined;
  return words.flatMap((word) => [word >> 8, word & 0xff]);
}

function ipv6InCidr(
  address: readonly number[],
  network: readonly number[],
  prefix: number,
): boolean {
  const fullBytes = Math.floor(prefix / 8);
  const remainingBits = prefix % 8;
  for (let index = 0; index < fullBytes; index += 1) {
    if (address[index] !== network[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (address[fullBytes]! & mask) === (network[fullBytes]! & mask);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
