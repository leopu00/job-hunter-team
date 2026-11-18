"""The office coordinates and the company logo of a checked position, by code (T325 A).

`position_enrich.py` runs as the team runs it, in its own interpreter, on a database and a home of its own, with synthetic
ads. Nothing reaches a network: a fake `curl` in front of the PATH answers for Nominatim and for the company sites and
writes down every request it gets (URL and User-Agent), and a `sitecustomize` answers the DNS with an address it
calls public.

What must hold:
  - an address written in the ad, in the position's city, becomes coordinates (address = verified, street = not);
  - anything else stays NULL with its reason: no address, two addresses, an answer in another city, Nominatim refusing
    or off, the policy off, a remote position. No city pin, no estimate;
  - Nominatim gets our User-Agent, only the street and the city, at most one request a second, the same query once
    (cache), and nothing for ten minutes after a 429;
  - the logo comes from the company's own site, never from a job board, an ATS or an agency's domain;
  - the backlog takes the checked positions the step never settled; db_update starts the step when a position becomes
    checked, detached, and only when allowed.
"""
from __future__ import annotations

import json
import os
import sqlite3
import struct
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

REPO = Path(__file__).resolve().parent.parent
SKILLS = REPO / "shared" / "skills"
ENRICH = SKILLS / "position_enrich.py"
DB_UPDATE = SKILLS / "db_update.py"

FAKE_CURL = r'''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
url = args[-1]
ua = args[args.index("--user-agent") + 1] if "--user-agent" in args else ""
with open(os.environ["FAKE_WEB_LOG"], "a", encoding="utf-8") as log:
    log.write(json.dumps({"url": url, "ua": ua}) + "\n")
rules = json.load(open(os.environ["FAKE_WEB"], encoding="utf-8"))
for rule in rules:
    if rule["match"] in url:
        body = bytes.fromhex(rule["hex"]) if "hex" in rule else rule.get("body", "").encode("utf-8")
        sys.stdout.buffer.write(body + ("\n%d 000 " % rule["status"]).encode())
        sys.exit(0)
sys.stdout.buffer.write(b"\n404 000 ")
'''

# Every name resolves to a documentation address (RFC 5737), which this fake world alone calls public.
SITECUSTOMIZE = '''
import ipaddress, socket
_is_global = ipaddress.IPv4Address.is_global
ipaddress.IPv4Address.is_global = property(lambda self: str(self) == "192.0.2.10" or _is_global.fget(self))
def _public(host, port, *args, **kwargs):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.10", port or 443))]
socket.getaddrinfo = _public
'''


def _png(side: int = 64) -> bytes:
    ihdr = struct.pack(">IIBBBBB", side, side, 8, 6, 0, 0, 0)
    pad = b"x" * 400
    return (b"\x89PNG\r\n\x1a\n" + struct.pack(">I", len(ihdr)) + b"IHDR" + ihdr + b"\0\0\0\0"
            + struct.pack(">I", len(pad)) + b"tEXt" + pad + b"\0\0\0\0")


ROMA_ANSWER = [{"lat": "41.9178", "lon": "12.5089", "display_name": "45, Via Tagliamento, Trieste, Roma, Lazio, 00198, Italia",
                "addresstype": "building", "address": {"house_number": "45", "road": "Via Tagliamento", "suburb": "Trieste",
                                                       "city": "Roma", "postcode": "00198", "country_code": "it"}}]
STREET_ANSWER = [{"lat": "41.91", "lon": "12.50", "display_name": "Via Tagliamento, Roma, Italia", "addresstype": "road",
                  "address": {"road": "Via Tagliamento", "city": "Roma", "country_code": "it"}}]
MILANO_ANSWER = [{"lat": "45.48", "lon": "9.20", "display_name": "45, Via Tagliamento, Milano, Italia", "addresstype": "building",
                  "address": {"house_number": "45", "road": "Via Tagliamento", "city": "Milano", "country_code": "it"}}]

AD_ROMA = ("Cerchiamo un'impiegata amministrativa per la nostra sede. Vieni a trovarci in Via Tagliamento 45, 00198 Roma. "
           "Contratto a tempo indeterminato, 3 giorni in ufficio.")


