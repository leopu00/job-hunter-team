/** Path helpers shared by every tool that takes a path from the model. */

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Expands a leading `~` and resolves against `cwd`. Always absolute, normalised. */
export function resolveUserPath(input: string, cwd: string, home: string = homedir()): string {
  const expanded = input === "~" ? home : input.startsWith("~/") ? join(home, input.slice(2)) : input;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

/**
 * `path` with every symlink resolved: the file a call would really touch.
 *
 * The permission policy judges this, not the name the model gave: a link
 * called `readme.txt` that points at `~/.ssh/id_ed25519` is the key. A path
 * that does not exist yet (a file about to be written) resolves through its
 * nearest existing ancestor, so a link to a folder cannot hide either.
 */
export function realPath(path: string): string {
  let head = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return resolve(path);
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

/** True when `target` is `root` itself or somewhere below it. */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === "") return true;
  // `..notes.md` is a legal file name; only `..` as a whole segment climbs out.
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/** `path` with the home directory shown as `~`, so no username reaches a prompt. */
export function displayPath(path: string, home: string = homedir()): string {
  if (path === home) return "~";
  return path.startsWith(home + sep) ? `~${sep}${path.slice(home.length + 1)}` : path;
}

const SECRET_DIRS = new Set([".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure", ".config/gcloud", ".config/gh"]);
const SECRET_FILE =
  /^(\.env(\..+)?|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.git-credentials|credentials(\.json)?|.*token.*|.*-key\.txt|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|keychain-db))$/i;

/**
 * True for files that commonly hold credentials: `.env` files, SSH and cloud
 * keys, package-registry and git tokens, the GitHub CLI's config, and the
 * `*-key.txt` files the harness keeps its own provider key in. The permission
 * policy never reads these silently, and grep skips them, so a key cannot
 * reach the model — and the provider — by accident. `.env.example` is a template and stays readable.
 */
export function isSensitivePath(path: string): boolean {
  const name = basename(path);
  if (name === ".env.example") return false;
  if (SECRET_FILE.test(name)) return true;
  const segments = path.split(sep);
  return segments.some((segment, i) => SECRET_DIRS.has(segment) || SECRET_DIRS.has(`${segment}/${segments[i + 1]}`));
}
