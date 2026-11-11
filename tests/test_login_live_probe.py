"""The probe of the LinkedIn sign-in (scripts/ci/login_live_probe*.py): what it takes from the compose file, what its scanner sees, and
the run on a real engine when an image is given.

The run for real needs the extras image and an engine (Docker, or Podman on a connection that the test may use):

    JHT_LOGIN_PROBE_IMAGE=jht:extras-check pytest tests/test_login_live_probe.py -k live -v
"""
from __future__ import annotations

import importlib.util
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from live_engines import live_engines  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "scripts" / "ci" / "login_live_probe.py"
INSIDE = ROOT / "scripts" / "ci" / "login_live_probe_inside.py"


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def host():
    return load(HOST, "login_live_probe_host")


@pytest.fixture()
def inside(tmp_path, monkeypatch):
    module = load(INSIDE, "login_live_probe_inside")
    monkeypatch.setattr(module, "WORK", tmp_path / "work")
    module.WORK.mkdir()
    return module


def test_the_probe_starts_the_container_with_the_hardening_the_compose_file_gives_the_browser(host):
    flags = host.hardening_flags(host.service(), without_chroot=False)
    pairs = [(flags[i], flags[i + 1]) for i in range(len(flags) - 1)]
    assert ("--network", "none") in pairs and ("--user", "1001:1001") in pairs
    assert "--read-only" in flags and ("--cap-drop", "ALL") in pairs and ("--cap-add", "SYS_CHROOT") in pairs
    assert ("--security-opt", "no-new-privileges") in pairs
    assert ("--pids-limit", "512") in pairs


def test_without_chroot_is_the_same_container_minus_that_one_capability(host):
    with_it = host.hardening_flags(host.service(), without_chroot=False)
    without = host.hardening_flags(host.service(), without_chroot=True)
    removed = [with_it[i:i + 2] for i in range(len(with_it) - 1) if with_it[i] == "--cap-add"]
    assert removed == [["--cap-add", "SYS_CHROOT"]]
    assert [a for a in with_it if a != "SYS_CHROOT" and a != "--cap-add"] == without


def test_the_probe_never_asks_for_more_than_the_service_has(host):
    flags = " ".join(host.hardening_flags(host.service(), without_chroot=False))
    for forbidden in ("--privileged", "--cap-add ALL", "--cap-add SYS_ADMIN", "--no-sandbox", "seccomp=unconfined", "--network host"):
        assert forbidden not in flags


def test_the_scanner_sees_a_planted_row_and_marker_and_passes_a_clean_folder(inside):
    verdict = inside.Verdict()
    inside.control_scanner(verdict)
    assert verdict.failed == 0
    clean = inside.WORK / "clean"
    (clean / "Default").mkdir(parents=True)
    for name, table in (("Login Data", "logins"), ("Web Data", "keywords")):
        connection = sqlite3.connect(clean / "Default" / name)
        connection.execute(f"CREATE TABLE {table} (value TEXT)")
        if table == "keywords":
            connection.execute("INSERT INTO keywords VALUES ('a search engine')")  # Web Data always has these: not a personal table
        connection.commit()
        connection.close()
    verdict = inside.Verdict()
    inside.scan_profile(clean, "someone-0123456789", "pw-0123456789abcdef", verdict)
    assert verdict.failed == 0


@pytest.mark.parametrize("name,table", [("Login Data", "logins"), ("Web Data", "autofill"), ("Web Data", "credit_cards"),
                                        ("Web Data", "autofill_profiles"), ("Login Data", "insecure_credentials")])
def test_a_row_in_a_table_of_saved_data_turns_the_result_red(inside, name, table):
    folder = inside.WORK / "dirty"
    (folder / "Default").mkdir(parents=True)
    connection = sqlite3.connect(folder / "Default" / name)
    connection.execute(f"CREATE TABLE {table} (value TEXT)")
    connection.execute(f"INSERT INTO {table} VALUES ('x')")
    connection.commit()
    connection.close()
    verdict = inside.Verdict()
    inside.scan_profile(folder, "someone-0123456789", "pw-0123456789abcdef", verdict)
    assert verdict.failed == 1


def test_the_password_in_any_file_of_the_profile_turns_the_result_red(inside):
    folder = inside.WORK / "leak"
    (folder / "Default" / "Local Storage").mkdir(parents=True)
    (folder / "Default" / "Local Storage" / "leveldb.log").write_bytes(b"\x00junk pw-0123456789abcdef junk")
    verdict = inside.Verdict()
    inside.scan_profile(folder, "someone-0123456789", "pw-0123456789abcdef", verdict)
    assert verdict.failed == 1


