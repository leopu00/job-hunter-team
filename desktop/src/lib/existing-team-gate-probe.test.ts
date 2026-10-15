// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { loadOnboardingGate } from "./onboarding";

// The team the authenticated modal sends to the VPS probe is the one the gate
// offers. The probe (the script of existing_team_runtime.rs, run here as it is,
// on a synthetic /jht_home) accepts it only when it is the `user_id` of the
// box's cloud.json: the token row's own `id` is a different uuid and exits 72.
// Synthetic ids only.
const USER = { id: "00000000-0000-4000-8000-0000000000aa", email: "person@example.invalid" } as unknown as User;
const TOKEN_ROW_ID = "00000000-0000-4000-8000-0000000000bb";
const PROBE_MISMATCH_EXIT = 72;

const sandboxes: string[] = [];
afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function probeScript(home: string): string {
  const source = readFileSync(fileURLToPath(new URL("../../src-tauri/src/existing_team_runtime.rs", import.meta.url)), "utf8");
  const start = source.indexOf("node -e '", source.indexOf("pub(crate) fn team_probe_command"));
  const end = source.indexOf("' \"$JHT_EXPECTED_TEAM\"", start);
  if (start < 0 || end < 0) throw new Error("team probe script not found");
  return source.slice(start + "node -e '".length, end).replaceAll("/jht_home", home);
}

function runProbe(cloudUserId: string, expectedTeam: string): number | null {
  const home = mkdtempSync(join(tmpdir(), "jht-team-probe-"));
  sandboxes.push(home);
  mkdirSync(join(home, "profile"));
  writeFileSync(join(home, "cloud.json"), JSON.stringify({ user_id: cloudUserId }));
  return spawnSync(process.execPath, ["-e", probeScript(home), expectedTeam], { encoding: "utf8" }).status;
}

function gateClient(tokenRow: Record<string, unknown>) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "order", "limit"]) chain[op] = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve({
          data: table === "cloud_sync_tokens" ? tokenRow
            : table === "user_onboarding_state" ? { vps_setup_completed_at: "2026-01-01T00:00:00Z" }
            : null,
          error: null,
        });
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe("the team the authenticated gate offers, against the VPS team probe", () => {
  it("is the one the box's cloud.json carries: the probe accepts it", async () => {
    // The token row has its own id and the account's user_id, as the table does.
    const gate = await loadOnboardingGate(gateClient({ id: TOKEN_ROW_ID, user_id: USER.id }), USER, {
      getItem: () => null,
      setItem: () => {},
    });
    if (gate.phase !== "required" || !gate.existingTeam) throw new Error("the gate offered no existing team");
    expect(runProbe(USER.id, gate.existingTeam.teamId)).toBe(0);
  });

  it("the token row's own id is not that team: the probe exits 72", () => {
    expect(runProbe(USER.id, TOKEN_ROW_ID)).toBe(PROBE_MISMATCH_EXIT);
  });
});
