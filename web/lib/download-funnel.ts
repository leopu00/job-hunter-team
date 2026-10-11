const RELEASE_039 =
  "https://github.com/leopu00/job-hunter-team/releases/download/v0.3.9";

export type DownloadArtifact = {
  url: string;
  version: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  sourceCommit: string;
  engine: "Godot";
  runtimeVersion: string;
};

// The active bytes, shared by /go, /download and the setup guide.
// Keep 0.3.9 until the exact Windows candidate passes retest and its hosted
// copy is verified. Activation replaces the complete installer entry; there
// is no latest fallback, environment switch or untested portable promotion.
// To withdraw the installer, set its whole entry to null: no active bytes.
export const DOWNLOAD_ARTIFACTS = {
  "win-setup": {
    url: `${RELEASE_039}/job-hunter-team-windows-x64-setup.exe`,
    version: "0.3.9",
    filename: "job-hunter-team-windows-x64-setup.exe",
    sha256: "13c70048aabbcaa5c6551da656e1c4ab7a23d8708e79fc9929d47577367d9290",
    sizeBytes: 296542703,
    sourceCommit: "8227b1cb0158e631d78542c8c75f09ac2b7b9ea9",
    engine: "Godot",
    runtimeVersion: "0.3.9",
  } as DownloadArtifact | null,
  "win-portable": {
    url: `${RELEASE_039}/job-hunter-team-windows-x64-portable.exe`,
    version: "0.3.9",
    filename: "job-hunter-team-windows-x64-portable.exe",
    sha256: "b29e76f3884966ff18e5db6d3caabd592af22a56d1bd7ab1e358783f648d91c1",
    sizeBytes: 569442624,
    sourceCommit: "8227b1cb0158e631d78542c8c75f09ac2b7b9ea9",
    engine: "Godot",
    runtimeVersion: "0.3.9",
  },
  mac: {
    url: `${RELEASE_039}/job-hunter-team.zip`,
    version: "0.3.9",
    filename: "job-hunter-team.zip",
    sha256: "91abb540657f4e7c41e3eeaebaba657844e42484ec01ca662cb7865b8c6e35ce",
    sizeBytes: 319176247,
    sourceCommit: "8227b1cb0158e631d78542c8c75f09ac2b7b9ea9",
    engine: "Godot",
    runtimeVersion: "0.3.9",
  },
  linux: {
    url: `${RELEASE_039}/job-hunter-team-linux-x64.tar.gz`,
    version: "0.3.9",
    filename: "job-hunter-team-linux-x64.tar.gz",
    sha256: "d94aed64adc9c8783c91b19c1bd1a4e11ea672513435efaa32f316349fe766dd",
    sizeBytes: 289755849,
    sourceCommit: "8227b1cb0158e631d78542c8c75f09ac2b7b9ea9",
    engine: "Godot",
    runtimeVersion: "0.3.9",
  },
} satisfies Record<string, DownloadArtifact | null>;

export type DownloadSlug = keyof typeof DOWNLOAD_ARTIFACTS;
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
  return Object.hasOwn(DOWNLOAD_ARTIFACTS, value);
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
  attribution: DownloadAttribution = {
    utm_source: "none",
    utm_medium: "none",
    utm_campaign: "none",
  },
): string {
  const query = new URLSearchParams();
  for (const key of ATTRIBUTION_KEYS) {
    const value = attribution[key];
    if (value !== "none") query.set(key, value);
  }
  const suffix = query.toString();
  return `/go/${slug}${suffix ? `?${suffix}` : ""}`;
}
