/**
 * The JHT home's portal secrets — LinkedIn and ATS passwords, the mailbox
 * login, the LinkedIn session — are credentials like `.ssh`: the file tools
 * do not read them and the bash sandbox shuts them (P1 portal secrets,
 * phase 0). This reduces, it does not close: the CLI agents run without this
 * sandbox and with the uid that owns the files.
 *
 * Canary values only; no real credential is read anywhere.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TurnAccount } from "../src/core/agent-loop.ts";
import { createBashTool } from "../src/tools/bash.ts";
import { isSensitivePath, portalSecretPaths } from "../src/tools/paths.ts";
import { bubblewrapArgs, createSandbox, seatbeltProfile, type Sandbox } from "../src/tools/sandbox.ts";

const CONTEXT = { account: new TurnAccount(Date.now), remainingMs: () => 60_000 };
const CANARY = "CANARY-portal-secret-7f3c";

describe("isSensitivePath — portal secrets", () => {
  it("covers every file of the class, wherever the JHT home is", () => {
    for (const p of [
      "/jht_home/credentials/linkedin.json",
      "/jht_home/credentials/ats-accounts/workday_acme.json",
      "/jht_home/credentials/email_monitor.json",
      "/jht_home/credentials/email_transport.json",
      "/jht_home/.cache/linkedin/storage-state.json",
      "/jht_home/.cache/linkedin/profile/Default/Cookies",
      "/home/me/.jht/credentials/linkedin.json",
      "/somewhere/storage-state.json",
    ]) {
      expect(isSensitivePath(p), p).toBe(true);
    }
  });

  it("leaves the rest of the JHT home readable", () => {
    for (const p of [
      "/jht_home/.cache/playwright/default/state.json",
      "/jht_home/.cache/apply-flow/42.json",
      "/jht_home/profile/candidate_profile.yml",
      "/jht_home/linkedin-notes.md",
    ]) {
      expect(isSensitivePath(p), p).toBe(false);
    }
  });
});

describe("portalSecretPaths", () => {
  it("is the credentials folder and the LinkedIn session under JHT_HOME, ~/.jht when unset", () => {
    expect(portalSecretPaths("/jht_home", "/home/me")).toEqual(["/jht_home/credentials", "/jht_home/.cache/linkedin"]);
    expect(portalSecretPaths(undefined, "/home/me")).toEqual(["/home/me/.jht/credentials", "/home/me/.jht/.cache/linkedin"]);
    expect(portalSecretPaths("~/elsewhere", "/home/me")).toEqual([
      "/home/me/elsewhere/credentials",
      "/home/me/elsewhere/.cache/linkedin",
    ]);
  });
});

describe("the sandbox rules", () => {
  it("Seatbelt shuts the folders and everything below them, not only their node", () => {
    const profile = seatbeltProfile({
      writableRoots: ["/work"],
      home: "/Users/me",
      protectedPaths: portalSecretPaths("/Users/me/.jht", "/Users/me"),
    });
    expect(profile).toContain('(subpath "/Users/me/.jht/credentials")');
    expect(profile).toContain('(subpath "/Users/me/.jht/.cache/linkedin")');
    expect(profile).toContain(String.raw`(regex #"/credentials/")`);
    expect(profile).toContain(String.raw`(regex #"/\.cache/linkedin(/|$)")`);
    expect(profile).toContain(String.raw`(regex #"/storage-state\.json$")`);
  });

  it("bubblewrap puts an empty tmpfs over each folder that exists", () => {
    const jht = "/jht_home";
    const line = bubblewrapArgs({
      writableRoots: [],
      home: "/jht_home",
      protectedPaths: portalSecretPaths(jht, "/jht_home"),
      workdir: "/jht_home/agents/scout",
      lookup: (path) => (path.startsWith("/jht_home/credentials") || path.startsWith("/jht_home/.cache/linkedin") ? { real: path, dir: true } : undefined),
      listDir: () => [],
    }).join(" ");
    expect(line).toContain("--tmpfs /jht_home/credentials");
    expect(line).toContain("--tmpfs /jht_home/.cache/linkedin");
  });
});

const probe = (() => {
  const box = createSandbox({ workdir: tmpdir() });
  box.dispose();
  return box;
})();

/**
 * The commands an injected agent would run. Each reads a secret, and each
 * would print the canary without a sandbox (the control below proves it).
 */
