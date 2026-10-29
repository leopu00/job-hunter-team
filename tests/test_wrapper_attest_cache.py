"""The attestation cache of the host wrapper (scripts/jht-wrapper.sh, `attest_cache_*`).

Every read of the app attested the container from scratch: `podman info`, `podman-compose ps -q`, a dry run of
podman-compose to recalculate the expected configuration hash, and `podman inspect`. The cache reuses what is
RECALCULATED (the expected line with its hash) and never what is COMPARED: each call still inspects the known id and
compares the whole line, plus the container's identity. These tests run the real wrapper against a fake docker and a
fake podman-compose that log every call.
"""

from __future__ import annotations

import hashlib
import os
import stat
from pathlib import Path
import subprocess

import pytest

from test_desktop_chat_wrapper import _runtime


REPLY = '{"ok":true,"data":{"items":[]}}'


def _panel(tmp_path: Path):
    """The runtime of the other wrapper tests, answering `agent-control` and with the team up."""
    wrapper, env, log = _runtime(tmp_path)
    runtime = Path(env["JHT_RUNTIME_DIR"])
    adapter = runtime / "bin" / "docker"
    source = adapter.read_text(encoding="utf-8")
    anchor = "      node:*)\n"
    assert source.count(anchor) == 1
    exec_arm = '      node:/app/cli/bin/jht.js) printf "%s\\n" \'' + REPLY + "'; exit 0 ;;\n"
    adapter.write_text(source.replace(anchor, exec_arm + anchor), encoding="utf-8")
    manifest = runtime / ".runtime-integrity"
    digest = hashlib.sha256(adapter.read_bytes()).hexdigest()
    manifest.write_text(
        "\n".join(
            f"docker-shim={digest}" if line.startswith("docker-shim=") else line
            for line in manifest.read_text(encoding="utf-8").splitlines()
        )
        + "\n",
        encoding="utf-8",
    )
    env["JHT_TEST_RUNTIME_READY"] = "1"
    return wrapper, env, log, runtime


def _read(wrapper: Path, env: dict[str, str]):
    return subprocess.run([str(wrapper), "agent-control", "list"], env=env, text=True, capture_output=True, timeout=30, check=False)


def _calls(log: Path) -> list[str]:
    return log.read_text(encoding="utf-8").splitlines() if log.exists() else []


def _fresh(log: Path) -> None:
    log.write_text("", encoding="utf-8")


def _complete(calls: list[str]) -> bool:
    """Whether the complete attestation ran: the listing of the project and the recalculation of the hash."""
    return any(c.startswith("podman-compose") and c.endswith(" ps -q") for c in calls) and any(
        c.startswith("podman-compose") and "--dry-run" in c for c in calls
    )


def _cache(runtime: Path) -> Path:
    return runtime / ".attest-cache.jht"


