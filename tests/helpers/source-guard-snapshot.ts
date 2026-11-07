import { createRequire } from "node:module";

export type MultisetSnapshot = {
  version: 1;
  guard: string;
  total: number;
  elements: ReadonlyArray<{ name: string; count: number }>;
};

type SnapshotApi = {
  assertMultisetSnapshot(actual: Iterable<string> & object, expected: unknown): void;
};

const api = createRequire(import.meta.url)("./source-guard-snapshot.cjs") as SnapshotApi;

export const assertMultisetSnapshot = api.assertMultisetSnapshot;
