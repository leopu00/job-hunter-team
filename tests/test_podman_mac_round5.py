"""What the fifth Mac round with Podman (package 22) left: jht screen off, the raw lines of jht down, the language of the repair.

- `jht screen off`: the screen's container stopped, yet podman-compose's stop/rm answered non-zero, the command said «il container dello
  schermo non si ferma» rc 1 and the screen stayed «chiesto acceso ma spento». Now what counts is what is left of the service.
- `jht down`: Podman 6 says «Error: no container with ID or name 'jht-media' found: no such container», one line per absent service
  (8 to 11 before «stopped»); the filter knew only «with name or ID "…"».
- The repair of a damaged image spoke English on a host with no setup made (English by default): with Italian chosen it speaks Italian.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from test_podman_compose_exact_version_boundary import WRAPPER, _wrapper_functions

INTEGRATION = WRAPPER.parent / "jht-integration.sh"


def _integration_function(name: str) -> str:
    match = re.search(rf"^{name}\(\) \{{.*?\n^\}}\n", INTEGRATION.read_text(encoding="utf-8"), re.S | re.M)
    assert match, name
    return match.group(0)


# ── jht down: the raw lines ──

def test_both_wordings_of_an_absent_service_are_kept_out_of_sight():
    said = "\n".join([
        "Error: no container with ID or name 'jht-media' found: no such container",
        "Error: no container with ID or name 'jht-screen' found",
        'Error: no container with name or ID "jht-telegram" found: no such container',
        "Error: no container with ID or name 'jht' found: no such container",
        "Error: no container with ID or name 'jht-media' found: and then something else",
        "Error: something else",
    ]) + "\n"
    result = subprocess.run(["bash", "-c", _wrapper_functions("compose_noise_filter") + "\ncompose_noise_filter"],
                            input=said, capture_output=True, text=True, timeout=30)
    assert result.stdout.splitlines() == [
        "Error: no container with ID or name 'jht' found: no such container",  # the team itself is never hidden
        "Error: no container with ID or name 'jht-media' found: and then something else",
        "Error: something else",
    ]


# ── jht screen off / integration remove media ──

def _remove(tmp_path: Path, lookups: list[str], *, compose_rc=1, docker_rc=0):
    log = tmp_path / "calls.log"
    answers = tmp_path / "answers"
    answers.write_text("\n".join(lookups) + "\n", encoding="utf-8")
    script = f"""
set -u
compose() {{ echo "compose $*" >> "{log}"; return {compose_rc}; }}
docker() {{ echo "docker $*" >> "{log}"; return {docker_rc}; }}
read_only_service_id() {{
  echo "lookup $*" >> "{log}"
  answer="$(head -n 1 "{answers}")"; sed -i.bak 1d "{answers}"
  case "$answer" in absent) return 3 ;; refused) return 1 ;; *) printf '%s\\n' "$answer" ;; esac
}}
{_integration_function("integration_stop_remove")}
integration_stop_remove jht-screen screen; echo "rc=$?"
"""
    result = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
    return result.stdout, log.read_text(encoding="utf-8").splitlines()


def test_a_container_gone_is_done_whatever_compose_answered(tmp_path: Path):
    out, calls = _remove(tmp_path, ["absent"])
    assert "rc=0" in out
    assert calls[:2] == ["compose stop jht-screen", "compose rm -f jht-screen"]
    assert calls[2] == "lookup jht-screen any-config" and not any(c.startswith("docker") for c in calls)


def test_a_container_of_ours_left_stopped_is_removed_by_its_id(tmp_path: Path):
    out, calls = _remove(tmp_path, ["b" * 64, "absent"])
    assert "rc=0" in out
    assert f"docker rm -f {'b' * 64}" in calls


def test_a_container_that_cannot_be_attested_is_never_touched(tmp_path: Path):
    out, calls = _remove(tmp_path, ["refused"])
    assert "rc=1" in out
    assert not any(c.startswith("docker") for c in calls)


def test_a_container_that_will_not_go_is_still_a_failure(tmp_path: Path):
    out, _ = _remove(tmp_path, ["b" * 64, "b" * 64])
    assert "rc=1" in out
    other = tmp_path / "docker-refuses"
    other.mkdir()
    out, _ = _remove(other, ["b" * 64], docker_rc=1)
    assert "rc=1" in out


def test_screen_and_media_go_through_it():
    remove = _integration_function("integration_do_remove")
    assert 'integration_stop_remove "$SCREEN_SERVICE" screen' in remove
    assert 'integration_stop_remove "$MEDIA_SERVICE" media' in remove


# ── the language of the repair ──

def _say(lang: str, key: str) -> str:
    script = (_wrapper_functions("jht_text_en", "jht_text_it", "jht_say")
              + f"\nJHT_SAY_LANG={lang}\njht_say {key}\n")
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30).stdout


def test_the_repair_speaks_the_language_the_person_chose():
    for key in ("up.storage_damaged", "up.storage_repair_failed", "down.still_running"):
        italian, english = _say("it", key), _say("en", key)
        assert italian and english and italian != english, key
    assert "L'immagine del team si e' rovinata" in _say("it", "up.storage_damaged")
