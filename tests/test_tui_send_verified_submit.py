"""Il kickoff dichiara SENT OK solo se la TUI ha ACCETTATO l'Enter.

`tui_send_verified` (.launcher/tui-helpers.sh) digitava il testo, ne vedeva la
firma nel pane, mandava UN Enter e ritornava 0. Il kickoff di start-agent.sh
loggava quindi "SENT OK" anche quando l'Enter era andato perso: su Codex, con un
prompt di ~2000 caratteri, l'ASSISTENTE e' rimasto fermo con il messaggio nel
composer e un log che diceva il contrario.

Ora, dopo l'Enter, il pane si rilegge: accettato se il turno e' partito o se il
testo non e' piu' nel composer; altrimenti si ripete SOLO l'Enter (mai il testo,
che raddoppierebbe), fino al tetto, e si ritorna 2.

Il tmux finto disegna un composer come le TUI vere (Codex: "›" e righe di
continuazione; Claude: box con bordi "│") e decide se accettare gli Enter.
Gira con dash, la /bin/sh del container dove il kickoff gira davvero (`setsid
sh -c`), e con bash.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
HELPERS = ROOT / ".launcher" / "tui-helpers.sh"
START_AGENT = ROOT / ".launcher" / "start-agent.sh"

# FAKE_STYLE: codex | claude. FAKE_ENTER: accept | lose:N (perde i primi N) |
# never. FAKE_BUSY=1: a turno partito compare la riga di stato. FAKE_KEEP=1: la
# bozza resta disegnata nel composer anche a turno partito. FAKE_ROWS=N: il
# composer Codex mostra solo le ultime N righe della bozza (scorre come una
# textarea): il marker "›" e la testa del messaggio sono fuori vista.
# FAKE_PLACEHOLDER=1: un incolla lungo (> 500 caratteri) il composer lo mostra come
# segnaposto («[Pasted Content N chars]» su Codex, «[Pasted text #1 +N lines]» su
# Claude), senza una parola del testo, come fanno le TUI vere.
FAKE_TMUX = r"""#!/usr/bin/env bash
d="$FAKE_DIR"
printf '%s\n' "$*" >> "$d/calls"
sub="$1"; shift
literal=0; key=""
while [ $# -gt 0 ]; do
  case "$1" in
    -t) shift 2 ;;
    -p) shift ;;
    -l) literal=1; shift ;;
    *) key="$1"; shift ;;
  esac
done
draft() {  # la bozza come la mostra la TUI: con FAKE_PLACEHOLDER=1 un incolla lungo diventa il segnaposto
  if [ "${FAKE_PLACEHOLDER:-0}" = 1 ] && [ "$(wc -c < "$d/composer" | tr -d ' ')" -gt 500 ]; then
    if [ "$FAKE_STYLE" = claude ]; then printf '[Pasted text #1 +%s lines]\n' "$(wc -l < "$d/composer" | tr -d ' ')"
    else printf '[Pasted Content %s chars]\n' "$(wc -c < "$d/composer" | tr -d ' ')"; fi
  else cat "$d/composer"; echo; fi
}
render() {  # stdin = testo grezzo, $1 = marker della prima riga
  awk -v W=60 -v style="$FAKE_STYLE" -v first="$1" '
    { line = $0
      do {
        chunk = substr(line, 1, W); line = substr(line, W + 1)
        p = (started ? "  " : first); started = 1
        if (style == "claude") printf "│ %s%-60s │\n", p, chunk
        else print p chunk
      } while (length(line) > 0) }'
}
case "$sub" in
  send-keys)
    if [ "$literal" = 1 ]; then
      printf '%s' "$key" >> "$d/composer"
    elif [ "$key" = Enter ]; then
      n=$(( $(cat "$d/enters" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/enters"
      accept=0
      case "$FAKE_ENTER" in
        accept) accept=1 ;;
        lose:*) [ "$n" -gt "${FAKE_ENTER#lose:}" ] && accept=1 ;;
      esac
      if [ "$accept" = 1 ] && [ -s "$d/composer" ]; then
        { cat "$d/composer"; echo; } | render "› " >> "$d/transcript"
        [ "${FAKE_BUSY:-0}" = 1 ] && echo "• Working (0s • esc to interrupt)" >> "$d/transcript"
        [ "${FAKE_KEEP:-0}" = 1 ] || : > "$d/composer"
      fi
    fi ;;
  capture-pane)
    cat "$d/transcript" 2>/dev/null
    echo
    if [ "$FAKE_STYLE" = claude ]; then
      echo "╭──────────────────────────────────────────────────────────────╮"
      if [ -s "$d/composer" ]; then draft | render "> "
      else printf '│ > %-60s │\n' ""; fi
      echo "╰──────────────────────────────────────────────────────────────╯"
      echo "  ? for shortcuts"
    else
      if [ -s "$d/composer" ]; then draft | render "› " | tail -n "${FAKE_ROWS:-1000}"
      else echo "› Ask Codex to do anything"; fi
      echo
      echo "  100% context left · ? for shortcuts"
    fi ;;
  *) exit 0 ;;
