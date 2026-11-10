"""Test del registro abbonamenti e dello stato di primo avvio.

Root cause coperta: un utente nuovo (Kimi Allegretto, 39$) accende il team,
guarda dieci minuti e vede comparire UNA posizione grezza — la calibrazione
graduale (1 worker, misura 30 min, sali di un gradino) è corretta a regime
ma al primo avvio è indistinguibile da un guasto. Serviva un roster
dimensionato sull'abbonamento e una definizione di successo diversa:
posizioni CON PUNTEGGIO, non posizioni trovate (il run del 2026-07-26 ne
trovò 50 e ne punteggiò 3).

Eseguire:
    pytest tests/test_first_run_plan.py -v
"""

import importlib
import json
import os
import sqlite3
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')

sys.path.insert(0, SKILLS_DIR)
import plan_registry  # noqa: E402
import i18n  # noqa: E402


@pytest.fixture(autouse=True)
def reset_plan_language(monkeypatch, tmp_path):
    """Every case starts from the English product default."""
    monkeypatch.delenv("JHT_LANG", raising=False)
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_HOST_ENV_FILE", "/nonexistent/jht-host.env")
    i18n._resolve_lang.cache_clear()
    i18n._load_catalog.cache_clear()
    yield
    i18n._resolve_lang.cache_clear()
    i18n._load_catalog.cache_clear()


@pytest.fixture()
def jht_home(tmp_path, monkeypatch):
    """Una $JHT_HOME isolata, con i moduli ricaricati per rileggerla."""
    monkeypatch.setenv('JHT_HOME', str(tmp_path))
    monkeypatch.delenv('JHT_DB', raising=False)
    importlib.reload(plan_registry)
    (tmp_path / 'jht.config.json').write_text(
        json.dumps({"active_provider": "kimi",
                    "providers": {"kimi": {"auth_method": "subscription"}}}),
        encoding='utf-8')
    return tmp_path


@pytest.fixture()
def first_run(jht_home):
    import first_run as mod
    importlib.reload(mod)
    return mod


# ── Il registro ─────────────────────────────────────────────────────────

def test_every_provider_has_plans():
    for provider in ("kimi", "claude", "openai"):
        assert plan_registry.list_plans(provider)[provider]

def test_provider_aliases_resolve():
    assert plan_registry.normalize_provider("codex") == "openai"
    assert plan_registry.normalize_provider("moonshot") == "kimi"
    assert plan_registry.normalize_provider("anthropic") == "claude"


def test_plan_display_defaults_to_english_without_changing_contract(jht_home):
    plans = plan_registry.list_plans("kimi")["kimi"]
    assert [plan["id"] for plan in plans] == [
        "adagio", "moderato", "allegretto", "allegro", "vivace",
    ]
    assert plans[0]["label"] == "Adagio (free)"
    # no price anywhere: they are a third party's, they change, and the registry keeps names and ids only
    assert all("price" not in plan for plan in plans)
    assert [plan["tier"] for plan in plans] == [0.2, 1, 5, 15, 30]
    assert all(plan["weekly_capped"] is True for plan in plans)


def test_plan_display_uses_the_existing_backend_catalog(jht_home, monkeypatch):
    monkeypatch.setenv("JHT_LANG", "it")
    i18n._resolve_lang.cache_clear()
    plans = plan_registry.list_plans("kimi")["kimi"]
    assert plans[0]["label"] == "Adagio (gratuito)"
    assert plans[1]["label"] == "Moderato" and "price" not in plans[1]


def test_plan_catalog_keys_exist_in_all_seven_languages():
    keys = {
        "plan.free", "plan.unknown",
        "plan.not_selected", "plan.select_hint", "plan.none_known",
        "plan.weekly_cap", "plan.no_weekly_cap", "plan.window_5h",
        "plan.no_window_5h", "plan.usage_pair", "plan.usage_single",
        "plan.codex_reports", "plan.codex_reports_unlisted", "plan.config_unreadable",
    }
    locales = os.path.join(REPO_ROOT, "shared", "locales")
    for lang in ("en", "it", "es", "fr", "de", "pt", "hu"):
        with open(os.path.join(locales, f"{lang}.json"), encoding="utf-8") as fh:
            assert keys <= set(json.load(fh)), lang


def test_no_plan_is_weekly_unlimited():
    """Il 403 'billing cycle' preso sul campo: nessun piano è senza tetto."""
    for plans in plan_registry.PLANS.values():
        for plan in plans:
            assert plan["weekly_capped"] is True


def test_missing_plan_is_a_gate_not_a_default(jht_home):
    """Senza dichiarazione NON si indovina: un roster sbagliato brucia la finestra."""
    assert plan_registry.active_plan() is None
    roster = plan_registry.burst_roster()
    assert roster["ok"] is False


