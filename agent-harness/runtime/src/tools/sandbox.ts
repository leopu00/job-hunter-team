/**
 * The operating-system boundary around `bash`, as Codex draws it in full-auto.
 * Ported from Home Hunter Team (f8cf133, 1a507bf), with this runtime's
 * credential names.
 *
 * The permission policy decides whether a call runs; it cannot see what a
 * shell command touches, because a command names no paths. This does: every
 * command runs inside the kernel's own sandbox, so an autonomous agent keeps
 * its whole shell and nobody is asked anything, but three things hold whatever
 * the command is:
 *
 * - **Writes stay home.** Only the role's working folder and a temporary
 *   folder of this run are writable (plus `/dev/null` and friends). `TMPDIR`
 *   and the npm and XDG caches point into the temporary folder, so ordinary
 *   tools find somewhere to write.
 * - **Credentials stay unread.** The files `isSensitivePath` protects from the
 *   file tools — SSH and cloud keys, `.env`, registry tokens, git, GitHub CLI
 *   and coding-agent logins, the run's MCP config — cannot be opened.
 * - **The internet stays on, this machine does not.** Scouting is the job,
 *   but a process outside the sandbox runs with the user's full authority:
 *   a tmux server whose sessions are other agents, the FLEET daemon on
 *   localhost. Reaching one is leaving the sandbox, so local sockets and
 *   loopback are shut, as `web_fetch` refuses private addresses.
 *
 * On macOS the sandbox is Seatbelt (`sandbox-exec`), on Linux bubblewrap
 * (`bwrap`). Where neither works — another OS, `bwrap` not installed, user
 * namespaces disabled, already inside a sandbox — commands run without one,
 * and every result says so in its trace details: the fallback is never silent.
 * What a sandbox does not cover is said the same way, in `gaps`.
 *
 * The two differ:
 * - Seatbelt matches files by pattern, so a `.env` is unreadable anywhere on
 *   disk. bubblewrap masks paths that exist when the run starts: the
 *   credential folders and files in the home, the run's protected files, and
 *   the `.env` files at the top of the working folder.
 * - Seatbelt shuts unix sockets (all but the DNS resolver's), IPv4 loopback
 *   and all of IPv6 — its rules name only `localhost` or every host, and an
 *   IPv4-mapped address (`::ffff:127.0.0.1`) reaches loopback through IPv6.
 *   Dual-stack sites fall back to IPv4; IPv6-only ones are out of reach.
 *   bubblewrap cannot cut loopback without cutting the network: it hides the
 *   socket folders (`/tmp`, `/run/user/<uid>`, the Docker socket) and
 *   declares loopback a gap.
 * - Neither can name the local network: this machine's own LAN address, and
 *   the router, stay reachable. Declared as a gap on both.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, platform as osPlatform, tmpdir } from "node:os";
import { join } from "node:path";

export type SandboxKind = "seatbelt" | "bubblewrap" | "none";

export interface Sandbox {
  kind: SandboxKind;
  /** Why commands run unsandboxed. Only for `kind: "none"`. */
  missing?: string;
  /** What this sandbox does not shut, in words, for the trace. Empty without a sandbox: `missing` says it all. */
  gaps: string[];
  /** Folders a command may write to, absolute and resolved. Empty without a sandbox. */
  writableRoots: string[];
  /** The command line that runs `argv` inside the sandbox. */
  wrap(argv: string[]): string[];
  /** Variables laid over the command's environment. */
  env: Record<string, string>;
  /** Removes the temporary folder. Call when the run ends. */
  dispose(): void;
}

export interface SandboxOptions {
  /** The agent's working folder: writable. */
  workdir: string;
  /** Files of this run that hold secrets, absolute: unreadable like `.env`. */
  protectedPaths?: string[];
  homeDir?: string;
  /** Test seams. */
  platform?: NodeJS.Platform;
  uid?: number;
  available?: (kind: "seatbelt" | "bubblewrap") => boolean;
  /** Runs `true` in the sandbox as built; the error, or undefined when it started. */
  start?: (argv: string[]) => string | undefined;
}