def test_the_user_name_in_the_form_history_turns_the_result_red_in_either_encoding(inside):
    for encoding, name in (("utf-8", "Web Data-journal"), ("utf-16-le", "Web Data-journal")):
        folder = inside.WORK / f"leak-{encoding}"
        (folder / "Default").mkdir(parents=True)
        (folder / "Default" / name).write_bytes("someone-0123456789".encode(encoding))
        verdict = inside.Verdict()
        inside.scan_profile(folder, "someone-0123456789", "pw-0123456789abcdef", verdict)
        assert verdict.failed == 1, encoding


def test_the_user_name_in_the_restore_state_of_the_browser_turns_the_result_red(inside):
    folder = inside.WORK / "restore"
    (folder / "Default" / "Sessions").mkdir(parents=True)
    (folder / "Default" / "Sessions" / "Session_1").write_bytes(b"x someone-0123456789 x")
    verdict = inside.Verdict()
    inside.scan_profile(folder, "someone-0123456789", "pw-0123456789abcdef", verdict)
    assert verdict.failed == 1


def test_the_scan_of_a_real_profile_prints_counts_and_names_and_never_a_value(inside, tmp_path, capsys, monkeypatch):
    profile = tmp_path / "real-profile"
    (profile / "Default" / "Network").mkdir(parents=True)
    connection = sqlite3.connect(profile / "Default" / "Network" / "Cookies")
    connection.execute("CREATE TABLE cookies (name TEXT, value TEXT)")
    connection.execute("INSERT INTO cookies VALUES ('li_at', 'a-secret-cookie-value')")
    connection.commit()
    connection.close()
    for name, table in (("Login Data", "logins"), ("Web Data", "keywords")):
        connection = sqlite3.connect(profile / "Default" / name)
        connection.execute(f"CREATE TABLE {table} (value TEXT)")
        connection.commit()
        connection.close()
    import io
    monkeypatch.setattr(sys, "stdin", io.StringIO("not-in-any-file\n"))
    assert inside.main(["--scan", str(profile), "--secret-stdin"]) == 0
    out = capsys.readouterr().out
    assert "RESULT [scan] OK" in out and "li_at" in out
    assert "a-secret-cookie-value" not in out and "not-in-any-file" not in out
    assert not list(Path(tempfile.gettempdir()).glob("jht-scan-*"))  # the copies are gone


def test_the_scan_of_a_real_profile_is_red_for_a_saved_login_the_secret_and_the_restore_state(inside, tmp_path, monkeypatch, capsys):
    profile = tmp_path / "real-profile"
    (profile / "Default" / "Sessions").mkdir(parents=True)
    (profile / "Default" / "Sessions" / "Session_1").write_bytes(b"x")
    (profile / "Default" / "leak").write_bytes(b"x correct-horse-battery x")
    connection = sqlite3.connect(profile / "Default" / "Login Data")
    connection.execute("CREATE TABLE logins (value TEXT)")
    connection.execute("INSERT INTO logins VALUES ('x')")
    connection.commit()
    connection.close()
    import io
    monkeypatch.setattr(sys, "stdin", io.StringIO("correct-horse-battery\n"))
    assert inside.main(["--scan", str(profile), "--secret-stdin"]) == 1
    out = capsys.readouterr().out
    assert out.count("FAIL [") == 3 and "correct-horse-battery" not in out


def test_the_browser_command_keeps_every_flag_of_the_image_and_only_swaps_the_network_ones(inside, monkeypatch):
    sys.path.insert(0, str(ROOT / "shared" / "login"))
    try:
        import login_session
    finally:
        sys.path.remove(str(ROOT / "shared" / "login"))
    real = login_session.chromium_command("/p")
    patched = inside.patched_command(login_session, "SPKI")("/p")
    assert patched[-1] == real[-1] == login_session.START_URL
    assert not any("no-sandbox" in a for a in patched)
    dropped = [a for a in real if a not in patched]
    assert all(a.startswith(("--proxy-server=", "--host-resolver-rules=")) for a in dropped)
    added = [a for a in patched if a not in real]
    assert len(added) == 3
    assert any(a == "--host-resolver-rules=MAP www.linkedin.com 127.0.0.1:8443, MAP * ~NOTFOUND" for a in added)
    assert any(a.startswith("--ignore-certificate-errors-spki-list=") for a in added)


