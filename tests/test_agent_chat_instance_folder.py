"""The chat of a numbered role reads the folder the agent writes to (agent_chat.py).

The app calls a numbered role by its bare role («scout», «analista», «scorer», «scrittore») and the team
files it under the launcher's instance name («scout-1»): `jht-send` writes the agent's words to
`agents/scout-1/chat.jsonl`, and `jht-notify-user` files the agent's questions under «scout-1». The chat read
`agents/scout/`, which no team has: the person's own turns showed, the agent's answers never did.

Run with: pytest tests/test_agent_chat_instance_folder.py -v
"""

from __future__ import annotations

from contextlib import closing
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


@pytest.fixture(scope="module")
def _schema_database(tmp_path_factory):
    home = tmp_path_factory.mktemp("chat-instance-schema")
    db = home / "jobs.db"
    env = {**os.environ, "JHT_DB": str(db), "JHT_HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1"}
    seed = subprocess.run(
        [sys.executable, "-c", "from _db import get_db, ensure_schema; c=get_db(); ensure_schema(c); c.commit(); c.close()"],
        cwd=SKILLS, env=env, capture_output=True, text=True,
    )
    assert seed.returncode == 0, seed.stderr
    return db


@pytest.fixture()
def home(tmp_path, _schema_database):
    folder = tmp_path / "home"
    folder.mkdir()
    env = {**os.environ, "JHT_DB": str(folder / "jobs.db"), "JHT_HOME": str(folder), "PYTHONDONTWRITEBYTECODE": "1"}
    # Each case gets an independent SQLite snapshot, including any committed WAL pages.
    with closing(sqlite3.connect(_schema_database.as_uri() + "?mode=ro", uri=True)) as source:
        with closing(sqlite3.connect(env["JHT_DB"])) as target:
            source.backup(target)
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


# ── a numbered role is spoken to by instance ────────────────────────────────
INSTANCES = {"scout-2": "SCOUT-2", "analista-12": "ANALISTA-12", "scorer-4": "SCORER-4", "scrittore-9999": "SCRITTORE-9999"}


@pytest.mark.parametrize("agent,session", sorted(INSTANCES.items()))
def test_an_instance_has_its_own_session_and_folder(home, agent, session):
    sys.path.insert(0, str(SKILLS))
    try:
        import agent_chat
    finally:
        sys.path.remove(str(SKILLS))
    assert agent in agent_chat.AGENTS and agent_chat.AGENTS[agent] == session
    assert agent_chat.agent_of(agent) == agent
    assert agent_chat.store_name(agent) == agent
    chat = home.path / "agents" / agent / "chat.jsonl"
    chat.parent.mkdir(parents=True)
    chat.write_text(json.dumps({"role": "assistant", "text": f"da {session}", "ts": 3.0, "message_id": "i1"}) + "\n", encoding="utf-8")
    assert [m["text"] for m in read(home, agent)["messages"]] == [f"da {session}"]


@pytest.mark.parametrize("bad", [
    "scout-0", "scout-01", "scout-10000", "scout-", "scout-x", "scout--1", "scout-1-2", "Scout-1",
    "critico-2", "capitano-2", "mentor-1", "closer-1", "scout_2", " scout-2", "scout-2 ", "../scout-2", "scout-2/..", "scout-2\n",
])
def test_a_name_outside_the_grammar_is_refused_before_it_touches_a_file(home, bad):
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), "read", bad], env=home.env, capture_output=True, text=True)
    assert done.returncode != 0
    assert not (home.path / "agents").exists()


def test_two_instances_keep_two_conversations(home):
    for agent, text in (("scout-1", "uno"), ("scout-2", "due")):
        chat = home.path / "agents" / agent / "chat.jsonl"
        chat.parent.mkdir(parents=True)
        chat.write_text(json.dumps({"role": "assistant", "text": text, "ts": 1.0}) + "\n", encoding="utf-8")
    assert [m["text"] for m in read(home, "scout")["messages"]] == ["uno"]       # the bare role is the first instance
    assert [m["text"] for m in read(home, "scout-1")["messages"]] == ["uno"]
    assert [m["text"] for m in read(home, "scout-2")["messages"]] == ["due"]
