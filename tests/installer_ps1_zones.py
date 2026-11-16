"""The IANA zone scripts/install.ps1 writes in host.env for the Windows zone of the computer, from shared/data/timezones.txt.

A Windows zone id covers many IANA zones: «W. Europe Standard Time» is Berlin, Rome, Vienna, Zurich... The CLDR takes the zone of the
id's own territory (its 001 line, P|...) only where the country of the computer does not name another: Italy + «W. Europe Standard Time»
is Europe/Rome. install.ps1 carries two kinds of lines, in a block made here:

    P|W. Europe Standard Time|Europe/Berlin       the zone of the id where the country names none (the P lines of the data)
    T|W. Europe Standard Time|IT|Europe/Rome      the zone of the id in a country, where it is not the P one

The zone of a country is the first of its zones (the order of zone.tab) that has the id, or the P one when the country has it. The picker of
the wrapper (Get-JhtDetectedTimezone) follows the same rule on its own copy of the data. Change the data, then
`python3 tests/installer_ps1_zones.py --write`; tests/test_windows_install_timezone_of_the_country.py fails when the two differ.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "shared" / "data" / "timezones.txt"
INSTALLERS = (ROOT / "scripts" / "install.ps1", ROOT / "web" / "public" / "install.ps1")
BEGIN = "# >>> zones of the Windows ids, made from shared/data/timezones.txt by `python3 tests/installer_ps1_zones.py --write`: do not edit by hand"
END = "# <<< zones of the Windows ids"


def _fields() -> list[list[str]]:
    return [line.split("|") for line in DATA.read_text(encoding="utf-8").splitlines() if line and not line.startswith("#")]


def zones() -> tuple[dict[str, str], dict[tuple[str, str], str]]:
    """The P zone of each Windows id, and the zone of an id in a country where it is another."""
    of_country: dict[str, list[str]] = {}
    windows: dict[str, str] = {}
    primary: dict[str, str] = {}
    for field in _fields():
        if field[0] == "Z":
            of_country.setdefault(field[1], []).append(field[2])
        elif field[0] == "W":
            windows[field[1]] = field[2]
        elif field[0] == "P":
            primary[field[1]] = field[2]
    territory: dict[tuple[str, str], str] = {}
    for country, names in of_country.items():
        for name in names:
            win = windows.get(name)
            if not win or (win, country) in territory or win not in primary:
                continue
            candidates = [zone for zone in names if windows.get(zone) == win]
            territory[(win, country)] = primary[win] if primary[win] in candidates else candidates[0]
    return primary, {key: zone for key, zone in territory.items() if zone != primary[key[0]]}


def block(newline: str = "\n") -> str:
    primary, territory = zones()
    body = [f"P|{win}|{zone}" for win, zone in sorted(primary.items())]
    body += [f"T|{win}|{country}|{zone}" for (win, country), zone in sorted(territory.items())]
    assert all(line.isascii() and "'@" not in line for line in body)
    return newline.join([BEGIN, "function Get-JhtWindowsZoneLines {", "  return @'", *body, "'@", "}", END]) + newline


def written_block(text: str) -> str:
    start, end = text.index(BEGIN), text.index(END)
    return text[start : text.index("\n", end) + 1]


def write() -> None:
    for installer in INSTALLERS:
        text = installer.read_bytes().decode("utf-8")
        newline = "\r\n" if "\r\n" in text else "\n"
        installer.write_bytes(text.replace(written_block(text), block(newline)).encode("utf-8"))


if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        write()
    else:
        sys.stdout.write(block())
