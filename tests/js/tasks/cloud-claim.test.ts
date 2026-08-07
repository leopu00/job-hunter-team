import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "../../../cli/node_modules/commander/esm.mjs";

const CURSOR_FILES = [
  ".cloud-sync-cursor.json",
  ".cloud-pull-cursor.json",
  ".cloud-tickets-cursor.json",
  ".cloud-directives-cursor.json",
];

type CloudModule = typeof import("../../../cli/src/commands/cloud.js");

let home: string;
let originalJhtHome: string | undefined;
let originalDeviceLabel: string | undefined;

function writeCloudConfig(overrides: Record<string, unknown> = {}) {
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "cloud.json"),
    JSON.stringify({
      enabled: true,
      base_url: "https://cloud.example.test/",
      token: "jht_sync_new-device-token",
      token_name: "laptop-nuovo",
      ...overrides,
    }),
  );
}

async function loadCloud(): Promise<CloudModule> {
  vi.resetModules();
  return import("../../../cli/src/commands/cloud.js");
}

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function outputOf(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
}

beforeEach(() => {
  originalJhtHome = process.env.JHT_HOME;
  originalDeviceLabel = process.env.JHT_DEVICE_LABEL;
  home = mkdtempSync(join(tmpdir(), "jht-cloud-claim-"));
  process.env.JHT_HOME = home;
  delete process.env.JHT_DEVICE_LABEL;
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  rmSync(home, { recursive: true, force: true });
  if (originalJhtHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = originalJhtHome;
  if (originalDeviceLabel === undefined) delete process.env.JHT_DEVICE_LABEL;
  else process.env.JHT_DEVICE_LABEL = originalDeviceLabel;
  process.exitCode = undefined;
});

describe("jht cloud claim", () => {
  it("espone --force nell'help del sottocomando", async () => {
    const { registerCloudCommand } = await loadCloud();
    const program = new Command();
    registerCloudCommand(program);

    const cloud = program.commands.find(
      (command) => command.name() === "cloud",
    );
    const claim = cloud?.commands.find((command) => command.name() === "claim");

    expect(claim).toBeDefined();
    expect(claim?.description()).toContain("claim del team");
    expect(claim?.helpInformation()).toContain("--force");
    expect(claim?.helpInformation()).toContain("invalida i cursor");
  });

  it("senza --force lascia intatto un claim fresco e spiega il takeover", async () => {
    writeCloudConfig();
    const fetchMock = vi.fn().mockResolvedValue(
      response(409, {
        error: "device_already_claimed",
        current_device_id: "device-vecchio",
        claimed_at: "2026-08-03T10:00:00.000Z",
        heartbeat_age_seconds: 17,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handleClaim } = await loadCloud();

    await handleClaim({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cloud.example.test/api/team-state/claim");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer jht_sync_new-device-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      force: false,
      device_label: "laptop-nuovo",
    });
    expect(process.exitCode).toBe(2);
    expect(outputOf(stderr)).toContain("device-vecchio");
    expect(outputOf(stderr)).toContain("jht cloud claim --force");
  });

  it("--force risolve il conflitto, mostra l'eviction e invalida i cursor", async () => {
    writeCloudConfig();
    for (const file of CURSOR_FILES) {
      writeFileSync(join(home, file), JSON.stringify({ since: "vecchio" }));
    }
    const fetchMock = vi.fn().mockResolvedValue(
      response(200, {
        claimed_device_id: "device-nuovo",
        evicted_device_id: "device-vecchio",
        state: { active_device_id: "device-nuovo" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const { handleClaim } = await loadCloud();

    await handleClaim({ force: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ force: true });
    expect(CURSOR_FILES.every((file) => !existsSync(join(home, file)))).toBe(
      true,
    );
    expect(process.exitCode).toBeUndefined();
    expect(outputOf(stdout)).toContain("device-nuovo");
    expect(outputOf(stdout)).toContain(
      "Device precedente evicted: device-vecchio",
    );
    expect(outputOf(stdout)).toContain("Cursor locali invalidati: 4");
    expect(outputOf(stdout)).toContain(
      "prossimo sync ripartira' senza cursor precedenti",
    );
  });
});
