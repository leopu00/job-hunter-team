const RELEASE_BASE =
  "https://github.com/leopu00/job-hunter-team/releases/latest/download";

export const DOWNLOAD_TARGETS = {
  "win-setup": `${RELEASE_BASE}/job-hunter-team-windows-x64-setup.exe`,
  "win-portable": `${RELEASE_BASE}/job-hunter-team-windows-x64-portable.exe`,
  mac: `${RELEASE_BASE}/job-hunter-team.zip`,
  linux: `${RELEASE_BASE}/job-hunter-team-linux-x64.tar.gz`,
} as const;

export type DownloadSlug = keyof typeof DOWNLOAD_TARGETS;
export type DownloadAttribution = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
};
export type DownloadClick = DownloadAttribution & {
  ts_hour: string;
  slug: DownloadSlug;
};

type PageSearchParams = Record<string, string | string[] | undefined>;

const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;
type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];

// Keep cardinality bounded. These are the only launch values currently in
// use; extending a campaign requires one explicit code change here.
export const DOWNLOAD_ATTRIBUTION_ALLOWLIST: Record<
  AttributionKey,
  readonly string[]
> = {
  utm_source: ["reddit", "tiktok"],
  utm_medium: ["paid"],
  utm_campaign: ["lancio-2026-08"],
};

export function isDownloadSlug(value: string): value is DownloadSlug {
  return Object.hasOwn(DOWNLOAD_TARGETS, value);
}

export function sanitizeUtmValue(
  key: AttributionKey,
  value: string | null | undefined,
): string {
  return value !== undefined &&
    value !== null &&
    DOWNLOAD_ATTRIBUTION_ALLOWLIST[key].includes(value)
    ? value
    : "none";
}

export function attributionFromUrl(
  searchParams: URLSearchParams,
): DownloadAttribution {
  const value = (key: (typeof ATTRIBUTION_KEYS)[number]) => {
    const candidates = searchParams.getAll(key);
    return candidates.length === 1 ? candidates[0] : undefined;
  };

  return {
    utm_source: sanitizeUtmValue("utm_source", value("utm_source")),
    utm_medium: sanitizeUtmValue("utm_medium", value("utm_medium")),
    utm_campaign: sanitizeUtmValue("utm_campaign", value("utm_campaign")),
  };
}

export function attributionFromPage(
  searchParams: PageSearchParams,
): DownloadAttribution {
  const value = (key: (typeof ATTRIBUTION_KEYS)[number]) => {
    const candidate = searchParams[key];
    // Duplicate query parameters arrive as an array. Treat them as ambiguous
    // rather than selecting one value, so attribution stays fail-closed.
    return typeof candidate === "string" ? candidate : undefined;
  };

  return {
    utm_source: sanitizeUtmValue("utm_source", value("utm_source")),
    utm_medium: sanitizeUtmValue("utm_medium", value("utm_medium")),
    utm_campaign: sanitizeUtmValue("utm_campaign", value("utm_campaign")),
  };
}

export function downloadHour(now: Date): string {
  return now.toISOString().slice(0, 13);
}

export function createDownloadClick(
  slug: DownloadSlug,
  searchParams: URLSearchParams,
  now = new Date(),
): DownloadClick {
  return {
    ts_hour: downloadHour(now),
    slug,
    ...attributionFromUrl(searchParams),
  };
}

export function downloadHref(
  slug: DownloadSlug,
  attribution: DownloadAttribution,
): string {
  const query = new URLSearchParams();
  for (const key of ATTRIBUTION_KEYS) {
    const value = attribution[key];
    if (value !== "none") query.set(key, value);
  }
  const suffix = query.toString();
  return `/go/${slug}${suffix ? `?${suffix}` : ""}`;
}