def test_the_page_of_our_own_sets_the_cookie_the_watcher_looks_for(inside):
    sys.path.insert(0, str(ROOT / "shared" / "login"))
    try:
        import login_session
    finally:
        sys.path.remove(str(ROOT / "shared" / "login"))
    handler = inside.FakeLinkedIn
    assert login_session.COOKIE_NAME == "li_at"
    source = INSIDE.read_text(encoding="utf-8")
    assert f"{login_session.COOKIE_NAME}=fake-" in source and f"Domain=.{login_session.COOKIE_HOST_SUFFIX}" in source
    assert handler.do_POST and handler.do_GET


def test_a_profile_dir_with_things_in_it_is_never_written_to_or_emptied(host, tmp_path):
    """The probe makes a NEW folder inside the one it is given; what was there stays, and only the new one is mounted and emptied."""
    parent = tmp_path / "profile-of-someone"
    parent.mkdir()
    (parent / "precious").write_text("keep me")
    (parent / "Default").mkdir()
    (parent / "Default" / "Cookies").write_text("keep me too")
    log = tmp_path / "calls.txt"
    engine = tmp_path / "fake-engine"
    engine.write_text(f"#!/bin/sh\nprintf '%s\\n' \"$*\" >> {log}\necho 'RESULT [probe] OK'\n")
    engine.chmod(0o755)
    probe = host.Probe([str(engine)], "image:test", str(parent))
    code, output = probe.run()
    assert code == 0 and "RESULT [probe] OK" in output
    assert (parent / "precious").read_text() == "keep me" and (parent / "Default" / "Cookies").read_text() == "keep me too"
    calls = log.read_text().splitlines()
    mounts = [word for call in calls for word in call.split() if word.endswith(":/p") or word.endswith(":/linkedin-profile")]
    assert mounts, calls
    for mount in mounts:
        source = mount.rsplit(":", 1)[0]
        assert source != str(parent) and source.startswith(str(parent) + "/jht-login-probe-")
    assert [p.name for p in parent.iterdir() if p.name.startswith("jht-login-probe-")] == []  # its own folder is gone (the fake left it empty)


def test_a_diagnosis_run_adds_its_looser_flags_to_that_run_only_and_asks_for_the_syscall_report(host, tmp_path):
    log = tmp_path / "calls.txt"
    engine = tmp_path / "fake-engine"
    engine.write_text(f"#!/bin/sh\nprintf '%s\\n' \"$*\" >> {log}\n")
    engine.chmod(0o755)
    probe = host.Probe([str(engine)], "image:test", None)
    probe.run(extra=("--security-opt", "seccomp=unconfined"), mode=("--syscalls",))
    probe.run()
    runs = [line for line in log.read_text().splitlines() if line.startswith("run --rm --name ") and "inside.py" in line]
    assert len(runs) == 2
    assert "seccomp=unconfined" in runs[0] and runs[0].endswith("inside.py --syscalls") and "--no-chroot" not in runs[0]
    assert "seccomp=unconfined" not in runs[1] and "--syscalls" not in runs[1] and "--profile /linkedin-profile" in runs[1]


@pytest.mark.parametrize("kind", ["missing", "file", "link"])
def test_a_profile_dir_that_is_not_a_real_folder_is_refused_before_anything_starts(host, tmp_path, kind):
    target = tmp_path / "x"
    if kind == "file":
        target.write_text("not a folder")
    elif kind == "link":
        real = tmp_path / "real"
        real.mkdir()
        target.symlink_to(real)
    probe = host.Probe(["false"], "image:test", str(target))
    with pytest.raises(ValueError):
        probe.make_profile_dir()


def test_the_command_line_refuses_a_bad_profile_dir_with_exit_2(tmp_path):
    import subprocess

    done = subprocess.run([sys.executable, str(HOST), "image:test", "--engine", "docker", "--profile-dir", str(tmp_path / "nope")],
                          capture_output=True, text=True, timeout=60)
    assert done.returncode == 2 and "existing folder" in done.stderr


# ── the run for real ──────────────────────────────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(not os.environ.get("JHT_LOGIN_PROBE_IMAGE"), reason="JHT_LOGIN_PROBE_IMAGE is not set (the extras image to probe)")
@pytest.mark.parametrize("engine", live_engines())
def test_live_the_browser_is_sandboxed_and_keeps_nothing_of_the_sign_in(engine):
    import subprocess

    image = os.environ["JHT_LOGIN_PROBE_IMAGE"]
    connection = os.environ.get("JHT_PODMAN_TEST_CONNECTION", "") if engine == "podman" else ""
    result = subprocess.run([sys.executable, str(HOST), image, "--engine", engine, "--connection", connection, "--controls"],
                            capture_output=True, text=True, timeout=1200)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "RESULT: OK" in result.stdout
