"""A Scout does not hand over a position whose title and requirements hold no word of the profile's trade (SC-04, fifth reject).

Measured 16/11: a bricklayer got 22 off-trade positions out of 32 (cashier, counter clerk, steward, sales, office), a lorry driver
2 on-trade out of 19. Synthetic profiles and ads only: nothing here is a real person or a real ad.

Run:
    pytest tests/test_scout_role.py -v
"""
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import scout_role as role  # noqa: E402

PROFILES = {
    "muratore": "name: Test Uno\ntarget_role: Muratore\nlocation: Bari, Italy\n",
    "infermiera": "name: Test Due\ntarget_role: Infermiera\ntarget_roles:\n  - Infermiere professionale\nlocation: Torino, Italy\n",
    "cuoco": "name: Test Tre\ntarget_role: Cuoco\nlocation: Rimini, Italy\n",
    "magazziniere": "name: Test Quattro\ntarget_role: Magazziniere\nlocation: Brescia, Italy\n",
}
FAMILY = {
    "muratore": ["muratore", "operaio edile", "capo cantiere", "carpentiere edile", "piastrellista", "manovale edile"],
    "infermiera": ["infermiere", "infermiera", "infermieristica", "oss", "operatore socio sanitario", "assistenza domiciliare"],
    "cuoco": ["cuoco", "chef", "aiuto cuoco", "capo partita", "pizzaiolo", "cucina"],
    "magazziniere": ["magazziniere", "addetto magazzino", "carrellista", "mulettista", "picker", "logistica"],
}
ON_TRADE = {
    "muratore": ["Muratore qualificato", "Operaio edile Gioia del Colle", "Capocantiere edile", "Carpentiere edile - Bari", "Muratori e manovali edili"],
    "infermiera": ["Infermiere/a professionale", "Infermiera RSA", "Operatore Socio Sanitario (OSS)", "Infermieristica domiciliare"],
    "cuoco": ["Cuoco di linea", "Chef de partie", "Aiuto cuoco", "Pizzaiolo", "Addetto alla cucina"],
    "magazziniere": ["Magazziniere", "Addetto/a magazzino part time", "Carrellista", "Mulettista tempo indeterminato", "Picker logistica"],
}
OFF_TRADE = {
    "muratore": ["Cassiere/a", "Banconista gastronomia", "Steward di bordo", "Agente commerciale", "Impiegato/a amministrativo", "Addetto alle vendite"],
    "infermiera": ["Cassiera supermercato", "Magazziniere", "Cuoco", "Muratore", "Impiegato back office"],
    "cuoco": ["Magazziniere", "Autista C+E", "Cassiere", "Infermiere", "Elettricista"],
    "magazziniere": ["Cuoco", "Infermiera", "Commessa negozio", "Barista", "Impiegato commerciale"],
}


@pytest.fixture
def home(tmp_path, monkeypatch):
    (tmp_path / "profile").mkdir()
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    return tmp_path


def _profile(home, text):
    (home / "profile" / "candidate_profile.yml").write_text(text, encoding="utf-8")


def _setup(home, trade, declared=True):
    _profile(home, PROFILES[trade])
    if declared:
        assert role.declare(FAMILY[trade])["declared"]


# ── the words ────────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("term,text,found", [
    ("muratore", "Muratori e carpentieri", True), ("infermiere", "Infermiera professionale", True), ("infermiere", "Infermieristica", True),
    ("cuoco", "Cuochi per ristorante", True), ("operaio edile", "Operaio edile specializzato", True), ("operaio edile", "Operaio/a edile", True),
    ("operaio edile", "Operaio metalmeccanico", False), ("capo cantiere", "Capocantiere", True), ("capocantiere", "Capo cantiere", True),
    ("oss", "OSS con attestato", True), ("oss", "Ossidazione e verniciatura", False), ("muratore", "Muratura a secco", False),
    ("cuoco", "Cucina industriale", False), ("maurer", "Maurermeister gesucht", True), ("cuoco", "", False),
    # a word between the words of the phrase, or the other order: the specific word (not the generic «operaio») names the trade
    ("operaio edile", "Operaio specializzato edile", True), ("operaio edile", "Capo squadra edile", True),
    ("operaio edile", "Addetto ai lavori in cantiere edile", True), ("autista camion", "Camion: autista patente C", True),
    ("operaio edile", "Operaio specializzato metalmeccanico", False), ("autista camion", "Autista di autobus", False),
    ("operaio addetto", "Operaio addetto alle pulizie", True),
])
def test_a_term_is_found_in_its_forms_and_not_in_another_trade(term, text, found):
    assert role.term_in(role._plain(term), role._tokens(text)) is found