const READS = (home: string) => [
  `cat ${home}/credentials/linkedin.json`,
  `cat ${home}/credentials/email_monitor.json`,
  `cat ${home}/credentials/ats-accounts/workday_acme.json`,
  `cat ${home}/.cache/linkedin/storage-state.json`,
  `cat ${home}/.cache/linkedin/profile/Cookies`,
  `grep -r ${CANARY} ${home}`,
  `find ${home} -name '*.json' -exec cat {} +`,
  `python3 -c 'print(open("${home}/credentials/linkedin.json").read())'`,
];

/**
 * A JHT home with canaries, OUTSIDE /tmp: bubblewrap puts an empty tmpfs over
 * /tmp (where tmux keeps its socket), so a home there is invisible as a whole
 * and every "cannot read the secret" passes for the wrong reason — the bug
 * this file shipped with. /var/tmp is neither masked nor a protected path.
 */
async function canaryHome(): Promise<{ jhtHome: string; workdir: string }> {
  const jhtHome = await realpath(await mkdtemp(join("/var/tmp", "jht-portal-home-")));
  const workdir = join(jhtHome, "agents", "scout");
  await mkdir(workdir, { recursive: true });
  await mkdir(join(jhtHome, "credentials", "ats-accounts"), { recursive: true });
  await mkdir(join(jhtHome, ".cache", "linkedin", "profile"), { recursive: true });
  const canary = (field: string) => JSON.stringify({ email: "canary@example.invalid", [field]: CANARY });
  await writeFile(join(jhtHome, "credentials", "linkedin.json"), canary("password"), { mode: 0o600 });
  await writeFile(join(jhtHome, "credentials", "email_monitor.json"), canary("password"), { mode: 0o600 });
  await writeFile(join(jhtHome, "credentials", "ats-accounts", "workday_acme.json"), canary("password"), { mode: 0o600 });
  await writeFile(join(jhtHome, ".cache", "linkedin", "storage-state.json"), canary("li_at"), { mode: 0o600 });
  await writeFile(join(jhtHome, ".cache", "linkedin", "profile", "Cookies"), CANARY, { mode: 0o600 });
  await writeFile(join(jhtHome, "notes.txt"), "readable\n");
  return { jhtHome, workdir };
}

describe.runIf(probe.kind !== "none")(`portal secrets in ${probe.kind}`, () => {
  let workdir: string;
  let jhtHome: string;
  let sandbox: Sandbox;
  const run = (command: string) => createBashTool({ workdir, sandbox }).execute({ command }, CONTEXT);

  beforeAll(async () => {
    ({ jhtHome, workdir } = await canaryHome());
    sandbox = createSandbox({ workdir, protectedPaths: portalSecretPaths(jhtHome), homeDir: jhtHome });
  });

  afterAll(async () => {
    sandbox.dispose();
    await rm(jhtHome, { recursive: true, force: true });
  });

  it("the rest of the JHT home stays readable", async () => {
    expect(await run(`cat ${jhtHome}/notes.txt`)).toMatchObject({ ok: true, content: expect.stringContaining("readable") });
  });

  it("cat, ls, find, grep and python never reach a canary, while the home itself stays visible", async () => {
    // The same command first proves the home is there: a negative that passes
    // because nothing at all is visible is not a negative.
    for (const command of [...READS(jhtHome), `ls -la ${jhtHome}/credentials ${jhtHome}/credentials/ats-accounts ${jhtHome}/.cache/linkedin`]) {
      const result = await run(`cat ${jhtHome}/notes.txt; ${command}`);
      expect(result.content, command).toContain("readable");
      expect(result.content, command).not.toContain(CANARY);
    }
  });
});

describe("control: the same commands without a sandbox", () => {
  it("read every canary, so the negatives above can fail", async () => {
    const { jhtHome, workdir } = await canaryHome();
    const sandbox = createSandbox({ workdir, platform: "sunos" });
    try {
      expect(sandbox.kind).toBe("none");
      for (const command of READS(jhtHome)) {
        const result = await createBashTool({ workdir, sandbox }).execute({ command }, CONTEXT);
        expect(result.content, command).toContain(CANARY);
      }
    } finally {
      sandbox.dispose();
      await rm(jhtHome, { recursive: true, force: true });
    }
  });
});
