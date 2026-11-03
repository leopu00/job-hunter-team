"""The chat of a numbered role reads the folder the agent writes to (agent_chat.py).

The app calls a numbered role by its bare role («scout», «analista», «scorer», «scrittore») and the team
files it under the launcher's instance name («scout-1»): `jht-send` writes the agent's words to
`agents/scout-1/chat.jsonl`, and `jht-notify-user` files the agent's questions under «scout-1». The chat read
`agents/scout/`, which no team has: the person's own turns showed, the agent's answers never did.

Run with: pytest tests/test_agent_chat_instance_folder.py -v
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
SCRIPT = SKILLS / "agent_chat.py"

# the app's id -> the folder the launcher gives that agent (jht_spawn_agent_name)
FOLDERS = {
    "capitano": "capitano",
    "assistente": "assistente",
    "mentor": "mentor",
    "critico": "critico",
    "scout": "scout-1",
    "analista": "analista-1",
    "scorer": "scorer-1",
    "scrittore": "scrittore-1",
}


@pytest.fixture()
def home(tmp_path):
    folder = tmp_path / "home"
    folder.mkdir()
    env = {**os.environ, "JHT_DB": str(folder / "jobs.db"), "JHT_HOME": str(folder), "PYTHONDONTWRITEBYTECODE": "1"}
    seed = subprocess.run(
        [sys.executable, "-c", "from _db import get_db, ensure_schema; c=get_db(); ensure_schema(c); c.commit(); c.close()"],
        cwd=SKILLS, env=env, capture_output=True, text=True,
    )
    assert seed.returncode == 0, seed.stderr
    return type("Home", (), {"path": folder, "env": env})


def read(home, agent: str) -> dict:
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), "read", agent], env=home.env, capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


def test_the_set_of_ids_is_the_one_this_test_knows():
    # a new id in the chat must get its folder here on purpose
    sys.path.insert(0, str(SKILLS))
    try:
        import agent_chat
    finally:
        sys.path.remove(str(SKILLS))
    assert set(agent_chat.AGENTS) == set(FOLDERS)
    for agent, folder in FOLDERS.items():
        assert agent_chat.store_name(agent) == folder


@pytest.mark.parametrize("agent,folder", sorted(FOLDERS.items()))
def test_what_the_agent_wrote_in_its_own_folder_is_read(home, agent, folder):
    chat = home.path / "agents" / folder / "chat.jsonl"
    chat.parent.mkdir(parents=True)
    chat.write_text(
        json.dumps({"role": "assistant", "text": "Ne ho trovate tre.", "ts": 5.0, "message_id": "a1"}) + "\n",
        encoding="utf-8",
    )
    page = read(home, agent)
    assert [m["text"] for m in page["messages"]] == ["Ne ho trovate tre."]


@pytest.mark.parametrize("agent,folder", [("scout", "scout-1"), ("analista", "analista-1")])
def test_a_folder_named_after_the_bare_role_is_not_read(home, agent, folder):
    stray = home.path / "agents" / agent / "chat.jsonl"
    stray.parent.mkdir(parents=True)
    stray.write_text(json.dumps({"role": "assistant", "text": "stray", "ts": 1.0}) + "\n", encoding="utf-8")
    assert read(home, agent)["messages"] == []


def test_a_plain_question_of_an_instance_reaches_the_chat(home):
    with sqlite3.connect(home.env["JHT_DB"]) as conn:
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind) VALUES (?,?,?)",
            ("scout-1", "Cerco anche da remoto?", "question"),
        )
    page = read(home, "scout")
    assert [q["text"] for q in page.get("questions", [])] == ["Cerco anche da remoto?"]
