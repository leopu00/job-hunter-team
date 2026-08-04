#!/usr/bin/env python3
"""Audit degli asset irraggiungibili sotto ``game/assets``.

Un grep del nome file NON basta: in questa scena molti path sono composti a
runtime.  L'audit riproduce ogni regola di composizione nota, quindi dichiara
orfano solo cio' che nessuna di esse puo' produrre.

Regole riprodotte (in ordine di specificita'):

  L1  letterale esatto           ``"res://assets/.../x.png"``
  L2  letterale di coda          ``RUG_DIR + "/persian_scout.png"``
  C1  furniture_node.gd:150      ``furniture/<kind>.png``
  C2  furniture_node.gd:142      ``furniture/<kind>_<down|up|side|diag_down>.png``
  C3  furniture_node.gd:180-183  ``<base>_seated_v2.png`` / ``<base>_seated.png``
  C4  character_defs.make_rig    ``sheets/<slug>_<variant>.png`` (+ ``_sit``)
  C5  character_defs.agent_txt   ``characters/gen/<slug>/*.svg``
  C6  ComicChat.portrait_slug    ``gen-art/portraits/<ruolo>[-<n>]/*``
                                 ``characters/gen/portraits/<ruolo>[-<n>]/*``

I ``<kind>`` di C1/C2 vengono dalla LORO unica sorgente (``KIND_SOURCES``), non
da un elenco a mano: sono i soli valori che ``furniture_node.gd`` puo' vedere a
runtime.  Per ``<slug>`` (C4/C5/C6), dove la sorgente e' piu' sfumata, si prende
invece OGNI stringa letterale del sorgente come candidato: e' volutamente
eccessivo, perche' il costo di un falso orfano (arte cancellata) e' molto piu'
alto di quello di un falso raggiungibile.

Cio' che non entra nel build non e' "orfano": e' gia' fuori, e l'audit non lo
guarda.  Le due vie per restarne fuori si leggono entrambe dalla loro sorgente,
invece di duplicarle qui:

  * un ``.gdignore`` nella cartella — Godot non la scandisce affatto, quindi
    dentro non c'e' nessuna risorsa (``assets/_attic/``);
  * ``exclude_filter`` nei preset — la risorsa esiste ma non viene impacchettata
    (``assets/characters/sources/``, che serve viva a un tool di build).

Dei preset si pretende che i tre concordino: se divergono l'audit si ferma,
perche' quella divergenza e' esattamente il difetto che deve far vedere.

In piu' l'audit tiene oneste le due mappe di ``furniture_node.gd``: una chiave
di ``GEN_ART``/``KIND_COLORS`` che non corrisponde ad alcun ``"kind"``
istanziato e' un doppio danno — mente su cosa esiste in ufficio, e siccome la
chiave E' una stringa letterale tiene artificialmente in vita l'arte che le sta
dietro, rendendo cieco l'audit proprio dove serve.

Uso::

    python3 game/tools/asset_orphan_audit.py            # elenco + exit 1 se orfani
    python3 game/tools/asset_orphan_audit.py --check    # solo exit code (per run.sh)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

GAME = Path(__file__).resolve().parent.parent
ASSETS = GAME / "assets"

SOURCE_SUFFIXES = {".gd", ".tscn", ".tres", ".py", ".godot", ".cfg", ".json"}
ASSET_SUFFIXES = {".png", ".svg"}

#: suffissi d'orientamento composti da ``furniture_node.gd`` (match/facing)
FACING_SUFFIXES = ("down", "up", "side", "diag_down")
#: suffissi "agente dipinto nella texture" tentati su ogni base raggiungibile
SEATED_SUFFIXES = ("_seated_v2", "_seated")
#: varianti di postazione assegnate da ``CharacterDefs.VARIANT_BY_DESK``
SHEET_VARIANTS = ("a", "b", "c", "d", "e", "f")
#: parti caricate dal rig a strati (storiche: la pipeline SVG e' in archivio)
RIG_PARTS = (
    "head_front", "head_side", "head_back",
    "torso_front", "torso_side", "leg_front", "leg_side",
)

STRING_RE = re.compile(r'"([^"\n]*)"')


def _iter_sources() -> list[Path]:
    out = []
    for path in GAME.rglob("*"):
        if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
            continue
        # i .import sono generati da Godot e citano il proprio stesso file:
        # includerli renderebbe ogni asset "raggiungibile" per costruzione
        if path.suffix == ".import":
            continue
        rel = path.relative_to(GAME)
        if rel.parts and rel.parts[0] == "assets":
            continue
        out.append(path)
    return out


def collect_literals(sources: list[Path]) -> set[str]:
    lits: set[str] = set()
    for path in sources:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        lits.update(STRING_RE.findall(text))
    return lits


def excluded_patterns() -> list[str]:
    """I glob di ``exclude_filter``, letti dai preset: unica fonte di verita'.

    Cio' che non entra nel build non puo' essere "orfano": e' gia' fuori. Il
    valore deve essere identico nei tre preset — se divergono e' proprio il
    difetto che questo audit deve far vedere, quindi qui e' un errore.
    """
    text = (GAME / "export_presets.cfg").read_text(encoding="utf-8")
    values = set(re.findall(r'^exclude_filter="([^"]*)"', text, re.M))
    if len(values) != 1:
        raise SystemExit(
            "export_presets.cfg: i preset hanno exclude_filter DIVERSI (%d varianti); "
            "un preset dimenticato imbarca cio' che gli altri escludono" % len(values)
        )
    return [p for p in values.pop().split(",") if p]


def gdignored_dirs() -> list[Path]:
    """Cartelle che un ``.gdignore`` toglie dal filesystem-risorse.

    Godot non le scandisce: dentro non esiste nessuna risorsa, quindi niente
    import, niente ``.import``, niente ``uid://`` e niente nel ``.pck``. Non
    sono "orfane", sono archiviate apposta. Si guarda il file che legge il
    motore, non un elenco da tenere allineato a mano.
    """
    return [p.parent for p in ASSETS.rglob(".gdignore")]


def collect_assets() -> list[str]:
    """Path ``assets/...`` che finiscono davvero nel build."""
    import fnmatch

    patterns = excluded_patterns()
    ignored = gdignored_dirs()
    out = []
    for path in sorted(ASSETS.rglob("*")):
        if not path.is_file() or path.suffix not in ASSET_SUFFIXES:
            continue
        if any(d in path.parents for d in ignored):
            continue
        rel = path.relative_to(GAME).as_posix()
        if any(fnmatch.fnmatch("res://" + rel, p) for p in patterns):
            continue
        out.append(rel)
    return out


def build_reachable(literals: set[str], assets: set[str]) -> dict[str, str]:
    """Mappa asset -> regola che lo raggiunge."""
    reach: dict[str, str] = {}

    def hit(rel: str, rule: str) -> None:
        if rel in assets and rel not in reach:
            reach[rel] = rule

    # ---- L1 / L2: letterali -------------------------------------------------
    tails = set()
    for lit in literals:
        norm = lit.replace("res://", "")
        if norm.startswith("assets/"):
            hit(norm, "L1 literal")
        if lit.endswith((".png", ".svg")) and "/" in lit:
            tails.add(lit.lstrip("res:/").lstrip("/"))
    for rel in assets:
        for tail in tails:
            if rel.endswith("/" + tail.split("/")[-1]) and rel.endswith(tail):
                if rel not in reach:
                    reach[rel] = "L2 literal tail"

    # ---- C1 / C2: SOLO i kind davvero istanziati ----------------------------
    # (usare "ogni letterale" qui e' troppo lasco: la chiave di una mappa e' essa
    #  stessa un letterale, quindi una chiave morta terrebbe in vita la sua arte)
    for kind in live_kinds():
        hit("assets/gen-art/furniture/%s.png" % kind, "C1 kind")
        for suf in FACING_SUFFIXES:
            hit("assets/gen-art/furniture/%s_%s.png" % (kind, suf), "C2 kind+facing")

    # ---- C4 / C5: slug, da ogni letterale (sorgente sfumata) ----------------
    for lit in literals:
        if not lit or "/" in lit or "." in lit or " " in lit:
            continue
        for var in SHEET_VARIANTS:
            hit("assets/characters/sheets/%s_%s.png" % (lit, var), "C4 sheet")
            hit("assets/characters/sheets/%s_%s_sit.png" % (lit, var), "C4 sheet sit")
        hit("assets/characters/sheets/%s_sit.png" % lit, "C4 sheet sit")
        # C5: parti SVG del rig legacy
        for part in RIG_PARTS:
            hit("assets/characters/gen/%s/%s.svg" % (lit, part), "C5 svg rig")

    # ---- C3: seated su OGNI base raggiungibile ------------------------------
    for rel in list(reach):
        if not rel.startswith("assets/gen-art/furniture/") or not rel.endswith(".png"):
            continue
        stem = rel[: -len(".png")]
        for suf in SEATED_SUFFIXES:
            hit(stem + suf + ".png", "C3 seated")

    # ---- C6: ritratti per ruolo e per istanza -------------------------------
    role_dirs = set()
    for lit in literals:
        if not lit or "/" in lit or "." in lit or " " in lit:
            continue
        role_dirs.add(lit)
        role_dirs.update("%s-%d" % (lit, n) for n in range(1, 13))
    for rel in assets:
        for base in ("assets/gen-art/portraits/", "assets/characters/gen/portraits/"):
            if not rel.startswith(base):
                continue
            sub = rel[len(base):].split("/")[0]
            if sub in role_dirs and rel not in reach:
                reach[rel] = "C6 portrait dir"

    return reach


#: file che istanziano davvero un mobile (l'unica sorgente di "kind")
KIND_SOURCES = (
    "scripts/office/furniture_defs.gd",
    "scripts/office/department_defs.gd",
    "scripts/office/desk_clutter.gd",
)
KIND_RE = re.compile(r'"kind"\s*:\s*"([a-z0-9_]+)"')
MAP_RE = re.compile(r'^const (KIND_COLORS|GEN_ART) := \{(.*?)^\}', re.S | re.M)


def live_kinds() -> set[str]:
    kinds: set[str] = set()
    for rel in KIND_SOURCES:
        kinds.update(KIND_RE.findall((GAME / rel).read_text(encoding="utf-8")))
    return kinds


def dead_map_keys() -> dict[str, list[str]]:
    """Chiavi di GEN_ART/KIND_COLORS senza un ``kind`` corrispondente."""
    text = (GAME / "scripts/office/furniture_node.gd").read_text(encoding="utf-8")
    kinds = live_kinds()
    out: dict[str, list[str]] = {}
    for name, body in MAP_RE.findall(text):
        keys = re.findall(r'^\t"([a-z0-9_]+)"\s*:', body, re.M)
        dead = [k for k in keys if k not in kinds]
        if dead:
            out[name] = dead
    return out


def audit() -> tuple[list[str], dict[str, str]]:
    sources = _iter_sources()
    literals = collect_literals(sources)
    assets = collect_assets()
    reach = build_reachable(literals, set(assets))
    orphans = [a for a in assets if a not in reach]
    return orphans, reach


def main(argv: list[str]) -> int:
    check_only = "--check" in argv
    orphans, reach = audit()
    dead = dead_map_keys()
    total = len(orphans) + len(reach)

    if not check_only:
        print("asset audit: %d file, %d raggiungibili, %d orfani"
              % (total, len(reach), len(orphans)))
        for rel in orphans:
            size = (GAME / rel).stat().st_size
            print("  ORFANO  %8.1f KB  %s" % (size / 1024.0, rel))
    for name, keys in dead.items():
        print("CHIAVI MORTE in furniture_node.%s: %s" % (name, ", ".join(keys)))

    if orphans or dead:
        if check_only and orphans:
            print("asset audit: %d orfani — archiviali sotto assets/_attic/ "
                  "(elenco: python3 tools/asset_orphan_audit.py)" % len(orphans))
        return 1
    print("PASS: nessun asset orfano, nessuna chiave morta in GEN_ART/KIND_COLORS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
