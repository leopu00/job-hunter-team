"""jht-send: gli a capo che l'agente scrive come escape devono arrivare veri.

Gli agenti invocano `jht-send "riga1\\nriga2"`. Dentro i doppi apici la shell
non tocca la sequenza, quindi lo strumento riceve backslash+n e — prima di
questo fix — li ri-serializzava in JSON come "\\\\n": la chat mostrava "\\n"
in mezzo alla frase invece di andare a capo.
"""
import json
import os
from pathlib import Path
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "agents/_tools/jht-send"


def _send(tmp_path: Path, *args: str) -> dict:
    env = os.environ.copy()
    env["JHT_AGENT_DIR"] = str(tmp_path)
    result = subprocess.run(
        [str(TOOL), *args],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads((tmp_path / "chat.jsonl").read_text().strip().split("\n")[-1])


def test_literal_newlines_become_real_ones(tmp_path: Path) -> None:
    entry = _send(tmp_path, "Ciao Leone!\\n\\nChe ruolo cerchi?")
    assert entry["text"] == "Ciao Leone!\n\nChe ruolo cerchi?"
    assert "\\n" not in entry["text"]


def test_tabs_are_decoded_too(tmp_path: Path) -> None:
    entry = _send(tmp_path, "colonna1\\tcolonna2")
    assert entry["text"] == "colonna1\tcolonna2"


def test_escaped_backslash_stays_literal(tmp_path: Path) -> None:
    """Chi vuole davvero mostrare "\\n" raddoppia il backslash."""
    entry = _send(tmp_path, "la sequenza \\\\n va a capo")
    assert entry["text"] == "la sequenza \\n va a capo"


def test_raw_keeps_the_text_untouched(tmp_path: Path) -> None:
    entry = _send(tmp_path, "--raw", "niente\\ndecodifica")
    assert entry["text"] == "niente\\ndecodifica"


def test_real_newlines_survive_the_round_trip(tmp_path: Path) -> None:
    """Un a capo vero nell'argomento resta un a capo, e la riga JSON resta una."""
    entry = _send(tmp_path, "prima\nseconda")
    assert entry["text"] == "prima\nseconda"
    assert len((tmp_path / "chat.jsonl").read_text().strip().split("\n")) == 1


def test_tmux_sender_does_not_wait_on_a_busy_pane_and_busy_alone_is_not_a_proof() -> None:
    """Un pane occupato non blocca la digitazione e non dichiara niente (23/10): 'occupato' da solo non e' una
    prova di consegna, e l'exit 6 resta la sola impersonazione."""
    src = (ROOT / "agents/_skills/tmux-send/jht-tmux-send").read_text()
    assert 'while [ "$waited" -lt "$busy_budget" ]' not in src
    assert "queued/delivery unverified" not in src
    assert src.count("exit 6") == 1, "the only exit 6 is the impersonation"
    assert "busy_pre" in src, "the busy state before the Enter is what makes a started turn a proof"


def _run(tmp_path: Path, *args: str) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["JHT_AGENT_DIR"] = str(tmp_path / "agent")
    return subprocess.run([str(TOOL), *args], env=env, text=True, capture_output=True, check=False)


def _lines(tmp_path: Path) -> list:
    chat = tmp_path / "agent" / "chat.jsonl"
    return [json.loads(line) for line in chat.read_text().splitlines()] if chat.exists() else []


@pytest.mark.parametrize("kind", ["urgent", "blocked", "completed"])
def test_kind_is_written_on_the_line(tmp_path: Path, kind: str) -> None:
    result = _run(tmp_path, "--kind", kind, "Mi serve una decisione")
    assert result.returncode == 0, result.stderr
    (entry,) = _lines(tmp_path)
    assert entry["kind"] == kind
    assert entry["text"] == "Mi serve una decisione"
    assert entry["role"] == "assistant" and entry["done"] is True


@pytest.mark.parametrize("args", [("Ciao",), ("--kind", "info", "Ciao")])
def test_info_is_the_default_and_leaves_the_line_as_it_always_was(tmp_path: Path, args: tuple) -> None:
    result = _run(tmp_path, *args)
    assert result.returncode == 0, result.stderr
    (entry,) = _lines(tmp_path)
    assert "kind" not in entry
    assert sorted(entry) == ["done", "role", "text", "ts"]


@pytest.mark.parametrize("kind", ["fatal", "URGENT", "", "urgent,blocked"])
def test_an_unknown_kind_is_refused_and_writes_nothing(tmp_path: Path, kind: str) -> None:
    result = _run(tmp_path, "--kind", kind, "Ciao")
    assert result.returncode != 0
    assert not (tmp_path / "agent").exists(), "not even the folder"
    for allowed in ("urgent", "blocked", "completed", "info"):
        assert allowed in result.stderr


def test_a_question_is_not_a_kind_and_the_error_says_where_questions_go(tmp_path: Path) -> None:
    result = _run(tmp_path, "--kind", "question", "Vuoi il CV breve o completo?")
    assert result.returncode != 0
    assert not (tmp_path / "agent").exists()
    assert "jht-notify-user --option" in result.stderr
    assert "question" in result.stderr


def test_a_refused_kind_leaves_the_earlier_messages_alone(tmp_path: Path) -> None:
    assert _run(tmp_path, "Primo").returncode == 0
    before = (tmp_path / "agent" / "chat.jsonl").read_text()
    assert _run(tmp_path, "--kind", "question", "Secondo").returncode != 0
    assert (tmp_path / "agent" / "chat.jsonl").read_text() == before


# Per lingua: la frase «nel dubbio fra domanda e blocco» e la frase «dopo una domanda non fermarti».
QUESTION_RULES = {
    "SKILL.md": ("if you can do something else meanwhile, it is a question", "After a question do not stop"),
    "SKILL.it.md": ("se intanto puoi fare altro, è una domanda", "Dopo una domanda non fermarti"),
    "SKILL.de.md": ("Wenn du inzwischen etwas anderes tun kannst, ist es eine Frage", "Nach einer Frage nicht anhalten"),
    "SKILL.es.md": ("si mientras tanto puedes hacer otra cosa, es una pregunta", "Tras una pregunta no te detengas"),
    "SKILL.fr.md": ("si tu peux faire autre chose en attendant, c'est une question", "Après une question, ne t'arrête pas"),
    "SKILL.hu.md": ("ha közben mást is tudsz csinálni, akkor kérdés", "Kérdés után ne állj meg"),
    "SKILL.pt.md": ("se entretanto podes fazer outra coisa, é uma pergunta", "Depois de uma pergunta não pares"),
}


def test_every_chat_web_skill_tells_when_to_use_each_kind_in_the_same_place() -> None:
    folder = ROOT / "agents/_skills/chat-web"
    skills = sorted(folder.glob("SKILL*.md"))
    assert sorted(skill.name for skill in skills) == sorted(QUESTION_RULES)
    for skill in skills:
        text = skill.read_text(encoding="utf-8")
        assert "jht-send --kind <" in text, skill.name
        for kind in ("urgent", "blocked", "completed", "info"):
            assert f"- `{kind}` — " in text, (skill.name, kind)
        lines = text.splitlines()
        headings = [i for i, line in enumerate(lines) if line.startswith("## ") and "--kind" in line]
        assert len(headings) == 1, skill.name
        start = headings[0]
        end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith("## "))
        block = "\n".join(lines[start:end])
        # Where the question goes, that a question is refused as a kind, and that the kind is only declared.
        assert 'jht-notify-user --option id="' in block, skill.name
        assert "--kind question" in block, skill.name
        assert "--partial" in block and "--role system" in block, skill.name
        for sentence in QUESTION_RULES[skill.name]:
            assert sentence in block, (skill.name, sentence)
        # Between «Reply commands» and the «--partial» section, like the other languages.
        assert "--partial" in lines[end], skill.name


