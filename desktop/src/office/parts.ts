import type {
  CreateOfficeEngine,
  DiffOfficeSnapshots,
  LoadOfficeSnapshot,
  OfficeEngine,
  OfficeLayout,
  OfficeManifest,
  Piles,
} from "./contract";

/**
 * The office's three parts meet here. The engine and the data layer are
 * built in parallel in their own folders (engine/, data/); until one has
 * landed, the page still runs and says what is missing, instead of the
 * build failing on an import. import.meta.glob finds a module only if the
 * file exists, and takes it as soon as it does.
 */
const engineModules = import.meta.glob<{ createOfficeEngine: CreateOfficeEngine }>("./engine/index.ts");
const dataModules = import.meta.glob<{ loadOfficeSnapshot: LoadOfficeSnapshot; diffOfficeSnapshots: DiffOfficeSnapshots }>(
  "./data/index.ts",
);

export type OfficeParts = {
  createEngine: CreateOfficeEngine | null;
  data: { load: LoadOfficeSnapshot; diff: DiffOfficeSnapshots } | null;
};

export async function loadParts(): Promise<OfficeParts> {
  const engine = engineModules["./engine/index.ts"];
  const data = dataModules["./data/index.ts"];
  const [e, d] = await Promise.all([engine?.(), data?.()]);
  return {
    createEngine: e?.createOfficeEngine ?? null,
    data: d ? { load: d.loadOfficeSnapshot, diff: d.diffOfficeSnapshots } : null,
  };
}

/** Without the engine: an empty office, nobody drawn, piles unknown. Never invented agents. */
export function emptyEngine(): OfficeEngine {
  const piles: Piles = { scout: null, analisti: null, scorer: null, scrittori: null, critici: null };
  return {
    apply: () => {},
    step: () => {},
    poses: () => [],
    bubbles: () => [],
    piles: () => piles,
  };
}

export type OfficeAssets = { manifest: OfficeManifest; layout: OfficeLayout };

/** /office/manifest.json, then the layout it names. null when the assets are not in the app yet. */
export async function loadAssets(fetchFn: typeof fetch = fetch): Promise<OfficeAssets | null> {
  const res = await fetchFn("/office/manifest.json");
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
  const manifest = (await res.json()) as OfficeManifest;
  const layoutRes = await fetchFn(manifest.layout);
  if (!layoutRes.ok) throw new Error(`layout ${layoutRes.status}`);
  return { manifest, layout: (await layoutRes.json()) as OfficeLayout };
}
