"""O-23 — il watchdog deve dire cosa ha VISTO, non cosa suppone.

Il messaggio al Capitano diceva «hit the step cap» in ogni caso. Ma lo step cap
esiste solo su Kimi: `--max-steps-per-turn 100` vive nel suo ramo di
`start-agent.sh` e in nessun altro. Su Claude e Codex quella frase è una
diagnosi falsa, e l'ordine che la accompagna — «inspect what is running» —
manda il Capitano a cercare un vicolo cieco che non c'è.

E la causa vera, quando l'abbiamo vista sul campo, era scritta tre volte nella
stessa schermata: «Usage limit reached». Il watchdog non la distingueva: metteva
in pausa e poi riprendeva un agente a quota esaurita, cioè lo rimandava contro
lo stesso muro.

Questi test non guardano il rilevamento — quello è giusto e non si tocca, senza
la rilevazione senza marcatore il watchdog era inerte su ogni VPS non-Kimi.
Guardano cosa viene DETTO.
"""

import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WATCHDOG = ROOT / ".launcher" / "stepcap-watchdog.py"


def load_watchdog():
    spec = importlib.util.spec_from_file_location("stepcap_watchdog", WATCHDOG)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def wd():
    return load_watchdog()


def test_a_still_pane_is_reported_as_a_still_pane(wd):
    """Nessun marcatore: si dice che non si è mosso, non che ha finito gli step."""
    said = wd.describe_stall("no marker: pane unchanged for 15 cycles", 15, None)

    assert "not moved" in said
    assert "step cap" not in said, said


def test_the_real_step_cap_is_still_called_by_its_name(wd):
    """Su Kimi il marcatore esiste davvero: lì la frase storica è corretta."""
    said = wd.describe_stall("Max number of steps reached", 3, None)

    assert "step cap" in said


def test_running_out_of_quota_is_not_a_rabbit_hole(wd):
    """Il caso che ha aperto il ticket: fermo per quota, non per vicolo cieco."""
    said = wd.describe_stall(
        "no marker: pane unchanged for 15 cycles",
        15,
        "Usage limit reached · resets at 18:00",
    )

    assert "usage quota" in said
    assert "step cap" not in said, said
    # La riga originale va riportata: al Capitano serve il testo, non la parafrasi.
    assert "resets at 18:00" in said


@pytest.mark.parametrize(
    "line",
    [
        "  Usage limit reached",
        "Claude usage limit reached — try again later",
        "API error 429: rate limit exceeded",
        "You have hit your quota exceeded threshold",
        "  2. Upgrade your plan",
    ],
)
def test_quota_signals_are_recognised_in_the_pane(wd, line):
    assert wd.find_usage_limit(["noise", line, "more noise"]) is not None


def test_an_ordinary_pane_is_not_mistaken_for_a_quota_wall(wd):
    """Il contrario del test sopra: senza questo, basterebbe restituire sempre
    qualcosa per farli passare tutti."""
    tail = [
        "⏺ Running tests…",
        "  Ran 2 shell commands",
        "✻ Thinking… (4m 3s)",
    ]

    assert wd.find_usage_limit(tail) is None


def test_the_captain_is_told_not_to_go_looking_when_it_is_a_quota_wall(wd, monkeypatch):
    from types import SimpleNamespace
    module = wd._delivery_module()
    messages = []
    ctx = SimpleNamespace(throttle_for=lambda *a: 60, arm_pause=lambda *a: {
        "via": "none", "applied_sec": 60, "until": 60}, emit=lambda *a, **k: None,
        notify_captain=lambda text: messages.append(text) or True, ESCALATE_AT=4)
    module._throttle(ctx, "SCOUT-1", "scout-1", {}, 0, "fixture", "quota", "quota", 3)
    assert "a pause does not refill a quota" in messages[0]
    assert "Do not inspect what is running" in messages[0]
    assert "Do not look for a rabbit hole" in module._escalation_message("scout-1", "quota", 4, "quota")