@pytest.mark.parametrize("flags", [("--partial",), ("--role", "system"), ("--partial", "--role", "system")])
@pytest.mark.parametrize("kind", ["urgent", "blocked", "completed"])
def test_a_kind_is_only_for_a_final_assistant_message(tmp_path: Path, flags: tuple, kind: str) -> None:
    result = _run(tmp_path, "--kind", kind, *flags, "Avanzamento")
    assert result.returncode != 0
    assert not (tmp_path / "agent").exists(), "nothing written, not even the folder"
    assert "--partial" in result.stderr and "--role system" in result.stderr


@pytest.mark.parametrize("flags", [("--partial",), ("--role", "system")])
def test_the_default_kind_still_goes_with_a_checkpoint_or_a_system_line(tmp_path: Path, flags: tuple) -> None:
    result = _run(tmp_path, "--kind", "info", *flags, "Avanzamento")
    assert result.returncode == 0, result.stderr
    (entry,) = _lines(tmp_path)
    assert "kind" not in entry


def test_a_text_at_the_limit_is_written_and_one_byte_more_is_not(tmp_path: Path) -> None:
    assert _run(tmp_path, "a" * 16384).returncode == 0
    (entry,) = _lines(tmp_path)
    assert len(entry["text"].encode("utf-8")) == 16384 and entry["role"] == "assistant"


def test_a_text_over_the_limit_leaves_a_fixed_system_line_and_not_the_text(tmp_path: Path) -> None:
    secret = "contenuto-che-non-deve-comparire"
    result = _run(tmp_path, secret + "a" * 16384)
    assert result.returncode != 0
    (entry,) = _lines(tmp_path)
    assert entry["role"] == "system" and entry["code"] == "message_too_long" and entry["done"] is True
    assert secret not in json.dumps(entry)
    assert sorted(entry) == ["code", "done", "role", "text", "ts"]
    # The words of the notice are fixed: the same for any message that is too long.
    again = _run(tmp_path, "b" * 20000)
    assert again.returncode != 0
    assert _lines(tmp_path)[-1]["text"] == entry["text"]


def test_the_limit_counts_utf8_bytes_not_characters(tmp_path: Path) -> None:
    # 8193 characters of two bytes each are 16386 bytes.
    result = _run(tmp_path, "è" * 8193)
    assert result.returncode != 0
    assert [line["role"] for line in _lines(tmp_path)] == ["system"]
    ok = _run(tmp_path, "è" * 8192)
    assert ok.returncode == 0, ok.stderr
    assert _lines(tmp_path)[-1]["role"] == "assistant"


def test_the_limit_holds_for_a_raw_text_and_for_a_decoded_one(tmp_path: Path) -> None:
    # "\\n" is two bytes in the argument and one after decoding: the limit is on what is written.
    assert _run(tmp_path, "\\n" * 8192).returncode == 0
    assert _run(tmp_path, "--raw", "\\n" * 8193).returncode != 0