def test_set_plan_persists_and_is_readable(jht_home):
    plan_registry.set_plan("kimi", "allegretto")
    active = plan_registry.active_plan()
    assert active is not None
    assert active["id"] == "allegretto"
    cfg = json.loads((jht_home / 'jht.config.json').read_text(encoding='utf-8'))
    assert cfg["providers"]["kimi"]["plan"] == "allegretto"
    # Non deve calpestare quello che c'era già nel file.
    assert cfg["providers"]["kimi"]["auth_method"] == "subscription"


def test_unknown_plan_is_refused(jht_home):
    with pytest.raises(ValueError):
        plan_registry.set_plan("kimi", "fortissimo")


# ── Il roster ───────────────────────────────────────────────────────────

def test_roster_scales_with_the_plan(jht_home, monkeypatch):
    # No cap from the host: on a small machine (a 8 GB VPS) the RAM cap trims every plan to the same roster,
    # and this test is about the plan, not about the machine that runs it (the cap has its own tests below).
    monkeypatch.setattr(plan_registry, "_host_agent_cap", lambda *a: None)
    small = plan_registry.burst_roster(plan_registry.find_plan("kimi", "moderato"))
    mid = plan_registry.burst_roster(plan_registry.find_plan("kimi", "allegretto"))
    big = plan_registry.burst_roster(plan_registry.find_plan("claude", "max20"))
    assert small["total_workers"] < mid["total_workers"] < big["total_workers"]


def test_every_roster_can_actually_score(jht_home):
    """Un roster senza Analista o Scorer produce righe grezze: per l'utente, niente."""
    for provider, plans in plan_registry.PLANS.items():
        for plan in plans:
            r = plan_registry.burst_roster(dict(plan, provider=provider))
            assert r["roster"]["analista"] >= 1, (provider, plan["id"])
            assert r["roster"]["scorer"] >= 1, (provider, plan["id"])
            assert r["roster"]["scout"] >= 1, (provider, plan["id"])


def test_sourcing_is_capped_on_the_first_pass(jht_home):
    """Senza tetto lo scouting si mangia la finestra e il punteggio non arriva."""
    r = plan_registry.burst_roster(plan_registry.find_plan("kimi", "allegretto"))
    assert r["scout_cap_first_pass"] > 0
    assert r["target_scored"] > 0


def test_small_host_trims_from_the_head(jht_home):
    """Si taglia dagli Scout: il downstream è ciò che trasforma le righe in punteggi."""
    plan = plan_registry.find_plan("claude", "max20")
    r = plan_registry.burst_roster(plan, host_cap=5)
    assert r["capped_by_host"] is True
    assert r["total_workers"] <= 5
    assert r["roster"]["scout"] == 1
    assert r["roster"]["analista"] == 2 and r["roster"]["scorer"] == 2


def test_pipeline_stays_whole_even_on_a_tiny_host(jht_home):
    """Sotto un worker per ruolo non si scende: una pipeline monca non produce nulla."""
    r = plan_registry.burst_roster(plan_registry.find_plan("claude", "max20"),
                                   host_cap=2)
    assert r["roster"] == {"scout": 1, "analista": 1, "scorer": 1}


# ── Lo stato di primo avvio ─────────────────────────────────────────────

def test_new_install_waits_for_the_profile(first_run):
    assert first_run.status()["phase"] == first_run.PHASE_AWAITING


def test_burst_does_not_wait_for_the_plan_it_opens_on_the_default_and_declares_it(first_run, jht_home):
    out = first_run.begin_burst()
    assert out["ok"] is True and out["plan"]["plan"] == "adagio" and out["plan"]["assumed"]
    assert out["plan_assumed"] == out["plan"]["assumed"] and out["roster"] == {"scout": 1, "analista": 1, "scorer": 1}
    assert first_run.plan_gap(first_run.status()) == {}, "an assumed plan is not a missing plan"
    assert "Plan not declared" in "".join(p.read_text(encoding="utf-8") for p in (jht_home / "logs").glob("captain-diary-*.md"))


def test_burst_refuses_only_when_the_provider_has_no_plan_to_assume(first_run, jht_home):
    (jht_home / "jht.config.json").write_text(json.dumps({"active_provider": "nobody"}), encoding="utf-8")
    out = first_run.begin_burst()
    assert out["ok"] is False and out["reason"] == "subscription plan not selected"


def _api_key_config(jht_home, **extra):
    (jht_home / "jht.config.json").write_text(json.dumps(
        {"active_provider": "openai", "providers": {"openai": {"auth_method": "api_key"}}, **extra}), encoding="utf-8")