def test_generic_words_cannot_be_declared_alone_but_a_phrase_can(home):
    _profile(home, PROFILES["muratore"])
    out = role.declare(["operaio", "addetto", "Operaio edile", "muratore", "junior", " "])
    assert out["terms"] == ["operaio edile", "muratore"]
    assert {r["term"] for r in out["refused"]} == {"operaio", "addetto", "junior", " "}


# ── the verdict, for four trades ─────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("trade", list(PROFILES))
def test_the_family_passes_and_the_other_trades_are_refused(home, trade):
    _setup(home, trade)
    for title in ON_TRADE[trade]:
        assert role.check_position(title)["verdict"] == "ok", title
    for title in OFF_TRADE[trade]:
        assert role.check_position(title)["verdict"] == "mismatch", title


def test_the_requirements_or_the_snippet_can_carry_the_trade(home):
    _setup(home, "muratore")
    assert role.check_position("Addetto cantiere")["verdict"] == "mismatch"
    assert role.check_position("Addetto cantiere", requirements="Esperienza come muratore, patente B")["verdict"] == "ok"
    assert role.check_position("Addetto cantiere", snippet="cercasi operaio edile")["verdict"] == "ok"


# ── a doubt is «ok» ──────────────────────────────────────────────────────────────────────────────────────────────────
def test_no_profile_no_role_unreadable_profile_or_no_text_is_ok(home):
    assert role.check_position("Cassiere")["verdict"] == "ok"                            # no profile at all
    _profile(home, "name: X\nlocation: Roma, Italy\n")
    assert role.check_position("Cassiere")["verdict"] == "ok"                            # a profile with no role
    _profile(home, "target_role: [unclosed\n  : :")
    assert role.check_position("Cassiere")["verdict"] == "ok"                            # a half-written file
    _setup(home, "cuoco")
    assert role.check_position("")["verdict"] == "ok"                                    # nothing to compare


def test_a_profile_with_a_role_and_no_declaration_is_refused_with_the_command(home):
    _setup(home, "muratore", declared=False)
    out = role.check_position("Muratore")
    assert out["verdict"] == "terms_missing" and "scout_role.py declare" in role.declare_hint(out["roles"])


def test_a_change_of_roles_makes_the_declaration_stale(home):
    _setup(home, "muratore")
    assert role.check_position("Muratore")["verdict"] == "ok"
    _profile(home, PROFILES["cuoco"])
    assert role.check_position("Muratore")["verdict"] == "terms_missing"
    assert role.declare(["cuoco"])["terms"] == ["cuoco"]                                 # starts again, the old family is gone
    assert role.check_position("Muratore")["verdict"] == "mismatch"


def test_declaring_again_adds_and_two_scouts_share_the_family(home):
    _profile(home, PROFILES["muratore"])
    role.declare(["muratore"], agent="scout-1")
    out = role.declare(["Maurer", "muratore"], agent="scout-2")
    assert out["terms"] == ["muratore", "maurer"]
    assert json.loads(role.terms_path().read_text())["by"] == ["scout-1", "scout-2"]