class Home:
    def __init__(self, root: Path, monkeypatch):
        self.root = root
        self.db = root / "jobs.db"
        (root / "profile").mkdir(parents=True)
        fake = root / "fake"
        (fake / "bin").mkdir(parents=True)
        (fake / "py").mkdir()
        curl = fake / "bin" / "curl"
        curl.write_text(FAKE_CURL, encoding="utf-8")
        curl.chmod(0o755)
        (fake / "py" / "sitecustomize.py").write_text(SITECUSTOMIZE, encoding="utf-8")
        self.rules_path = fake / "rules.json"
        self.log_path = fake / "requests.jsonl"
        self.rules([])
        env = {k: v for k, v in os.environ.items() if not k.startswith(("JHT_", "FAKE_")) and not k.lower().endswith("_proxy")}
        env.update(JHT_DB=str(self.db), PATH=f"{fake / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}",
                   PYTHONPATH=str(fake / "py"), FAKE_WEB=str(self.rules_path), FAKE_WEB_LOG=str(self.log_path),
                   PYTHONDONTWRITEBYTECODE="1", JHT_POSITION_ENRICH="0", JHT_EVENT_WAKE="0")
        self.env = env
        seed = ("import sys; sys.path.insert(0, %r)\nfrom _db import get_db, ensure_schema\n"
                "c = get_db(); ensure_schema(c); c.commit(); c.close()" % str(SKILLS))
        done = subprocess.run([sys.executable, "-c", seed], env=env, capture_output=True, text=True, timeout=60)
        assert done.returncode == 0, done.stderr

    def rules(self, rules: list[dict]) -> None:
        self.rules_path.write_text(json.dumps(rules), encoding="utf-8")

    def nominatim(self, answer, status: int = 200) -> dict:
        return {"match": "nominatim.openstreetmap.org/search", "status": status, "body": json.dumps(answer)}

    def requests(self) -> list[dict]:
        if not self.log_path.exists():
            return []
        return [json.loads(line) for line in self.log_path.read_text(encoding="utf-8").splitlines()]

    def sql(self, query: str, params=()):
        conn = sqlite3.connect(self.db)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(query, params).fetchall()
            conn.commit()
            return rows
        finally:
            conn.close()

    def company(self, name: str, website: str | None = None) -> int:
        self.sql("INSERT INTO companies (name, website) VALUES (?, ?)", (name, website))
        return self.sql("SELECT id FROM companies WHERE name = ?", (name,))[0]["id"]

    def position(self, *, company="Acme Robotics", jd=AD_ROMA, city="Roma", cc="IT", status="checked", work_mode="hybrid",
                 url="linkedin", website=None, row=True) -> int:
        if url == "linkedin":  # the default: an ad on a job board, a different one each time (positions.url is unique)
            url = f"https://www.linkedin.com/jobs/view/{len(self.sql('SELECT id FROM positions')) + 1}"
        if row is False:  # the ad names a company the database has no row for
            cid = None
        else:
            rows = self.sql("SELECT id FROM companies WHERE name = ?", (company,))
            cid = rows[0]["id"] if rows else self.company(company, website)
        self.sql("INSERT INTO positions (title, company, company_id, status, jd_text, loc_city, loc_country_code, work_mode, url) "
                 "VALUES ('Impiegata', ?, ?, ?, ?, ?, ?, ?, ?)", (company, cid, status, jd, city, cc, work_mode, url))
        return self.sql("SELECT MAX(id) AS id FROM positions")[0]["id"]

    def policy(self, data: dict) -> None:
        (self.root / "profile" / "enrichment-policy.json").write_text(json.dumps(data), encoding="utf-8")

    def run(self, *args: str, **extra) -> dict:
        done = subprocess.run([sys.executable, str(ENRICH), *args], env={**self.env, **extra}, capture_output=True,
                              text=True, timeout=120)
        assert done.returncode == 0, done.stdout + done.stderr
        return json.loads(done.stdout.strip().splitlines()[-1])

    def office(self, pid: int) -> dict:
        row = self.sql("SELECT office_lat, office_lon, office_address, office_geocoded, office_verified, location_precision "
                       "FROM positions WHERE id = ?", (pid,))[0]
        return dict(row)

    def events(self, target_type: str, target_id: int) -> list[tuple]:
        return [(r["action"], r["outcome"], r["field"]) for r in self.sql(
            "SELECT action, outcome, field FROM maintenance_events WHERE by_agent = 'position-enrich' AND target_type = ? "
            "AND target_id = ? ORDER BY id", (target_type, target_id))]