/** Credential folders under the home, as `SECRET_DIRS` in `paths.ts`. */
const SECRET_HOME_DIRS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".docker",
  ".azure",
  ".config/gcloud",
  ".config/gh",
  "credentials",
  ".cache/linkedin",
];
/** Credential files under the home, as in `paths.ts`. */
const SECRET_HOME_FILES = [
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".pgpass",
  ".claude/.credentials.json",
  ".codex/auth.json",
];
/**
 * File names that hold credentials wherever they are, as `SECRET_FILE` in
 * `paths.ts` — `credentials(.json)` and the `*-key.txt` the harness keeps a
 * provider key in included. Not its `*token*`: that name is also Python's
 * own `token.py` and `tokenize.py`, and shutting them breaks `python3`.
 */
const SECRET_NAME_REGEXES = [
  String.raw`/\.env(\.[^/]+)?$`,
  String.raw`/\.(git-credentials|netrc|npmrc|pypirc|pgpass)$`,
  String.raw`/id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$`,
  String.raw`/credentials(\.json)?$`,
  // A credentials folder anywhere, and what is inside it: the regex above only
  // matches the folder's own node, not the files under it.
  String.raw`/credentials/`,
  String.raw`/\.cache/linkedin(/|$)`,
  String.raw`/storage-state\.json$`,
  String.raw`-key\.txt$`,
];
/**
 * Key and certificate files, shut under the home only. The same extensions
 * name the system's public CA bundles (`/etc/ssl/cert.pem`), and shutting
 * those breaks every HTTPS client in the sandbox.
 */
const SECRET_KEY_EXTENSIONS = String.raw`\.(pem|key|p12|pfx|keychain-db)$`;
/** A template, not a secret: stays readable, as in `paths.ts`. */
const READABLE_EXCEPTION = String.raw`/\.env\.example$`;

/** The DNS resolver's socket: the one unix socket name resolution needs on macOS. */
const DNS_SOCKET = "/private/var/run/mDNSResponder";

const LAN_GAP = "the local network stays reachable, this machine's own LAN address included: services bound to it are not shut";
const SEATBELT_GAPS = [LAN_GAP];
const BUBBLEWRAP_GAPS = [
  "loopback (127.0.0.1, ::1) stays reachable: bubblewrap cannot shut it without shutting the network",
  "abstract unix sockets, and sockets outside /tmp, /run/user/<uid> and the Docker socket, stay reachable",
  LAN_GAP,
];

/** Device files every shell writes to. */
const WRITABLE_DEVICES = ["/dev/null", "/dev/zero", "/dev/tty", "/dev/stdout", "/dev/stderr", "/dev/dtracehelper"];

/**
 * The sandbox for `bash` on this machine. It creates the run's temporary
 * folder; `dispose` removes it.
 */
export function createSandbox(options: SandboxOptions): Sandbox {
  const os = options.platform ?? osPlatform();
  const available = options.available ?? isAvailable;
  const kind = os === "darwin" ? "seatbelt" : os === "linux" ? "bubblewrap" : undefined;
  if (!kind) return unsandboxed(`no sandbox is known for ${os}`);
  if (!available(kind)) {
    return unsandboxed(
      kind === "seatbelt"
        ? "sandbox-exec is not available or not permitted here"
        : "bwrap is not installed, or user namespaces are disabled",
    );
  }

  const home = options.homeDir ?? homedir();
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "jht-api-sandbox-")));
  const writableRoots = [resolved(options.workdir), tmp];
  const env = {
    TMPDIR: tmp,
    npm_config_cache: join(tmp, "npm"),
    XDG_CACHE_HOME: join(tmp, "cache"),
  };
  const protectedPaths = options.protectedPaths ?? [];
  const dispose = () => rmSync(tmp, { recursive: true, force: true });

  if (kind === "seatbelt") {
    const profile = seatbeltProfile({ writableRoots, home, protectedPaths });
    return {
      kind,
      gaps: SEATBELT_GAPS,
      writableRoots,
      env,
      dispose,
      wrap: (argv) => ["/usr/bin/sandbox-exec", "-p", profile, ...argv],
    };
  }
  const uid = options.uid ?? process.getuid?.();
  const args = bubblewrapArgs({ writableRoots, home, protectedPaths, workdir: options.workdir, ...(uid === undefined ? {} : { uid }) });
  const wrap = (argv: string[]) => ["bwrap", ...args, "--", ...argv];
  // The probe above starts an empty sandbox; this one starts the real one. A mount
  // bubblewrap refuses would fail every command: declared as no sandbox instead.
  const refused = (options.start ?? startsTrue)(wrap(["/bin/true"]));
  if (refused !== undefined) {
    dispose();
    return unsandboxed(`bwrap refused this sandbox: ${refused}`);
  }
  return { kind, gaps: BUBBLEWRAP_GAPS, writableRoots, env, dispose, wrap };
}

