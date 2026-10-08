import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { credentialFiles } from "../../../cli/src/commands/health.js";
import { secretFiles } from "../../../cli/src/commands/secrets.js";

// [AUDIT-G1-r1] After the mailbox migration the broker's guard leaves an
// empty directory where credentials/email_monitor.json was: health and
// `jht secrets list` must not count it as a credential.
function credentialsWithPlaceholder(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "jht-creds-")), "credentials");
  mkdirSync(dir);
  mkdirSync(join(dir, "email_monitor.json"));
  mkdirSync(join(dir, "email_monitor.json.tmp"));
  writeFileSync(join(dir, "github.enc"), "x");
  writeFileSync(join(dir, "linkedin.json"), "{}");
  return dir;
}

describe("credential listings skip the broker's placeholder", () => {
  it("health counts only credential files", async () => {
    expect((await credentialFiles(credentialsWithPlaceholder())).sort()).toEqual(["github.enc", "linkedin.json"]);
  });

  it("secrets list shows only secret files", async () => {
    expect((await secretFiles(credentialsWithPlaceholder())).sort()).toEqual(["github.enc", "linkedin.json"]);
  });

  it("a missing folder is no credential, not an error, for health", async () => {
    expect(await credentialFiles(join(tmpdir(), "jht-no-such-dir-" + Date.now()))).toEqual([]);
  });
});
