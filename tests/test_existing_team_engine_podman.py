"""The VPS of an existing team may run it on Podman, with no Docker at all.

Every remote script of the VPS view (the discovery that finds the team's container, and
`command()`'s prefix that every later read, chat or judgement goes through) picks the engine
first: Docker when it is there and is Docker, otherwise Podman. Podman answers with other shapes:
the image id is bare (no `sha256:`), there is no `ImageManifestDescriptor` and no
`image inspect --platform`; the index is the image's `.Digest` (the container's `.ImageDigest`)
and the platform manifest is its other RepoDigest of the fixed repository.

The scripts are taken from the Rust sources as they are and run by `sh` against a fake engine
that renders the `--format` templates it is given, the way the engines do, with the shapes a
rootless Podman 5.7 gave on a real VPS (synthetic values). An unknown field fails like Podman:
exit 125. The PATH holds only the fake and `grep`: no engine of this machine (or of a CI runner,
whose /usr/bin has both) is ever reached.
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "desktop" / "src-tauri" / "src"
RUNTIME = (SRC / "existing_team_runtime.rs").read_text(encoding="utf-8")
REGISTER = (SRC / "existing_team_register.rs").read_text(encoding="utf-8")

REPO = "ghcr.io/leopu00/jht"
TEAM = {"cid": "d9" * 32, "image": "f4" * 32, "index": "c9" * 32, "platform": "40" * 32, "revision": "9f" * 20}
NOISE = {"cid": "20" * 32, "image": "aa" * 32}


def _raw_string(source: str, after: str) -> str:
    start = source.index('r#"', source.index(after)) + len('r#"')
    return source[start : source.index('"#', start)]


DISCOVERY = _raw_string(REGISTER, "pub(crate) const DISCOVERY_SCRIPT")
TEMPLATE = _raw_string(RUNTIME, "pub(crate) fn command(")
ENGINE = _raw_string(RUNTIME, "pub(crate) fn engine_selection(")


def render_command(target: dict, operation: str) -> str:
    text = TEMPLATE.replace("{{", "\0").replace("}}", "\1")
    for name, value in target.items():
        text = text.replace("{" + name + "}", value)
    text = text.replace("{engine}", ENGINE.replace("{exit}", "70")).replace("{operation}", "\2")
    assert not re.findall(r"(?<!\$)\{(\w+)\}", text), "a placeholder the test does not know"
    return text.replace("\0", "{").replace("\1", "}").replace("\2", operation)


FAKE = r'''#!@PYTHON@
"""A container engine that renders --format like Go templates, with fixed shapes."""
import json, os, re, sys
args = sys.argv[1:]
d = os.environ["FAKE_DIR"]
with open(os.path.join(d, "calls"), "a") as log:
    log.write(json.dumps(args) + "\n")
engine = os.environ["FAKE_ENGINE"]
world = json.loads(os.environ["FAKE_WORLD"])
if args == ["--version"]:
    print("podman version 5.7.0" if engine == "podman" else "Docker version 27.3.1, build ce12230"); sys.exit(0)
def render(fmt, fields):
    def one(m):
        expr = m.group(1).strip()
        if expr == "range .RepoDigests":
            return "\x00RANGE"
        if expr in ("end", "."):
            return "\x00" + expr
        if expr not in fields:
            sys.stderr.write('Error: template: inspect:1: executing "inspect" at <%s>: can\'t evaluate field\n' % expr)
            sys.exit(125)
        return str(fields[expr])
    out = re.sub(r"\{\{(.*?)\}\}", one, fmt)
    def ranges(m):
        return "".join(m.group(1).replace("\x00.", item) for item in fields["range .RepoDigests"])
    return re.sub("\x00RANGE(.*?)\x00end", ranges, out, flags=re.S)
def fmt_of(a):
    return a[a.index("--format") + 1]
if args[:1] == ["ps"]:
    print("\n".join(c["id"] for c in world["containers"])); sys.exit(0)
if args[:3] == ["inspect", "--type", "container"]:
    c = next((c for c in world["containers"] if c["id"] == args[-1]), None)
    if c is None: sys.exit(125)
    fields = {".Id": c["id"], ".Image": c["image"], ".State.Running": "true",
              'index .Config.Labels "org.opencontainers.image.revision"': c["revision"]}
    if engine == "podman":
        fields[".ImageDigest"] = c["imageDigest"]
    else:
        fields['index .ImageManifestDescriptor "digest"'] = c["descriptor"]
    print(render(fmt_of(args), fields)); sys.exit(0)
if args[:2] == ["image", "inspect"]:
    if "--platform" in args and engine == "podman":
        sys.stderr.write("Error: unknown flag: --platform\n"); sys.exit(125)
    i = next((i for i in world["images"] if i["ref"] == args[-1]), None)
    if i is None: sys.exit(125)
    fields = {".Id": i["platformId"] if "--platform" in args else i["id"], ".Os": "linux", ".Architecture": "amd64",
              'index .Config.Labels "org.opencontainers.image.revision"': i["revision"],
              "range .RepoDigests": i["repoDigests"]}
    if engine == "podman":
        fields[".Digest"] = i["digest"]
    print(render(fmt_of(args), fields)); sys.exit(0)
if args[:1] == ["exec"]:
    print("EXEC " + " ".join(args[1:])); sys.exit(0)
sys.exit(99)
'''


def podman_world():
    return {
        "containers": [
            {"id": NOISE["cid"], "image": NOISE["image"], "revision": "", "imageDigest": "sha256:" + "ab" * 32},
            {"id": TEAM["cid"], "image": TEAM["image"], "revision": TEAM["revision"], "imageDigest": "sha256:" + TEAM["index"]},
        ],
        "images": [
            {"ref": NOISE["image"], "id": NOISE["image"], "revision": "", "repoDigests": ["docker.io/library/redis@sha256:" + "ab" * 32], "digest": "sha256:" + "ab" * 32},
            {"ref": TEAM["image"], "id": TEAM["image"], "revision": TEAM["revision"], "digest": "sha256:" + TEAM["index"],
             "repoDigests": [f"{REPO}@sha256:{TEAM['platform']}", f"{REPO}@sha256:{TEAM['index']}"]},
        ],
    }


def docker_world():
    # the containerd store: the container's image is the index, the descriptor the platform manifest
    index = "sha256:" + TEAM["index"]
    return {
        "containers": [{"id": TEAM["cid"], "image": index, "revision": TEAM["revision"], "descriptor": "sha256:" + TEAM["platform"]}],
        "images": [{"ref": index, "id": index, "platformId": "sha256:" + TEAM["platform"], "revision": TEAM["revision"],
                    "repoDigests": [f"{REPO}@{index}"]}],
    }


@pytest.fixture
def engine_dir(tmp_path):
    if sys.platform == "win32":
        pytest.skip("the scripts run in the VPS shell")
    if not shutil.which("sh") or not shutil.which("grep"):
        pytest.skip("no POSIX shell")
    return tmp_path


def run(tmp_path, script, engine, world, names=None):
    """Runs `script` with only the fake engine (as `names`) and `grep` on the PATH."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    if not (bin_dir / "grep").exists():
        (bin_dir / "grep").symlink_to(shutil.which("grep"))
    for name in names if names is not None else [engine]:
        fake = bin_dir / name
        fake.write_text(FAKE.replace("@PYTHON@", sys.executable), encoding="utf-8")
        fake.chmod(0o755)
    calls = tmp_path / "calls"
    calls.unlink(missing_ok=True)
    env = {"PATH": str(bin_dir), "FAKE_DIR": str(tmp_path), "FAKE_ENGINE": engine, "FAKE_WORLD": __import__("json").dumps(world)}
    result = subprocess.run([shutil.which("sh"), "-c", script], capture_output=True, text=True, env=env, timeout=30)
    logged = [__import__("json").loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
    return result, logged


def test_the_discovery_and_the_commands_choose_the_engine_the_same_way():
    assert ENGINE.replace("{exit}", "71") in DISCOVERY
    assert "{engine}" in TEMPLATE and "engine = engine_selection(70)" in RUNTIME
    # nothing of the VPS view names the engine by hand any more, but the Docker branch of the checks
    for source in (RUNTIME, REGISTER, (SRC / "existing_team_judgement.rs").read_text(encoding="utf-8"),
                   (SRC / "agent_control.rs").read_text(encoding="utf-8"), (SRC / "direct_chat.rs").read_text(encoding="utf-8")):
        code = "\n".join(line for line in source.split("#[cfg(test)]")[0].splitlines() if not line.lstrip().startswith("//"))
        assert "docker exec" not in code
        assert not re.search(r"docker (ps|start|stop|run)\b", code)


def test_podman_discovery_gives_the_team_with_its_three_digests(engine_dir):
    result, calls = run(engine_dir, DISCOVERY, "podman", podman_world())
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert f"P|{TEAM['cid']}|sha256:{TEAM['image']}|true" in lines
    # the image lists only its index as the repository's digest; the platform manifest is its descriptor
    assert f"I|sha256:{TEAM['image']}|linux/amd64|{TEAM['revision']}|{REPO}@sha256:{TEAM['index']}," in lines
    assert f"D|{TEAM['cid']}|sha256:{TEAM['platform']}" in lines
    assert lines[-1] == "END|2|2|1"
    assert not [c for c in calls if "--platform" in c or any("ImageManifestDescriptor" in a for a in c)]


def test_podman_shapes_the_discovery_cannot_attest_give_no_descriptor(engine_dir):
    world = podman_world()
    team = world["images"][1]
    for digests in ([f"{REPO}@sha256:{TEAM['index']}"],  # no platform manifest
                    [f"{REPO}@sha256:{TEAM['platform']}", f"{REPO}@sha256:{'77' * 32}", f"{REPO}@sha256:{TEAM['index']}"]):  # two
        team["repoDigests"] = digests
        result, _ = run(engine_dir, DISCOVERY, "podman", world)
        assert result.returncode == 0, result.stderr
        assert f"D|{TEAM['cid']}|-" in result.stdout.splitlines(), digests


def test_docker_discovery_is_unchanged(engine_dir):
    result, _ = run(engine_dir, DISCOVERY, "docker", docker_world())
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    index = "sha256:" + TEAM["index"]
    assert lines == [
        f"P|{TEAM['cid']}|{index}|true",
        f"I|{index}|linux/amd64|{TEAM['revision']}|{REPO}@{index},",
        f"D|{TEAM['cid']}|sha256:{TEAM['platform']}",
        "END|1|1|1",
    ]


def test_a_docker_that_is_podmans_shim_is_read_as_podman(engine_dir):
    result, _ = run(engine_dir, DISCOVERY, "podman", podman_world(), names=["docker", "podman"])
    assert result.returncode == 0, result.stderr
    assert f"D|{TEAM['cid']}|sha256:{TEAM['platform']}" in result.stdout.splitlines()


def test_with_no_engine_the_scripts_stop_with_their_code(engine_dir):
    result, _ = run(engine_dir, DISCOVERY, "podman", podman_world(), names=[])
    assert result.returncode == 71
    result, _ = run(engine_dir, render_command(podman_target(), 'echo reached'), "podman", podman_world(), names=[])
    assert result.returncode == 70 and "reached" not in result.stdout


def podman_target():
    return {"cid": TEAM["cid"], "image": "sha256:" + TEAM["image"], "platform": "sha256:" + TEAM["platform"],
            "revision": TEAM["revision"], "digest": "sha256:" + TEAM["index"], "os": "linux", "architecture": "amd64"}


OPERATION = 'exec "$JHT_ENGINE" exec -i "$JHT_CID" python3 -I /app/shared/skills/agent_chat.py read \'capitano\''


def test_on_podman_every_command_checks_the_pinned_target_then_runs(engine_dir):
    result, calls = run(engine_dir, render_command(podman_target(), OPERATION), "podman", podman_world())
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == f"EXEC -i {TEAM['cid']} python3 -I /app/shared/skills/agent_chat.py read capitano"
    # no docker on this VPS: not even asked for its version
    assert [c[:2] for c in calls] == [["inspect", "--type"], ["image", "inspect"], ["exec", "-i"]]
    assert not [c for c in calls if "--platform" in c or any("ImageManifestDescriptor" in a for a in c)]


def test_on_podman_a_target_that_changed_never_runs(engine_dir):
    for field, value in (("cid", "11" * 32), ("image", "sha256:" + "12" * 32), ("platform", "sha256:" + "13" * 32),
                         ("revision", "14" * 20), ("digest", "sha256:" + "15" * 32), ("architecture", "arm64")):
        target = {**podman_target(), field: value}
        case = engine_dir / field
        case.mkdir()
        result, calls = run(case, render_command(target, OPERATION), "podman", podman_world())
        assert result.returncode == 70, (field, result.stderr)
        assert not [c for c in calls if c[:1] == ["exec"]], field


def test_on_docker_the_command_still_checks_the_descriptor_and_the_platform(engine_dir):
    index = "sha256:" + TEAM["index"]
    target = {"cid": TEAM["cid"], "image": index, "platform": "sha256:" + TEAM["platform"], "revision": TEAM["revision"],
              "digest": index, "os": "linux", "architecture": "amd64"}
    result, calls = run(engine_dir, render_command(target, OPERATION), "docker", docker_world())
    assert result.returncode == 0, result.stderr
    assert any("--platform" in c for c in calls)
    assert any(any("ImageManifestDescriptor" in a for a in c) for c in calls)
