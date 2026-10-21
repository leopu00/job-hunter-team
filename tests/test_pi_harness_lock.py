"""pi is installed only from the reviewed lock in shared/runtime/pi-harness.

The lock pins @earendil-works/pi-coding-agent and its whole tree, each package
with its sha512 integrity from the npm registry. install-pi.sh refuses a
package.json or lock other than the reviewed ones (sha256), refuses a Node
older than the one pi declares, never runs dependency scripts, and exposes
`pi` only after it answered the expected version.

These tests keep the four places of one bump together: the lock, the two
sha256 in the installer, the installer's version and JHT_PI_VERSION in the
launcher. npm itself is faked: the tests never reach the network.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from test_agent_model_override import _bash


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "shared" / "runtime" / "pi-harness"
INSTALL = HARNESS / "install-pi.sh"
LOCK = HARNESS / "package-lock.json"
PACKAGE = HARNESS / "package.json"
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"
PI = "node_modules/@earendil-works/pi-coding-agent"

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="the installer runs in the Linux container"
)


def _lock() -> dict:
    return json.loads(LOCK.read_text(encoding="utf-8"))


def _installer_constant(name: str) -> str:
    match = re.search(rf'^readonly {name}="([^"]+)"$', INSTALL.read_text(encoding="utf-8"),
                      re.MULTILINE)
    assert match, f"{name} is no longer in install-pi.sh"
    return match.group(1)


def _launcher_version() -> str:
    return subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; printf %s "$JHT_PI_VERSION"'],
        capture_output=True, text=True, check=True,
    ).stdout


# ── the lock ─────────────────────────────────────────────────────────────


def test_the_lock_installs_exactly_the_launcher_s_pi() -> None:
    version = _launcher_version()
    lock = _lock()
    assert lock["lockfileVersion"] == 3
    assert json.loads(PACKAGE.read_text(encoding="utf-8"))["dependencies"] == {
        "@earendil-works/pi-coding-agent": version
    }
    assert lock["packages"][""]["dependencies"] == {"@earendil-works/pi-coding-agent": version}
    assert lock["packages"][PI]["version"] == version
    assert _installer_constant("PI_VERSION") == version


def test_every_package_has_its_integrity_from_the_registry() -> None:
    packages = {k: v for k, v in _lock()["packages"].items() if k}
    assert len(packages) > 50, "a lock this small is not pi's tree"
    for name, entry in packages.items():
        assert str(entry.get("integrity", "")).startswith("sha512-"), name
        assert str(entry.get("resolved", "")).startswith("https://registry.npmjs.org/"), name


def test_the_installer_pins_the_reviewed_files() -> None:
    assert _installer_constant("PACKAGE_JSON_SHA256") == hashlib.sha256(PACKAGE.read_bytes()).hexdigest()
    assert _installer_constant("PACKAGE_LOCK_SHA256") == hashlib.sha256(LOCK.read_bytes()).hexdigest()


def test_pi_declares_the_node_minimum_the_installer_reads() -> None:
    assert re.fullmatch(r">=\s*\d+\.\d+\.\d+", _lock()["packages"][PI]["engines"]["node"])


def test_the_installer_never_runs_dependency_scripts() -> None:
    text = INSTALL.read_text(encoding="utf-8")
    installs = re.findall(r"npm (?:ci|install)[^\n]*", text)
    assert installs, "the installer no longer installs"
    assert all("--ignore-scripts" in line for line in installs), installs


# ── the installer, with npm faked ────────────────────────────────────────


def _fake_npm(tmp_path: Path, answers: str) -> Path:
    """An npm whose `ci` lays down a pi that prints `answers`."""
    bindir = tmp_path / "fakebin"
    bindir.mkdir(exist_ok=True)
    log = tmp_path / "npm-calls.log"
    npm = bindir / "npm"
    npm.write_text(
        "#!/usr/bin/env bash\n"
        f'echo "$PWD $*" >> "{log}"\n'
        '[ "$1" = ci ] || exit 1\n'
        "mkdir -p node_modules/.bin\n"
        f"printf '#!/usr/bin/env bash\\necho {answers}\\n' > node_modules/.bin/pi\n"
        "chmod +x node_modules/.bin/pi\n",
        encoding="utf-8",
    )
    npm.chmod(0o755)
    return bindir


def _install(tmp_path: Path, bindir: Path, harness: Path = HARNESS,
             node_version: str | None = None) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env["PATH"] = f"{bindir}:{env.get('PATH', '')}"
    env["JHT_PI_PREFIX"] = str(tmp_path / "deps")
    if node_version:
        fake = tmp_path / "node-version.cjs"
        fake.write_text(
            'Object.defineProperty(process, "versions", '
            f'{{value: {{...process.versions, node: "{node_version}"}}}});\n',
            encoding="utf-8",
        )
        env["NODE_OPTIONS"] = f"--require={fake}"
    return subprocess.run([_bash(), str(harness / "install-pi.sh")], capture_output=True,
                          text=True, check=False, env=env)


requires_node = pytest.mark.skipif(shutil.which("node") is None, reason="node required")


@requires_node
def test_a_clean_install_exposes_pi_only_after_it_answers(tmp_path: Path) -> None:
    version = _launcher_version()
    result = _install(tmp_path, _fake_npm(tmp_path, version), node_version="22.22.2")

    assert result.returncode == 0, result.stderr
    link = tmp_path / "deps" / "bin" / "pi"
    target = tmp_path / "deps" / "pi" / version / "node_modules" / ".bin" / "pi"
    assert link.is_symlink() and Path(os.readlink(link)) == target
    calls = (tmp_path / "npm-calls.log").read_text(encoding="utf-8")
    assert "ci --ignore-scripts" in calls
    assert not list((tmp_path / "deps" / "pi").glob(".stage-*"))

    again = _install(tmp_path, _fake_npm(tmp_path, version), node_version="22.22.2")
    assert again.returncode == 0, again.stderr
    assert "already installed" in again.stdout
    assert (tmp_path / "npm-calls.log").read_text(encoding="utf-8").count(" ci ") == 1


@requires_node
def test_a_pi_that_answers_another_version_is_not_exposed(tmp_path: Path) -> None:
    result = _install(tmp_path, _fake_npm(tmp_path, "9.9.9"), node_version="22.22.2")

    assert result.returncode != 0
    assert "does not answer" in result.stderr
    assert not (tmp_path / "deps" / "bin" / "pi").exists()
    assert not list((tmp_path / "deps" / "pi").iterdir())


@requires_node
def test_a_node_older_than_pi_needs_is_refused_before_npm(tmp_path: Path) -> None:
    result = _install(tmp_path, _fake_npm(tmp_path, _launcher_version()), node_version="22.18.0")

    assert result.returncode != 0
    assert "older than the >=22.19.0 pi needs" in result.stderr
    assert not (tmp_path / "npm-calls.log").exists()


@requires_node
@pytest.mark.parametrize("name", ["package.json", "package-lock.json"])
def test_a_changed_file_is_refused_before_npm(tmp_path: Path, name: str) -> None:
    copy = tmp_path / "pi-harness"
    shutil.copytree(HARNESS, copy)
    (copy / name).write_text((copy / name).read_text(encoding="utf-8") + "\n", encoding="utf-8")

    result = _install(tmp_path, _fake_npm(tmp_path, _launcher_version()), harness=copy,
                      node_version="22.22.2")

    assert result.returncode != 0
    assert f"{name} is not the reviewed one" in result.stderr
    assert not (tmp_path / "npm-calls.log").exists()