esac
"""


def _shells():
    found = []
    for name in ("dash", "bash"):
        path = shutil.which(name)
        if path:
            found.append(path)
    return found


@pytest.fixture(params=_shells() or [None], ids=lambda p: Path(p).name if p else "none")
def shell(request):
    if sys.platform == "win32":
        pytest.skip("il launcher gira nel container Linux")
    if request.param is None:
        pytest.skip("ne' dash ne' bash disponibili")
    return request.param


class _Fake:
    def __init__(self, tmp_path: Path):
        self.dir = tmp_path / "tui"
        self.dir.mkdir()
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        (self.bin / "tmux").write_text(FAKE_TMUX, encoding="utf-8", newline="\n")
        (self.bin / "tmux").chmod(0o755)
        # Le attese dell'helper (1.5 s + 0.4 s + 1.2 s per Enter) non provano
        # niente qui: il tmux finto risponde subito.
        (self.bin / "sleep").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8", newline="\n")
        (self.bin / "sleep").chmod(0o755)

    def send(self, shell, msg, *, style="codex", enter="accept", busy=False, keep=False, rows=None, placeholder=False):
        env = {
            **os.environ,
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "FAKE_DIR": str(self.dir),
            "FAKE_STYLE": style,
            "FAKE_ENTER": enter,
            "FAKE_BUSY": "1" if busy else "0",
            "FAKE_KEEP": "1" if keep else "0",
            "FAKE_ROWS": str(rows or 1000),
            "FAKE_PLACEHOLDER": "1" if placeholder else "0",
            "MSG": msg,
        }
        env.pop("TUI_SUBMIT_TRIES", None)
        script = f'. "{HELPERS}"\ntui_send_verified ASSISTENTE "$MSG"\necho "rc=$?"\n'
        result = subprocess.run([shell, "-c", script], capture_output=True, text=True, env=env, timeout=60)
        rc = [line for line in result.stdout.splitlines() if line.startswith("rc=")]
        assert rc, result.stdout + result.stderr
        return int(rc[-1][3:]), result

    def calls(self):
        return (self.dir / "calls").read_text(encoding="utf-8").splitlines()

    def typed(self):
        return sum(1 for c in self.calls() if c.startswith("send-keys") and " -l " in c)

    def enters(self):
        return sum(1 for c in self.calls() if c.startswith("send-keys") and c.endswith(" Enter"))


# Un kickoff come quello dell'ASSISTENTE: molte righe, ~2000 caratteri, e
# un'ultima riga che il composer manda a capo DENTRO gli ultimi 30 caratteri
# (70 caratteri, larghezza 60): la sonda deve reggere il ritorno a capo.
LONG_MSG = "\n".join(
    ["[@system -> @assistente] [WELCOME-USER]", ""]
    + [f"{i}. step {i} of the user welcome protocol, idempotent, " + "x" * 40 for i in range(1, 22)]
    + ["", "Then start working immediately, do not stay idle waiting for a signal."]
)
SHORT_MSG = "[@utente -> @sentinella] [MSG] Startup. Wait for the first [BRIDGE TICK]."


@pytest.mark.parametrize("style", ["codex", "claude"])
def test_an_enter_accepted_at_once_is_sent_ok(shell, tmp_path, style):
    fake = _Fake(tmp_path)
    rc, out = fake.send(shell, LONG_MSG, style=style, enter="accept")
    assert rc == 0, out.stdout + out.stderr
    assert fake.enters() == 1
    assert fake.typed() == 1


@pytest.mark.parametrize("style", ["codex", "claude"])
def test_a_lost_enter_is_recovered_by_repeating_only_the_enter(shell, tmp_path, style):
    fake = _Fake(tmp_path)
    rc, out = fake.send(shell, LONG_MSG, style=style, enter="lose:1")
    assert rc == 0, out.stdout + out.stderr
    assert fake.enters() == 2
    assert fake.typed() == 1, "il testo e' stato ridigitato: nel composer sarebbe doppio"


@pytest.mark.parametrize("style", ["codex", "claude"])
def test_an_enter_never_accepted_is_not_reported_as_sent(shell, tmp_path, style):
    fake = _Fake(tmp_path)
    rc, out = fake.send(shell, LONG_MSG, style=style, enter="never")
    assert rc == 2, out.stdout + out.stderr
    assert fake.enters() == 3, "il tetto degli Enter e' 3"
    assert fake.typed() == 1, "il testo e' stato ridigitato: nel composer sarebbe doppio"


def test_a_short_message_never_accepted_is_not_reported_as_sent(shell, tmp_path):
    fake = _Fake(tmp_path)
    rc, out = fake.send(shell, SHORT_MSG, enter="never")
    assert rc == 2, out.stdout + out.stderr
    assert fake.typed() == 1


def test_a_turn_that_starts_counts_as_accepted(shell, tmp_path):
    """La bozza resta disegnata, ma la riga di stato dice che il turno e' partito."""
    fake = _Fake(tmp_path)
    rc, out = fake.send(shell, SHORT_MSG, enter="accept", busy=True, keep=True)
    assert rc == 0, out.stdout + out.stderr
    assert fake.enters() == 1


