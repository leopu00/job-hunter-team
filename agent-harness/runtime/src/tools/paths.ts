/** Path helpers shared by every tool that takes a path from the model. */

import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Expands a leading `~` and resolves against `cwd`. Always absolute, normalised. */
export function resolveUserPath(input: string, cwd: string, home: string = homedir()): string {
  const expanded = input === "~" ? home : input.startsWith("~/") ? join(home, input.slice(2)) : input;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
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

const SECRET_DIRS = new Set([".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure", ".config/gcloud"]);
const SECRET_FILE = /^(\.env(\..+)?|\.netrc|\.npmrc|\.pypirc|\.pgpass|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|keychain-db))$/;

/**
 * True for files that commonly hold credentials: `.env` files, SSH and cloud
 * keys, package-registry tokens. The permission policy never reads these
 * silently, and grep skips them, so a key cannot reach the model — and the
 * provider — by accident. `.env.example` is a template and stays readable.
 */
export function isSensitivePath(path: string): boolean {
  const name = basename(path);
  if (name === ".env.example") return false;
  if (SECRET_FILE.test(name)) return true;
  const segments = path.split(sep);
  return segments.some((segment, i) => SECRET_DIRS.has(segment) || SECRET_DIRS.has(`${segment}/${segments[i + 1]}`));
}