@pytest.fixture()
def home(tmp_path, monkeypatch):
    return Home(tmp_path / "home", monkeypatch)


NOTHING = {"office_lat": None, "office_lon": None, "office_address": None, "office_geocoded": 0, "office_verified": 0,
           "location_precision": None}


# ── coordinates ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_address_of_the_ad_in_the_position_s_city_becomes_a_verified_office(home):
    pid = home.position()
    home.rules([home.nominatim(ROMA_ANSWER)])
    answer = home.run("position", str(pid))
    assert answer["office"] == {"done": True, "precision": "address"}
    office = home.office(pid)
    assert (office["office_lat"], office["office_lon"]) == (41.9178, 12.5089)
    assert office["office_address"] == ROMA_ANSWER[0]["display_name"]
    assert (office["office_geocoded"], office["office_verified"], office["location_precision"]) == (1, 1, "address")
    assert ("geocode", "updated", "office_lat") in home.events("position", pid)
    [sent] = [r for r in home.requests() if "nominatim" in r["url"]]
    query = parse_qs(urlsplit(sent["url"]).query)
    assert query["q"] == ["Via Tagliamento 45, Roma"], "only the street, the number and the city"
    assert query["countrycodes"] == ["it"] and query["limit"] == ["1"]
    assert sent["ua"].startswith("JobHunterTeam-enrich/") and "github.com" in sent["ua"]


def test_a_street_without_its_number_is_written_as_a_street_and_not_verified(home):
    pid = home.position()
    home.rules([home.nominatim(STREET_ANSWER)])
    assert home.run("position", str(pid))["office"] == {"done": True, "precision": "street"}
    office = home.office(pid)
    assert (office["office_geocoded"], office["office_verified"], office["location_precision"]) == (1, 0, "street")


@pytest.mark.parametrize(("jd", "answer", "reason", "asked", "outcome"), [
    ("Lavoro in sede a Roma, 3 giorni in ufficio, 20 persone.", ROMA_ANSWER, "no_address_in_ad", False, "skipped"),
    ("Sedi: Via Tagliamento 45, 00198 Roma e Via Nazionale 10, 00184 Roma.", ROMA_ANSWER, "several_addresses_in_ad", False,
     "skipped"),
    ("Siamo in Via Tagliamento 45, 20121 Milano.", ROMA_ANSWER, "no_address_in_ad", False, "skipped"),
    (AD_ROMA, MILANO_ANSWER, "not_in_city", True, "failed"),
    (AD_ROMA, [], "not_found", True, "failed"),
    (AD_ROMA, [{"lat": "41.9", "lon": "12.5", "display_name": "Roma, Lazio, Italia", "addresstype": "city",
                "address": {"city": "Roma", "country_code": "it"}}], "not_found", True, "failed"),
    ("", ROMA_ANSWER, "no_ad_text", False, "skipped"),
], ids=["no-address", "two-addresses", "address-of-another-city", "answer-in-another-city", "nothing-found", "city-pin",
        "no-text"])
def test_what_cannot_be_found_stays_null_with_its_reason(home, jd, answer, reason, asked, outcome):
    pid = home.position(jd=jd)
    home.rules([home.nominatim(answer)])
    assert home.run("position", str(pid))["office"] == {"done": False, "reason": reason}
    assert home.office(pid) == NOTHING, "never a city pin, never an estimate"
    assert any("nominatim" in r["url"] for r in home.requests()) == asked
    assert home.events("position", pid) == [("geocode", outcome, None)]


@pytest.mark.parametrize(("setup", "reason"), [
    ({"work_mode": "remote"}, "remote"),
    ({"city": None}, "no_city"),
])
def test_a_remote_position_or_one_without_a_city_asks_nothing(home, setup, reason):
    pid = home.position(**setup)
    home.rules([home.nominatim(ROMA_ANSWER)])
    assert home.run("position", str(pid))["office"]["reason"] == reason
    assert not [r for r in home.requests() if "nominatim" in r["url"]]
    assert home.office(pid) == NOTHING