@pytest.mark.parametrize(("ceiling", "roster"), [
    (None, {"scout": 1, "analista": 1, "scorer": 1}),
    (5, {"scout": 1, "analista": 1, "scorer": 1}),
    (10, {"scout": 2, "analista": 1, "scorer": 1}),
    (29.9, {"scout": 2, "analista": 1, "scorer": 1}),
    (30, {"scout": 5, "analista": 3, "scorer": 2}),
    ("30", {"scout": 1, "analista": 1, "scorer": 1}),
    (True, {"scout": 1, "analista": 1, "scorer": 1}),
    (-5, {"scout": 1, "analista": 1, "scorer": 1}),
])
def test_an_api_key_has_no_card_and_the_roster_comes_from_the_spending_ceiling(first_run, jht_home, ceiling, roster, monkeypatch):
    # the table, not the machine that runs the test: the big rosters (10 workers) are cut on a small one. first_run loads its own
    # copy of plan_registry on every call, so the one this test patched is handed to it.
    monkeypatch.setattr(plan_registry, "_host_agent_cap", lambda *a: None)
    original = first_run._load_module
    monkeypatch.setattr(first_run, "_load_module", lambda name, filename: plan_registry if name == "plan_registry" else original(name, filename))
    _api_key_config(jht_home, **({} if ceiling is None else {"no_quota_cap": {"eur": ceiling}}))
    info = first_run.plan_info()
    assert info["ok"] and info["plan"] == "api-key" and info["weekly_capped"] is False
    out = first_run.begin_burst()
    assert out["ok"] and out["roster"] == roster
    declared_ceiling = isinstance(ceiling, (int, float)) and not isinstance(ceiling, bool) and ceiling > 0
    assert bool(out.get("plan_assumed")) is (not declared_ceiling)


def test_an_api_key_never_posts_the_plan_card_and_a_declared_plan_still_wins(first_run, jht_home):
    _api_key_config(jht_home)
    assert first_run.ask_plan(agent="capitano")["asked"] is False
    plan_registry.set_plan("openai", "pro")
    assert first_run.plan_info()["plan"] == "pro"


def test_burst_carries_the_roster_and_the_goal(first_run):
    plan_registry.set_plan("kimi", "allegretto")
    out = first_run.begin_burst()
    assert out["ok"] is True
    assert out["phase"] == first_run.PHASE_BURST
    assert out["roster"]["scout"] >= 1
    assert out["target_scored"] > 0


def test_begin_burst_is_idempotent(first_run):
    plan_registry.set_plan("kimi", "allegretto")
    first_run.begin_burst()
    again = first_run.begin_burst()
    assert again["phase"] == first_run.PHASE_BURST
    assert "note" in again


def test_burst_closes_when_the_goal_is_reached(first_run, jht_home):
    plan_registry.set_plan("kimi", "moderato")
    started = first_run.begin_burst()
    target = started["target_scored"]

    db = jht_home / 'jobs.db'
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE scores (position_id INTEGER)")
    conn.executemany("INSERT INTO scores VALUES (?)",
                     [(i,) for i in range(target)])
    conn.commit()
    conn.close()

    out = first_run.check()
    assert out["phase"] == first_run.PHASE_STEADY
    assert out["action"] == "completato"


def test_upgrade_of_an_existing_install_gets_no_burst(first_run, jht_home):
    """Chi ha già punteggi in archivio è a regime: niente burst all'aggiornamento."""
    db = jht_home / 'jobs.db'
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE scores (position_id INTEGER)")
    conn.execute("INSERT INTO scores VALUES (1)")
    conn.commit()
    conn.close()

    assert first_run.status()["phase"] == first_run.PHASE_STEADY


def test_the_first_burst_targets_twenty_scored_positions_and_lets_the_scouts_find_enough_for_them_in_every_band(jht_home):
    """The promise of the product (JHT-T313): 20 scored positions, whatever the plan or the ceiling. About 58% of the positions
    reach a score (the run of 10/11): the two bands with the big rosters (tier 15 and 20) may find 40, the others 30."""
    for provider, plans in plan_registry.PLANS.items():
        for plan in plans:
            roster = plan_registry.burst_roster(plan_registry.find_plan(provider, plan["id"]), host_cap=99)
            assert roster["target_scored"] == 20 and roster["scout_cap_first_pass"] == (50 if plan["tier"] >= 15 else 30), (provider, plan["id"])
    for eur in (None, 5, 10, 30):
        (jht_home / "jht.config.json").write_text(json.dumps(
            {"active_provider": "openai", "providers": {"openai": {"auth_method": "api_key"}},
             **({} if eur is None else {"no_quota_cap": {"eur": eur}})}), encoding="utf-8")
        roster = plan_registry.burst_roster(host_cap=99)
        assert roster["target_scored"] == 20 and roster["scout_cap_first_pass"] == (50 if eur == 30 else 30), eur
