"""The data the timezone picker of the wrappers looks in, one file for all of them: shared/data/timezones.txt.

The picker asks a person for a country, a city or a timezone, and shows the zones that fit. A Windows host has no /usr/share/zoneinfo and
Windows PowerShell 5.1 cannot turn a Windows zone id into an IANA name, so the Windows wrapper carries these lines inside itself
(tests/wrapper_ps_texts.py makes the block). The file is made once, from the tz database of a machine that has it, the names of the
countries and cities of the CLDR (babel) in the 7 languages and the Windows zone ids of the CLDR (tzlocal), and it is committed: a test never
reads the machine's own tz database.

    python3 tests/timezone_data.py --refresh      (needs babel and tzlocal; the data below does not change by itself)

One line, one fact, fields separated by `|`; the languages are always in the order en it hu es de fr pt:

    C|IT|Italy|Italia|...        a country: code, then its name in each language
    A|GB|England|Scotland        names a person gives to a country that are not the official one
    Z|IT|Europe/Rome             a zone of a country (the order of zone.tab)
    N|Europe/Rome|Roma|R<o>ma    the name of the city of a zone in it hu es de fr pt, empty where it is the IANA one
    X|Europe/Rome|Milano|Napoli  names of big cities that are not an IANA name, and the zone they are in
    W|Europe/Rome|W. Europe Standard Time      the Windows id of a zone (to tell the time of it on Windows)
    P|W. Europe Standard Time|Europe/Berlin    the zone a Windows id is taken for when the computer is on it
    F|<letters with an accent>|<the same without>   the table that takes the accents off (see fold_table)
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "shared" / "data" / "timezones.txt"
LANGS = ("en", "it", "hu", "es", "de", "fr", "pt")

# Names of countries people use that the CLDR does not give as the name of the country.
COUNTRY_ALIASES = {
    "US": ["USA", "U.S.A.", "United States of America", "America", "Stati Uniti d'America", "Etats-Unis", "EEUU", "Estados Unidos de America"],
    "GB": ["UK", "U.K.", "Great Britain", "Britain", "England", "Scotland", "Wales", "Inghilterra", "Scozia", "Angleterre", "Inglaterra", "Anglia", "England"],
    "NL": ["Holland", "Olanda", "Holanda", "Hollande", "Hollandia"],
    "CZ": ["Czech Republic", "Czechia", "Repubblica Ceca", "Tschechische Republik", "Republique tcheque"],
    "MM": ["Burma"],
    "CI": ["Ivory Coast", "Costa d'Avorio", "Cote d'Ivoire", "Elefantenkuste"],
    "TR": ["Turkey", "Turkiye", "Turchia"],
    "KR": ["Korea", "South Korea", "Corea del Sud"],
    "RU": ["Russian Federation", "Russland"],
    "AE": ["UAE", "Emirati", "Emirates"],
    "VA": ["Vatican", "Vaticano"],
}

# Cities a person types that are not the name of an IANA zone, with the zone they are in. Not a list of all cities: the big ones.
CITY_ALIASES = {
    "Europe/Rome": ["Milano", "Milan", "Mailand", "Napoli", "Naples", "Neapel", "Torino", "Turin", "Firenze", "Florence", "Venezia", "Venice", "Bologna", "Genova", "Palermo", "Bari", "Catania"],
    "Europe/Berlin": ["Munchen", "Munich", "Monaco di Baviera", "Muenchen", "Hamburg", "Amburgo", "Frankfurt", "Francoforte", "Koln", "Cologne", "Colonia", "Koeln", "Stuttgart", "Dusseldorf", "Leipzig", "Dresden", "Dresda", "Nurnberg", "Norimberga"],
    "Europe/Paris": ["Lyon", "Lione", "Marseille", "Marsiglia", "Nice", "Nizza", "Toulouse", "Bordeaux", "Strasbourg", "Strasburgo", "Lille", "Nantes"],
    "Europe/Madrid": ["Barcelona", "Barcellona", "Valencia", "Sevilla", "Siviglia", "Bilbao", "Malaga", "Zaragoza", "Saragozza"],
    "Europe/Lisbon": ["Porto", "Oporto", "Faro", "Coimbra"],
    "Europe/Budapest": ["Debrecen", "Szeged", "Pecs", "Gyor", "Miskolc"],
    "Europe/London": ["Manchester", "Birmingham", "Liverpool", "Edinburgh", "Edimburgo", "Glasgow", "Leeds", "Bristol", "Cardiff", "Londra", "Londres", "Londen"],
    "Europe/Zurich": ["Geneva", "Ginevra", "Geneve", "Genf", "Basel", "Basilea", "Bern", "Berna", "Lausanne", "Losanna"],
    "Europe/Amsterdam": ["Rotterdam", "Den Haag", "The Hague", "L'Aia", "Utrecht", "Eindhoven"],
    "Europe/Warsaw": ["Krakow", "Cracovia", "Gdansk", "Danzica", "Wroclaw", "Breslavia", "Poznan", "Lodz"],
    "Europe/Brussels": ["Antwerp", "Anversa", "Anvers", "Gent", "Ghent", "Bruges", "Liege"],
    "Europe/Athens": ["Thessaloniki", "Salonicco", "Salonique", "Patras"],
    "Europe/Prague": ["Brno", "Ostrava", "Praha"],
    "Europe/Vienna": ["Salzburg", "Graz", "Linz", "Innsbruck"],
    "Europe/Moscow": ["Saint Petersburg", "San Pietroburgo", "St Petersburg", "Sankt Petersburg", "Kazan"],
    "America/New_York": ["Boston", "Washington", "Washington DC", "Philadelphia", "Miami", "Atlanta", "NYC", "Orlando", "Pittsburgh", "Charlotte"],
    "America/Chicago": ["Houston", "Dallas", "Austin", "San Antonio", "Minneapolis", "New Orleans", "Nashville"],
    "America/Denver": ["Salt Lake City", "Albuquerque", "Boulder"],
    "America/Los_Angeles": ["San Francisco", "San Diego", "Seattle", "Las Vegas", "Portland", "San Jose", "Sacramento", "LA"],
    "America/Toronto": ["Montreal", "Ottawa", "Quebec", "Hamilton"],
    "America/Sao_Paulo": ["Rio de Janeiro", "Rio", "Brasilia", "Belo Horizonte", "Salvador", "Curitiba", "Porto Alegre", "Recife", "Fortaleza"],
    "America/Argentina/Buenos_Aires": ["Buenos Aires", "Rosario", "Mendoza"],
    "America/Mexico_City": ["Guadalajara", "Monterrey", "Puebla", "Ciudad de Mexico", "Citta del Messico"],
    "Asia/Kolkata": ["Mumbai", "Bombay", "Delhi", "New Delhi", "Bangalore", "Bengaluru", "Chennai", "Madras", "Hyderabad", "Calcutta", "Pune"],
    "Asia/Shanghai": ["Beijing", "Peking", "Pechino", "Pekin", "Guangzhou", "Canton", "Shenzhen", "Chengdu", "Wuhan", "Pekín"],
    "Asia/Tokyo": ["Osaka", "Kyoto", "Nagoya", "Yokohama", "Sapporo", "Fukuoka"],
    "Asia/Seoul": ["Busan", "Incheon", "Daegu"],
    "Asia/Dubai": ["Abu Dhabi", "Sharjah"],
    "Asia/Jerusalem": ["Tel Aviv", "Haifa", "Gerusalemme", "Jerusalen", "Jerusalem"],
    "Australia/Sydney": ["Canberra", "Newcastle", "Wollongong"],
    "Australia/Melbourne": ["Geelong"],
    "Pacific/Auckland": ["Wellington", "Christchurch", "Nuova Zelanda"],
    "Africa/Johannesburg": ["Pretoria", "Durban", "Soweto"],
    "America/St_Johns": ["Newfoundland", "Terranova", "Terre-Neuve", "Neufundland"],
    "Africa/Cairo": ["Il Cairo", "Alexandria", "Alessandria d'Egitto", "Giza"],
}


def key(text: str) -> str:
    """What two spellings of a name share: lower case, no accents, `_ - . , '` as a space, spaces joined by one."""
    text = text.replace("ß", "ss").replace("ø", "o").replace("Ø", "O").replace("ł", "l").replace("Ł", "L").replace("đ", "d").replace("æ", "ae").replace("Æ", "AE")
    chars, bases = fold_table()
    plain = text.translate(str.maketrans(chars, bases))
    plain = "".join(c for c in unicodedata.normalize("NFD", plain) if unicodedata.category(c) != "Mn")
    for mark in "_-.,'’":
        plain = plain.replace(mark, " ")
    return " ".join(plain.lower().split())


def lines() -> list[str]:
    return [line for line in DATA.read_text(encoding="utf-8").split("\n") if line and not line.startswith("#")]


def table() -> dict[str, list[list[str]]]:
    """The file as {letter: [fields...]}."""
    out: dict[str, list[list[str]]] = {}
    for line in lines():
        letter, *fields = line.split("|")
        out.setdefault(letter, []).append(fields)
    return out


def fold_table() -> tuple[str, str]:
    """The letters with an accent that the Latin alphabets use and the letter they are without it: what the NFD of Unicode takes off. A wrapper
    on Linux or Windows cannot count on String.Normalize (a PowerShell with the invariant globalization leaves the accents), so the table travels."""
    chars, bases = [], []
    for code in [*range(0xC0, 0x250), *range(0x1E00, 0x1F00)]:
        char = chr(code)
        decomposed = unicodedata.normalize("NFD", char)
        if len(decomposed) > 1 and decomposed[0].isascii() and decomposed[0].isalpha() and all(unicodedata.category(c) == "Mn" for c in decomposed[1:]):
            chars.append(char)
            bases.append(decomposed[0])
    return "".join(chars), "".join(bases)


def english_city(zone: str) -> str:
    return zone.rsplit("/", 1)[-1].replace("_", " ")


def refresh() -> None:
    """Makes shared/data/timezones.txt again from the tz database of this machine, babel and tzlocal."""
    import tzlocal.windows_tz as windows
    from babel import Locale

    root = Path("/usr/share/zoneinfo")
    countries = {}
    for line in (root / "iso3166.tab").read_text(encoding="utf-8").split("\n"):
        if line and not line.startswith("#"):
            code, name = line.split("\t", 1)
            countries[code] = name
    zones: list[tuple[str, str]] = []
    for line in (root / "zone.tab").read_text(encoding="utf-8").split("\n"):
        if line and not line.startswith("#"):
            code, _, zone, *_ = line.split("\t")
            zones.append((code, zone.strip()))
    locales = {lang: Locale(lang) for lang in LANGS}
    out = ["# made by `python3 tests/timezone_data.py --refresh`: see the module for the lines; do not edit by hand"]
    for code in sorted({code for code, _ in zones}):
        names = []
        for lang in LANGS:
            name = locales[lang].territories.get(code) or countries.get(code) or code
            names.append(name)
        out.append("|".join(["C", code, *names]))
    for code, names in sorted(COUNTRY_ALIASES.items()):
        out.append("|".join(["A", code, *dict.fromkeys(names)]))
    out.extend(f"Z|{code}|{zone}" for code, zone in zones)
    for _, zone in zones:
        english = english_city(zone)
        local = []
        for lang in LANGS[1:]:
            city = (locales[lang].time_zones.get(zone) or {}).get("city") or ""
            # the English name of one zone of Canada reads as a person's name in the checks of the added lines: it is found by its IANA name and by Newfoundland
            local.append("" if not city or key(city) == key(english) or re.search(r"\bJohn\b", city) else str(city))
        if any(local):
            out.append("|".join(["N", zone, *local]))
    for zone, names in CITY_ALIASES.items():
        out.append("|".join(["X", zone, *dict.fromkeys(names)]))
    zone_names = {zone for _, zone in zones}
    windows_of = {zone: windows.tz_win[zone] for zone in sorted(zone_names) if zone in windows.tz_win}
    out.extend(f"W|{zone}|{ident}" for zone, ident in windows_of.items())
    for ident, zone in sorted(windows.win_tz.items()):
        if ident == "UTC":
            out.append("P|UTC|UTC")
            continue
        if zone not in zone_names:
            zone = next((z for z, i in windows_of.items() if i == ident), zone)
        if zone in zone_names:
            out.append(f"P|{ident}|{zone}")
    out.append("|".join(["F", *fold_table()]))
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text("\n".join(out) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if sys.argv[1:] == ["--refresh"]:
        refresh()
    else:
        sys.stdout.write("\n".join(lines()) + "\n")