@pytest.mark.parametrize("policy", [{"geocode_pipeline": {"enabled": False}}, {"economy": True}])
def test_the_geocoding_switch_off_asks_nothing_and_writes_nothing(home, policy):
    home.policy(policy)
    pid = home.position()
    home.rules([home.nominatim(ROMA_ANSWER)])
    assert home.run("position", str(pid))["office"] == {"done": False, "reason": "policy_off"}
    assert not [r for r in home.requests() if "nominatim" in r["url"]]
    assert home.events("position", pid) == []


def test_jht_nominatim_0_turns_nominatim_off_without_an_update(home):
    pid = home.position()
    home.rules([home.nominatim(ROMA_ANSWER)])
    assert home.run("position", str(pid), JHT_NOMINATIM="0")["office"] == {"done": False, "reason": "nominatim_off"}
    assert home.requests() == [] or not [r for r in home.requests() if "nominatim" in r["url"]]
    assert home.office(pid) == NOTHING


def test_a_position_already_geocoded_is_left_alone(home):
    pid = home.position()
    home.sql("UPDATE positions SET office_geocoded = 1 WHERE id = ?", (pid,))
    assert home.run("position", str(pid))["office"] == {"done": False, "reason": "already_done"}
    assert not [r for r in home.requests() if "nominatim" in r["url"]]


def test_the_same_query_is_sent_once_and_a_second_request_waits_a_second(home):
    first, second = home.position(), home.position(company="Beta Servizi")
    home.rules([home.nominatim(ROMA_ANSWER)])
    home.run("position", str(first))
    home.run("position", str(second))
    assert len([r for r in home.requests() if "nominatim" in r["url"]]) == 1, "the cache answers the second"
    other = home.position(company="Gamma", jd=AD_ROMA.replace("Via Tagliamento 45", "Via Po 2"))
    state = home.root / "state" / "nominatim.json"
    last = json.loads(state.read_text(encoding="utf-8"))["last"]
    state.write_text(json.dumps({"last": time.time()}), encoding="utf-8")
    started = time.monotonic()
    home.run("position", str(other))
    assert time.monotonic() - started >= 1.0, "one request a second for the whole team"
    assert last > 0


def test_a_429_pauses_nominatim_for_everyone_and_the_backlog_retries_later(home):
    first, second = home.position(), home.position(company="Beta", jd=AD_ROMA.replace("45", "47"))
    home.rules([home.nominatim({"error": "too many"}, status=429)])
    assert home.run("position", str(first))["office"] == {"done": False, "reason": "rate_limited"}
    assert home.run("position", str(second))["office"] == {"done": False, "reason": "rate_limited"}
    assert len([r for r in home.requests() if "nominatim" in r["url"]]) == 1, "paused: the second is not sent"
    assert home.events("position", first) == [("geocode", "unreachable", None)]
    paused = json.loads((home.root / "state" / "nominatim.json").read_text(encoding="utf-8"))["paused_until"]
    assert paused - time.time() > 500
    # «unreachable» is not settled: the backlog takes them again
    (home.root / "state" / "nominatim.json").write_text("{}", encoding="utf-8")
    home.rules([home.nominatim(ROMA_ANSWER)])
    done = home.run("backlog", "--limit", "5")
    assert done["offices_written"] >= 1


# ── logo ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
def _site(home: Home, host: str) -> None:
    html = '<html><head><link rel="apple-touch-icon" href="/icon.png"></head></html>'
    home.rules([{"match": f"https://{host}/icon.png", "status": 200, "hex": _png().hex()},
                {"match": f"https://{host}", "status": 200, "body": html}])


def test_the_logo_comes_from_the_company_s_own_domain_of_the_ad(home):
    pid = home.position(jd="Lavoro a Roma.", url="https://careers.acme-robotics.it/jobs/42")
    _site(home, "acme-robotics.it")
    answer = home.run("position", str(pid))
    assert answer["logo"] == {"done": True, "site": "https://acme-robotics.it"}
    row = home.sql("SELECT logo, logo_source, logo_fetched FROM companies WHERE name = 'Acme Robotics'")[0]
    assert row["logo"].startswith("data:image/png;base64,") and row["logo_fetched"] == 1
    assert row["logo_source"] == "https://acme-robotics.it/icon.png"
    assert all(urlsplit(r["url"]).hostname == "acme-robotics.it" for r in home.requests())