# ── the command and the INSERT ───────────────────────────────────────────────────────────────────────────────────────
def _run(home, *args, agent="scout-1"):
    env = {**os.environ, "JHT_HOME": str(home), "JHT_AGENT_NAME": agent, "JHT_DB": str(home / "jobs.db")}
    return subprocess.run([sys.executable, str(SKILLS / "scout_role.py"), *args], capture_output=True, text=True, env=env, timeout=60)


def _insert(home, agent, n, title, requirements="requisiti generici"):
    env = {**os.environ, "JHT_HOME": str(home), "JHT_AGENT_NAME": agent, "JHT_DB": str(home / "jobs.db")}
    return subprocess.run([sys.executable, str(SKILLS / "db_insert.py"), "position", "--title", title, "--company", "Azienda %d" % n,
                           "--url", "https://jobs.example/%d" % n, "--source", "test", "--found-by", agent, "--location", "Bari, Italy",
                           "--remote-type", "onsite", "--jd-text", "annuncio sintetico", "--requirements", requirements],
                          capture_output=True, text=True, env=env, timeout=60)


def _rows(home):
    return sqlite3.connect(str(home / "jobs.db")).execute("SELECT title FROM positions ORDER BY id").fetchall()


def test_the_command_exit_codes_and_the_declaration(home):
    _profile(home, PROFILES["muratore"])
    missing = _run(home, "check", "--title", "Muratore")
    assert missing.returncode == 6 and json.loads(missing.stdout)["verdict"] == "terms_missing" and "declare" in json.loads(missing.stdout)["do"]
    declared = _run(home, "declare", "--term", "muratore", "--term", "operaio", "--agent", "scout-1")
    assert declared.returncode == 0 and json.loads(declared.stdout)["terms"] == ["muratore"]
    assert _run(home, "check", "--title", "Muratore").returncode == 0
    assert _run(home, "check", "--title", "Cassiere").returncode == 5
    shown = json.loads(_run(home, "show").stdout)
    assert shown["fresh"] is True and shown["terms"] == ["muratore"]
    assert _run(home, "reset").returncode == 0 and _run(home, "check", "--title", "Muratore").returncode == 6
    assert _run(home, "declare", "--term", "operaio").returncode == 2                    # only generic words: nothing declared


def test_a_scout_cannot_insert_an_off_trade_position_and_nothing_is_written(home):
    _setup(home, "muratore")
    done = _insert(home, "scout-1", 1, "Cassiere/a")
    assert done.returncode == 5 and done.stdout.startswith("ROLE_MISMATCH") and "INSERT refused" in done.stdout, done.stdout + done.stderr
    assert not (home / "jobs.db").exists() or _rows(home) == []
    assert _insert(home, "scout-1", 2, "Operaio edile Gioia del Colle").returncode == 0
    assert _insert(home, "scout-1", 3, "Addetto cantiere", requirements="esperienza come muratore").returncode == 0
    assert _rows(home) == [("Operaio edile Gioia del Colle",), ("Addetto cantiere",)]


def test_a_scout_with_no_declaration_inserts_and_is_told_to_declare_and_then_is_held_to_it(home):
    _setup(home, "cuoco", declared=False)
    done = _insert(home, "scout-1", 1, "Magazziniere")                # a doubt is «ok»: never refused for a step not done yet
    assert done.returncode == 0 and "Position inserted" in done.stdout and "ROLE_FAMILY_NOT_DECLARED" in done.stdout and "scout_role.py declare" in done.stdout
    assert _run(home, "declare", "--term", "cuoco", "--term", "chef").returncode == 0
    refused = _insert(home, "scout-1", 2, "Magazziniere")
    assert refused.returncode == 5 and refused.stdout.startswith("ROLE_MISMATCH")
    done = _insert(home, "scout-1", 3, "Cuoco di linea")
    assert done.returncode == 0 and "ROLE_FAMILY_NOT_DECLARED" not in done.stdout


def test_the_gate_is_for_the_scout_alone_and_a_profile_with_no_role_passes(home):
    _setup(home, "muratore", declared=False)
    assert _insert(home, "user", 1, "Cassiere/a").returncode == 0                         # a position the user adds is not the Scout's rule
    _profile(home, "name: X\nlocation: Bari, Italy\n")
    assert _insert(home, "scout-1", 2, "Cassiere/a").returncode == 0                     # no role in the profile: no filter