def test_the_first_read_attests_in_full_and_leaves_a_private_cache_in_the_runtime_folder(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    done = _read(wrapper, env)
    assert (done.returncode, done.stdout) == (0, REPLY + "\n"), done.stderr
    assert _complete(_calls(log))
    cache = _cache(runtime)
    assert cache.is_file()
    assert stat.S_IMODE(cache.stat().st_mode) == 0o600
    assert not list(runtime.glob(".attest-cache.*.tmp.*")), "the rename leaves no temporary file"
    # outside every folder the container mounts: ~/.jht and ~/Documents (the HOME of the test) and nothing in them
    home = Path(env["HOME"])
    assert home not in cache.parents
    text = cache.read_text(encoding="utf-8")
    assert text.startswith("v=1\nkey=") and "\nline=jht|true|jht|jht|jht|jht|1|" in text


def test_the_next_read_compares_the_whole_line_and_the_identity_and_recalculates_nothing(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    _read(wrapper, env)
    _fresh(log)
    done = _read(wrapper, env)
    assert (done.returncode, done.stdout) == (0, REPLY + "\n"), done.stderr
    calls = _calls(log)
    assert not _complete(calls)
    assert not any(c.startswith("podman-compose") for c in calls), calls
    assert not any(c == "docker info" for c in calls)
    inspects = [c for c in calls if c.startswith("docker inspect")]
    assert len(inspects) == 1 and "aaaaaaaaaaaa" in inspects[0]
    # the whole line of labels is asked for, and the identity of the container beside it
    assert "io.podman.compose.config-hash" in inspects[0] and inspects[0].endswith("|{{.Id}}|{{.State.StartedAt}}")
    # the exec goes by id
    execs = [c for c in calls if c.startswith("docker exec")]
    assert len(execs) == 1 and "aaaaaaaaaaaa node /app/cli/bin/jht.js agent-control" in execs[0]
    assert _cache(runtime).is_file()


@pytest.mark.parametrize(
    "change, accepted",
    (
        ({"JHT_TEST_STARTED": "2026-10-30T11:00:00Z"}, True),  # restarted: the complete attestation accepts the same labels
        ({"JHT_TEST_FULL_ID": "aaaaaaaaaaaa" + "1" * 52}, True),  # another Id behind the same short id: attested again from scratch
        ({"JHT_TEST_CONTAINER_HASH": "c" * 64}, False),  # the label's hash is no longer the expected one
        ({"JHT_TEST_CONFIG_FILES": "/somewhere/else.yml"}, False),  # config_files differs
    ),
)
def test_a_container_that_is_not_the_attested_one_clears_the_cache_and_the_complete_attestation_decides(tmp_path: Path, change, accepted):
    wrapper, env, log, runtime = _panel(tmp_path)
    _read(wrapper, env)
    before = _cache(runtime).read_text(encoding="utf-8")
    _fresh(log)
    env.update(change)
    done = _read(wrapper, env)
    calls = _calls(log)
    assert _complete(calls), "the complete attestation follows"
    if accepted:
        assert done.returncode == 0 and done.stdout == REPLY + "\n", done.stderr
        # a new cache, written from what was just attested
        assert _cache(runtime).read_text(encoding="utf-8") != before
    else:
        # the complete attestation refuses a line that is not the expected one: no team, no exec, no cache left
        assert done.returncode == 113, done.stderr
        assert not _cache(runtime).exists()
        assert not any(c.startswith("docker exec") for c in calls)


def test_a_cache_that_is_old_or_from_the_future_is_not_used(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    _read(wrapper, env)
    cache = _cache(runtime)
    original = cache.read_text(encoding="utf-8")
    expires = next(int(l.split("=", 1)[1]) for l in original.splitlines() if l.startswith("expires="))
    for forged in (expires - 60, expires + 3600):
        cache.write_text(original.replace(f"expires={expires}", f"expires={forged}"), encoding="utf-8")
        cache.chmod(0o600)
        _fresh(log)
        done = _read(wrapper, env)
        assert done.returncode == 0, done.stderr
        assert _complete(_calls(log)), forged


@pytest.mark.parametrize(
    "variable",
    ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "JHT_LIVE_SCREEN_PORT", "JHT_IMAGE"),
)
def test_a_variable_of_the_callers_environment_that_changes_the_hash_changes_the_key(tmp_path: Path, variable: str):
    wrapper, env, log, _ = _panel(tmp_path)
    _read(wrapper, env)
    _fresh(log)
    env[variable] = "synthetic-value"
    _read(wrapper, env)
    assert _complete(_calls(log))


def test_a_changed_compose_or_runtime_bundle_or_binary_is_not_served_from_the_cache(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    _read(wrapper, env)
    # the binary of podman-compose (identity: path, size, date)
    compose_bin = wrapper.parent / "podman-compose"
    compose_bin.write_text(compose_bin.read_text() + "\n# changed\n", encoding="utf-8")
    _fresh(log)
    _read(wrapper, env)
    assert _complete(_calls(log))
    # the compose file itself: the bundle no longer matches its manifest, so nothing is attested, cache or not
    _read(wrapper, env)
    (runtime / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
    _fresh(log)
    done = _read(wrapper, env)
    assert done.returncode == 113
    assert not any(c.startswith("docker exec") for c in _calls(log))


def test_a_compose_that_changes_the_containers_clears_the_cache_before_and_after(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    _read(wrapper, env)
    assert _cache(runtime).is_file()
    env["JHT_TEST_PS_STATE"] = str(tmp_path / "ps-state")
    done = subprocess.run([str(wrapper), "down"], env=env, text=True, capture_output=True, timeout=30, check=False)
    del done
    assert not _cache(runtime).exists(), "a down leaves no attestation behind"


def test_a_cache_file_that_is_not_the_users_or_is_a_link_is_never_read(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    _read(wrapper, env)
    cache = _cache(runtime)
    cache.chmod(0o666)  # writable by others: not a file the wrapper trusts
    _fresh(log)
    done = _read(wrapper, env)
    assert done.returncode == 0
    assert _complete(_calls(log))
    # a link in its place
    cache.unlink()
    target = tmp_path / "elsewhere"
    target.write_text("v=1\nkey=x\n", encoding="utf-8")
    os.symlink(target, cache)
    _fresh(log)
    done = _read(wrapper, env)
    assert done.returncode == 0
    assert _complete(_calls(log))
    assert target.read_text(encoding="utf-8") == "v=1\nkey=x\n", "what the link leads to is not touched"


@pytest.mark.parametrize(
    "mangle",
    (
        lambda t: t.replace("v=1", "v=2"),
        lambda t: "\n".join(l for l in t.splitlines() if not l.startswith("fullid=")) + "\n",
        lambda t: t.replace("fullid=", "fullid=zz"),
        lambda t: t.replace("id=aaaaaaaaaaaa\n", "id=aaaaaaaaaaaa;touch x\n"),
        lambda t: t.replace("\nline=jht|true|", "\nline=other|true|"),
        lambda t: t.replace("v=1\n", "v=1\nline=jht|true|evil\n", 1),
        lambda t: t.replace("started=", "started=\x01"),
        lambda t: "",
    ),
)
def test_a_cache_file_that_does_not_parse_in_full_is_dropped(tmp_path: Path, mangle):
    wrapper, env, log, runtime = _panel(tmp_path)
    _read(wrapper, env)
    cache = _cache(runtime)
    cache.write_text(mangle(cache.read_text(encoding="utf-8")), encoding="utf-8")
    cache.chmod(0o600)
    _fresh(log)
    done = _read(wrapper, env)
    assert done.returncode == 0, done.stderr
    assert _complete(_calls(log))
    assert not (tmp_path / "x").exists()


def test_a_refused_attestation_never_leaves_a_cache(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    env["JHT_TEST_CONFIG_HASH"] = "d" * 64
    env["JHT_TEST_CONTAINER_HASH"] = "e" * 64  # the container carries a hash other than the expected one
    done = _read(wrapper, env)
    assert done.returncode == 113
    assert not _cache(runtime).exists()


def test_the_cache_is_only_for_the_exact_check_of_podman_and_the_source_says_so():
    source = (Path(__file__).resolve().parents[1] / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    entry = source.split("read_only_service_id() {")[1].split("read_only_service_id_attest() {")[0]
    assert '[ "$CONTAINER_RUNTIME" = podman ] && [ "$config_check" = exact ] && [ "${JHT_ATTEST_CACHE:-1}" != 0 ]' in entry
    # the entry is bundle trust first, the cache second, the complete attestation last
    assert entry.index("runtime_bundle_trusted") < entry.index("attest_cache_lookup") < entry.index("read_only_service_id_attest")
    # no part of the cache path starts, creates or stops anything
    helpers = source.split("attest_inspect_format() {")[1].split("read_only_service_id() {")[0]
    for forbidden in ("compose_file", "ensure_up", "machine start", "docker run", "docker exec", "docker stop", "docker rm"):
        assert forbidden not in helpers, forbidden
    # the cache folder is the runtime's, never the home the container mounts
    path = helpers.split("attest_cache_path() {")[1].split("}")[0]
    assert '"$RUNTIME_DIR"' in path and ".attest-cache." in path
    assert "/.jht" not in path and "Documents" not in path and "JHT_HOME" not in path


def test_the_agents_and_the_broker_each_have_their_own_file_and_do_not_wipe_each_other(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    _read(wrapper, env)
    assert _cache(runtime).is_file()
    # a file for another service name is never created from a name outside the closed charset
    source = (Path(__file__).resolve().parents[1] / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    assert "case \"$service\" in ''|*[!a-z-]*) return 1 ;; esac" in source
    # clearing one service leaves the other's file; a compose that changes the containers clears all of them
    other = runtime / ".attest-cache.jht-broker"
    other.write_text("v=1\n", encoding="utf-8")
    other.chmod(0o600)
    names = lambda: sorted(p.name for p in runtime.glob(".attest-cache.*"))  # noqa: E731
    assert names() == [".attest-cache.jht", ".attest-cache.jht-broker"]


def test_the_switch_turns_the_cache_off_and_nothing_turns_it_on_harder(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    env["JHT_ATTEST_CACHE"] = "0"
    _read(wrapper, env)
    assert not any(runtime.glob(".attest-cache.*")), "off: nothing is written"
    _fresh(log)
    _read(wrapper, env)
    assert _complete(_calls(log)), "off: every read attests in full"
    # on (any other value): the cache is used; the switch has no value that skips the comparison
    env["JHT_ATTEST_CACHE"] = "yes"
    _read(wrapper, env)
    _fresh(log)
    _read(wrapper, env)
    assert not _complete(_calls(log))
    source = (Path(__file__).resolve().parents[1] / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    assert source.count("JHT_ATTEST_CACHE") == 3 and "JHT_ATTEST_CACHE:-1}\" != 0" in source


def test_a_binary_replaced_with_the_same_size_and_date_is_still_another_binary(tmp_path: Path):
    """The identity of podman-compose is path, size, date of modification, inode and change time: a `touch -r` puts the
    date back, the inode and the change time do not come back."""
    wrapper, env, log, runtime = _panel(tmp_path)
    _read(wrapper, env)
    binary = wrapper.parent / "podman-compose"
    before = binary.stat()
    clone = binary.with_name("podman-compose.clone")
    clone.write_bytes(binary.read_bytes())
    clone.chmod(binary.stat().st_mode)
    os.utime(clone, ns=(before.st_atime_ns, before.st_mtime_ns))
    os.replace(clone, binary)
    after = binary.stat()
    assert (after.st_size, after.st_mtime_ns) == (before.st_size, before.st_mtime_ns)
    _fresh(log)
    _read(wrapper, env)
    assert _complete(_calls(log))


def test_no_cache_is_written_or_read_in_or_under_a_folder_the_container_mounts(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    # the runtime folder is under the folder the wrapper is told the container mounts as the home
    env["JHT_HOME_HOST"] = str(runtime.parent)
    done = _read(wrapper, env)
    assert done.returncode == 0, done.stderr
    assert not any(runtime.glob(".attest-cache.*"))
    # and a cache that was there is not read either
    del env["JHT_HOME_HOST"]
    _read(wrapper, env)
    assert _cache(runtime).is_file()
    env["JHT_USER_DIR_HOST"] = str(runtime)
    _fresh(log)
    _read(wrapper, env)
    assert _complete(_calls(log))
    # the home folder of the compose itself
    del env["JHT_USER_DIR_HOST"]
    source = (Path(__file__).resolve().parents[1] / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    guard = source.split("attest_cache_folder_ok() {")[1].split("\n}\n")[0]
    assert '$HOME/.jht' in guard and '$HOME/Documents/Job Hunter Team' in guard and "JHT_HOME_HOST" in guard and "JHT_USER_DIR_HOST" in guard


def test_the_cache_file_is_read_and_written_by_the_same_closed_class_in_the_c_locale():
    """A path may hold any byte but a control character; reading and writing agree, in any locale of the machine."""
    source = (Path(__file__).resolve().parents[1] / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    parse = source.split("attest_cache_parse() {")[1].split("\n}\n")[0]
    assert "local LC_ALL=C" in parse and "*[[:cntrl:]]*) return 1" in parse
    store = source.split("attest_cache_store() {")[1].split("\n}\n")[0]
    assert store.count("LC_ALL=C tr -d '\\040-\\176\\200-\\377'") >= 1
    # the wrapper itself refuses a runtime folder that is not plain ASCII today (with the cache off as well), so a
    # non-ASCII path is not a case that reaches the cache; this only keeps the two sides from disagreeing
    assert "[:print:]" not in parse
