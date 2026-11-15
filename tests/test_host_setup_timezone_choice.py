"""The host preflight helps the person choose their timezone.

It used to ask «Timezone [Etc/UTC]:» and take only an IANA name typed by hand, falling back to UTC in silence on anything else.
Now it proposes the zone saved before or the one of the machine (Enter keeps it), and otherwise the person types a country, a city
or a zone and picks from a short numbered list; what is not a zone is asked again, never UTC in silence. These runs use a small
fake zoneinfo folder (JHT_ZONEINFO_DIR) and a fake /etc/localtime (JHT_LOCALTIME), and the real script at a terminal.
"""

from __future__ import annotations

import os
import re
import select
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from host_setup_texts import HOST_SETUP, LANGUAGES, catalog  # noqa: E402

ANSI = re.compile(r"\x1b\[[0-9;]*m")
ZONES = [
    ("IT", "Europe/Rome"), ("DE", "Europe/Berlin"), ("DE", "Europe/Busingen"), ("ES", "Europe/Madrid"),
    ("ES", "Africa/Ceuta"), ("ES", "Atlantic/Canary"), ("HU", "Europe/Budapest"), ("PT", "Europe/Lisbon"),
    ("US", "America/New_York"), ("US", "America/Chicago"), ("US", "America/Denver"), ("US", "America/Los_Angeles"),
    ("US", "America/Phoenix"), ("US", "America/Anchorage"), ("US", "Pacific/Honolulu"), ("US", "America/Detroit"),
    ("US", "America/Boise"), ("US", "America/Juneau"), ("RO", "Europe/Bucharest"),
    ("PT", "Atlantic/Madeira"), ("PT", "Atlantic/Azores"), ("AS", "Pacific/Pago_Pago"),
]
COUNTRIES = [("IT", "Italy"), ("DE", "Germany"), ("ES", "Spain"), ("HU", "Hungary"), ("PT", "Portugal"),
             ("US", "United States"), ("RO", "Romania"), ("AS", "American Samoa")]


@pytest.fixture
def zoneinfo(tmp_path):
    folder = tmp_path / "zoneinfo"
    folder.mkdir()
    (folder / "zone.tab").write_text("# fake\n" + "".join(f"{cc}\t+0000+00000\t{zone}\n" for cc, zone in ZONES), encoding="utf-8")
    (folder / "iso3166.tab").write_text("# fake\n" + "".join(f"{cc}\t{name}\n" for cc, name in COUNTRIES), encoding="utf-8")
    for _, zone in ZONES:
        path = folder / zone
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"TZif2" + b"\0" * 40)
    (folder / "NotAZone").write_bytes(b"something else")
    # an old name kept as a link (the «backward» file): a real TZif, but never a result
    (folder / "Portugal").write_bytes(b"TZif2" + b"\0" * 40)
    return folder


def _run(tmp_path, zoneinfo, answers, *, lang="en", detected="Europe/Rome", saved=None, host="1", extra=None):
    pty = pytest.importorskip("pty")
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True, exist_ok=True)
    if saved:
        (home / ".jht" / "host.env").write_text(f"JHT_LANG={lang}\nJHT_HOST_TYPE=local\nJHT_USER_TZ={saved}\n", encoding="utf-8")
    localtime = tmp_path / "localtime"
    if detected:
        localtime.symlink_to(zoneinfo / detected)
    env = {k: v for k, v in os.environ.items() if k not in {"LANG", "LC_ALL", "LC_MESSAGES", "JHT_LANG", "JHT_USER_TZ", "DISPLAY", "WAYLAND_DISPLAY"}}
    env.update({"HOME": str(home), "PATH": "/usr/bin:/bin", "LANG": "C", "TERM": "dumb", "JHT_LANG": lang,
                "JHT_ZONEINFO_DIR": str(zoneinfo), "JHT_LOCALTIME": str(localtime), "JHT_RUNTIME_DIR": str(tmp_path / "runtime")})
    env.update(extra or {})
    (tmp_path / "runtime").mkdir(exist_ok=True)
    pid, fd = pty.fork()
    if pid == 0:
        os.execve("/bin/bash", ["bash", str(HOST_SETUP)], env)
    # the picker (the language), the host type, then the answers of the timezone
    pending = [f"{LANGUAGES.index(lang) + 1}\n".encode(), f"{host}\n".encode(), *[a.encode() + b"\n" for a in answers]]
    out = b""
    deadline = time.time() + 60
    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], 1)
        if not ready:
            continue
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
        if out.endswith(b": ") and pending:
            os.write(fd, pending.pop(0))
    _, status = os.waitpid(pid, 0)
    text = ANSI.sub("", out.decode("utf-8", "replace"))
    saved_env = (home / ".jht" / "host.env").read_text(encoding="utf-8") if (home / ".jht" / "host.env").exists() else ""
    return os.waitstatus_to_exitcode(status), text, saved_env, pending


def _tz(saved_env: str) -> str:
    return re.search(r"^JHT_USER_TZ=(.*)$", saved_env, re.M).group(1)


pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the host preflight runs on Linux and macOS")


def test_enter_keeps_the_zone_of_the_machine(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, [""])
    assert code == 0 and not left, out
    assert "Proposed: Europe/Rome" in out and _tz(saved) == "Europe/Rome"


def test_a_city_in_the_person_s_language_proposes_its_zone_and_enter_takes_it(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["München", ""], detected="Europe/Rome")
    assert code == 0 and not left, out
    assert "Proposed: Europe/Berlin" in out and _tz(saved) == "Europe/Berlin"