# ── the plan: `scout_coverage.py next` ───────────────────────────────────────────────────────────────────────────────
def _next(home, *extra):
    done = subprocess.run([sys.executable, str(SKILLS / "scout_coverage.py"), "next", *extra], capture_output=True, text=True,
                          env={**os.environ, "JHT_HOME": str(home), "JHT_DB": str(home / "jobs.db")}, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr
    return json.loads(done.stdout)


def test_next_asks_for_the_family_first_and_then_the_wide_query_is_the_trades_own_words(home):
    _profile(home, PROFILES["muratore"] + "languages:\n  - language: Italiano\n    level: native\npreferences:\n  work_mode: in sede\n")
    step = _next(home)
    assert step["query_kind"] == "broad" and "scout_role.py declare" in step["declare_role_family"]["do"]
    assert "tirocinio" in step["broad_terms"]                                           # nothing declared: the entry words, as before
    assert role.declare(FAMILY["muratore"])["declared"]
    step = _next(home)
    assert "declare_role_family" not in step
    assert step["broad_terms"] == role.read_declaration()["terms"] and "tirocinio" in step["entry_words"]
    assert step["trade_terms"] == step["broad_terms"]


def test_next_says_nothing_of_a_family_for_a_profile_with_no_role(home):
    _profile(home, "name: X\nlocation: Bari, Italy\nlanguages:\n  - language: Italiano\n    level: native\n")
    step = _next(home)
    assert "declare_role_family" not in step and "trade_terms" not in step and "tirocinio" in step["broad_terms"]


# ── a word of the sector or the place is not a trade (banco 17/11: a nurse in Torino got a «CUOCO/A PER RSA») ────────────────
WIDE_NURSE = ["infermiere", "infermiera", "nurse", "oss", "operatore socio sanitario", "caposala", "ostetrica", "sanitario",
              "ospedale", "rsa", "reparto", "ambulatorio", "assistenza domiciliare"]


@pytest.mark.parametrize("title,verdict", [
    ("CUOCO/A PER RSA", "mismatch"), ("Cuoco - Ospedale San Luca", "mismatch"), ("Autista per ambulatorio", "mismatch"),
    ("Magazziniere reparto", "mismatch"),
    # the trade's own words always pass, with or without a sector word
    ("OSS per RSA", "ok"), ("Infermiere RSA", "ok"), ("Nurse - Ospedale", "ok"),
    # a sector word beside a generic worker word in the title is a doubt, and a doubt is in
    ("Addetto RSA", "ok"), ("Ausiliario reparto operatore", "ok"),
])
def test_a_sector_word_passes_only_beside_a_worker_word_in_the_title(home, title, verdict):
    _profile(home, PROFILES["infermiera"])
    assert role.declare(WIDE_NURSE)["declared"]
    assert role.check_position(title)["verdict"] == verdict


def test_a_sector_word_in_the_text_around_the_title_is_not_enough_either(home):
    _profile(home, PROFILES["infermiera"])
    assert role.declare(WIDE_NURSE)["declared"]
    assert role.check_position("Cuoco", snippet="Cooperativa sociale, RSA di Torino, operatore", requirements="Esperienza in RSA")["verdict"] == "mismatch"


def test_the_building_words_follow_the_same_rule(home):
    _profile(home, PROFILES["muratore"])
    assert role.declare(FAMILY["muratore"] + ["edile", "edilizia", "cantiere", "capo squadra", "carpentiere", "posatore"])["declared"]
    assert role.check_position("Cuoco di cantiere")["verdict"] == "mismatch"
    assert role.check_position("Addetto cantiere edile")["verdict"] == "ok"
    assert role.check_position("Operaio di cantiere")["verdict"] == "ok"
    assert role.check_position("Muratore")["verdict"] == "ok"
