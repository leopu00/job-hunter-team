import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ModelProfileSchema,
  ScoutWorkerInputSchema,
  SyntheticJobSource,
  type ModelProfile,
  type ScoutWorkerInput,
} from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve(packageRoot, "fixtures", name), "utf8"),
  );
}

export async function fixtureInput(): Promise<ScoutWorkerInput> {
  return ScoutWorkerInputSchema.parse(
    await loadFixture("scout-input.synthetic.json"),
  );
}

export async function fixtureProfile(): Promise<ModelProfile> {
  return ModelProfileSchema.parse(await loadFixture("mock-profile.json"));
}

export async function fixtureSource(): Promise<SyntheticJobSource> {
  return new SyntheticJobSource(await loadFixture("jobs.synthetic.json"));
}

export function cloneInput(
  input: ScoutWorkerInput,
  patch: Omit<Partial<ScoutWorkerInput>, "limits" | "search"> & {
    limits?: Partial<ScoutWorkerInput["limits"]>;
    search?: Partial<ScoutWorkerInput["search"]>;
  },
): ScoutWorkerInput {
  return ScoutWorkerInputSchema.parse({
    ...structuredClone(input),
    ...patch,
    limits: { ...input.limits, ...patch.limits },
    search: { ...input.search, ...patch.search },
  });
}
