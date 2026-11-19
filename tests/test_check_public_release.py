"""The public-release check (scripts/ci/check_public_release.py): what a person who is not logged in can download.

GitHub is replaced by a table of addresses; each way the release can fail the person is a case, and one
that is right is green, so the check is seen red before it is trusted on the real release.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import sys
import urllib.error
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ci"))
import check_public_release as check  # noqa: E402

SITE = (ROOT / "web/lib/download-funnel.ts").read_text(encoding="utf-8")
TAG, SITE_NAMES = check.site_targets(SITE)
REPO = "leopu00/job-hunter-team"
BASE = f"https://github.com/{REPO}/releases/download/{TAG}"
API = f"https://api.github.com/repos/{REPO}/releases/tags/{TAG}"
# what a release attaches besides the files the site links (0.4.0: the runtime manifest, no desktop app)
OTHER = {"RUNTIME-IMAGE.json": b"{}"}
# a site that links a file of the release, as one with the desktop app back would: the checks of each file
APP = "job-hunter-team-macos-universal.dmg"
SITE_WITH_APP = re.sub(
    r"export const DOWNLOAD_TARGETS = \{.*?\} as const",
    "export const DOWNLOAD_TARGETS = {\n  mac: `${RELEASE_BASE}/" + APP + "`,\n} as const",
    SITE,
    flags=re.S,
)


def sums(bodies):
    return "".join(f"{hashlib.sha256(body).hexdigest()}  {name}\n" for name, body in bodies.items()).encode()


def bodies_for(names):
    return {**{name: (name * 3).encode() for name in names}, **OTHER}


def release(names=SITE_NAMES, **changes):
    bodies = bodies_for(names)
    files = {**bodies, "SHA256SUMS": sums(bodies)}
    data = {
        "tag_name": TAG, "draft": False, "prerelease": False,
        "assets": [
            {"name": n, "state": "uploaded", "size": len(b), "browser_download_url": f"{BASE}/{n}"}
            for n, b in files.items()
        ],
    }
    data.update(changes)
    return data


class Reply(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def answers(monkeypatch, names):
    """Answers for the addresses the check asks; anything else is a 404, as for a person with no login."""
    bodies = bodies_for(names)
    state = {"release": release(names), "files": {**bodies, "SHA256SUMS": sums(bodies)}}

    def anonymous(url, extra=None):
        if url == API:
            if state["release"] is None:
                raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
            return Reply(json.dumps(state["release"]).encode())
        name = url.removeprefix(BASE + "/")
        if url.startswith(BASE + "/") and name in state["files"]:
            return Reply(state["files"][name])
        raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)

    monkeypatch.setattr(check, "anonymous", anonymous)
    return state


@pytest.fixture
def github(monkeypatch):
    """The release of the site as it is."""
    return answers(monkeypatch, SITE_NAMES)


@pytest.fixture
def github_with_app(monkeypatch, tmp_path):
    """A site that links the dmg of the release, and a release that holds it."""
    funnel = tmp_path / "download-funnel.ts"
    funnel.write_text(SITE_WITH_APP, encoding="utf-8")
    monkeypatch.setattr(check, "FUNNEL", funnel)
    return answers(monkeypatch, [APP])


def run(*argv):
    sys.argv = ["check_public_release.py", *argv]
    return check.main()


def test_0_4_0_links_no_file_of_the_release():
    # no desktop app in 0.4.0: no dmg, exe, AppImage or deb is asked for, only the public release and its SHA256SUMS
    assert TAG.startswith("v") and SITE_NAMES == []
    assert check.site_targets(SITE_WITH_APP) == (TAG, [APP])


def test_a_public_release_with_its_sums_is_green(github, capsys):
    assert run() == 0
    out = capsys.readouterr().out
    assert "public, no login needed" in out and "SHA256SUMS only" in out
    assert run("--no-bytes") == 0


def test_a_release_without_its_sums_is_red(github, capsys):
    data = release()
    data["assets"] = [a for a in data["assets"] if a["name"] != "SHA256SUMS"]
    github["release"] = data
    assert run() == 1 and "SHA256SUMS" in capsys.readouterr().err
    github["release"] = release()
    del github["files"]["SHA256SUMS"]
    assert run("--no-bytes") == 1


def test_a_draft_is_red_because_nobody_can_see_it(github, capsys):
    github["release"] = None
    assert run() == 1
    assert "is not a public release" in capsys.readouterr().err


@pytest.mark.parametrize("change", [{"draft": True}, {"prerelease": True}, {"tag_name": "v9.9.9"}])
def test_a_release_the_site_would_not_link_is_red(github, change):
    github["release"] = release(**change)
    assert run() == 1


def test_a_site_that_links_a_file_is_green_when_the_release_holds_it(github_with_app, capsys):
    assert run() == 0 and f"{APP}: " in capsys.readouterr().out
    assert run("--no-bytes") == 0


def test_a_missing_or_misplaced_asset_is_red(github_with_app, capsys):
    data = release([APP])
    data["assets"] = [a for a in data["assets"] if not a["name"].endswith(".dmg")]
    github_with_app["release"] = data
    assert run() == 1 and ".dmg" in capsys.readouterr().err
    data = release([APP])
    data["assets"][0]["browser_download_url"] = "https://example.invalid/x"
    github_with_app["release"] = data
    assert run() == 1
    data = release([APP])
    data["assets"][0]["state"] = "starter"
    github_with_app["release"] = data
    assert run() == 1


def test_a_file_that_is_not_what_the_release_announces_is_red(github_with_app, capsys):
    github_with_app["files"][APP] = b"short"
    assert run() == 1 and "bytes arrived" in capsys.readouterr().err
    github_with_app["files"][APP] = bytes(len(bodies_for([APP])[APP]))
    assert run() == 1 and "SHA256SUMS" in capsys.readouterr().err


def test_an_address_that_gives_404_is_red_even_without_downloading(github_with_app):
    del github_with_app["files"][APP]
    assert run("--no-bytes") == 1


def test_a_tag_other_than_the_one_the_site_links_is_red(github, capsys):
    assert run("--tag", "v0.4.1") == 1 and "a button that leads to another release" in capsys.readouterr().err


def test_the_check_runs_with_no_credential(monkeypatch):
    seen = []

    def urlopen(request, timeout=None):
        seen.append({k.lower() for k in request.headers})
        raise urllib.error.HTTPError(request.full_url, 404, "Not Found", {}, None)

    monkeypatch.setattr(check.urllib.request, "urlopen", urlopen)
    sys.argv = ["check_public_release.py"]
    assert check.main() == 1
    assert seen and all("authorization" not in headers for headers in seen)


WORKFLOW = (ROOT / ".github/workflows/public-release-check.yml").read_text(encoding="utf-8")


def test_the_workflow_starts_on_publication_and_keeps_no_credential():
    assert re.search(r"^on:\n  release:\n    types: \[published\]", WORKFLOW, re.M)
    # the least the census allows: read this repository, nothing else; no write, no secret
    assert re.search(r"^permissions:\n  contents: read$", WORKFLOW, re.M)
    assert not re.search(r"^\s*[a-z-]+: write$", WORKFLOW, re.M) and "secrets." not in WORKFLOW
    assert "GITHUB_TOKEN" not in WORKFLOW and "token:" not in WORKFLOW
    assert "persist-credentials: false" in WORKFLOW
    assert "scripts/ci/check_public_release.py" in WORKFLOW
    # the tag reaches the shell as an environment variable, never pasted into the script
    assert "run: |" in WORKFLOW and not re.search(r"run:.*\$\{\{", WORKFLOW)
