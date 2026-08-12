"""Contratto di regressione per JHT-DOCTOR-DAILY-RESTART.

Il vecchio daily restart non deve rinascere come secondo scheduler. La
copertura corrente è una sola catena: doctor-watchdog -> Dottore/
session-refresh, con agent-watchdog come fail-safe TTL deterministico.
Questi test leggono soltanto artefatti del repository: nessun tmux, spawn o
restart reale.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCALES = ("", ".it", ".es", ".fr", ".de", ".pt", ".hu")


def _localized(directory: Path, stem: str) -> list[Path]:
    return [directory / f"{stem}{locale}.md" for locale in LOCALES]


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_both_doctor_skills_exist_in_all_seven_locales():
    for skill in ("daily-restart-wave", "session-refresh"):
        directory = ROOT / "agents" / "_skills" / skill
        files = _localized(directory, "SKILL")
        assert all(path.is_file() for path in files), skill


def test_session_refresh_is_the_only_primary_doctor_path():
    prompts = _localized(ROOT / "agents" / "dottore", "dottore")
    for path in prompts:
        text = _read(path)
        assert "session-refresh" in text, path.name
        assert "daily-restart-wave" in text, path.name

    skills_list = _read(ROOT / "agents" / "dottore" / "skills.list")
    assert "superseded by the scheduled session-refresh rounds" in skills_list

    launcher_sources = "\n".join(
        _read(path) for path in (ROOT / ".launcher").glob("*.sh")
    )
    assert "daily-restart-wave" not in launcher_sources


def test_scheduler_and_ttl_fail_safe_are_distinct_and_single_owner():
    scheduler = _read(ROOT / ".launcher" / "doctor-watchdog.sh")
    schedule = _read(ROOT / "shared" / "skills" / "doctor_schedule.py")
    watchdog = _read(ROOT / ".launcher" / "agent-watchdog.sh")

    assert 'case "$slot" in' in scheduler
    assert "T30|MID" in scheduler
    assert 'bash "$SPAWNER"' in scheduler
    assert "T30_MIN = 30.0" in schedule
    assert 'AGENT_MAX_SESSION_AGE_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"' in watchdog
    assert "maybe_ttl_refresh" in watchdog
    assert "oldest_age" in watchdog
    assert "daily-restart-wave" not in scheduler + schedule + watchdog


def test_rich_refresh_orders_and_snapshots_before_recreate():
    skill = _read(ROOT / "agents" / "_skills" / "session-refresh" / "SKILL.md")

    assert "worker sessions FIRST" in skill
    assert "coordinators LAST" in skill
    assert "CAPITANO" in skill
    capture = skill.index("tmux capture-pane -p -S - -t")
    durable_snapshot = skill.index('with open(journal, "a")')
    recreate = skill.index('tmux kill-session -t "$S"')
    assert capture < durable_snapshot < recreate
    assert "doctor-retrospective.jsonl" in skill


def test_capitano_gets_one_heads_up_before_the_first_recreate_in_every_locale():
    files = _localized(
        ROOT / "agents" / "_skills" / "session-refresh", "SKILL"
    )
    for path in files:
        text = _read(path)
        assert "ROUND_HEADS_UP_SENT" in text, path.name
        notify = text.index("jht-tmux-send CAPITANO")
        recreate = text.index('tmux kill-session -t "$S"')
        assert notify < recreate, path.name


def test_config_has_one_canonical_vocabulary_not_legacy_preferences():
    primary = "\n".join(
        _read(path)
        for path in _localized(
            ROOT / "agents" / "_skills" / "session-refresh", "SKILL"
        )
    )
    scheduler = _read(ROOT / "shared" / "skills" / "doctor_schedule.py")
    launchers = _read(ROOT / ".launcher" / "doctor-watchdog.sh") + _read(
        ROOT / ".launcher" / "agent-watchdog.sh"
    )
    legacy = _read(
        ROOT / "agents" / "_skills" / "daily-restart-wave" / "SKILL.md"
    )

    assert "JHT_AGENT_MAX_SESSION_AGE_H" in primary
    assert "working_hours" in scheduler
    assert "preferences.json" not in primary + scheduler + launchers
    assert "Read `~/.jht/preferences.json`" in legacy
    assert "❌" in legacy[legacy.index("Read `~/.jht/preferences.json`") - 5 :]
