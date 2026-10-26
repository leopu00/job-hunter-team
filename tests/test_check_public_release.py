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

TAG, NAMES = check.site_targets((ROOT / "web/lib/download-funnel.ts").read_text(encoding="utf-8"))
REPO = "leopu00/job-hunter-team"
BASE = f"https://github.com/{REPO}/releases/download/{TAG}"
API = f"https://api.github.com/repos/{REPO}/releases/tags/{TAG}"
BODIES = {name: (name * 3).encode() for name in NAMES}


def sums(bodies):
    return "".join(f"{hashlib.sha256(body).hexdigest()}  {name}\n" for name, body in bodies.items()).encode()


def release(**changes):
    files = {**BODIES, "SHA256SUMS": sums(BODIES)}
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


@pytest.fixture
def github(monkeypatch):
    """Answers for the addresses the check asks; anything else is a 404, as for a person with no login."""
    state = {"release": release(), "files": {**BODIES, "SHA256SUMS": sums(BODIES)}}

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


def run(*argv):
    sys.argv = ["check_public_release.py", *argv]
    return check.main()


def test_the_names_are_the_ones_the_site_links():
    # D13: Mac and Linux; Windows is not in the release, so it is not asked for
    assert TAG.startswith("v") and len(NAMES) == 2 and all(re.search(r"\.(dmg|AppImage)$", n) for n in NAMES)
    assert not any(n.endswith(".exe") for n in NAMES)


def test_a_public_release_that_holds_the_files_is_green(github, capsys):
    assert run() == 0
    assert "public, no login needed" in capsys.readouterr().out
    assert run("--no-bytes") == 0


def test_a_draft_is_red_because_nobody_can_see_it(github, capsys):
    github["release"] = None
    assert run() == 1
    assert "is not a public release" in capsys.readouterr().err


@pytest.mark.parametrize("change", [{"draft": True}, {"prerelease": True}, {"tag_name": "v9.9.9"}])
def test_a_release_the_site_would_not_link_is_red(github, change):
    github["release"] = release(**change)
    assert run() == 1


def test_a_missing_or_misplaced_asset_is_red(github, capsys):
    data = release()
    data["assets"] = [a for a in data["assets"] if not a["name"].endswith(".dmg")]
    github["release"] = data
    assert run() == 1 and ".dmg" in capsys.readouterr().err
    data = release()
    data["assets"][0]["browser_download_url"] = "https://example.invalid/x"
    github["release"] = data
    assert run() == 1
    data = release()
    data["assets"][0]["state"] = "starter"
    github["release"] = data
    assert run() == 1


def test_a_file_that_is_not_what_the_release_announces_is_red(github, capsys):
    github["files"][NAMES[0]] = b"short"
    assert run() == 1 and "bytes arrived" in capsys.readouterr().err
    github["files"][NAMES[0]] = bytes(len(BODIES[NAMES[0]]))
    assert run() == 1 and "SHA256SUMS" in capsys.readouterr().err


def test_an_address_that_gives_404_is_red_even_without_downloading(github):
    del github["files"][NAMES[1]]
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


def test_the_workflow_starts_on_publication_and_holds_no_credential():
    assert re.search(r"^on:\n  release:\n    types: \[published\]", WORKFLOW, re.M)
    assert re.search(r"^permissions: \{\}$", WORKFLOW, re.M)
    assert "secrets." not in WORKFLOW and "GITHUB_TOKEN" not in WORKFLOW and "token:" not in WORKFLOW
    assert "persist-credentials: false" in WORKFLOW
    assert "scripts/ci/check_public_release.py" in WORKFLOW
    # the tag reaches the shell as an environment variable, never pasted into the script
    assert "run: |" in WORKFLOW and not re.search(r"run:.*\$\{\{", WORKFLOW)
