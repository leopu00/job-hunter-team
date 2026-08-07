import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "../../../cli/node_modules/commander/esm.mjs";

type CloudModule = typeof import("../../../cli/src/commands/cloud.js");

let home: string;
let originalJhtHome: string | undefined;

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

async function reachFirstPoll() {
  // device-init e il parsing JSON completano su microtask; il primo timer
  // nasce solo dopo. Tenere il tempo finto evita un secondo reale per test.
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(1_000);
}

beforeEach(() => {
  originalJhtHome = process.env.JHT_HOME;
  home = mkdtempSync(join(tmpdir(), "jht-cloud-login-ui-"));
  process.env.JHT_HOME = home;
  process.exitCode = undefined;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  rmSync(home, { recursive: true, force: true });
  if (originalJhtHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = originalJhtHome;
  process.exitCode = undefined;
});

describe("jht cloud login --ui-json", () => {
  it("espone il protocollo nativo nell'help", async () => {
    const { registerCloudCommand } = await loadCloud();
    const program = new Command();
    registerCloudCommand(program);

    const cloud = program.commands.find((command) => command.name() === "cloud");
    const login = cloud?.commands.find((command) => command.name() === "login");

    expect(login?.helpInformation()).toContain("--ui-json");
  });

  it("emette URL completo e completamento senza segreti o istruzioni da terminale", async () => {
    const completeUrl = "https://cloud.example.test/cli-link?code=ABCD-1234";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          device_code: "0123456789abcdef0123456789abcdef",
          user_code: "ABCD-1234",
          verification_url: "https://cloud.example.test/cli-link",
          verification_url_complete: completeUrl,
          expires_in: 600,
          interval: 1,
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          status: "approved",
          token: "jht_sync_synthetic-test-token",
          user_id: "00000000-0000-4000-8000-000000000000",
          token_name: "desktop-test",
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          state: {
            active_device_id: "private-device-id",
            active_device_claimed_at: new Date(Date.now()).toISOString(),
            last_heartbeat_at: new Date(Date.now()).toISOString(),
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const { CLOUD_LOGIN_UI_PREFIX, handleLogin } = await loadCloud();

    const pending = handleLogin({
      uiJson: true,
      noPush: true,
      url: "https://cloud.example.test",
    });
    await reachFirstPoll();
    await pending;

    const raw = outputOf(stdout);
    const events = raw
      .split("\n")
      .filter((line) => line.startsWith(CLOUD_LOGIN_UI_PREFIX))
      .map((line) => JSON.parse(line.slice(CLOUD_LOGIN_UI_PREFIX.length)));
    expect(events).toEqual([
      { event: "ready", url: completeUrl, expires_in: 600 },
      { event: "paired", token_name: "desktop-test" },
    ]);
    for (const event of events) {
      expect(event).not.toHaveProperty("device_code");
      expect(event).not.toHaveProperty("user_code");
      expect(event).not.toHaveProperty("token");
      expect(event).not.toHaveProperty("user_id");
    }
    expect(raw).not.toContain("Codice da digitare");
    expect(raw).not.toContain("User ID");
    expect(raw).not.toContain("jht_sync_synthetic-test-token");
    expect(raw).not.toContain("private-device-id");
    expect(JSON.parse(readFileSync(join(home, "cloud.json"), "utf8"))).toMatchObject({
      enabled: true,
      token_name: "desktop-test",
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("distingue un link gia usato e chiede alla UI di rigenerarlo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          device_code: "0123456789abcdef0123456789abcdef",
          user_code: "WXYZ-9876",
          verification_url: "https://cloud.example.test/cli-link",
          verification_url_complete:
            "https://cloud.example.test/cli-link?code=WXYZ-9876",
          expires_in: 600,
          interval: 1,
        }),
      )
      .mockResolvedValueOnce(response(410, { status: "consumed" }));
    vi.stubGlobal("fetch", fetchMock);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const { CLOUD_LOGIN_UI_PREFIX, handleLogin } = await loadCloud();

    const pending = handleLogin({
      uiJson: true,
      noPush: true,
      url: "https://cloud.example.test",
    });
    await reachFirstPoll();
    await pending;

    const events = outputOf(stdout)
      .split("\n")
      .filter((line) => line.startsWith(CLOUD_LOGIN_UI_PREFIX))
      .map((line) => JSON.parse(line.slice(CLOUD_LOGIN_UI_PREFIX.length)));
    expect(events.at(-1)).toEqual({ event: "already_used" });
    expect(process.exitCode).toBe(1);
  });
});
