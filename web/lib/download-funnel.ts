const RELEASE_REPO = "leopu00/job-hunter-team";
export const DOWNLOAD_RELEASE_TAG = "v0.4.0";
export const DOWNLOAD_RELEASE_API =
  `https://api.github.com/repos/${RELEASE_REPO}/releases/tags/${DOWNLOAD_RELEASE_TAG}`;
const RELEASE_BASE =
  `https://github.com/${RELEASE_REPO}/releases/download/${DOWNLOAD_RELEASE_TAG}`;

export const DOWNLOAD_TARGETS = {
  "win-setup": `${RELEASE_BASE}/job-hunter-team-windows-x64-setup.exe`,
  mac: `${RELEASE_BASE}/job-hunter-team-macos-universal.dmg`,
  linux: `${RELEASE_BASE}/job-hunter-team-linux-x64.AppImage`,
} as const;

export type DownloadSlug = keyof typeof DOWNLOAD_TARGETS;

const DOWNLOAD_ASSET_CANDIDATES: Record<
  DownloadSlug,
  readonly string[]
> = {
  "win-setup": ["job-hunter-team-windows-x64-setup.exe"],
  mac: ["job-hunter-team-macos-universal.dmg", "job-hunter-team.zip"],
  linux: [
    "job-hunter-team-linux-x64.AppImage",
    "job-hunter-team-linux-x64.tar.gz",
  ],
};

/**
 * Resolve only assets published inside the Tauri 0.4.0 release. The legacy
 * filenames are temporary aliases for a mixed-name 0.4.0 publication; they
 * must never fall through to the 0.3.9 release, whose bytes are Godot.
 */
export function resolveDownloadTarget(
  slug: string,
  release: unknown,
): string | null {
  if (!isDownloadSlug(slug) || !release || typeof release !== "object") {
    return null;
  }
  const payload = release as Record<string, unknown>;
  if (
    payload.tag_name !== DOWNLOAD_RELEASE_TAG ||
    payload.draft !== false ||
    payload.prerelease !== false ||
    !Array.isArray(payload.assets)
  ) {
    return null;
  }

  const uploaded = new Map(
    payload.assets.flatMap((asset) => {
      if (!asset || typeof asset !== "object") return [];
      const row = asset as Record<string, unknown>;
      if (
        typeof row.name !== "string" ||
        row.state !== "uploaded" ||
        typeof row.size !== "number" ||
        row.size <= 0
      ) {
        return [];
      }
      const expectedUrl = `${RELEASE_BASE}/${row.name}`;
      return row.browser_download_url === expectedUrl
        ? [[row.name, expectedUrl] as const]
        : [];
    }),
  );
  const selected = DOWNLOAD_ASSET_CANDIDATES[slug].find((name) =>
    uploaded.has(name),
  );
  return selected ? uploaded.get(selected)! : null;
}

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
