/**
 * The person's documents and the team's deliverables are two folders, and
 * siblings (SICUREZZA, 21/09).
 *
 * The history is a read-only root, and that rule wins over every own root,
 * whatever the permission mode. Nested — the mount that ashley ran for a day,
 * `/jht_user` holding `/jht_user/out` — every CV the SCRITTORE writes is
 * refused: safely, but the reason says "the person's profile", the live turn
 * is spent, and nothing is produced. Both halves were right on their own, and
 * no test saw it because they all put the two folders side by side.
 *
 * So: the policy's behaviour is pinned here in both layouts, and a
 * configuration that contradicts itself stops at startup instead of at the
 * first write.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.ts";
import { isHarnessError } from "../src/core/errors.ts";
import { PermissionPolicy } from "../src/core/permissions.ts";
import { realPath } from "../src/tools/paths.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-user-folders-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const env = (extra: Record<string, string>) => ({ JHT_API_HOME: join(root, "api"), ...extra });

describe("the deliverables and the person's documents", () => {
  it("refuses at startup a deliverables folder inside the history", () => {
    const history = join(root, "jht_user");
    for (const userDir of [join(history, "out"), history, join(history, "out", "deeper")]) {
      let error: unknown;
      try {
        loadConfig(env({ JHT_API_USER_HISTORY_DIR: history, JHT_API_USER_DIR: userDir }), "scrittore-1");
      } catch (caught) {
        error = caught;
      }
      expect(isHarnessError(error) && error.code, userDir).toBe("config_invalid");
      expect(String((error as Error).message), userDir).toMatch(/is inside JHT_API_USER_HISTORY_DIR/);
      expect(String((error as Error).message), userDir).toMatch(/mount the two as siblings/);
    }
  });

  it("follows a link into the history, where the policy would (P2-b)", () => {
    const history = join(root, "jht_user");
    mkdirSync(join(history, "out"), { recursive: true });
    // A deliverables folder that is a link into the history IS the history: said here,
    // where the reason fits, instead of at the first write the policy refuses.
    symlinkSync(join(history, "out"), join(root, "jht_out"));
    let error: unknown;
    try {
      loadConfig(env({ JHT_API_USER_HISTORY_DIR: history, JHT_API_USER_DIR: join(root, "jht_out") }), "scrittore-1");
    } catch (caught) {
      error = caught;
    }
    expect(isHarnessError(error) && error.code).toBe("config_invalid");
    expect(String((error as Error).message)).toMatch(/is inside JHT_API_USER_HISTORY_DIR/);
    // And a link that stays outside is a sibling, as it looks.
    mkdirSync(join(root, "real_out"), { recursive: true });
    symlinkSync(join(root, "real_out"), join(root, "linked_out"));
    expect(
      loadConfig(env({ JHT_API_USER_HISTORY_DIR: history, JHT_API_USER_DIR: join(root, "linked_out") }), "scrittore-1").userDir,
    ).toBe(join(root, "linked_out"));
  });

  it("takes them as siblings, in either order on disk", () => {
    const history = join(root, "jht_user");
    for (const userDir of [join(root, "jht_out"), join(root, "deliverables", "out")]) {
      const config = loadConfig(env({ JHT_API_USER_HISTORY_DIR: history, JHT_API_USER_DIR: userDir }), "scrittore-1");
      expect([config.userDir, config.userHistoryDir]).toEqual([userDir, history]);
    }
    // No history at all: the box simply has none.
    expect(loadConfig(env({ JHT_API_USER_DIR: join(root, "out") }), "scrittore-1").userHistoryDir).toBeUndefined();
  });

  it("shows what nesting would have done to the policy, which is why it is refused", async () => {
    // The two layouts, judged by the policy itself, on the paths a write would carry.
    const nested = { history: join(root, "jht_user"), out: join(root, "jht_user", "out") };
    const siblings = { history: join(root, "jht_user"), out: join(root, "jht_out") };
    // `classify` hands the policy the file a call would really touch, symlinks resolved.
    const decide = async (layout: { history: string; out: string }, raw: string) => {
      const path = realPath(raw);
      return new PermissionPolicy({
        mode: "auto",
        readOnlyRoots: [layout.history],
        freeReadRoots: [layout.history],
        ownRoots: [join(root, "home"), layout.out],
        stateRoots: [join(root, "api")],
      }).decide("write_file", { risk: "write", paths: [path], summary: path });
    };

    expect((await decide(nested, join(nested.out, "cv", "CV_1.md"))).allowed).toBe(false);
    expect((await decide(siblings, join(siblings.out, "cv", "CV_1.md"))).allowed).toBe(true);
    // The history itself is refused in both, which is the point of it.
    expect((await decide(siblings, join(siblings.history, "CV_2024.md"))).allowed).toBe(false);
  });
});