def test_the_site_already_known_wins_over_the_ad(home):
    pid = home.position(jd="Lavoro a Roma.", url="https://jobs.lever.co/acme/1", website="https://www.acme.example")
    _site(home, "www.acme.example")
    assert home.run("position", str(pid))["logo"]["done"] is True


@pytest.mark.parametrize(("url", "company", "reason"), [
    ("https://it.indeed.com/viewjob?jk=1", "Acme Robotics", "portal_domain"),
    ("https://www.linkedin.com/jobs/view/1", "Acme Robotics", "portal_domain"),
    ("https://boards.greenhouse.io/acme/jobs/1", "Acme Robotics", "portal_domain"),
    ("https://www.infojobs.it/offerta/1", "Acme Robotics", "portal_domain"),
    ("https://www.randstad.it/offerte-lavoro/1", "Acme Robotics", "portal_domain"),
    ("https://www.hays.it/job/1", "Acme Robotics", "site_not_the_company"),
    (None, "Acme Robotics", "no_company_site"),
], ids=["indeed", "linkedin", "greenhouse", "infojobs", "randstad", "agency", "no-url"])
def test_a_portal_or_an_agency_is_never_taken_for_the_company_s_site(home, url, company, reason):
    pid = home.position(jd="Lavoro a Roma.", url=url, company=company)
    _site(home, "www.hays.it")
    answer = home.run("position", str(pid))
    assert answer["logo"] == {"done": False, "reason": reason}
    assert home.requests() == [], "no page of the portal or of the agency is opened"
    cid = home.sql("SELECT id FROM companies WHERE name = ?", (company,))[0]["id"]
    assert home.events("company", cid) == [("logo_fetch", "skipped", None)]
    assert home.sql("SELECT logo, logo_fetched FROM companies WHERE id = ?", (cid,))[0]["logo"] is None


def test_a_site_without_a_usable_logo_leaves_it_null_and_says_so(home):
    pid = home.position(jd="Lavoro a Roma.", url="https://acme-robotics.it/lavora-con-noi")
    home.rules([{"match": "https://acme-robotics.it", "status": 200, "body": "<html></html>"}])
    assert home.run("position", str(pid))["logo"] == {"done": False, "reason": "no_candidate",
                                                      "site": "https://acme-robotics.it"}
    row = home.sql("SELECT logo, logo_fetched FROM companies WHERE name = 'Acme Robotics'")[0]
    assert (row["logo"], row["logo_fetched"]) == (None, 0), "the Analista and the care queue can still try"


def test_the_logo_switch_off_fetches_nothing(home):
    home.policy({"logo": {"enabled": False}})
    pid = home.position(jd="Lavoro a Roma.", url="https://acme-robotics.it/jobs")
    _site(home, "acme-robotics.it")
    assert home.run("position", str(pid))["logo"]["reason"] == "policy_off"
    assert home.requests() == []


# ── backlog, the hook in db_update, the log ──────────────────────────────────────────────────────────────────────────
def test_the_backlog_takes_the_checked_positions_the_step_never_settled(home):
    settled = home.position(jd="Lavoro a Roma.", company="Uno")
    home.run("position", str(settled))  # no address: settled as skipped, never asked again
    new = home.position(status="new", company="Due")
    excluded = home.position(status="excluded", company="Tre")
    todo = home.position(company="Quattro")
    home.rules([home.nominatim(ROMA_ANSWER)])
    done = home.run("backlog", "--limit", "10")
    taken = {r["position_id"] for r in done["results"]}
    assert todo in taken and settled not in taken and new not in taken and excluded not in taken
    assert done["offices_written"] == 1
    assert home.run("backlog", "--limit", "1")["positions"] <= 1


def test_the_backlog_uses_the_care_queue_switch(home):
    home.policy({"geocode_missing": {"enabled": False}, "geocode_pipeline": {"enabled": True}})
    pid = home.position()
    home.rules([home.nominatim(ROMA_ANSWER)])
    assert home.run("backlog")["results"][0]["office"]["reason"] == "policy_off"
    assert home.run("position", str(pid))["office"]["done"] is True


