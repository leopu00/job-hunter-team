"""The shutdown protocol is an agent order, excluded from user-facing copy."""
from pathlib import Path

from test_shared_backend_english import census

ROOT = Path(__file__).resolve().parents[1]
ORDER = ROOT / "game/scripts/setup/graceful_shutdown_request.gd"


def test_shutdown_order_continuations_are_excluded_from_the_copy_census(tmp_path):
    visible = [text for _, text in census.gdscript_visible_literals(ORDER)]
    assert not any("l'applicazione. Usa" in text or "ogni agente" in text or "poi fermali" in text
                   for text in visible)
    # Positive control: the envelope alone excludes only the first line.
    unmarked = tmp_path / "unmarked.gd"
    unmarked.write_text("\n".join(line for line in ORDER.read_text(encoding="utf-8").splitlines()
                                    if "NON TRADURRE" not in line), encoding="utf-8")
    leaked = [text for _, text in census.gdscript_visible_literals(unmarked)]
    assert any("l'applicazione. Usa" in text for text in leaked)
