/**
 * The kernel's sandbox around `bash` (src/tools/sandbox.ts), ported from Home
 * Hunter Team. The profile and argument tests run everywhere; the escapes run
 * against the sandbox this machine really has — Seatbelt on macOS, bubblewrap
 * on Linux where it can start — and each one must fail.
 */

import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TurnAccount } from "../src/core/agent-loop.ts";
import { MockProvider } from "../src/core/provider/mock.ts";
import { createBashTool } from "../src/tools/bash.ts";
import { bubblewrapArgs, createSandbox, seatbeltProfile, type Sandbox } from "../src/tools/sandbox.ts";
import { buildToolkit } from "../src/tools/toolkit.ts";

const CONTEXT = { account: new TurnAccount(Date.now), remainingMs: () => 60_000 };

describe("seatbeltProfile", () => {
  const profile = seatbeltProfile({
    writableRoots: ["/work", "/private/tmp/jht-api-sandbox-x"],
    home: "/Users/me",
    protectedPaths: ["/etc/jht/mcp.json"],
  });

  it("denies every write, then allows the writable roots and the devices", () => {
    expect(profile).toMatch(/\(deny file-write\*\)\n\(allow file-write\*\n {2}\(subpath "\/work"\)\n {2}\(subpath "\/private\/tmp\/jht-api-sandbox-x"\)/);
    expect(profile).toContain('(literal "/dev/null")');
  });

  it("shuts the credential folders, files and names of paths.ts, and the run's own secrets", () => {
    expect(profile).toContain('(subpath "/Users/me/.ssh")');
    expect(profile).toContain('(subpath "/Users/me/.config/gcloud")');
    expect(profile).toContain('(subpath "/Users/me/.config/gh")');
    expect(profile).toContain('(literal "/Users/me/.codex/auth.json")');
    // `subpath`, not `literal`: a protected path can be a folder (the portal
    // secrets), and `subpath` on a file still matches that file alone.
    expect(profile).toContain('(subpath "/etc/jht/mcp.json")');
    expect(profile).toContain(String.raw`(regex #"/\.env(\.[^/]+)?$")`);
    expect(profile).toContain(String.raw`(regex #"/credentials(\.json)?$")`);
    expect(profile).toContain(String.raw`(regex #"-key\.txt$")`);
  });

  it("lets .env.example back in after the rule that shuts .env*, since later rules win", () => {
    const allow = profile.indexOf(String.raw`(allow file-read* (regex #"/\.env\.example$"))`);
    expect(allow).toBeGreaterThan(profile.indexOf("(deny file-read* file-write*"));
  });

  it("shuts key files under the home only, so the system's CA bundle stays readable", () => {
    expect(profile).toContain(String.raw`(regex #"^/Users/me/.*\.(pem|key|p12|pfx|keychain-db)$")`);
    expect(profile).not.toMatch(/regex #"\\\.\(pem/);
  });

  it("does not shut *token* names: Python's own token.py and tokenize.py would go with them", () => {
    expect(profile).not.toMatch(/token/i);
  });

  it("shuts unix sockets but the DNS resolver's, IPv4 loopback and IPv6, as separate rules", () => {
    const network = profile.split("\n").filter((line) => line.includes("network-outbound"));
    expect(network).toEqual([
      "(deny network-outbound (remote unix-socket))",
      '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))',
      '(deny network-outbound (remote ip4 "localhost:*"))',
      '(deny network-outbound (remote ip6 "*:*"))',
    ]);
    // `ip` next to `ip6` stops Seatbelt matching IPv4 loopback: never both.
    expect(profile).not.toContain("(remote ip ");
  });
});

/** A fake filesystem for `lookup`: folders, other files, and links resolved to where they point. */
function fakeFs(dirs: string[], files: string[], links: Record<string, string> = {}) {
  return (path: string) => {
    const real = Object.entries(links).reduce((p, [from, to]) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p), path);
    if (dirs.includes(real)) return { real, dir: true };
    if (files.includes(real)) return { real, dir: false };
    return undefined;
  };
}

describe("bubblewrapArgs", () => {
  const args = bubblewrapArgs({
    writableRoots: ["/work", "/tmp/jht-api-sandbox-x"],
    home: "/home/me",
    protectedPaths: ["/etc/jht/mcp.json"],
    workdir: "/work",
    lookup: fakeFs(["/home/me/.ssh", "/home/me/.config/gh"], ["/home/me/.netrc", "/work/.env", "/etc/jht/mcp.json"]),
    listDir: () => [".env", ".env.example", "notes.md"],
  });
  const joined = args.join(" ");

  it("binds the root read-only and the writable roots read-write, network shared", () => {
    expect(joined).toContain("--ro-bind / /");
    expect(joined).toContain("--bind /work /work");
    expect(joined).toContain("--bind /tmp/jht-api-sandbox-x /tmp/jht-api-sandbox-x");
    expect(joined).not.toContain("--unshare-net");
    expect(joined).not.toContain("--unshare-all");
  });

  it("masks the credential paths that exist, and only those", () => {
    expect(joined).toContain("--tmpfs /home/me/.ssh");
    expect(joined).toContain("--tmpfs /home/me/.config/gh");
    expect(joined).toContain("--ro-bind /dev/null /home/me/.netrc");
    expect(joined).toContain("--ro-bind /dev/null /work/.env");
    expect(joined).toContain("--ro-bind /dev/null /etc/jht/mcp.json");
    expect(joined).not.toContain(".aws");
    expect(joined).not.toContain(".env.example");
  });

  it("masks after binding, so a mask inside a writable root still holds", () => {
    expect(args.indexOf("/work")).toBeLessThan(args.lastIndexOf("/work/.env"));
  });

  it("hides the socket folders and the Docker socket, and binds a writable root under /tmp back on top", () => {
    const withSockets = bubblewrapArgs({
      writableRoots: ["/tmp/jht-api-sandbox-x"],
      home: "/home/me",
      protectedPaths: [],
      workdir: "/work",
      uid: 1000,
      lookup: fakeFs(["/tmp", "/run/user/1000"], ["/run/docker.sock"]),
      listDir: () => [],
    });
    const line = withSockets.join(" ");
    expect(line).toContain("--tmpfs /tmp");
    expect(line).toContain("--tmpfs /run/user/1000");
    expect(line).toContain("--ro-bind /dev/null /run/docker.sock");
    expect(withSockets.indexOf("--tmpfs")).toBeLessThan(withSockets.indexOf("--bind"));
  });

  // CI, 27/09, the first real bubblewrap: /var/run is a link to /run, bwrap does not
  // follow a link in a destination, tries to create the file on the read-only root,
  // and every command died: "Can't create file at /var/run/docker.sock".
  it("masks each path where it really is, once — never through a link, never where it is not", () => {
    const line = bubblewrapArgs({
      writableRoots: ["/work"],
      home: "/home/me",
      protectedPaths: ["/etc/jht/absent.json"],
      workdir: "/work",
      lookup: fakeFs(["/tmp"], ["/run/docker.sock"], { "/var/run": "/run" }),
      listDir: () => [],
    }).join(" ");
    expect(line).not.toContain("/var/run");
    expect(line.match(/--ro-bind \/dev\/null \/run\/docker\.sock/g)).toHaveLength(1);
    expect(line).not.toContain("absent.json");
    expect(line).not.toContain("/run/user");
  });

  it("does the same on the real disk: a secret behind a linked folder, a missing one, a folder given as a file", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "jht-api-bwargs-")));
    try {
      await mkdir(join(root, "real"));
      await writeFile(join(root, "real", "secret.json"), "{}");
      await mkdir(join(root, "real", "keys"));
      await symlink(join(root, "real"), join(root, "linked"));
      const line = bubblewrapArgs({
        writableRoots: [],
        home: join(root, "home"),
        protectedPaths: [join(root, "linked", "secret.json"), join(root, "linked", "gone.json"), join(root, "linked", "keys")],
        workdir: join(root, "work"),
      }).join(" ");
      expect(line).toContain(`--ro-bind /dev/null ${join(root, "real", "secret.json")}`);
      expect(line).toContain(`--tmpfs ${join(root, "real", "keys")}`);
      expect(line).not.toContain(join(root, "linked"));
      expect(line).not.toContain("gone.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("createSandbox — gaps", () => {
  it("declares what bubblewrap cannot shut: loopback above all", () => {
    const sandbox = createSandbox({ workdir: tmpdir(), platform: "linux", available: () => true, start: () => undefined });
    try {
      expect(sandbox.kind).toBe("bubblewrap");
      expect(sandbox.gaps.join("\n")).toMatch(/loopback .* stays reachable/);
      expect(sandbox.gaps.join("\n")).toMatch(/local network/);
    } finally {
      sandbox.dispose();
    }
  });

  it("declares the local network as Seatbelt's gap, and nothing it shuts", () => {
    const sandbox = createSandbox({ workdir: tmpdir(), platform: "darwin", available: () => true });
    try {
      expect(sandbox.gaps).toHaveLength(1);
      expect(sandbox.gaps[0]).toMatch(/local network/);
    } finally {
      sandbox.dispose();
    }
  });
});

describe("createSandbox — fallback", () => {
  it("runs without a sandbox on an OS it has none for, and says why", () => {
    const sandbox = createSandbox({ workdir: "/w", platform: "win32" });
    expect(sandbox.kind).toBe("none");
    expect(sandbox.missing).toContain("win32");
    expect(sandbox.wrap(["/bin/bash", "-c", "true"])).toEqual(["/bin/bash", "-c", "true"]);
  });

  it("runs without a sandbox, and says bwrap's own words, when bwrap refuses the one it was given", () => {
    const tried: string[][] = [];
    const sandbox = createSandbox({
      workdir: tmpdir(),
      platform: "linux",
      available: () => true,
      start: (argv) => (tried.push(argv), "bwrap: Can't create file at /var/run/docker.sock: No such file or directory"),
    });
    // The probe runs the sandbox as built, masks and all, not an empty one.
    expect(tried[0]![0]).toBe("bwrap");
    expect(tried[0]!.slice(-2)).toEqual(["--", "/bin/true"]);
    expect(tried[0]).toContain("--bind");
    expect(sandbox).toMatchObject({ kind: "none", missing: expect.stringContaining("Can't create file at /var/run/docker.sock") });
  });

  it("says why when the sandbox program cannot start", () => {
    const sandbox = createSandbox({ workdir: "/w", platform: "linux", available: () => false });
    expect(sandbox).toMatchObject({ kind: "none", missing: expect.stringContaining("bwrap") });
  });

  it("puts the fallback in every bash result's details", async () => {
    const workdir = await realpath(await mkdtemp(join(tmpdir(), "jht-api-nobox-")));
    try {
      const bash = createBashTool({ workdir, sandbox: createSandbox({ workdir, platform: "win32" }) });
      const result = await bash.execute({ command: "true" }, CONTEXT);
      expect(result.details).toMatchObject({ sandbox: "none", sandboxMissing: expect.stringContaining("win32") });
      expect(bash.spec.description).not.toContain("sandbox");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});

describe("the toolkit", () => {
  it("gives bash the sandbox, reports it, and removes its temporary folder on close", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "jht-api-kit-")));
    try {
      // As in run.ts: the role's home is prepared before its toolkit, and bubblewrap binds it.
      await mkdir(join(root, "agents", "scrittore-1"), { recursive: true });
      const toolkit = await buildToolkit(
        {
          role: "scrittore-1",
          workdir: join(root, "agents", "scrittore-1"),
          agentHome: join(root, "agents", "scrittore-1"),
          apiHome: root,
          permissionMode: "auto",
          profile: { capabilities: { webSearch: false } },
        } as Parameters<typeof buildToolkit>[0],
        { provider: new MockProvider([]) },
      );
      const kind = createProbe().kind;
      expect(toolkit.sandbox.kind).toBe(kind);
      const bash = toolkit.tools.find((tool) => tool.spec.name === "bash")!;
      const result = await bash.execute({ command: 'echo "$TMPDIR"' }, CONTEXT);
      expect(result.details).toMatchObject({ sandbox: kind });
      if (kind !== "none") {
        const tmp = /--- stdout ---\n(.+)/.exec(result.content)![1]!;
        expect(existsSync(tmp)).toBe(true);
        await toolkit.close();
        expect(existsSync(tmp)).toBe(false);
      } else {
        expect(toolkit.sandbox.missing).toBeTruthy();
        await toolkit.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

const VISIBLE = {
  home: "home-readable",
  outside: "outside-readable",
  workdir: "workdir-readable",
} as const;

/**
 * Every secret read is paired below with a normal file in the same area. The
 * positive read and the negative happen in one shell, so a hidden fixture
 * cannot make the negative pass vacuously.
 */
const SECRET_READS: Array<[keyof typeof VISIBLE, string]> = [
  ["home", "cat ~/.ssh/id_ed25519"],
  ["home", "cat ~/.ssh/config"],
  ["workdir", "cat .env"],
  ["outside", "cat $SECRET"],
];

/**
 * Keep the escape targets outside /tmp: bubblewrap covers /tmp with an empty
 * tmpfs and binds back only writable roots. A home or outside folder there is
 * otherwise invisible as a whole, making read and write negatives vacuous.
 * /var/tmp is neither masked nor writable in the sandbox.
 */
async function escapeFixture(): Promise<{ workdir: string; outside: string; home: string; secret: string }> {
  // The role's folder sits inside a parent it must not write to: `cd ..` has somewhere to go.
  const parent = await realpath(await mkdtemp(join("/var/tmp", "jht-api-parent-")));
  const workdir = join(parent, "agent");
  await mkdir(workdir);
  const outside = await realpath(await mkdtemp(join("/var/tmp", "jht-api-outside-")));
  const home = await realpath(await mkdtemp(join("/var/tmp", "jht-api-home-")));
  const secret = join(outside, "mcp.json");
  await mkdir(join(home, ".ssh"));
  await writeFile(join(home, ".ssh", "id_ed25519"), "PRIVATE hunter2\n");
  await writeFile(join(home, ".ssh", "config"), "Host hunter2\n");
  await writeFile(join(home, "notes.txt"), `${VISIBLE.home}\n`);
  await writeFile(join(parent, "notes.txt"), "parent-readable\n");
  await writeFile(join(workdir, ".env"), "API_KEY=hunter2\n");
  await writeFile(join(workdir, ".env.example"), `API_KEY=\n${VISIBLE.workdir}\n`);
  await writeFile(join(outside, "notes.txt"), `${VISIBLE.outside}\n`);
  await writeFile(secret, '{"token":"hunter2"}');
  return { workdir, outside, home, secret };
}

describe("the escapes, without a sandbox (the control)", () => {
  it("reads every secret, so the sandbox negatives can fail", async () => {
    const { workdir, outside, home, secret } = await escapeFixture();
    try {
      const bare = createBashTool({ workdir });
      for (const [, command] of SECRET_READS) {
        const result = await bare.execute({ command: command.replace("~", home).replace("$SECRET", secret) }, CONTEXT);
        expect(result.content, command).toContain("hunter2");
      }
    } finally {
      await rm(join(workdir, ".."), { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});

// The real boundary, on the machine that has one. Every escape below must fail;
// what the work needs — DNS, HTTPS, python and node inside the folder — must not.
const probe = createProbe();

describe.runIf(probe.kind !== "none")(`bash in ${probe.kind}`, () => {
  let workdir: string;
  let outside: string;
  let home: string;
  let secret: string;
  let sandbox: Sandbox;
  const run = (command: string) => createBashTool({ workdir, sandbox }).execute({ command }, CONTEXT);
  const has = (bin: string) => spawnSync("/bin/sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0;
  const read = (command: string) => command.replace("~", home).replace("$SECRET", secret);
  const see = (where: keyof typeof VISIBLE) =>
    where === "home" ? `cat ${home}/notes.txt` : where === "outside" ? `cat ${outside}/notes.txt` : "cat .env.example";

  beforeAll(async () => {
    ({ workdir, outside, home, secret } = await escapeFixture());
    sandbox = createSandbox({ workdir, protectedPaths: [secret], homeDir: home });
  });

  afterAll(async () => {
    sandbox.dispose();
    await rm(join(workdir, ".."), { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it("writes in the working folder and in $TMPDIR, and says it is sandboxed", async () => {
    const result = await run('echo hi > note.txt && echo tmp > "$TMPDIR/scratch" && cat "$TMPDIR/scratch"');
    expect(result).toMatchObject({ ok: true, details: { sandbox: probe.kind } });
    expect(await readFile(join(workdir, "note.txt"), "utf8")).toBe("hi\n");
  });

  it("cannot write anywhere else: an absolute path, or cd ..", async () => {
    for (const [visible, marker, command] of [
      [`cat ${outside}/notes.txt`, VISIBLE.outside, `echo x > ${outside}/escaped.txt`],
      ["cat ../notes.txt", "parent-readable", "cd .. && echo x > escaped.txt"],
    ] as const) {
      const result = await run(`${visible}; ${command}`);
      expect(result.content, command).toContain(marker);
      expect(result.ok, command).toBe(false);
      expect(result.content, command).toMatch(/Operation not permitted|Read-only file system/);
    }
    expect(existsSync(join(outside, "escaped.txt"))).toBe(false);
    expect(existsSync(join(workdir, "..", "escaped.txt"))).toBe(false);
  });

  it("cannot write through a symlink or a hard link to a file outside", async () => {
    const soft = await run(`ln -s ${outside} out-link; cat out-link/notes.txt; echo pwned > out-link/notes.txt`);
    const hard = await run(`cat ${outside}/notes.txt; ln ${outside}/notes.txt hard-notes.txt && echo pwned >> hard-notes.txt`);
    expect(soft.content).toContain(VISIBLE.outside);
    expect(hard.content).toContain(VISIBLE.outside);
    expect(soft.ok).toBe(false);
    expect(hard.ok).toBe(false);
    expect(await readFile(join(outside, "notes.txt"), "utf8")).toBe(`${VISIBLE.outside}\n`);
  });

  it("cannot read a secret through a symlink or a hard link either", async () => {
    const soft = await run(`ln -s ${secret} soft.json; cat ${outside}/notes.txt; cat soft.json`);
    const hard = await run(`cat ${outside}/notes.txt; ln ${secret} hard.json && cat hard.json`);
    for (const result of [soft, hard]) {
      expect(result.content).toContain(VISIBLE.outside);
      expect(result.content).not.toContain("hunter2");
    }
  });

  it("python and node cannot write outside either", async () => {
    const target = join(outside, "from-script.txt");
    const commands = [
      ...(has("python3") ? [`python3 -c 'open("${target}", "w").write("pwned")'`] : []),
      ...(has("node") ? [`node -e 'require("fs").writeFileSync("${target}", "pwned")'`] : []),
    ];
    for (const command of commands) {
      const result = await run(`cat ${outside}/notes.txt; ${command}`);
      expect(result.content, command).toContain(VISIBLE.outside);
      expect(result.ok, command).toBe(false);
      expect(result.content, command).toMatch(/[Oo]peration not permitted|Read-only file system|EROFS|EPERM/);
    }
    expect(existsSync(target)).toBe(false);
  });

  it("python and node still run, and write in the working folder", async () => {
    if (has("python3")) {
      expect(await run(`python3 -c 'import tokenize, json; open("py.txt", "w").write("ok")' && cat py.txt`)).toMatchObject({ ok: true, content: expect.stringContaining("ok") });
    }
    if (has("node")) {
      expect(await run(`node -e 'require("fs").writeFileSync("js.txt", "ok")' && cat js.txt`)).toMatchObject({ ok: true, content: expect.stringContaining("ok") });
    }
  });

  it("cannot read ~/.ssh, the credential files, or the run's own secrets, but reads a template", async () => {
    for (const [where, command] of SECRET_READS) {
      const result = await run(`${see(where)}; ${read(command)}`);
      expect(result.content, command).toContain(VISIBLE[where]);
      expect(result.content, command).not.toContain("hunter2");
    }
  });

  it.runIf(probe.kind === "seatbelt")(
    "cannot reach a server on this machine: unix socket, IPv4 loopback, ::1, ::ffff:127.0.0.1 or localhost",
    async () => {
      const socketPath = join(outside, "server.sock");
      const hits: string[] = [];
      const unixServer = createServer((c) => { hits.push("unix"); c.end("pwned"); }).listen(socketPath);
      const tcp4 = createServer((c) => { hits.push("tcp4"); c.end("pwned"); });
      const tcp6 = createServer((c) => { hits.push("tcp6"); c.end("pwned"); });
      await Promise.all([
        once(unixServer, "listening"),
        new Promise<void>((resolve) => tcp4.listen(0, "127.0.0.1", resolve)),
        new Promise<void>((resolve) => tcp6.listen(0, "::1", resolve)),
      ]);
      const port4 = (tcp4.address() as AddressInfo).port;
      const port6 = (tcp6.address() as AddressInfo).port;
      try {
        const connect = (target: string) =>
          `node -e 'const s=require("net").connect(${target});s.on("data",d=>{console.log("REACHED",String(d));process.exit(0)});s.on("error",e=>{console.log("refused",e.code);process.exit(1)})'`;
        for (const target of [JSON.stringify(socketPath), `${port4},"127.0.0.1"`, `${port6},"::1"`, `${port4},"::ffff:127.0.0.1"`, `${port4},"localhost"`]) {
          const result = await run(connect(target));
          expect(result.content, target).not.toContain("REACHED");
          expect(result.content, target).toContain("refused");
        }
        expect(hits).toEqual([]);
      } finally {
        unixServer.close();
        tcp4.close();
        tcp6.close();
      }
    },
  );

  it.runIf(has("tmux"))("cannot reach a tmux server: its sessions are other agents", async () => {
    // A private server, not anyone's real one. On Linux the socket lives in /tmp, which bubblewrap hides.
    const socket = probe.kind === "bubblewrap" ? join("/tmp", `jht-api-tmux-${process.pid}`) : join(outside, "tmux.sock");
    expect(spawnSync("tmux", ["-S", socket, "new-session", "-d", "-s", "victim", "sleep 60"]).status).toBe(0);
    try {
      const result = await run(`tmux -S ${socket} ls; tmux -S ${socket} send-keys -t victim 'echo pwned' Enter`);
      expect(result.ok).toBe(false);
      expect(result.content).not.toContain("victim:");
    } finally {
      spawnSync("tmux", ["-S", socket, "kill-server"]);
      await rm(socket, { force: true });
    }
  });

  it("still resolves names and reads the system CA bundle, which HTTPS needs", async () => {
    const dns = await run(`node -e 'require("dns").lookup("localhost",(e,a)=>{console.log(e?"dns-failed":"dns-ok");process.exit(e?1:0)})'`);
    expect(dns).toMatchObject({ ok: true, content: expect.stringContaining("dns-ok") });
    const bundle = ["/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"].find(existsSync);
    if (bundle) expect(await run(`head -c 1 ${bundle} >/dev/null && echo ca-ok`)).toMatchObject({ ok: true, content: expect.stringContaining("ca-ok") });
  });

  it("reaches a site over HTTPS, when this machine is online", async () => {
    const curl = "curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://example.com";
    const online = spawnSync("/bin/sh", ["-c", curl], { encoding: "utf8" }).stdout.startsWith("2");
    if (!online) return;
    expect(await run(curl)).toMatchObject({ ok: true, content: expect.stringMatching(/\b2\d\d\b/) });
    if (has("python3")) {
      const py = await run(`python3 -c 'import urllib.request as u; print(u.urlopen("https://example.com", timeout=15).status)'`);
      expect(py).toMatchObject({ ok: true, content: expect.stringContaining("200") });
    }
  });

  it("reports the gaps it leaves in every result's details", async () => {
    const gaps = (await run("true")).details?.["sandboxGaps"] as string[];
    expect(gaps.join("\n")).toMatch(/local network/);
    if (probe.kind === "bubblewrap") expect(gaps.join("\n")).toMatch(/loopback/);
  });

  it("removes its temporary folder when disposed", async () => {
    const box = createSandbox({ workdir });
    const tmp = box.env["TMPDIR"]!;
    expect(existsSync(tmp)).toBe(true);
    box.dispose();
    expect(existsSync(tmp)).toBe(false);
  });
});

function createProbe(): Sandbox {
  const box = createSandbox({ workdir: tmpdir() });
  box.dispose();
  return box;
}
