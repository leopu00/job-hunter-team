"""Two container-engine traps reported by Home Hunter Team on 09/10/2026.

1. Podman 6 over a remote connection exits 125, not 1, when `inspect` asks
   for an object that does not exist. Code that reads «exit 1» as «absent»
   would see an error instead and never decide. Nothing in JHT does it today:
   everything treats any non-zero exit as «absent» or «not attestable». The
   guard below keeps it that way.

2. The JHT image declares `VOLUME ["/jht_home", "/jht_user"]`. A container
   that does not mount those paths gets one anonymous volume per path, and a
   `rm` without `-v` (or a `compose down` without `-v`) leaves them on the
   disk. jht-broker was such a service; the throwaway test containers were
   removed with `rm -f` alone.
"""

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


# ── 2a. Compose: every service on the JHT image covers its VOLUME paths ─────
class _TolerantLoader(yaml.SafeLoader):
    """Compose tags such as `!reset` are not YAML the safe loader knows."""


_TolerantLoader.add_multi_constructor(
    "!", lambda loader, suffix, node: loader.construct_sequence(node)
    if isinstance(node, yaml.SequenceNode) else None)


def image_volume_paths() -> list:
    text = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    paths = []
    for match in re.finditer(r"^VOLUME\s+(\[.*?\])", text, re.MULTILINE):
        paths.extend(yaml.safe_load(match.group(1)))
    return paths


def _target(entry) -> str:
    if isinstance(entry, dict):
        return str(entry.get("target") or "")
    parts = str(entry).split(":")
    return parts[1] if len(parts) > 1 else parts[0]


def uncovered_paths(compose_text: str, paths: list) -> dict:
    """{service: [VOLUME paths with no volume, bind or tmpfs]} for JHT-image services."""
    data = yaml.load(compose_text, Loader=_TolerantLoader) or {}
    out = {}
    for name, service in (data.get("services") or {}).items():
        image = str((service or {}).get("image") or "")
        if "leopu00/jht" not in image:
            continue
        covered = {_target(v) for v in service.get("volumes") or []}
        covered |= {str(t).split(":")[0] for t in service.get("tmpfs") or []}
        missing = [p for p in paths if p not in covered]
        out[name] = missing
    return out


def test_the_image_still_declares_the_two_volumes():
    # If this changes, the checks below follow the Dockerfile, not a copy.
    assert image_volume_paths() == ["/jht_home", "/jht_user"]


def test_every_compose_service_on_the_jht_image_mounts_its_volume_paths():
    result = uncovered_paths((ROOT / "docker-compose.yml").read_text(encoding="utf-8"),
                             image_volume_paths())
    # jht, jht-broker, jht-telegram: a search that finds none proves nothing.
    assert len(result) >= 3, result
    assert {name: missing for name, missing in result.items() if missing} == {}


def test_the_compose_check_catches_a_service_that_leaves_them_anonymous():
    compose = """
services:
  jht-broker:
    image: ghcr.io/leopu00/jht@sha256:abc
    volumes:
      - jht-secrets:/jht_secrets
    tmpfs:
      - /tmp
"""
    assert uncovered_paths(compose, ["/jht_home", "/jht_user"]) == {
        "jht-broker": ["/jht_home", "/jht_user"]}


# ── 2b. Throwaway containers are removed with their anonymous volumes ───────
FORCED_RM = re.compile(r'"rm",\s*"(?:-f|--force)"(?P<rest>[^)\]]*)')


def forced_container_removals(text: str) -> list:
    """Forced `rm` calls that are not `volume rm`, with what follows them."""
    found = []
    for match in FORCED_RM.finditer(text):
        before = text[max(0, match.start() - 12):match.start()]
        if '"volume",' in before:
            continue
        found.append(match.group(0))
    return found


def _removes_volumes(call: str) -> bool:
    return '"-v"' in call or '"--volumes"' in call


def test_throwaway_containers_are_removed_with_their_anonymous_volumes():
    files = sorted((ROOT / "tests").glob("*.py")) + [ROOT / "scripts/ci/broker_smoke.py"]
    calls = {}
    for path in files:
        if path.name == Path(__file__).name:
            continue
        for call in forced_container_removals(path.read_text(encoding="utf-8")):
            calls.setdefault(path.name, []).append(call)
    assert sum(len(v) for v in calls.values()) >= 10, calls
    leaking = {name: [c for c in found if not _removes_volumes(c)]
               for name, found in calls.items()}
    assert {name: c for name, c in leaking.items() if c} == {}


def test_the_rm_check_catches_a_forced_rm_without_volumes():
    found = forced_container_removals(
        'docker("rm", "-f", broker)\ndocker("volume", "rm", "-f", vol)\n')
    assert found and not _removes_volumes(found[0])
    assert len(found) == 1, "volume rm is not a container rm"


# ── 1. «Absent» is never read from exit code 1 of inspect or exists ─────────
ENGINE_PROBE = re.compile(
    r"(docker|podman|\$Podman|\$PodmanPath|\bpm\b|engine)[^\n]{0,80}\b(inspect|exists)\b",
    re.IGNORECASE)
# Only exit-code expressions: `$x.Count -ne 1` counts items, it is not a status.
EXIT_ONE = re.compile(
    r"(LASTEXITCODE|\$\?|\bstatus\b|returncode|code\(\)|\brc\b|exit_?code)"
    r"\s*(-eq|-ne|==|!=|===|!==|=)\s*1\b(?!\d)|Some\(1\)")
SOURCES = (
    "scripts/*.sh", "scripts/*.ps1", ".launcher/*.sh", ".launcher/*.py",
    "cli/src/**/*.js", "desktop/src-tauri/src/*.rs", "scripts/ci/*.py",
)


def exit_one_after_probe(text: str, window: int = 3) -> list:
    lines = text.splitlines()
    hits, probes = [], 0
    for i, line in enumerate(lines):
        if not ENGINE_PROBE.search(line):
            continue
        probes += 1
        for j in range(i, min(len(lines), i + window + 1)):
            if EXIT_ONE.search(lines[j]):
                hits.append((i + 1, lines[j].strip()))
                break
    return hits, probes


def test_no_code_reads_absent_from_exit_code_one_of_inspect_or_exists():
    total, hits = 0, {}
    for pattern in SOURCES:
        for path in sorted(ROOT.glob(pattern)):
            found, probes = exit_one_after_probe(path.read_text(encoding="utf-8", errors="replace"))
            total += probes
            if found:
                hits[str(path.relative_to(ROOT))] = found
    assert total >= 15, f"only {total} inspect/exists calls scanned: the search is broken"
    assert hits == {}, (
        "Podman 6 remote exits 125 for an absent object: treat any non-zero "
        f"exit (or `exists`) as absent, never exit 1 alone: {hits}")


def test_the_exit_code_check_catches_the_podman_6_trap():
    snippet = ('podman inspect jht-broker >/dev/null 2>&1\n'
               'if [ $? -eq 1 ]; then echo absent; fi\n'
               '& docker inspect jht *> $null\n'
               'if ($LASTEXITCODE -eq 1) { $absent = $true }\n'
               '$items = @(& docker inspect jht | ConvertFrom-Json)\n'
               'if ($items.Count -ne 1) { throw "two" }\n')
    hits, probes = exit_one_after_probe(snippet)
    assert probes == 3
    assert [line for line, _ in hits] == [1, 3], hits
