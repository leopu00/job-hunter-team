"""I fatti che spiegano il silenzio del team (`shared/skills/team_quiet.py`): sola lettura, solo numeri e booleani.

Cosa tiene fermo:

  1. la finestra del provider viene dall'ULTIMO campione buono del sentinel, anche se la riga in fondo e' tagliata;
  2. un campione vecchio, senza ora di riapertura o fuori scala non inventa niente;
  3. il contenimento e' un marker `*.hold.json` nella cartella dei contenimenti, e nient'altro;
  4. l'accesso del provider e' un file di credenziali non vuoto, per il provider attivo;
  5. un fatto che non si legge MANCA dalla risposta (non diventa «tutto a posto»);
  6. dalla risposta non esce nessun percorso, nome di agente o testo libero; il programma non scrive niente.

Eseguire:
    pytest tests/test_team_quiet.py -v
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS_DIR))
import team_quiet  # noqa: E402


@pytest.fixture
def home(tmp_path):
    (tmp_path / "logs").mkdir()
    return tmp_path


def samples(home: Path, *rows: object, tail: str = "") -> None:
    lines = [row if isinstance(row, str) else json.dumps(row) for row in rows]
    (home / "logs" / "sentinel-data.jsonl").write_text("\n".join(lines) + ("\n" if lines else "") + tail, encoding="utf-8")


def test_the_window_is_the_last_good_sample(home):
    samples(home, {"usage": 10.0, "reset_at_unix": 1}, {"usage": 97.54, "reset_at_unix": 1790000000.0, "status": "ok", "ts": "x"})
    assert team_quiet.budget(home) == {"usagePct": 97.5, "resetAtUnix": 1790000000}


def test_a_cut_last_line_is_skipped_for_the_one_before(home):
    samples(home, {"usage": 91.0, "reset_at_unix": 1790000000}, tail='{"usage": 99, "reset_at_u')
    assert team_quiet.budget(home) == {"usagePct": 91.0, "resetAtUnix": 1790000000}


def test_a_sample_without_a_reopening_time_keeps_the_use_and_says_no_time(home):
    samples(home, {"usage": 95, "reset_at_unix": None})
    assert team_quiet.budget(home) == {"usagePct": 95.0, "resetAtUnix": None}
    samples(home, {"usage": 95, "reset_at_unix": "soon"})
    assert team_quiet.budget(home) == {"usagePct": 95.0, "resetAtUnix": None}


@pytest.mark.parametrize("row", [{"usage": "97"}, {"usage": True}, {"usage": -1}, {"usage": 5000}, {"usage": float("nan")}, [1, 2], "not json", {}])
def test_a_sample_that_is_not_a_use_is_no_window(home, row):
    samples(home, row)
    assert team_quiet.budget(home) is None


def test_no_file_is_no_window(home):
    assert team_quiet.budget(home) is None


def test_only_the_end_of_a_big_file_is_read(home):
    filler = json.dumps({"usage": 1.0, "reset_at_unix": 1, "pad": "x" * 200})
    rows = [filler] * 2000 + [{"usage": 99.9, "reset_at_unix": 1790000000}]
    samples(home, *rows)
    assert (home / "logs" / "sentinel-data.jsonl").stat().st_size > team_quiet.TAIL_BYTES
    assert team_quiet.budget(home) == {"usagePct": 99.9, "resetAtUnix": 1790000000}


def test_a_containment_is_a_hold_marker_and_nothing_else(home):
    assert team_quiet.containment(home) is False
    folder = home / "logs" / "containment"
    folder.mkdir()
    assert team_quiet.containment(home) is False
    (folder / "notes.txt").write_text("x")
    assert team_quiet.containment(home) is False
    (folder / "SENTINELLA.hold.json").write_text("{}")
    assert team_quiet.containment(home) is True


def config(home: Path, provider: str, method: str | None = "subscription", **extra: object) -> None:
    entry: dict = dict(extra)
    if method is not None:
        entry["auth_method"] = method
    (home / "jht.config.json").write_text(json.dumps({"active_provider": provider, "providers": {provider: entry}}))


def test_the_login_is_a_credentials_file_that_is_not_empty_for_the_active_provider(home):
    config(home, "codex")
    assert team_quiet.provider_ready(home) is False
    (home / ".codex").mkdir()
    (home / ".codex" / "auth.json").write_text("")
    assert team_quiet.provider_ready(home) is False
    (home / ".codex" / "auth.json").write_text("{}")
    assert team_quiet.provider_ready(home) is True
    # the login of another provider does not count
    config(home, "claude")
    assert team_quiet.provider_ready(home) is False


@pytest.mark.parametrize("provider,where", [
    ("claude", ".claude/.credentials.json"), ("claude", ".claude/credentials.json"),
    ("claude", ".config/claude/credentials.json"), ("claude", ".config/claude/auth.json"),
    ("anthropic", ".config/claude/auth.json"),
    ("codex", ".codex/credentials.json"), ("openai", ".config/codex/credentials.json"),
    ("kimi", ".kimi/credentials/kimi-code.json"), ("kimi", ".kimi/kimi.json"), ("kimi", ".config/kimi/config.json"),
    ("moonshot", ".kimi/credentials.json"),
])
def test_a_login_in_any_place_the_start_check_looks_in_counts(home, provider, where):
    config(home, provider)
    assert team_quiet.provider_ready(home) is False
    target = home / where
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("{}")
    assert team_quiet.provider_ready(home) is True


def test_the_cli_login_is_a_file_login_too(home):
    config(home, "claude", method="cli")
    (home / ".claude").mkdir()
    (home / ".claude" / ".credentials.json").write_text("{}")
    assert team_quiet.provider_ready(home) is True


@pytest.mark.parametrize("method", ["api_key", "", "oauth2", None, 5])
def test_a_provider_that_does_not_log_in_with_a_file_gives_no_answer_never_not_connected(home, method):
    # with an API key there is no credentials file and the team works all the same
    config(home, "claude", method=method, api_key="synthetic-key")
    assert team_quiet.provider_ready(home) is None
    assert "providerReady" not in team_quiet.status(home)["quiet"]


@pytest.mark.parametrize("raw", ["", "not json", "[]", json.dumps({}), json.dumps({"active_provider": "unknown"}), json.dumps({"active_provider": None}),
                                 json.dumps({"active_provider": "claude"}), json.dumps({"active_provider": "claude", "providers": []}),
                                 json.dumps({"active_provider": "claude", "providers": {"claude": "subscription"}}),
                                 json.dumps({"active_provider": "unknown", "providers": {"unknown": {"auth_method": "subscription"}}})])
def test_a_provider_that_is_not_known_gives_no_answer(home, raw):
    (home / "jht.config.json").write_text(raw)
    assert team_quiet.provider_ready(home) is None


def test_what_cannot_be_read_is_missing_from_the_answer(home):
    assert team_quiet.status(home) == {"ok": True, "quiet": {"containment": False}}
    samples(home, {"usage": 100, "reset_at_unix": 1790000000})
    config(home, "kimi")
    assert team_quiet.status(home) == {
        "ok": True,
        "quiet": {"budget": {"usagePct": 100.0, "resetAtUnix": 1790000000}, "containment": False, "providerReady": False},
    }


def test_the_answer_carries_no_path_name_or_free_text(home):
    samples(home, {"usage": 98, "reset_at_unix": 1790000000, "status": "locked out for alice@example.com", "ts": str(home)})
    folder = home / "logs" / "containment"
    folder.mkdir()
    (folder / "ANALISTA.hold.json").write_text(json.dumps({"reason": "secret reason", "by": "bob"}))
    config(home, "claude", email="carol@example.com")
    text = json.dumps(team_quiet.status(home))
    for leaked in (str(home), "alice", "ANALISTA", "secret", "bob", "carol", "example.com"):
        assert leaked not in text


def test_it_is_a_program_with_one_verb_that_writes_nothing(home):
    before = sorted(str(p) for p in home.rglob("*"))
    run = lambda *argv: subprocess.run([sys.executable, str(SKILLS_DIR / "team_quiet.py"), *argv], capture_output=True, text=True, env={"JHT_HOME": str(home), "PATH": ""})
    ok = run("status")
    assert ok.returncode == 0
    assert json.loads(ok.stdout.strip().split("\n")[-1])["ok"] is True
    for argv in ([], ["status", "extra"], ["write"]):
        bad = run(*argv)
        assert bad.returncode == 2
        assert json.loads(bad.stdout) == {"ok": False, "code": "request_invalid"}
    assert sorted(str(p) for p in home.rglob("*")) == before