/**
 * A Seatbelt profile: everything allowed, then writes denied outside the
 * writable roots, credential reads denied, and connections to this machine
 * denied. Later rules win, which is what lets `.env.example` and the DNS
 * socket back in after the rule that shuts them.
 *
 * The network rules are separate statements on purpose: `ip` and `ip6`
 * filters in one profile make Seatbelt stop matching IPv4 loopback (checked
 * on macOS 26), so IPv4 is named as `ip4`.
 */
export function seatbeltProfile(options: { writableRoots: string[]; home: string; protectedPaths: string[] }): string {
  const q = (path: string) => JSON.stringify(path);
  // A regex literal is written as is: SBPL reads `\.` in `#"..."` as a regex escape.
  const re = (pattern: string) => `(regex #"${pattern}")`;
  const secretDirs = SECRET_HOME_DIRS.flatMap((dir) => bothSpellings(join(options.home, dir))).map((dir) => `(subpath ${q(dir)})`);
  const secretFiles = SECRET_HOME_FILES.map((file) => join(options.home, file))
    .flatMap(bothSpellings)
    .map((file) => `(literal ${q(file)})`);
  // A protected path can be a folder (the portal secrets): `subpath` shuts it and
  // everything below, and on a file it matches the file alone, as `literal` did.
  const protectedRules = options.protectedPaths.flatMap(bothSpellings).map((path) => `(subpath ${q(path)})`);
  const secretNames = [...SECRET_NAME_REGEXES, `^${escapeRegex(options.home)}/.*${SECRET_KEY_EXTENSIONS}`].map(re);
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    "(allow file-write*",
    ...options.writableRoots.map((root) => `  (subpath ${q(root)})`),
    ...WRITABLE_DEVICES.map((device) => `  (literal ${q(device)})`),
    `  ${re("^/dev/fd/")}`,
    `  ${re("^/dev/ttys[0-9]+$")})`,
    "(deny file-read* file-write*",
    ...[...secretDirs, ...secretFiles, ...protectedRules, ...secretNames].map((rule) => `  ${rule}`),
    ")",
    `(allow file-read* ${re(READABLE_EXCEPTION)})`,
    // tmux, the Docker daemon, an SSH agent: servers that run outside the sandbox.
    "(deny network-outbound (remote unix-socket))",
    `(allow network-outbound (remote unix-socket (path-literal ${q(DNS_SOCKET)})))`,
    // The FLEET daemon and every other localhost service.
    `(deny network-outbound (remote ip4 ${q("localhost:*")}))`,
    // All of IPv6: ::1 and ::ffff:127.0.0.1 cannot be named apart from the rest.
    `(deny network-outbound (remote ip6 ${q("*:*")}))`,
  ].join("\n");
}

/**
 * bubblewrap arguments: the root read-only, the folders where local servers
 * keep their sockets hidden under an empty tmpfs, the writable roots bound
 * read-write on top, the network shared, and every credential path that
 * exists masked — an empty tmpfs over a folder, `/dev/null` over anything else.
 *
 * Every mask goes on the path as resolved, once, and only when it is there.
 * bubblewrap does not follow a symlink in a destination: it tries to create
 * the file instead, and on a root bound read-only that kills the command. On
 * most Linux systems `/var/run` is a link to `/run`, so `/var/run/docker.sock`
 * was such a destination, and every bash command died on it.
 */