def test_a_country_with_some_zones_gives_a_numbered_list_with_the_time_of_each(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["España", "3"])
    assert code == 0 and not left, out
    assert re.search(r"1\) Europe/Madrid  \(\d\d:\d\d\)", out) and "3) Atlantic/Canary" in out, out
    assert _tz(saved) == "Atlantic/Canary"


def test_a_country_with_too_many_zones_asks_for_something_more_precise(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["Stati Uniti", "new york", ""])
    assert code == 0 and not left, out
    assert "timezones match «Stati Uniti»" in out and _tz(saved) == "America/New_York"


def test_what_is_not_a_zone_is_asked_again_and_never_becomes_utc(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["xyzzy", "NotAZone", "Rome", ""], detected=None)
    assert code == 0 and not left, out
    assert "No timezone found for «xyzzy»" in out and "No timezone found for «NotAZone»" in out
    assert "Your timezone was not detected." in out and _tz(saved) == "Europe/Rome"


def test_with_nothing_detected_enter_alone_does_not_pick_utc(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["", "Lisboa", ""], detected=None)
    assert code == 0 and not left, out
    assert _tz(saved) == "Europe/Lisbon"


def test_utc_is_taken_only_when_it_is_typed(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["UTC"])
    assert code == 0 and not left, out
    assert _tz(saved) == "UTC"


def test_a_number_from_the_list_and_a_number_out_of_it(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["Germany", "7", "Germany", "1"])
    assert code == 0 and not left, out
    assert "Choose a number between 1 and 2." in out and _tz(saved) == "Europe/Berlin"


def test_a_new_search_typed_after_the_list_starts_again(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["Germany", "Budapest", ""])
    assert code == 0 and not left, out
    assert "Proposed: Europe/Budapest" in out and _tz(saved) == "Europe/Budapest"


def test_a_saved_zone_other_than_the_machine_s_shows_both_and_enter_keeps_the_saved_one(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, [""], detected="Europe/Rome", saved="America/Chicago")
    assert code == 0 and not left, out
    assert re.search(r"Saved: America/Chicago \(now \d\d:\d\d\) · Detected now: Europe/Rome \(now \d\d:\d\d\)", out), out
    assert _tz(saved) == "America/Chicago"


@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_choice_speaks_the_language_chosen(tmp_path, zoneinfo, lang):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["xyzzy", ""], lang=lang)
    assert code == 0 and not left, out
    said = catalog(lang)
    after = out.split("Language / Lingua", 1)[1]
    for key in ("host_setup.timezone_header", "host_setup.timezone_explain"):
        assert said[key] in after, (lang, key, out)
    assert said["host_setup.tz.none"].replace("%s", "xyzzy") in after, (lang, out)
    assert said["host_setup.tz.how_default"].replace("%s", "Europe/Rome") in after, (lang, out)


def test_a_part_of_a_name_is_never_proposed_alone_america_is_too_many(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["America", ""])
    assert code == 0 and not left, out
    assert "timezones match «America»" in out and "Proposed: Pacific/Pago_Pago" not in out, out
    assert _tz(saved) == "Europe/Rome"


def test_a_single_zone_found_by_a_part_of_its_name_is_a_list_of_one_to_pick(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["Samo", "1"])
    assert code == 0 and not left, out
    assert "1) Pacific/Pago_Pago" in out and "Proposed: Pacific/Pago_Pago" not in out, out
    assert _tz(saved) == "Pacific/Pago_Pago"


def test_portugal_is_the_country_with_its_three_zones_not_the_old_link(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["Portugal", "2"])
    assert code == 0 and not left, out
    assert "1) Europe/Lisbon" in out and "2) Atlantic/Madeira" in out and "3) Atlantic/Azores" in out, out
    assert "Proposed: Portugal" not in out and _tz(saved) == "Atlantic/Madeira"


def test_a_search_typed_at_the_prompt_of_the_number_starts_on_a_line_of_its_own(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["Germany", "Budapest", ""])
    assert code == 0 and not left, out
    # the next thing said is the proposal, not a prompt left without its answer
    assert not re.search(r"\]: *Proposed", out), out
    assert re.search(r"a new search: Budapest\r?\nProposed: Europe/Budapest", out), out


def test_the_search_writes_no_file_in_a_shared_temporary_folder(tmp_path, zoneinfo):
    """A name like /tmp/jht-tz-names.<pid> could be made first by another user, as a link to a file of the person."""
    shared = tmp_path / "shared-tmp"
    shared.mkdir()
    shared.chmod(0o555)  # nobody writes here: a search that needs a file there finds nothing
    try:
        code, out, saved, left = _run(tmp_path, zoneinfo, ["Lisbon", ""], extra={"TMPDIR": str(shared)})
    finally:
        shared.chmod(0o755)
    assert code == 0 and not left, out
    assert "Proposed: Europe/Lisbon" in out and _tz(saved) == "Europe/Lisbon", out
    assert list(shared.iterdir()) == []
    source = HOST_SETUP.read_text(encoding="utf-8")
    assert "jht-tz-names" not in source and not re.search(r'>\s*"\$\{TMPDIR', source)


def test_a_small_town_not_found_says_to_type_the_country_or_a_big_city_nearby(tmp_path, zoneinfo):
    code, out, saved, left = _run(tmp_path, zoneinfo, ["Brescia", "Italia", ""])
    assert code == 0 and not left, out
    assert "No timezone found for «Brescia»: type the country (for example Italy) or a big city nearby." in out, out
    assert _tz(saved) == "Europe/Rome"
