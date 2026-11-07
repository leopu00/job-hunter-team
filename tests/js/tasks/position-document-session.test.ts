// @vitest-environment node
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCandidateFilesFixture } from "../../../desktop/src/test-support/candidate-files-client";
import { resolveCoverLetterPdfFileName as web } from "../../../web/lib/position-document-file.server";
import { resolveCoverLetterPdfFileName as desktop } from "../../../desktop/src/web-shims/server/position-document-file";

const factories = vi.hoisted(() => ({
  web: vi.fn(),
  desktop: vi.fn(),
  dirs: [] as string[],
}));
vi.mock("../../../web/lib/supabase/server", () => ({
  createClient: factories.web,
}));
vi.mock("../../../desktop/src/web-shims/server/supabase-server", () => ({
  createClient: factories.desktop,
}));
vi.mock("../../../web/lib/jht-paths", () => ({
  get JHT_USER_CV_DIR() {
    return factories.dirs[0];
  },
  get JHT_USER_UPLOADS_DIR() {
    return factories.dirs[1];
  },
  get JHT_USER_OUTPUT_DIR() {
    return factories.dirs[2];
  },
}));

const adapters = [
  { name: "web", resolve: web },
  { name: "desktop", resolve: desktop },
] as const;
const request = { explicitPath: null, legacyId: 42, cloudMode: true };
let fixture: ReturnType<typeof createCandidateFilesFixture>;
let home: string;

beforeEach(() => {
  fixture = createCandidateFilesFixture();
  home = fs.mkdtempSync(join(tmpdir(), "synthetic-file-index-"));
  factories.dirs = ["cv", "uploads", "output"].map((name) => join(home, name));
  for (const dir of factories.dirs) fs.mkdirSync(dir);
  for (const name of ["web", "desktop"] as const) {
    factories[name].mockReset().mockImplementation(async () => {
      fixture.events.push([`${name}.createClient`]);
      return fixture.client;
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe.each(adapters)("$name cloud file session", ({ name, resolve }) => {
  it("authenticates before one user-filtered query and ignores a newer foreign file", async () => {
    await expect(resolve(request)).resolves.toBe("CoverLetter_42_own.pdf");
    expect(fixture.events).toEqual([
      [`${name}.createClient`],
      ["getUser"],
      ["from", "candidate_files"],
      ["select", "name, size, updated_at"],
      ["eq", "user_id", "synthetic-user-a"],
    ]);
    expect(factories[name]).toHaveBeenCalledTimes(1);
    expect(
      factories[name === "web" ? "desktop" : "web"],
    ).not.toHaveBeenCalled();
  });

  it("does not query any file table without a user", async () => {
    fixture.user = null;
    await expect(resolve(request)).resolves.toBeNull();
    expect(fixture.events).toEqual([[`${name}.createClient`], ["getUser"]]);
  });

  it("does not claim a file for a different position", async () => {
    fixture.rows![1].name = "CoverLetter_142_own.pdf";
    await expect(resolve(request)).resolves.toBeNull();
  });

  it("keeps the newest matching own PDF while rejecting empty and non-PDF entries", async () => {
    fixture.rows!.push(
      {
        ...fixture.rows![1],
        name: "CoverLetter_42_new.pdf",
        updated_at: "2026-03-01T00:00:00Z",
      },
      {
        ...fixture.rows![1],
        name: "CoverLetter_42_empty.pdf",
        size: 0,
        updated_at: "2026-04-01T00:00:00Z",
      },
      {
        ...fixture.rows![1],
        name: "CoverLetter_42_new.md",
        updated_at: "2026-05-01T00:00:00Z",
      },
    );
    await expect(resolve(request)).resolves.toBe("CoverLetter_42_new.pdf");
  });
});

describe.each(adapters)(
  "$name preexisting cloud failure behavior",
  ({ resolve }) => {
    it.each(["returned error", "null data"])(
      "keeps %s as an empty inventory",
      async (failure) => {
        if (failure === "returned error")
          fixture.error = { code: "synthetic-read-failure" };
        else fixture.rows = null;
        await expect(resolve(request)).resolves.toBeNull();
      },
    );

    it.each(["authFailure", "queryFailure"] as const)(
      "propagates a rejected %s unchanged",
      async (phase) => {
        const failure = new Error("synthetic rejected read");
        fixture[phase] = failure;
        await expect(resolve(request)).rejects.toBe(failure);
      },
    );
  },
);

describe.each(adapters)("$name document shortcuts", ({ resolve }) => {
  it.each(["/synthetic/explicit.pdf", "C:\\Synthetic\\explicit.pdf"])(
    "keeps explicitPath %s ahead of the index",
    async (explicitPath) => {
      await expect(resolve({ ...request, explicitPath })).resolves.toBe(
        "explicit.pdf",
      );
      expect(fixture.events).toEqual([]);
    },
  );

  it("does not create a client when the position id is absent", async () => {
    await expect(resolve({ ...request, legacyId: null })).resolves.toBeNull();
    expect(fixture.events).toEqual([]);
  });

  it("keeps an explicit file even when the position id is absent", async () => {
    await expect(
      resolve({
        ...request,
        explicitPath: "/synthetic/explicit.pdf",
        legacyId: null,
      }),
    ).resolves.toBe("explicit.pdf");
    expect(fixture.events).toEqual([]);
  });
});

describe("the distinct local adapters", () => {
  it("web scans only the three existing folders in order without a cloud client", async () => {
    fs.writeFileSync(
      join(factories.dirs[1], "CoverLetter_42_local.pdf"),
      "synthetic PDF",
    );
    const reads = vi.spyOn(fs, "readdirSync");
    await expect(web({ ...request, cloudMode: false })).resolves.toBe(
      "CoverLetter_42_local.pdf",
    );
    expect(reads.mock.calls.map(([dir]) => dir)).toEqual(factories.dirs);
    expect(fixture.events).toEqual([]);
  });

  it("desktop keeps its local empty answer without reading folders or cloud", async () => {
    fs.writeFileSync(
      join(factories.dirs[1], "CoverLetter_42_local.pdf"),
      "synthetic PDF",
    );
    const reads = vi.spyOn(fs, "readdirSync");
    await expect(desktop({ ...request, cloudMode: false })).resolves.toBeNull();
    expect(reads).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([]);
  });
});
