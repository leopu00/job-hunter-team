#!/usr/bin/env python3
"""Check that a published GitHub Release can be downloaded by anyone, without logging in.

The Actions artifacts of a run ask for a GitHub login; the download button of
the site must not. This asks the way a person who is not logged in asks, with
no token at all:

 1. the release is public: not a draft, not a pre-release (what the site's
    /go/<slug> route also requires before it redirects);
 2. every asset the site links is listed, uploaded, not empty, and at the very
    address the site builds for it;
 3. each of those addresses answers with the file (the redirect to GitHub's
    storage is followed), the size the API announced, and, unless --no-bytes,
    the SHA-256 that SHA256SUMS of the same release carries.

The file names are the ones of web/lib/download-funnel.ts, read from there: the
site and this check cannot disagree on what the release must hold.

Usage: check_public_release.py [--tag v0.4.0] [--repository owner/name] [--no-bytes]
Exit: 0 ok, 1 something a person could not download, 2 the check could not run.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FUNNEL = ROOT / "web" / "lib" / "download-funnel.ts"
REPOSITORY = "leopu00/job-hunter-team"
TIMEOUT = 60
CHUNK = 1024 * 1024


class Fail(Exception):
    """A person could not get what the site promises."""


class CannotRun(Exception):
    """The check itself could not run."""


def site_targets(source: str) -> tuple:
    """(release tag, asset names) as web/lib/download-funnel.ts declares them."""
    tag = re.search(r'DOWNLOAD_RELEASE_TAG = "([^"]+)"', source)
    block = re.search(r"export const DOWNLOAD_TARGETS = \{(.*?)\} as const", source, re.S)
    if not tag or not block:
        raise CannotRun("web/lib/download-funnel.ts no longer declares DOWNLOAD_RELEASE_TAG / DOWNLOAD_TARGETS")
    names = re.findall(r"RELEASE_BASE\}/([^`]+)`", block.group(1))
    if not names:
        raise CannotRun("no download target found in web/lib/download-funnel.ts")
    return tag.group(1), names


def anonymous(url: str, extra=None):
    """A GET with no credential of any kind."""
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "jht-release-check", **(extra or {})}
    request = urllib.request.Request(url, headers=headers)
    return urllib.request.urlopen(request, timeout=TIMEOUT)


def read_release(repository: str, tag: str) -> dict:
    try:
        with anonymous(f"https://api.github.com/repos/{repository}/releases/tags/{tag}") as response:
            return json.load(response)
    except urllib.error.HTTPError as problem:
        if problem.code == 404:
            raise Fail(f"{tag} is not a public release (a draft answers 404 to someone who is not logged in)")
        raise CannotRun(f"GitHub answered {problem.code} for the release")
    except (OSError, ValueError) as problem:
        raise CannotRun(f"cannot read the release: {problem}")


def check_release(release: dict, repository: str, tag: str, names: list) -> dict:
    """The public face of the release; returns {name: announced size}."""
    if release.get("tag_name") != tag:
        raise Fail(f"the release says it is {release.get('tag_name')!r}, not {tag}")
    if release.get("draft") is not False or release.get("prerelease") is not False:
        raise Fail("the release is a draft or a pre-release: the site does not link it")
    base = f"https://github.com/{repository}/releases/download/{tag}"
    listed = {}
    for asset in release.get("assets") or []:
        if isinstance(asset, dict) and asset.get("state") == "uploaded" and isinstance(asset.get("size"), int) and asset["size"] > 0:
            if asset.get("browser_download_url") == f"{base}/{asset.get('name')}":
                listed[asset["name"]] = asset["size"]
    missing = [name for name in [*names, "SHA256SUMS"] if name not in listed]
    if missing:
        raise Fail(f"not uploaded, or not at the address the site builds: {', '.join(missing)}")
    return {name: listed[name] for name in [*names, "SHA256SUMS"]}


def fetch(url: str, expected_size: int, keep: bool) -> tuple:
    """(sha256 hex, body or b"") of the file at url, with its size checked."""
    digest = hashlib.sha256()
    kept = bytearray()
    total = 0
    try:
        with anonymous(url) as response:
            if response.status != 200:
                raise Fail(f"{url} answered {response.status}")
            while True:
                chunk = response.read(CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                digest.update(chunk)
                if keep:
                    kept += chunk
    except urllib.error.HTTPError as problem:
        raise Fail(f"{url} answered {problem.code}")
    except OSError as problem:
        raise CannotRun(f"cannot download {url}: {problem}")
    if total != expected_size:
        raise Fail(f"{url}: {total} bytes arrived, the release says {expected_size}")
    return digest.hexdigest(), bytes(kept)


def probe(url: str) -> int:
    """Without downloading it all: does the address answer a file (a ranged read of its first byte)?"""
    try:
        with anonymous(url, {"Range": "bytes=0-0"}) as response:
            return response.status
    except urllib.error.HTTPError as problem:
        raise Fail(f"{url} answered {problem.code}")
    except OSError as problem:
        raise CannotRun(f"cannot reach {url}: {problem}")


def parse_sums(text: str) -> dict:
    sums = {}
    for line in text.splitlines():
        found = re.fullmatch(r"([0-9a-f]{64}) [ *](.+)", line.strip())
        if found:
            sums[found.group(2)] = found.group(1)
    return sums


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", help="default: the tag web/lib/download-funnel.ts links")
    parser.add_argument("--repository", default=REPOSITORY)
    parser.add_argument("--no-bytes", action="store_true", help="only ask that each address answers, do not download and hash")
    args = parser.parse_args()
    try:
        site_tag, names = site_targets(FUNNEL.read_text(encoding="utf-8"))
        tag = args.tag or site_tag
        if tag != site_tag:
            raise Fail(f"the site links {site_tag}, not {tag}: a button that leads to another release")
        listed = check_release(read_release(args.repository, tag), args.repository, tag, names)
        base = f"https://github.com/{args.repository}/releases/download/{tag}"
        lines = []
        if args.no_bytes:
            for name in names:
                probe(f"{base}/{name}")
                lines.append(f"{name}: answers, {listed[name]} bytes announced")
        else:
            _, raw = fetch(f"{base}/SHA256SUMS", listed["SHA256SUMS"], keep=True)
            sums = parse_sums(raw.decode("utf-8", errors="replace"))
            for name in names:
                found, _ = fetch(f"{base}/{name}", listed[name], keep=False)
                if sums.get(name) != found:
                    raise Fail(f"{name}: the bytes anyone downloads are not the ones SHA256SUMS lists")
                lines.append(f"{name}: {listed[name]} bytes, sha256 {found[:12]}… as in SHA256SUMS")
    except Fail as problem:
        print(f"FAIL {problem}", file=sys.stderr)
        return 1
    except (CannotRun, OSError) as problem:
        print(f"CANNOT RUN {problem}", file=sys.stderr)
        return 2
    notice = f"{args.repository} {tag}: public, no login needed.\n" + "\n".join(lines)
    print(notice)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as handle:
            handle.write("### Public release: downloadable without logging in\n\n" + notice.replace("\n", "\n\n") + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
