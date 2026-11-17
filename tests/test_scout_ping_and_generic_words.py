"""Two rules of the Scout's prompts that the banco of 17/11 found missing (profile 1/4, a bricklayer in Bari).

1. A Scout never holds its ping to the Analista to build a batch of 3-5: with one insert it would never send it, and nobody
   worked the positions. The words of the recovery message of the watchdog and of every language say so.
2. A word that names a task common to many trades (`posatore`) is declared with its sector, never alone: alone it let in a
   fibre-optic layer for a mason.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANGS = ("", ".it", ".de", ".es", ".fr", ".hu", ".pt")
SCOUT = [ROOT / "agents" / "scout" / f"scout{lang}.md" for lang in LANGS]
INSERT = [ROOT / "agents" / "_skills" / "position-insert" / f"SKILL{lang}.md" for lang in LANGS]
CIRCLES = [ROOT / "agents" / "_skills" / "circles-and-sources" / f"SKILL{lang}.md" for lang in LANGS]
BATCH = re.compile(r"(?:every|each|Alle|Ogni|Cada|Tous les|Minden|Dopo ogni|Après chaque|Nach jedem|Después de cada|Após cada)\s+"
                   r"(?:batch|lot|lote|Batch)?\s*(?:of|di|von|de)?\s*3[-–]5", re.I)


def test_no_prompt_asks_for_a_ping_only_every_three_to_five_inserts():
    for path in SCOUT + INSERT:
        text = path.read_text(encoding="utf-8")
        assert not BATCH.search(text), path.name
        assert "3-5 insert" not in text.replace("batch of 3-5", "").replace("lote de 3-5", ""), path.name
        assert "Batch N" not in text and "Batch 5 posizioni" not in text, path.name


def test_every_language_says_to_ping_after_each_insert_and_never_to_wait_for_a_batch():
    for path in INSERT:
        text = path.read_text(encoding="utf-8")
        assert "3-5" in text, path.name                      # named, to be refused
        assert re.search(r"EVERY|CADA|CHAQUE|JEDEM|OGNI|MINDEN|CADA|CADA", text), path.name


def test_the_recovery_message_of_the_watchdog_does_not_say_batches():
    text = (ROOT / "shared" / "skills" / "watchdog_delivery.py").read_text(encoding="utf-8")
    assert "in batches of 3–5" not in text and "after each insert" in text


def test_a_generic_task_word_is_declared_with_its_sector_in_every_language():
    for path in SCOUT + CIRCLES:
        text = path.read_text(encoding="utf-8")
        assert "posatore di piastrelle" in text and "posatore edile" in text, path.name


def test_a_sector_word_is_said_to_need_a_worker_word_in_every_language():
    for path in SCOUT + CIRCLES:
        text = path.read_text(encoding="utf-8")
        assert "«Cuoco per RSA»" in text and "«Addetto RSA»" in text, path.name


def test_the_brief_of_the_first_run_and_the_spawn_table_do_not_say_batches_either():
    brief = (ROOT / "shared" / "skills" / "burst_roster.py").read_text(encoding="utf-8")
    assert "after batches of 3-5" not in brief and "after each insert" in brief
    for lang in LANGS:
        table = (ROOT / "agents" / "_skills" / "spawn-agent" / f"SKILL{lang}.md").read_text(encoding="utf-8")
        row = next(line for line in table.splitlines() if line.startswith("| `scout`"))
        assert "3-5" not in row, lang
