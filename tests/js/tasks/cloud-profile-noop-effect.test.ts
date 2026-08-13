import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dirs: string[] = [];
let previousHome: string | undefined;

function fixture() {
  previousHome = process.env.JHT_HOME;
  const home = mkdtempSync(join(tmpdir(), "jht-profile-noop-"));
  dirs.push(home);
  process.env.JHT_HOME = home;
  writeFileSync(
    join(home, "cloud.json"),
    JSON.stringify({
      enabled: true,
      base_url: "https://cloud.example.test",
      token: "jht_sync_synthetic-test-token",
    }),
  );
  const profileDir = join(home, "profile");
  mkdirSync(join(profileDir, "summaries"), { recursive: true });
  const profilePath = join(profileDir, "candidate_profile.yml");
  writeFileSync(
    profilePath,
    "name: Synthetic candidate\ntarget_role: Engineer\n",
  );
  writeFileSync(join(profileDir, "summaries", "about.md"), "Initial summary");
  return { home, profilePath, profileDir };
}

function profileAck(body: any) {
  return new Response(
    JSON.stringify({
      ok: true,
      receipts: { profile: [body.profile._receipt_id] },
      profile: { upserted: true, error: null },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  process.exitCode = undefined;
  if (previousHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = previousHome;
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("profile push cursor — effect", () => {
  it("fa zero richieste sul secondo push invariato e riparte su modifica reale", async () => {
    const { home, profileDir } = fixture();
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        return profileAck(body);
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({})).resolves.toMatchObject({ ok: true });
    await expect(handlePush({})).resolves.toMatchObject({
      ok: true,
      nothingToSync: true,
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].profile).not.toHaveProperty("source_hash");
    expect(
      JSON.parse(readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8")),
    ).toMatchObject({ profile_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });

    writeFileSync(join(profileDir, "summaries", "about.md"), "Changed summary");
    await expect(handlePush({})).resolves.toMatchObject({ ok: true });
    expect(bodies).toHaveLength(2);
  });

  it("non avanza il fingerprint su failure e ritenta lo stesso snapshot", async () => {
    const { home } = fixture();
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        attempts += 1;
        const body = JSON.parse(String(init?.body));
        if (attempts === 1)
          return new Response(JSON.stringify({ error: "synthetic_failure" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        return profileAck(body);
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({})).resolves.toMatchObject({ ok: false });
    expect(() =>
      readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"),
    ).toThrow();
    await expect(handlePush({})).resolves.toMatchObject({ ok: true });
    expect(attempts).toBe(2);
  });

  it("serializza due push sovrapposti e invia lo snapshot una volta sola", async () => {
    fixture();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        requests += 1;
        const body = JSON.parse(String(init?.body));
        await barrier;
        return profileAck(body);
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    const first = handlePush({});
    const second = handlePush({});
    await vi.waitFor(() => expect(requests).toBe(1));
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true, nothingToSync: true }),
    ]);
    expect(requests).toBe(1);
  });
});