def test_prose_quoting_esc_to_interrupt_is_not_a_turn(shell, tmp_path):
    """Il transcript cita la riga di stato, a ridosso del composer: non e' un
    turno partito (messaggio corto, cosi' la citazione cade nelle ultime righe)."""
    fake = _Fake(tmp_path)
    (fake.dir / "transcript").write_text(
        'All workers idle at the prompt (no spinner, no "esc to interrupt") - halted as expected.\n',
        encoding="utf-8",
    )
    rc, out = fake.send(shell, SHORT_MSG, enter="never")
    assert rc == 2, out.stdout + out.stderr


def test_the_kickoff_and_the_welcome_watchdog_log_an_unconfirmed_submit():
    source = START_AGENT.read_text(encoding="utf-8")
    kickoff = source[source.index("_kickoff() {"): source.index("_welcome_kickoff() {")]
    assert "SUBMIT NOT CONFIRMED" in kickoff
    assert "2) echo" in kickoff and '0) echo "[$(date +%H:%M:%S)] SENT OK"' in kickoff
    start = source.index("_welcome_kickoff() {")
    welcome = source[start: source.index('\nif [ "$ROLE" = "assistente" ]', start)]
    # il watchdog vive in tui-helpers.sh (tui_welcome_watchdog), start-agent lo chiama
    assert "tui_welcome_watchdog" in welcome
    helpers = HELPERS.read_text(encoding="utf-8")
    watchdog = helpers[helpers.index("tui_welcome_watchdog() {"):]
    assert "SUBMIT NOT CONFIRMED" in watchdog


@pytest.mark.parametrize("enter,expected_rc,expected_enters", [("accept", 0, 1), ("never", 2, 3)])
def test_a_long_draft_scrolled_inside_the_composer(shell, tmp_path, enter, expected_rc, expected_enters):
    """Il kickoff dell'ASSISTENTE su Codex: la bozza scorre nel composer, il
    marker e la testa sono fuori vista e la coda e' spezzata dal ritorno a capo.
    Resta da guardare il fondo del pane, a testo compattato."""
    fake = _Fake(tmp_path)
    rc, out = fake.send(shell, LONG_MSG, enter=enter, rows=6)
    assert rc == expected_rc, out.stdout + out.stderr
    assert fake.enters() == expected_enters
    assert fake.typed() == 1


def test_a_quoted_status_line_does_not_hide_a_turn_that_starts(shell, tmp_path):
    """Una citazione di "esc to interrupt" gia' nel pane non e' un turno: se
    contasse, il turno vero partito con l'Enter non si vedrebbe piu'. La prosa
    va a capo subito dopo la frase, come la manda a capo una TUI: a riconoscerla
    restano solo le virgolette davanti."""
    fake = _Fake(tmp_path)
    (fake.dir / "transcript").write_text(
        'All three workers are idle: the dashboard no longer shows "esc to interrupt\n'
        'on any of them, halted as expected.\n',
        encoding="utf-8",
    )
    rc, out = fake.send(shell, SHORT_MSG, enter="accept", busy=True, keep=True)
    assert rc == 0, out.stdout + out.stderr
    assert fake.enters() == 1


def test_a_turn_already_running_does_not_confirm_a_lost_enter(shell, tmp_path):
    """Reiniezione del watchdog del welcome mentre l'agente lavora: la riga di
    stato c'era gia' prima dell'Enter, quindi non prova che QUESTO Enter sia
    stato accettato. Il testo resta nel composer: non confermato."""
    fake = _Fake(tmp_path)
    (fake.dir / "transcript").write_text("• Working (12s • esc to interrupt)\n", encoding="utf-8")
    rc, out = fake.send(shell, SHORT_MSG, enter="never")
    assert rc == 2, out.stdout + out.stderr
    assert fake.enters() == 3
    assert fake.typed() == 1


# ── il segnaposto di incolla: il testo c'e', ma il composer non ne mostra una parola ──


@pytest.mark.parametrize("style", ["codex", "claude"])
@pytest.mark.parametrize("enter", ["accept", "lose:1"])
def test_a_long_paste_shown_as_a_placeholder_is_typed_once(shell, tmp_path, style, enter):
    """Le TUI vere raccolgono un incolla lungo in un segnaposto: la sonda (testa e
    coda del messaggio) non compare mai, e l'helper credeva che il testo non fosse
    arrivato, lo ridigitava, e il composer teneva il benvenuto due o tre volte."""
    fake = _Fake(tmp_path)
    rc, out = fake.send(shell, LONG_MSG, style=style, enter=enter, placeholder=True)
    assert rc == 0, out.stdout + out.stderr
    assert fake.typed() == 1, "il testo e' stato ridigitato: nel composer sarebbe doppio\n" + out.stdout
    assert fake.enters() == (1 if enter == "accept" else 2)


def test_a_placeholder_that_never_goes_away_is_not_reported_as_sent(shell, tmp_path):
    fake = _Fake(tmp_path)
    rc, out = fake.send(shell, LONG_MSG, enter="never", placeholder=True)
    assert rc == 2, out.stdout + out.stderr
    assert fake.typed() == 1
    assert fake.enters() == 3
