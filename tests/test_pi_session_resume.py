"""The Assistente takes up its last pi session again after a restart of the container, and only a sound one of the same model.

start-agent.sh started pi with no session: after the switch to the full image in the middle of the onboarding the Assistente
had forgotten the conversation (giro Linux, 15/11). shared/skills/pi_session_resume.py picks the session and
jht_pi_resume_args (spawn-lib.sh) puts `--session '<file>'` on the command line of pi, for the Assistente only. Synthetic
sessions in a made-up pi folder; no pi, no provider.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
import pi_session_resume as resume  # noqa: E402

CWD = "/jht_home/agents/assistente"


def _session(sessions: Path, name: str, lines, *, cwd: str = CWD, age_s: float = 60, raw_tail: str = "") -> Path:
    folder = resume.session_folder(sessions, cwd)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    header = {"type": "session", "version": 3, "id": "s-" + name[:8], "timestamp": "2026-11-15T22:00:00.000Z", "cwd": cwd}
    path.write_text("\n".join(json.dumps(x) for x in [header, *lines]) + "\n" + raw_tail, encoding="utf-8")
    when = time.time() - age_s
    os.utime(path, (when, when))
    return path


def _talk(provider="zai", model="glm-5.3"):
    return [
        {"type": "message", "id": "a1", "parentId": None, "message": {"role": "system", "content": ""}},
        {"type": "message", "id": "a2", "parentId": "a1", "message": {"role": "user", "content": "I am looking for an internship in Stockholm"}},
        {"type": "message", "id": "a3", "parentId": "a2", "message": {"role": "assistant", "content": [{"type": "text", "text": "Which field?"}],
                                                                    "provider": provider, "model": model, "stopReason": "stop"}},
    ]


def test_the_folder_is_the_one_pi_writes():
    assert resume.session_folder(Path("/s"), "/jht_home/agents/assistente") == Path("/s/--jht_home-agents-assistente--")


def test_the_newest_sound_conversation_of_the_same_model_is_taken_up_again(tmp_path):
    _session(tmp_path, "2026-11-15T20-00-00-000Z_old.jsonl", _talk(), age_s=3600)
    newest = _session(tmp_path, "2026-11-15T22-00-00-000Z_new.jsonl", _talk())
    assert resume.pick(tmp_path, CWD, "zai", "glm-5.3") == (newest, None)


@pytest.mark.parametrize(
    ("lines", "kw", "reason"),
    [
        (_talk(), {"raw_tail": '{"type":"message","id":"a4","message":{"role":"assist'}, "the last line is cut"),
        (_talk()[:1] + ["not an object"], {}, "line 3 is not an object"),
        (_talk("moonshot", "kimi-k3.1-pro"), {}, "another provider or model (moonshot/kimi-k3.1-pro)"),
        (_talk() + [{"type": "model_change", "id": "m", "parentId": "a3", "provider": "openai", "modelId": "gpt-5.6-terra"}], {},
         "another provider or model (openai/gpt-5.6-terra)"),
        (_talk()[:2], {}, "no conversation in it"),
        (_talk(), {"age_s": 30 * 3600}, "older than the limit"),
        (_talk(), {"cwd": "/jht_home/agents/other"}, None),
    ],
)
def test_a_corrupted_session_another_model_no_talk_or_an_old_one_starts_a_new_session(tmp_path, lines, kw, reason):
    _session(tmp_path, "2026-11-15T22-00-00-000Z_x.jsonl", lines, **kw)
    path, why = resume.pick(tmp_path, CWD, "zai", "glm-5.3")
    assert path is None
    assert why == (reason or "no session yet")


def test_a_broken_newest_session_does_not_fall_back_to_an_older_one(tmp_path):
    _session(tmp_path, "2026-11-15T20-00-00-000Z_old.jsonl", _talk(), age_s=3600)
    _session(tmp_path, "2026-11-15T22-00-00-000Z_new.jsonl", _talk(), raw_tail='{"cut')
    assert resume.pick(tmp_path, CWD, "zai", "glm-5.3") == (None, "the last line is cut")


def _bash():
    for candidate in ("/opt/homebrew/bin/bash", "/usr/local/bin/bash", "/bin/bash"):
        if Path(candidate).exists():
            return candidate
    return "bash"


def _resume_args(home: Path, role: str, provider: str, model: str) -> subprocess.CompletedProcess:
    script = (
        f'source "{ROOT / ".launcher" / "role-models.sh"}"; source "{ROOT / ".launcher" / "spawn-lib.sh"}"; '
        f'jht_pi_resume_args {role} {CWD} {model} {provider}'
    )
    return subprocess.run([_bash(), "-c", script], capture_output=True, text=True, timeout=30,
                          env={**os.environ, "JHT_HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1"})


def test_the_command_line_of_pi_gets_the_session_for_the_assistente_only(tmp_path):
    sessions = tmp_path / ".pi" / "agent" / "sessions"
    path = _session(sessions, "2026-11-15T22-00-00-000Z_new.jsonl", _talk())
    done = _resume_args(tmp_path, "assistente", "glm", "glm-5.3")
    assert done.returncode == 0, done.stderr
    assert done.stdout == f" --session '{path}'"
    assert _resume_args(tmp_path, "capitano", "glm", "glm-5.3").stdout == ""
    other = _resume_args(tmp_path, "assistente", "glm", "glm-5.2")
    assert (other.returncode, other.stdout) == (0, "")
    assert "a new one (another provider or model" in other.stderr


def test_start_agent_puts_the_session_on_the_command_line_of_pi():
    text = (ROOT / ".launcher" / "start-agent.sh").read_text(encoding="utf-8")
    assert 'CLI_ARGS="$CLI_ARGS$(jht_pi_resume_args "$ROLE" "$AGENT_DIR" "$pi_model" "$PROVIDER")"' in text
