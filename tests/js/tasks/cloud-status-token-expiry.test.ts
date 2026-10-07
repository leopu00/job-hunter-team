/**
 * `jht cloud status` mostra la scadenza del token del box.
 *
 * Il box non conserva la scadenza: la chiede a /api/cloud-sync/ping, che la
 * restituisce a chi presenta quel token. Qui gira il comando vero, con
 * fetch finto: si guarda cosa stampa nei casi nessuna scadenza, data con
 * giorni rimasti (sopra e sotto la soglia), scaduto, e server muto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "../../../cli/node_modules/commander/esm.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const DAY = 86_400_000;
const TOKEN = "jht_sync_synthetic-status-token";

let home: string;
let originalJhtHome: string | undefined;

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function runStatus(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  vi.resetModules();
  const { registerCloudCommand } = await import("../../../cli/src/commands/cloud.js");
  const program = new Command();
  program.exitOverride();
  registerCloudCommand(program);
  await program.parseAsync(["node", "jht", "cloud", "status"]);
  // picocolors scrive codici ANSI solo su un terminale: qui il testo è nudo,
  // ma li togliamo comunque per non dipendere dall'ambiente.
  // eslint-disable-next-line no-control-regex
  const plain = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  return plain.find((line) => line.startsWith("Token expiry:")) ?? "";
}

function pingOk(expiresAt: string | null) {
  return vi.fn().mockResolvedValue(
    response(200, {
      ok: true,
      user_id: "synthetic-user",
      token: { id: "synthetic-token-id", name: "box", expires_at: expiresAt },
    }),
  );
}

beforeEach(() => {
  originalJhtHome = process.env.JHT_HOME;
  home = mkdtempSync(join(tmpdir(), "jht-cloud-status-"));
  process.env.JHT_HOME = home;
  writeFileSync(
    join(home, "cloud.json"),
    JSON.stringify({
      enabled: true,
      base_url: "https://cloud.example.test/",
      token: TOKEN,
      token_name: "box",
      user_id: "synthetic-user",
      enabled_at: "2026-07-09T10:00:00.000Z",
    }),
  );
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  process.exitCode = undefined;
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

describe("jht cloud status: scadenza del token", () => {
  it("chiede la scadenza a ping con il token del box", async () => {
    const fetchMock = pingOk(null);

    await runStatus(fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cloud.example.test/api/cloud-sync/ping");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it("nessuna scadenza", async () => {
    expect(await runStatus(pingOk(null))).toBe("Token expiry: no expiry");
  });

  it("data e giorni rimasti, sopra la soglia", async () => {
    expect(await runStatus(pingOk("2026-10-25T00:00:00+00:00"))).toBe(
      "Token expiry: 2026-10-25 (18 days left)",
    );
  });

  it("sotto la soglia avvisa e dice cosa fare", async () => {
    const line = await runStatus(pingOk(new Date(NOW + 5 * DAY).toISOString()));
    expect(line).toContain("2026-10-12 (5 days left)");
    expect(line).toContain("jht cloud enable --token");
  });

  it("scaduto: il cloud rifiuta il token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(401, { error: "token scaduto" }));

    const line = await runStatus(fetchMock);

    expect(line).toMatch(/^Token expiry: expired/);
    expect(line).toContain("jht cloud enable --token");
    expect(process.exitCode).toBeUndefined();
  });

  it("scaduto anche se ping risponde ancora con una data passata", async () => {
    expect(await runStatus(pingOk("2026-10-01T00:00:00.000Z"))).toMatch(
      /^Token expiry: 2026-10-01, expired/,
    );
  });

  it("server che non riporta la scadenza o non raggiungibile: sconosciuta, mai «no expiry»", async () => {
    const legacy = vi.fn().mockResolvedValue(
      response(200, { ok: true, user_id: "u", token: { id: "t", name: "box" } }),
    );
    expect(await runStatus(legacy)).toBe(
      "Token expiry: unknown (the cloud does not report it)",
    );

    const offline = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect(await runStatus(offline)).toBe("Token expiry: unknown (cloud unreachable)");
  });
});
