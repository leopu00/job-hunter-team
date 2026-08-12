"""Ogni azione di input consumata nei .gd deve essere dichiarata — senza Godot.

[WIN-INTERACT-ACTION-UNDECLARED] Il gioco dichiara le azioni A RUNTIME, in
`_register_inputs()` (game.gd — «Input map via codice, niente sezione [input]
nel project.godot»). Un'azione consumata ma mai dichiarata non rompe niente a
compile-time e nemmeno a runtime: Godot logga un errore A OGNI INPUT e va
avanti. Sono decine di KB di log in pochi minuti, che seppelliscono i
messaggi veri — la stessa malattia del rosso normalizzato dei test.

È già successo, e in un modo che nessun occhio poteva vedere: la rimozione
del personaggio giocatore (a9b518dfc1) ha tolto `interact` dalla
registrazione insieme al suo uso in ufficio, ma il consumo dentro
`dialogue_ui.gd` è sopravvissuto — orfano per un mese. Questo test è il
confronto che mancava: azioni CONSUMATE contro azioni DICHIARATE, con un
parse dei sorgenti. Non serve Godot, quindi gira anche dove Godot non può.

Fail-closed nei due sensi del censimento: se il parser smette di trovare le
dichiarazioni o i consumi (refactor, rename, file spostato) i guardiani di
soglia falliscono INVECE di lasciare verde un confronto fra insiemi vuoti.
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GAME_GD = REPO / "game" / "scripts" / "game.gd"
SCRIPTS = REPO / "game" / "scripts"

# Le azioni `ui_*` sono i default che Godot stesso definisce (ui_accept,
# ui_cancel, …): esistono senza dichiarazione di progetto, per costruzione.
BUILTIN_PREFIX = "ui_"

# Tutte le forme con cui i .gd di questo repo CONSUMANO un'azione. L'elenco è
# deliberatamente esplicito: un pattern generico su qualsiasi stringa
# produrrebbe falsi positivi (chiavi i18n, nomi di nodi), e un censimento che
# grida al lupo si disattiva come quello che tace.
_CONSUME = [
    # is_action / is_action_pressed / is_action_just_pressed / is_action_released
    re.compile(r'is_action(?:_just)?(?:_pressed|_released)?\(\s*"([^"]+)"'),
    re.compile(r'get_action_strength\(\s*"([^"]+)"'),
    re.compile(r'action_(?:press|release)\(\s*"([^"]+)"'),
    # InputEventAction costruita a mano (title.gd): `.action = "ui_accept"`
    re.compile(r'\.action\s*=\s*"([^"]+)"'),
]
# get_vector / get_axis prendono più azioni per chiamata: prima si isola la
# chiamata, poi si estraggono tutte le stringhe dentro le sue parentesi.
_MULTI = re.compile(r"get_(?:vector|axis)\(([^)]*)\)")
_QUOTED = re.compile(r'"([^"]+)"')


def declared_actions() -> set[str]:
    src = GAME_GD.read_text(encoding="utf-8")
    return set(re.findall(r'_add_key_action\(\s*"([^"]+)"', src))


def consumed_actions() -> dict[str, list[str]]:
    """azione -> lista di `file:riga` che la consumano."""
    found: dict[str, list[str]] = {}
    for path in sorted(SCRIPTS.rglob("*.gd")):
        text = path.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), 1):
            names: list[str] = []
            for rx in _CONSUME:
                names.extend(rx.findall(line))
            for args in _MULTI.findall(line):
                names.extend(_QUOTED.findall(args))
            for name in names:
                where = f"{path.relative_to(REPO)}:{lineno}"
                found.setdefault(name, []).append(where)
    return found


def test_il_censimento_trova_davvero_le_dichiarazioni():
    # Senza questa soglia un rename di _add_key_action renderebbe il
    # confronto qui sotto un verde su un insieme vuoto.
    assert len(declared_actions()) >= 8


def test_il_censimento_trova_davvero_i_consumi():
    consumed = consumed_actions()
    assert len(consumed) >= 10
    # Il caso che questo file esiste per non far regredire: il consumo
    # orfano di dialogue_ui. Se sparisce dal censimento, o è stato rimosso
    # (e questo test va aggiornato con cognizione) o il parser è cieco.
    assert "interact" in consumed


def test_ogni_azione_consumata_e_dichiarata():
    declared = declared_actions()
    orphans = {
        name: places
        for name, places in consumed_actions().items()
        if name not in declared and not name.startswith(BUILTIN_PREFIX)
    }
    assert orphans == {}, (
        "azioni consumate ma mai dichiarate in _register_inputs "
        f"(errore a ogni input, log seppelliti): {orphans}"
    )
