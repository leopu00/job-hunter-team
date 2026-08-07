import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "../../..");
const JHT_BIN = path.join(REPO, "cli", "bin", "jht.js");

function runDoctor(provider: Record<string, unknown>, env: Record<string, string> = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "jht-doctor-provider-"));
  writeFileSync(
    path.join(home, "jht.config.json"),
    JSON.stringify({ version: 4, active_provider: "openai", providers: { openai: provider } }),
    "utf-8",
  );
  const r = spawnSync(process.execPath, [JHT_BIN, "doctor"], {
    encoding: "utf-8",
    env: { ...process.env, JHT_HOME: home, NO_COLOR: "1", ...env },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("jht doctor — autenticazione provider", () => {
  it("riconosce una subscription OAuth senza richiedere una API key", () => {
    const r = runDoctor({ auth_method: "subscription", model: "gpt-5.6-sol" }, {
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    });

    expect(r.code).toBe(0);
    expect(r.out).toContain("Provider: openai (gpt-5.6-sol) — subscription");
    expect(r.out).not.toContain("Provider openai has no API key");
  }, 15_000);

  it("continua a segnalare una API key mancante per auth_method api_key", () => {
    const r = runDoctor({ auth_method: "api_key" }, {
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "key-di-un-altro-provider",
    });

    expect(r.code).toBe(0);
    expect(r.out).toContain("Provider openai has no API key");
    expect(r.out).toContain("OPENAI_API_KEY");
  }, 15_000);
});