export function bubblewrapArgs(options: {
  writableRoots: string[];
  home: string;
  protectedPaths: string[];
  workdir: string;
  uid?: number;
  /** Test seam: where a path really is, and whether it is a folder. Undefined when it is not there. */
  lookup?: (path: string) => Found | undefined;
  listDir?: (dir: string) => string[];
}): string[] {
  const lookup = options.lookup ?? find;
  const listDir = options.listDir ?? safeList;
  const dotEnvs = listDir(options.workdir)
    .filter((name) => /^\.env(\..+)?$/.test(name) && name !== ".env.example")
    .map((name) => join(options.workdir, name));
  const secrets = [
    ...SECRET_HOME_DIRS.map((dir) => join(options.home, dir)),
    ...SECRET_HOME_FILES.map((file) => join(options.home, file)),
    ...options.protectedPaths,
    ...dotEnvs,
  ];
  // tmux keeps its socket in /tmp, session services theirs in /run/user/<uid>.
  const socketDirs = ["/tmp", ...(options.uid === undefined ? [] : [`/run/user/${options.uid}`])];
  const sockets = ["/run/docker.sock", "/var/run/docker.sock"];
  return [
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    ...masks([...socketDirs, ...sockets], lookup),
    // After the tmpfs: a writable root under /tmp is bound back on top of it.
    ...options.writableRoots.flatMap((root) => ["--bind", root, root]),
    ...masks(secrets, lookup),
    // Killing bwrap's process group, as a timeout does, ends everything inside.
    "--unshare-pid",
    "--die-with-parent",
  ];
}

interface Found {
  /** The path with every symlink resolved. */
  real: string;
  dir: boolean;
}

/** The bubblewrap arguments that hide `paths`: the ones that exist, resolved, each once, by kind. */
function masks(paths: string[], lookup: (path: string) => Found | undefined): string[] {
  const seen = new Set<string>();
  return paths.flatMap((path) => {
    const found = lookup(path);
    if (!found || seen.has(found.real)) return [];
    seen.add(found.real);
    return found.dir ? ["--tmpfs", found.real] : ["--ro-bind", "/dev/null", found.real];
  });
}

function find(path: string): Found | undefined {
  try {
    const real = realpathSync(path);
    return { real, dir: statSync(real).isDirectory() };
  } catch {
    return undefined;
  }
}

function unsandboxed(missing: string): Sandbox {
  return { kind: "none", missing, gaps: [], writableRoots: [], env: {}, wrap: (argv) => argv, dispose: () => {} };
}

/** Probed once per process: a sandbox that cannot start a trivial command cannot start any. */
const probes = new Map<string, boolean>();
function isAvailable(kind: "seatbelt" | "bubblewrap"): boolean {
  let ok = probes.get(kind);
  if (ok === undefined) {
    const [bin, ...args] =
      kind === "seatbelt"
        ? ["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/usr/bin/true"]
        : ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "/bin/true"];
    ok = spawnSync(bin!, args, { stdio: "ignore", timeout: 5_000 }).status === 0;
    probes.set(kind, ok);
  }
  return ok;
}

function startsTrue(argv: string[]): string | undefined {
  const [bin, ...args] = argv;
  const run = spawnSync(bin!, args, { encoding: "utf8", timeout: 5_000 });
  if (run.status === 0) return undefined;
  return run.error?.message ?? (run.stderr.trim() || `exit ${run.status ?? run.signal}`);
}

/** Seatbelt matches the resolved path: `/var` is `/private/var` on macOS. */
function resolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A protected path as given and resolved, so a symlinked spelling is shut too. */
function bothSpellings(path: string): string[] {
  const real = resolved(path);
  return real === path ? [path] : [path, real];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
