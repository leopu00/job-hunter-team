"""Contratto statico fra tour guidato e pannelli nativi, senza avviare Godot.

[WIN-TOUR-DRAWS-OVER-SETUP] ha due cause indipendenti ma adiacenti:

* `SectionPanel` dichiara già di essere un `camera_blocking_overlay`; la regia
  del tour deve rispettare quel gruppo prima di montare il dialogo a layer 60,
  non mantenere un secondo elenco incompleto di pannelli;
* interrompere il giro deve silenziare la regia senza trasformare l'indice
  persistito da `TourGuide` in un completamento. Lo stesso stato `dismissed`
  che ferma chat e azioni deve poter tornare falso, e la sidebar deve offrire
  il percorso di ripresa.

I controlli sono intenzionalmente sul wiring, non sull'aspetto: mordono sul
codice precedente senza richiedere export o runtime Godot su questa macchina.
"""

import re
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
OFFICE = REPO / "game" / "scripts" / "office" / "office.gd"
SECTION_PANEL = REPO / "game" / "scripts" / "ui" / "section_panel.gd"
SIDEBAR = REPO / "game" / "scripts" / "ui" / "game_sidebar.gd"
SCRIPTED = REPO / "game" / "scripts" / "setup" / "scripted_onboarding.gd"
TOUR = REPO / "game" / "scripts" / "setup" / "tour_guide.gd"
UI_STRINGS = REPO / "game" / "scripts" / "ui_strings.gd"
I18N = REPO / "game" / "scripts" / "i18n"


def source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def function_body(text: str, name: str) -> str:
    """Estrae una funzione GDScript top-level fino alla funzione successiva."""
    match = re.search(
        rf"(?ms)^func {re.escape(name)}\([^\n]*\)(?:\s*->\s*[^:]+)?:\n"
        rf"(?P<body>.*?)(?=^func |\Z)",
        text,
    )
    assert match, f"funzione GDScript assente: {name}"
    return match.group("body")


def test_il_tour_rispetta_il_contratto_degli_overlay_nativi():
    section = source(SECTION_PANEL)
    office = source(OFFICE)
    opener = function_body(office, "_tour_open_stop_dialogue")

    assert 'add_to_group("camera_blocking_overlay")' in section
    assert "camera_blocking_overlay" in opener, (
        "il setup dichiara già il contratto camera_blocking_overlay, ma il "
        "tour non lo consulta prima di montare DialogueUI sopra il pannello"
    )
    assert opener.index("camera_blocking_overlay") < opener.index("DialogueUI.new()")


def test_interrompere_non_marca_il_tour_come_completato():
    scripted = source(SCRIPTED)
    tour = source(TOUR)
    dismiss = function_body(scripted, "dismiss")
    skip = function_body(tour, "skip")

    assert "_dismissed = true" in dismiss and "_save_state()" in dismiss
    assert "TourGuide.finish()" not in dismiss
    assert "finish()" not in skip
    assert "ScriptedOnboarding.dismiss()" in skip


def test_lo_stesso_stato_persistito_puo_essere_ripreso():
    scripted = source(SCRIPTED)
    tour = source(TOUR)
    sidebar = source(SIDEBAR)
    office = source(OFFICE)

    resume = function_body(scripted, "resume")
    active = function_body(tour, "active")
    assert "_dismissed = false" in resume and "_save_state()" in resume
    assert "resumed.emit()" in resume
    assert "ScriptedOnboarding.is_dismissed()" in active
    assert "ScriptedOnboarding.resumed.connect" in office
    assert "TourTracker.new()" in function_body(office, "_on_tour_resumed")
    assert "_tour_resume_entry" in function_body(office, "_on_tour_resumed")
    assert "ScriptedOnboarding.resume" in sidebar


def test_pausa_e_ripresa_hanno_copy_in_tutte_le_lingue_ui():
    catalogs = [UI_STRINGS, *sorted(I18N.glob("ui_*.gd"))]
    assert len(catalogs) == 7, "il perimetro UI atteso è fallback italiano + 6 cataloghi"
    for path in catalogs:
        text = source(path)
        assert '"tour.pause"' in text, f"tour.pause assente in {path.relative_to(REPO)}"
        assert '"tour.resume"' in text, f"tour.resume assente in {path.relative_to(REPO)}"
