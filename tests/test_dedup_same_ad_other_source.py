"""The same ad, republished by another source, is a duplicate (banco 17/11, a nurse in Torino, one double).

An aggregator hands out an agency's ad under another company («Randstad Healthcare» for «Randstad Professional Italia»), another
title («infermiere» for «Infermiere per centro di riabilitazione Torino») and its own URL: company+title does not know it, its TEXT
does. Synthetic ads only.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import db_insert  # noqa: E402

AD = ("Sei un infermiere appassionato di riabilitazione intensiva e desideri mettere le tue competenze al servizio di una struttura "
      "di eccellenza? Cerchiamo un professionista qualificato da inserire in un contesto sanitario complesso, con pazienti in "
      "percorsi di riabilitazione cardiologica e neuromotoria. Lavorerai in equipe con medici e fisioterapisti, turni diurni e "
      "notturni, contratto a tempo indeterminato, strumentazioni per la riabilitazione robotica avanzata e formazione continua "
      "a carico della struttura. Requisiti: laurea in infermieristica, iscrizione all'albo, esperienza anche breve in reparto.")
OTHER_AD = ("Cerchiamo un addetto al magazzino per un centro di distribuzione alle porte della citta, con esperienza nell'uso del "
            "carrello elevatore, nella preparazione degli ordini e nel controllo della merce in arrivo e in uscita. Orario su "
            "tre turni a rotazione, contratto iniziale di sei mesi con possibilita di proroga, mensa aziendale e buoni pasto. "
            "Requisiti: patentino in corso di validita, disponibilita al lavoro notturno, buona conoscenza del gestionale.")


@pytest.fixture
def home(tmp_path):
    return tmp_path


def _insert(home, n, company, title, location, jd, agent="user"):
    env = {**os.environ, "JHT_HOME": str(home), "JHT_AGENT_NAME": agent, "JHT_DB": str(home / "jobs.db")}
    env.pop("JHT_TEST_SKIP", None)
    return subprocess.run([sys.executable, str(SKILLS / "db_insert.py"), "position", "--title", title, "--company", company,
                           "--url", "https://source%d.example/ad/%d" % (n, n), "--source", "source%d" % n, "--found-by", agent,
                           "--location", location, "--remote-type", "onsite", "--jd-text", jd],
                          capture_output=True, text=True, env=env, timeout=60)


def _count(home):
    return sqlite3.connect(str(home / "jobs.db")).execute("SELECT COUNT(*) FROM positions").fetchone()[0]


def test_the_same_text_under_another_company_title_and_url_is_a_duplicate(home):
    first = _insert(home, 1, "Randstad Professional Italia", "Infermiere per centro di riabilitazione Torino", "Turin, Piedmont, Italy", AD)
    assert first.returncode == 0, first.stdout + first.stderr
    again = _insert(home, 2, "Randstad Healthcare", "infermiere", "Torino, Piemonte, Italia", AD)
    assert again.returncode == 1 and "DUPLICATE (testo dell'annuncio+city-norm)" in again.stdout, again.stdout + again.stderr
    assert "already exists as #1" in again.stdout and _count(home) == 1


def test_a_text_that_a_source_cut_or_added_to_is_still_the_same_ad(home):
    assert _insert(home, 1, "A", "Infermiere", "Torino", AD).returncode == 0
    framed = "Descrizione dell'offerta di lavoro. " + AD[: len(AD) - 90] + " Candidati ora sul nostro portale."
    again = _insert(home, 2, "B", "Infermiere reparto", "Torino", framed)
    assert again.returncode == 1 and "DUPLICATE" in again.stdout, again.stdout


def test_the_same_text_in_another_city_is_another_offer(home):
    assert _insert(home, 1, "Gi Group", "Magazziniere", "Brescia", OTHER_AD).returncode == 0
    other = _insert(home, 2, "Gi Group", "Magazziniere", "Bergamo", OTHER_AD)
    assert other.returncode == 0 and _count(home) == 2, other.stdout


def test_different_ads_in_the_same_city_are_both_inserted(home):
    assert _insert(home, 1, "A", "Infermiere", "Torino", AD).returncode == 0
    assert _insert(home, 2, "B", "Magazziniere", "Torino", OTHER_AD).returncode == 0
    assert _count(home) == 2


def test_a_text_too_short_to_be_an_ad_decides_nothing(home):
    assert _insert(home, 1, "A", "Infermiere", "Torino", "Cerchiamo un infermiere a Torino").returncode == 0
    assert _insert(home, 2, "B", "Infermiere", "Torino", "Cerchiamo un infermiere a Torino").returncode == 0
    assert _count(home) == 2


def test_the_shingles_ignore_case_accents_and_spacing_and_need_forty_words():
    mine = db_insert._jd_shingles(AD)
    assert mine and db_insert._jd_shingles(AD.upper().replace(" ", "  ")) == mine
    assert db_insert._jd_shingles("poche parole") is None and db_insert._jd_shingles(None) is None
