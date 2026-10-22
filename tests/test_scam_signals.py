"""Segnali anti-truffa deterministici (JHT-T06): un avviso, mai un'esclusione.

Annunci FINTI, uno per segnale, più i falsi positivi che il codice deve lasciare
stare: la stessa azienda che ripubblica in un'altra città, un annuncio che dice
«nessuna quota» e un annuncio vero su un ATS comune.
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import scam_signals as ss  # noqa: E402

DATA = ss.load_data()

# ~120 parole di annuncio, uguali per tutti: il corpo che si "ripubblica"
BODY = (
    "We are looking for a motivated warehouse coordinator to join our logistics team. "
    "You will plan daily shipments, supervise the loading dock, keep the inventory records accurate "
    "and coordinate with carriers and customers about delivery windows. The ideal candidate is "
    "organised, reliable and comfortable working with spreadsheets and scanners. Previous experience "
    "in a similar role is a plus but not required, because we train every new colleague during the "
    "first weeks. We offer a permanent contract, flexible shifts, a canteen, health insurance and a "
    "friendly environment with clear career paths for people who want to grow with the company. "
    "Responsibilities also include preparing weekly reports, checking quality of goods at arrival and "
    "helping the safety officer keep the site compliant with every regulation that applies to it."
)


def position(pid=1, company="Acme Logistics S.r.l.", location="Milano", url="https://boards.greenhouse.io/acme/jobs/1",
             text=BODY, website="https://acme-logistics.example"):
    return {"id": pid, "title": "Warehouse coordinator", "company": company, "location": location,
            "url": url, "jd_text": text, "company_website": website}


def prints(*positions):
    out = {}
    for pos in positions:
        for digest in ss.fingerprints_of(pos, DATA):
            out.setdefault(digest, []).append((pos["id"], ss.company_key(pos["company"])))
    return out


def codes(pos, others=()):
    return ss.evaluate(pos, prints(pos, *others), DATA)["codes"]


# ── un annuncio vero non ha segnali ──

def test_a_real_ad_on_a_common_ats_has_no_signal():
    result = ss.evaluate(position(), prints(position()), DATA)
    assert result["codes"] == [] and result["bucket"] == "none"


# ── same_text_many_places ──

def test_the_same_text_in_two_other_companies_is_a_signal():
    mine = position(1, "Acme Logistics", "Milano")
    others = [position(2, "Globex Trading", "Roma"), position(3, "Initech Freight", "Napoli")]
    assert codes(mine, others) == ["same_text_many_places"]


def test_the_same_company_in_other_cities_is_not_a_signal():
    # agenzie e grandi aziende ripubblicano lo stesso annuncio in più città
    mine = position(1, "Acme Logistics S.r.l.", "Milano")
    others = [position(2, "Acme Logistics", "Roma"), position(3, "ACME LOGISTICS SRL", "Napoli"),
              position(4, "Acme Logistics S.p.A.", "Torino")]
    assert codes(mine, others) == []


def test_the_same_company_never_adds_to_the_count_of_other_companies():
    # Acme in tre città + UN'altra azienda: le aziende diverse sono una sola, non basta
    mine = position(1, "Acme Logistics", "Milano")
    others = [position(2, "Acme Logistics", "Roma"), position(3, "Acme Logistics", "Napoli"),
              position(4, "Globex Trading", "Torino")]
    assert codes(mine, others) == []


def test_a_single_other_company_is_not_enough():
    assert codes(position(1, "Acme", "Milano"), [position(2, "Globex", "Roma")]) == []


def test_the_name_and_the_city_of_each_ad_do_not_hide_the_copy():
    text_a = BODY + " Join Acme in Milano today."
    text_b = BODY + " Join Globex in Roma today."
    text_c = BODY + " Join Initech in Napoli today."
    mine = position(1, "Acme", "Milano", text=text_a)
    others = [position(2, "Globex", "Roma", text=text_b), position(3, "Initech", "Napoli", text=text_c)]
    assert codes(mine, others) == ["same_text_many_places"]


def test_a_different_text_or_a_short_text_is_never_a_copy():
    other_text = " ".join(reversed(BODY.split()))
    assert codes(position(1, "Acme"), [position(2, "Globex", text=other_text),
                                       position(3, "Initech", text=other_text)]) == []
    short = "Warehouse coordinator wanted, apply now."
    assert codes(position(1, "Acme", text=short), [position(2, "Globex", text=short),
                                                   position(3, "Initech", text=short)]) == []


# ── advance_payment ──

@pytest.mark.parametrize("phrase", [
    "A registration fee of 90 euro is due before the first day.",
    "Candidates must pay for your own equipment before starting.",
    "Per iniziare è richiesta una quota di iscrizione al corso.",
    "Es necesario un pago por adelantado del material.",
    "Des frais d'inscription sont à régler avant le début.",
    "Es fällt eine Anmeldegebühr an, bitte vorab überweisen.",
    "É preciso um pagamento antecipado para a formação.",
    "Kérjük, előre fizet a képzési díjat.",
])
def test_an_advance_payment_phrase_in_each_language_is_a_signal(phrase):
    assert "advance_payment" in codes(position(text=BODY + " " + phrase))


@pytest.mark.parametrize("phrase", [
    "We will never ask for a registration fee.",
    "There is no application fee and no training fee at any stage.",
    "Non è richiesta nessuna quota di iscrizione.",
    "Kein Anmeldegebühr, alles ist kostenlos.",
    "Sem pagamento antecipado de qualquer tipo.",
])
def test_a_denied_fee_is_not_a_signal(phrase):
    assert "advance_payment" not in codes(position(text=BODY + " " + phrase))


def test_an_ordinary_payments_job_is_not_a_signal():
    text = BODY + " You will process wire transfers and handle bitcoin exchange reports for our clients."
    assert "advance_payment" not in codes(position(text=text))


# ── company_unverifiable ──

def test_no_website_and_an_unknown_link_is_a_signal():
    pos = position(url="https://jobs-apply-now.example/post/77", website=None)
    assert codes(pos) == ["company_unverifiable"]


@pytest.mark.parametrize("url", [
    "https://boards.greenhouse.io/acme/jobs/1", "https://jobs.lever.co/acme/abc",
    "https://acme.wd3.myworkdayjobs.com/en/ext/job/1", "https://jobs.smartrecruiters.com/Acme/1",
    "https://acme.jobs.personio.de/job/1", "https://acme.teamtailor.com/jobs/1",
    "https://acme.recruitee.com/o/1", "https://apply.workable.com/acme/j/1",
    "https://acme.bamboohr.com/careers/1", "https://careers-acme.icims.com/jobs/1",
    "https://career5.successfactors.eu/sfcareer/jobreqcareer?jobId=1",
    "https://www.linkedin.com/jobs/view/123", "https://www.indeed.com/viewjob?jk=1",
])
def test_the_common_ats_and_portals_are_never_unverifiable(url):
    assert codes(position(url=url, website=None)) == []


def test_a_known_website_makes_the_company_verifiable():
    assert codes(position(url="https://jobs-apply-now.example/post/77", website="https://acme.example")) == []


def test_no_link_to_judge_accuses_nobody():
    assert codes(position(url="", website=None)) == []


# ── private_chat_only ──

@pytest.mark.parametrize("phrase", [
    "To apply, write to us on WhatsApp +00 000 000 0000.",
    "Candidati scrivendoci su Telegram.",
    "Apply here: https://wa.me/390000000000",
    "Contact our recruiter at t.me/recruiter_example",
])
def test_apply_only_through_a_private_chat_is_a_signal(phrase):
    pos = position(url="", website="https://acme.example", text=BODY + " " + phrase)
    assert "private_chat_only" in codes(pos)


def test_a_chat_next_to_an_email_or_a_real_apply_link_is_fine():
    text = BODY + " Questions? Message us on WhatsApp."
    assert "private_chat_only" not in codes(position(text=text))                       # link ATS
    mail = BODY + " Message us on WhatsApp or write to jobs@example.com."
    assert "private_chat_only" not in codes(position(url="", text=mail))               # email


def test_a_chat_word_in_an_engineering_ad_is_not_contact():
    text = BODY + " You will integrate the Telegram bot API into our internal dashboards."
    assert "private_chat_only" not in codes(position(url="", text=text))


# ── la regola 1 / 2 ──

def test_one_signal_is_a_badge_and_two_families_are_the_section():
    one = ss.evaluate(position(text=BODY + " A registration fee is due."), {}, DATA)
    assert (one["codes"], one["bucket"]) == (["advance_payment"], "badge")
    two = ss.evaluate(position(text=BODY + " A registration fee is due. Write to us on WhatsApp.",
                               url="https://jobs-apply-now.example/p/1", website=None), {}, DATA)
    assert set(two["codes"]) == {"advance_payment", "company_unverifiable", "private_chat_only"}
    assert two["bucket"] == "section"


def test_two_signals_of_the_same_family_stay_a_badge():
    mine = position(1, "Acme", text=BODY + " A registration fee is due.")
    others = [position(2, "Globex", text=BODY + " A registration fee is due."),
              position(3, "Initech", text=BODY + " A registration fee is due.")]
    result = ss.evaluate(mine, prints(mine, *others), DATA)
    assert set(result["codes"]) == {"same_text_many_places", "advance_payment"}
    assert result["bucket"] == "badge"


def test_a_real_ad_with_one_false_positive_stays_visible_as_a_badge_only():
    # un annuncio vero che cita una "quota di iscrizione" legittima al sindacato: un segnale, solo badge
    text = BODY + " Il rimborso include la quota di iscrizione all'albo professionale."
    result = ss.evaluate(position(text=text), {}, DATA)
    assert result["bucket"] == "badge" and result["codes"] == ["advance_payment"]


# ── DB: scrive solo i codici, non tocca lo status, non riscrive se non cambia ──

@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    from _db import ensure_schema, get_db
    conn = get_db()
    ensure_schema(conn)
    return conn


def _insert(conn, company, location, text, url=None, status="new"):
    count = conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0]
    url = url or f"https://boards.greenhouse.io/x/{count + 1}"
    cur = conn.execute("INSERT INTO positions (title, company, location, url, jd_text, status) VALUES (?,?,?,?,?,?)",
                       ("Warehouse coordinator", company, location, url, text, status))
    conn.commit()
    return cur.lastrowid


def test_the_check_writes_only_the_codes_and_never_the_status_or_the_text(db):
    pid = _insert(db, "Acme", "Milano", BODY + " A registration fee is due.", status="checked")
    result = ss.check_position(db, pid)
    assert result["codes"] == ["advance_payment"] and result["changed"] is True
    row = db.execute("SELECT status, scam_signals, jd_text FROM positions WHERE id=?", (pid,)).fetchone()
    assert row["status"] == "checked"
    assert json.loads(row["scam_signals"]) == {"v": 1, "codes": ["advance_payment"], "bucket": "badge"}
    assert "registration" not in row["scam_signals"]
    assert row["jd_text"].endswith("A registration fee is due.")


def test_a_second_check_does_not_rewrite_the_row(db):
    pid = _insert(db, "Acme", "Milano", BODY + " A registration fee is due.")
    ss.check_position(db, pid)
    stamp = db.execute("SELECT updated_at FROM positions WHERE id=?", (pid,)).fetchone()[0]
    db.execute("UPDATE positions SET updated_at='2000-01-01 00:00:00' WHERE id=?", (pid,))
    db.commit()
    again = ss.check_position(db, pid)
    assert again["changed"] is False
    assert db.execute("SELECT updated_at FROM positions WHERE id=?", (pid,)).fetchone()[0] == "2000-01-01 00:00:00"
    assert stamp


def test_the_same_text_in_other_companies_is_found_in_the_db(db):
    ids = [_insert(db, name, city, BODY) for name, city in
           (("Acme", "Milano"), ("Globex", "Roma"), ("Initech", "Napoli"))]
    assert ss.check_position(db, ids[0])["codes"] == ["same_text_many_places"]


def test_the_company_website_comes_from_the_companies_table(db):
    db.execute("INSERT INTO companies (name, website) VALUES ('Acme', 'https://acme.example')")
    db.commit()
    pid = _insert(db, "Acme", "Milano", BODY, url="https://jobs-apply-now.example/p/1")
    assert ss.check_position(db, pid)["codes"] == []
    other = _insert(db, "Nameless", "Roma", BODY + " v2", url="https://jobs-apply-now.example/p/2")
    assert ss.check_position(db, other)["codes"] == ["company_unverifiable"]


def test_the_command_line_never_prints_the_ad_and_fences_the_phrase(db, tmp_path):
    pid = _insert(db, "Acme", "Milano", BODY + " Pay a registration fee now.")
    env = {**os.environ, "JHT_DB": str(tmp_path / "jobs.db"), "JHT_HOME": str(tmp_path)}
    run = subprocess.run([sys.executable, str(SKILLS / "scam_signals.py"), "check", "--id", str(pid)],
                         capture_output=True, text=True, env=env)
    assert run.returncode == 0, run.stderr
    out = json.loads(run.stdout)
    assert out["codes"] == ["advance_payment"] and out["bucket"] == "badge"
    phrase = out["evidence"]["advance_payment"]["phrase"]
    assert phrase.startswith("⟦EXT·") and "registration fee" in phrase
    assert "warehouse coordinator to join" not in run.stdout


def test_sweep_checks_only_what_was_never_checked(db, tmp_path):
    a = _insert(db, "Acme", "Milano", BODY + " Pay a registration fee now.")
    _insert(db, "Globex", "Roma", BODY + " clean one")
    db.execute("UPDATE positions SET scam_signals='{\"v\":1,\"codes\":[],\"bucket\":\"none\"}' WHERE company='Globex'")
    db.commit()
    env = {**os.environ, "JHT_DB": str(tmp_path / "jobs.db"), "JHT_HOME": str(tmp_path)}
    run = subprocess.run([sys.executable, str(SKILLS / "scam_signals.py"), "sweep"],
                         capture_output=True, text=True, env=env)
    assert json.loads(run.stdout) == {"checked": 1, "changed": 1, "none": 0, "badge": 1, "section": 0}
    assert json.loads(db.execute("SELECT scam_signals FROM positions WHERE id=?", (a,)).fetchone()[0])["codes"] == [
        "advance_payment"]


def test_a_missing_position_is_reported_not_raised(db, tmp_path):
    env = {**os.environ, "JHT_DB": str(tmp_path / "jobs.db"), "JHT_HOME": str(tmp_path)}
    run = subprocess.run([sys.executable, str(SKILLS / "scam_signals.py"), "check", "--id", "999"],
                         capture_output=True, text=True, env=env)
    assert run.returncode == 2 and json.loads(run.stdout)["error"] == "position_not_found"


def test_the_portal_list_lives_in_the_data_file_not_in_the_code():
    assert "greenhouse.io" in DATA["known_portals"]
    source = (SKILLS / "scam_signals.py").read_text(encoding="utf-8")
    assert "greenhouse" not in source and "myworkdayjobs" not in source


def test_the_codes_may_reach_the_agents_in_all_three_readers():
    """`scam_signals` holds codes and a bucket, never the ad's text: the analyst reads
    it back with db_query, and the harness's native reader and the team API's reader
    list it the same way."""
    import db_query

    assert "scam_signals" in db_query.AGENT_POSITION_COLUMNS
    assert "scam_signals" not in db_query.USER_ONLY_POSITION_COLUMNS
    native = (ROOT / "agent-harness" / "runtime" / "src" / "db" / "db-query.ts").read_text(encoding="utf-8")
    block = native[native.index("export const AGENT_POSITION_COLUMNS"):native.index(".split(/\\s+/)")]
    assert "scam_signals" in block.split()
    api = (ROOT / "shared" / "queries" / "readonly-sqlite.js").read_text(encoding="utf-8")
    assert '"scam_signals",' in api


# ── il valore che va nel cloud (migrazione 096) ──

# Le stesse stringhe sono fissate in tests/js/tasks/scam-signals.test.ts contro il
# canonicalizzatore del web e quello della CLI: tre copie, un solo valore.
def test_the_stored_value_is_the_string_the_cloud_copies_pin():
    every_code = ["same_text_many_places", "advance_payment", "company_unverifiable", "private_chat_only"]
    pinned = {
        '{"bucket":"badge","codes":["advance_payment"],"v":1}': ["advance_payment"],
        '{"bucket":"section","codes":["advance_payment","private_chat_only"],"v":1}': [
            "advance_payment", "private_chat_only"],
        '{"bucket":"section","codes":["same_text_many_places","advance_payment",'
        '"company_unverifiable","private_chat_only"],"v":1}': every_code,
    }
    for expected, codes in pinned.items():
        assert ss.stored_value({"codes": codes, "bucket": ss.bucket_of(codes)}) == expected
    # the longest value the skill can write fits the column's CHECK (a JSON object, 400 characters)
    longest = ss.stored_value({"codes": every_code, "bucket": "section"})
    assert len(longest) <= 400 and longest.startswith("{") and longest.endswith("}")