def test_the_log_says_the_reasons_and_nothing_of_the_ad(home):
    pid = home.position()
    home.rules([home.nominatim(MILANO_ANSWER)])
    home.run("position", str(pid))
    lines = (home.root / "logs" / "position-enrich.jsonl").read_text(encoding="utf-8").splitlines()
    row = json.loads(lines[-1])
    assert row["position_id"] == pid and row["office"] == "not_in_city" and row["mode"] == "pipeline"
    assert "Tagliamento" not in lines[-1] and "Roma" not in lines[-1]


def test_db_update_starts_the_step_when_a_position_becomes_checked(home):
    pid = home.position(status="new", jd="Lavoro a Roma.", url=None)
    done = subprocess.run([sys.executable, str(DB_UPDATE), "position", str(pid), "--status", "checked",
                           "--loc-city", "Roma", "--loc-country", "Italy"],
                          env={**home.env, "JHT_POSITION_ENRICH": "1"}, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr
    log = home.root / "logs" / "position-enrich.jsonl"
    deadline = time.monotonic() + 20
    while not log.exists() and time.monotonic() < deadline:
        time.sleep(0.2)
    assert log.exists(), "the detached step ran"
    assert json.loads(log.read_text(encoding="utf-8").splitlines()[-1])["position_id"] == pid


def test_the_step_starts_only_when_allowed_and_never_breaks_the_writer(monkeypatch):
    sys.path.insert(0, str(SKILLS))
    try:
        import position_enrich
    finally:
        sys.path.remove(str(SKILLS))
    started = []
    monkeypatch.setattr(position_enrich.subprocess, "Popen", lambda *a, **k: started.append(a[0]))
    assert position_enrich.spawn(7, environ={"JHT_POSITION_ENRICH": "0"}) is False
    assert position_enrich.spawn(7, environ={}) is False, "outside the image, unset = off"
    assert position_enrich.spawn(7, environ={"JHT_POSITION_ENRICH": "1"}) is True
    assert started[-1][-2:] == ["position", "7"]

    def boom(*_a, **_k):
        raise OSError("no fork")
    monkeypatch.setattr(position_enrich.subprocess, "Popen", boom)
    assert position_enrich.spawn(7, environ={"JHT_POSITION_ENRICH": "1"}) is False


def test_a_new_or_excluded_position_is_not_touched(home):
    for status in ("new", "excluded"):
        pid = home.position(status=status, company=status)
        home.rules([home.nominatim(ROMA_ANSWER)])
        answer = home.run("position", str(pid))
        assert answer["office"]["done"] is False and answer["logo"]["done"] is False
    assert home.requests() == []


def test_an_unknown_position_is_an_error():
    env = {k: v for k, v in os.environ.items() if not k.startswith("JHT_")}
    done = subprocess.run([sys.executable, str(ENRICH), "position", "999"], capture_output=True, text=True, timeout=60,
                          env={**env, "JHT_DB": str(Path(os.environ.get("TMPDIR", "/tmp")) / f"pe-{os.getpid()}.db")})
    assert done.returncode == 1 and json.loads(done.stdout)["ok"] is False


# ── the company of the ad: created, linked, the logo tried again (T325 B) ────────────────────────────────────────────
def test_a_direct_employer_without_a_row_gets_one_from_the_ad_and_its_logo(home):
    pid = home.position(company="Acme Robotics", row=False, jd="Acme Robotics cerca un manutentore a Roma.",
                        url="https://careers.acme-robotics.it/jobs/7")
    other = home.position(company="ACME ROBOTICS S.p.A.", row=False, jd="Manutentore.", status="new")
    _site(home, "acme-robotics.it")
    answer = home.run("position", str(pid))
    cid = home.sql("SELECT id FROM companies WHERE name = 'Acme Robotics'")[0]["id"]
    assert answer["logo"] == {"done": True, "site": "https://acme-robotics.it", "company_created": cid}
    assert [r["company_id"] for r in home.sql("SELECT company_id FROM positions WHERE id IN (?, ?) ORDER BY id",
                                               (pid, other))] == [cid, cid]
    row = home.sql("SELECT logo, analyzed_by, verdict FROM companies WHERE id = ?", (cid,))[0]
    assert row["logo"].startswith("data:image/png") and row["verdict"] is None, "the Analista still judges it"


def test_a_direct_employer_on_a_board_gets_its_row_and_the_logo_stays_null_with_the_reason(home):
    pid = home.position(company="Omega Trasporti", row=False, jd="Omega Trasporti, servizio tranviario di Roma.")
    answer = home.run("position", str(pid))
    assert answer["logo"]["reason"] == "portal_domain" and answer["logo"]["company_created"]
    assert home.requests() == []


@pytest.mark.parametrize(("company", "jd", "reason"), [
    ("Alfa Lavoro S.p.A.", "Cerchiamo un elettricista.", "intermediary"),
    ("Beta Impianti (azienda cliente non nominata)", "Cerchiamo un elettricista.", "intermediary"),
    ("Servizi tecnici (tramite Gamma)", "Cerchiamo un elettricista.", "intermediary"),
    ("Delta Srl", "Delta Srl - Agenzia per il Lavoro (Aut. Min. 0000) cerca un elettricista.", "intermediary"),
    ("Epsilon", "Epsilon, per conto di azienda cliente del settore, ricerca un elettricista.", "intermediary"),
    ("Zeta", "Zeta ricerca, per un\u2019importante realt\u00e0 operante nel settore, un elettricista.", "intermediary"),
    ("Eta Search", "Our client, a leading manufacturer, is hiring an electrician.", "intermediary"),
    ("Theta", "Im Auftrag unseres Kunden suchen wir einen Elektriker.", "intermediary"),
    ("talent.com", "Cerchiamo un elettricista.", "portal_name"),
    ("Indeed", "Cerchiamo un elettricista.", "portal_name"),
    ("", "Cerchiamo un elettricista.", "no_company"),
], ids=["agency-name", "unnamed-client", "through", "agency-text", "for-a-client", "for-a-firm", "our-client",
        "im-auftrag", "board-domain", "board-name", "no-name"])
def test_an_agency_an_unnamed_client_or_a_board_gets_no_row(home, company, jd, reason):
    pid = home.position(company=company, row=False, jd=jd, url="https://careers.example.com/jobs/1")
    answer = home.run("position", str(pid))
    assert answer["logo"] == {"done": False, "reason": reason}
    assert home.sql("SELECT COUNT(*) AS n FROM companies")[0]["n"] == 0
    assert home.requests() == []
    assert home.events("position", pid)[-1] == ("logo_fetch", "skipped", None), "settled: the backlog leaves it"
    assert pid not in {r["position_id"] for r in home.run("backlog")["results"]}


def test_the_dry_run_says_which_company_it_would_create_and_creates_none(home):
    pid = home.position(company="Acme Robotics", row=False, jd="Lavoro a Roma.")
    assert home.run("position", str(pid), "--dry-run")["logo"] == {"done": False, "reason": "no_company",
                                                                  "would_create": "Acme Robotics"}
    assert home.sql("SELECT COUNT(*) AS n FROM companies")[0]["n"] == 0


def test_the_logo_switch_off_creates_no_row_either(home):
    home.policy({"logo": {"enabled": False}})
    pid = home.position(company="Acme Robotics", row=False, jd="Lavoro a Roma.")
    assert home.run("position", str(pid))["logo"]["reason"] == "policy_off"
    assert home.sql("SELECT COUNT(*) AS n FROM companies")[0]["n"] == 0


def test_the_company_of_another_legal_form_is_the_position_s_company(home):
    cid = home.company("Kappa Italia")
    pid = home.position(company="Kappa Italia S.p.a.", row=False, jd="Lavoro a Roma.",
                        url="https://lavora.kappa-italia.it/1")
    _site(home, "kappa-italia.it")
    assert home.run("position", str(pid))["logo"] == {"done": True, "site": "https://kappa-italia.it"}
    assert home.sql("SELECT logo_fetched FROM companies WHERE id = ?", (cid,))[0]["logo_fetched"] == 1
    assert home.sql("SELECT COUNT(*) AS n FROM companies")[0]["n"] == 1, "no second row"


def test_a_company_created_after_the_step_gets_its_logo_from_the_company_command(home):
    # the Analista creates the company in the same second as the step, which did not see it: the step said
    # «intermediary» (the ad is through a client), then the company arrives and is linked
    pid = home.position(company="Lambda Impianti", row=False, url="https://jobs.lambda-impianti.it/9",
                        jd="Lambda Impianti, per conto di azienda cliente, cerca un elettricista.")
    assert home.run("position", str(pid))["logo"]["reason"] == "intermediary"
    done = subprocess.run([sys.executable, str(SKILLS / "db_insert.py"), "company", "--name", "Lambda Impianti"],
                          env=home.env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr
    cid = home.sql("SELECT company_id FROM positions WHERE id = ?", (pid,))[0]["company_id"]
    assert cid
    _site(home, "lambda-impianti.it")
    answer = home.run("company", str(cid))
    assert answer["logo"] == {"done": True, "site": "https://lambda-impianti.it"}
    row = json.loads((home.root / "logs" / "position-enrich.jsonl").read_text(encoding="utf-8").splitlines()[-1])
    assert row["company_id"] == cid and row["mode"] == "company" and row["logo"] == "written"


def test_the_company_command_without_a_checked_position_fetches_nothing(home):
    cid = home.company("Mu Servizi")
    home.position(company="Mu Servizi", status="new", url="https://mu-servizi.it/jobs/1")
    _site(home, "mu-servizi.it")
    assert home.run("company", str(cid))["logo"] == {"done": False, "reason": "no_position"}
    assert home.requests() == []


@pytest.mark.parametrize("script", ["db_insert.py", "db_update.py"])
def test_linking_positions_to_a_company_starts_the_company_step(home, script):
    pid = home.position(company="Nu Elettrica S.r.l.", row=False, jd="Lavoro a Roma.")
    if script == "db_update.py":
        home.company("Nu Elettrica")
        args = ["company", "Nu Elettrica", "--sector", "Impianti"]
    else:
        args = ["company", "--name", "Nu Elettrica"]
    done = subprocess.run([sys.executable, str(SKILLS / script), *args], env={**home.env, "JHT_POSITION_ENRICH": "1"},
                          capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr
    cid = home.sql("SELECT company_id FROM positions WHERE id = ?", (pid,))[0]["company_id"]
    assert cid
    log = home.root / "logs" / "position-enrich.jsonl"
    deadline = time.monotonic() + 20
    while not log.exists() and time.monotonic() < deadline:
        time.sleep(0.2)
    assert log.exists(), "the detached company step ran"
    assert json.loads(log.read_text(encoding="utf-8").splitlines()[-1]) | {"at": 0} == {
        "at": 0, "company_id": cid, "logo": "portal_domain", "mode": "company"}


def test_the_company_step_starts_only_when_allowed_and_the_step_s_own_writes_start_nothing(monkeypatch):
    sys.path.insert(0, str(SKILLS))
    try:
        import position_enrich
    finally:
        sys.path.remove(str(SKILLS))
    started = []
    monkeypatch.setattr(position_enrich.subprocess, "Popen", lambda *a, **k: started.append(a[0]))
    assert position_enrich.spawn_company(3, environ={"JHT_POSITION_ENRICH": "0"}) is False
    assert position_enrich.spawn_company(3, environ={}) is False
    assert position_enrich.spawn_company(3, environ={"JHT_POSITION_ENRICH": "1"}) is True
    assert started[-1][-2:] == ["company", "3"]
    seen = {}
    monkeypatch.setattr(position_enrich.subprocess, "run", lambda *a, **k: seen.update(k["env"]))
    monkeypatch.setenv("JHT_POSITION_ENRICH", "1")
    position_enrich._skill("db_insert.py", "company", "--name", "X")
    assert seen["JHT_POSITION_ENRICH"] == "0", "a company the step creates does not start a second step for itself"


@pytest.mark.parametrize(("company", "jd"), [
    ("Allarmi Sicuri", "Manutentore - Roma (Allarmi Sicuri). Assistenza tecnica presso i clienti."),
    ("Tram Dev", "Operatore di manutenzione impianti fissi (Tram Dev, Roma, servizio tranviario)."),
    ("Humana Foods", "Humana Foods cerca un elettricista per lo stabilimento."),
    ("Orientale Costruzioni", "Cerchiamo un elettricista per i nostri cantieri."),
], ids=["clients-of-the-employer", "direct", "umana-inside-a-word", "orienta-inside-a-word"])
def test_a_direct_employer_is_not_taken_for_an_agency(company, jd):
    sys.path.insert(0, str(SKILLS))
    try:
        import position_enrich
    finally:
        sys.path.remove(str(SKILLS))
    assert position_enrich.employer_in_ad(company, jd, None, portals=("linkedin.com",)) == (company, "")
