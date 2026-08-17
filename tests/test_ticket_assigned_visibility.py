"""O-164 — 'assigned' non è uno stato che si tiene da solo.

Il difetto che ha prodotto il report: `list-open` rispondeva «No open tickets»
mentre QUATTRO ticket erano aperti. Erano tutti in stato `assigned`, e la lista
mostrava solo gli `open` — quindi il Capitano vedeva una coda vuota e non li
avrebbe ripresi mai più.

La diagnosi ovvia era «gli agenti sono morti in un riavvio», e per due dei
quattro era vera. Ma **JHT-1173 era assegnato a scorer-3, che era VIVO — ed è
rimasto fermo 98 ore lo stesso**. Quel dato sposta la domanda: non «l'agente
esiste?» ma «il ticket sta avanzando?». Un fix costruito sulle sessioni morte
avrebbe lasciato scoperto un caso su quattro, e sarebbe stato scoperto la
prossima volta da un utente, non da noi.

Il test di accettazione centrale è quindi
`test_a_live_agent_holding_a_ticket_without_touching_it_loses_it`.

Le proprietà, nell'ordine in cui contano:

 1. un agente VIVO che non tocca il ticket lo perde comunque;
 2. un agente che lavora davvero se lo tiene — l'orologio riparte a ogni
    traccia di lavoro sulla posizione, o il fix diventerebbe un ladro;
 3. l'assegnatario sparito resta un motivo valido, ma è il secondo;
 4. la coda non può dirsi vuota mentre qualcuno aspetta — il caso del report,
    riprodotto con quattro ticket tutti `assigned`;
 5. l'attesa si vede, perché un ticket di tre giorni deve sembrare di tre
    giorni.

Più i due che proteggono il fix da sé stesso: la liveness non stabilibile non
reclama nulla (un set vuoto da `tmux` che non risponde significa «non lo so»,
non «sono morti tutti»), e le ore si misurano riportando a UTC colonne scritte
in basi orarie diverse.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

TICKET_CLI = ROOT / "shared" / "skills" / "ticket.py"


@pytest.fixture()
def box(tmp_path, monkeypatch):
    """Il jobs.db vero, costruito da `_db.ensure_schema`.

    Non uno schema scritto a mano: `position_tickets` cambia con le migrazioni
    e un test che si porta la propria copia smette di parlare della tabella
    che il Capitano legge davvero.
    """
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    import importlib
    import _db
    _db = importlib.reload(_db)
    conn = _db.get_db()
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions (id, company, title, url, status) "
        "VALUES (5, 'Lumon', 'Backend Developer', "
        "'https://example.invalid/5', 'scored')"
    )
    conn.commit()
    yield conn
    conn.close()


def _add(conn, *, status="open", agent=None, created_days_ago=0.0,
         assigned_hours_ago=None, touched_hours_ago=None, ticket_id=None):
    """Un ticket con l'anzianità che serve al caso.

    ⚠️ `created_at` si scrive in UTC e `assigned_at` in ora locale, perché è
    così che li scrivono il DEFAULT della tabella e `assign()`. Allinearli qui
    "per comodità" renderebbe il test cieco proprio all'errore di fuso che il
    codice deve evitare.

    `updated_at` segue l'assegnazione se non si chiede altro, perché è ciò che
    fa `assign()`: un ticket assegnato tre giorni fa e mai toccato ha lì il
    timestamp di allora, non quello di adesso. Lasciare il DEFAULT (che vale
    «adesso») descriverebbe uno stato che nel prodotto non esiste, e il test
    direbbe di sì a un codice rotto.
    """
    created = f"datetime('now','-{created_days_ago} days')"
    assigned = (
        "NULL" if assigned_hours_ago is None
        else f"datetime('now','localtime','-{assigned_hours_ago} hours')"
    )
    touched_at = (
        touched_hours_ago if touched_hours_ago is not None else assigned_hours_ago
    )
    updated = (
        "datetime('now','localtime')" if touched_at is None
        else f"datetime('now','localtime','-{touched_at} hours')"
    )
    cur = conn.execute(
        f"INSERT INTO position_tickets "
        f"(id, position_id, request_text, status, assigned_agent, created_at, "
        f" assigned_at, updated_at) "
        f"VALUES (?, 5, 'verifica questa offerta', ?, ?, {created}, {assigned}, "
        f"        {updated})",
        (ticket_id, status, agent),
    )
    conn.commit()
    return int(cur.lastrowid)


def _status(conn, ticket_id):
    row = conn.execute(
        "SELECT status, assigned_agent FROM position_tickets WHERE id = ?",
        (ticket_id,),
    ).fetchone()
    return row["status"], row["assigned_agent"]


# ── 1. il criterio: il ticket avanza? ──────────────────────────────────────

def test_a_live_agent_holding_a_ticket_without_touching_it_loses_it(box):
    """Il caso JHT-1173, che ha smontato la diagnosi ovvia.

    scorer-3 è vivo — la sessione risponde — e il ticket è fermo da 98 ore.
    Nessuna traccia di lavoro sulla posizione da quando gli è stato assegnato:
    il ticket torna in coda, e il motivo dice l'immobilità, non l'assenza.
    """
    import ticket

    stuck = _add(box, status="assigned", agent="scorer-3",
                 created_days_ago=4, assigned_hours_ago=98)

    reclaimed = ticket.reclaim_stale(box, live={"SCORER-3", "CAPITANO"})

    assert [r[0] for r in reclaimed] == [stuck]
    assert "no progress" in reclaimed[0][2], reclaimed
    assert "no longer alive" not in reclaimed[0][2], (
        "scorer-3 è vivo: dire che è morto sarebbe una diagnosi sbagliata "
        "scritta in un log che qualcuno leggerà"
    )
    assert _status(box, stuck) == ("open", None)


def test_an_agent_that_is_actually_working_keeps_its_ticket(box):
    """L'altra metà, senza la quale il fix diventa un ladro.

    Stesso ticket vecchio di 98 ore, ma sulla posizione c'è una traccia di
    lavoro recente: l'orologio dell'immobilità riparte da lì, non
    dall'assegnazione.
    """
    import ticket

    working = _add(box, status="assigned", agent="scorer-3",
                   created_days_ago=4, assigned_hours_ago=98)
    box.execute(
        "INSERT INTO scores (position_id, total_score, scored_by, scored_at) "
        "VALUES (5, 88, 'scorer-3', strftime('%Y-%m-%d %H:%M:%f','now','-1 hours'))"
    )
    box.commit()

    assert ticket.reclaim_stale(box, live={"SCORER-3"}) == []
    assert _status(box, working) == ("assigned", "scorer-3")


def test_progress_counts_from_any_of_the_traces_the_team_leaves(box):
    """Le tracce sono tre perché i ruoli sono tre: analista, scorer, scrittore."""
    import ticket

    held = _add(box, status="assigned", agent="analista-2", assigned_hours_ago=50)
    box.execute(
        "UPDATE positions SET last_checked = datetime('now','localtime','-30 minutes') "
        "WHERE id = 5"
    )
    box.commit()
    assert ticket.reclaim_stale(box, live={"ANALISTA-2"}) == []

    box.execute("UPDATE positions SET last_checked = NULL WHERE id = 5")
    box.execute(
        "INSERT INTO applications (position_id, status, written_at) "
        "VALUES (5, 'draft', datetime('now','localtime','-20 minutes'))"
    )
    box.commit()
    assert ticket.reclaim_stale(box, live={"ANALISTA-2"}) == []
    assert _status(box, held) == ("assigned", "analista-2")


# ── 2. l'assegnatario sparito, che resta un motivo valido ──────────────────

def test_a_ticket_assigned_to_a_dead_agent_comes_back_by_itself(box):
    """Assegnato da POCO, quindi l'immobilità non è ancora scattata: qui a
    parlare è il secondo criterio, da solo. Aspettare la scadenza avrebbe
    senso solo se qualcuno potesse ancora prenderlo, e scrittore-5 non c'è."""
    import ticket

    orphan = _add(box, status="assigned", agent="scrittore-5",
                  created_days_ago=3, assigned_hours_ago=1)
    working = _add(box, status="assigned", agent="scorer-2",
                   created_days_ago=0.1, assigned_hours_ago=1)

    # Lo scrittore-5 non c'è più: nel roster vivo restano gli altri.
    reclaimed = ticket.reclaim_stale(box, live={"SCORER-2", "CAPITANO"})

    assert [r[0] for r in reclaimed] == [orphan]
    assert "no longer alive" in reclaimed[0][2]
    # Torna assegnabile E senza assegnatario: un 'open' che dichiara ancora un
    # agente sarebbe un terzo stato che nessuno legge.
    assert _status(box, orphan) == ("open", None)
    # Chi sta davvero lavorando non si fa portare via il ticket.
    assert _status(box, working) == ("assigned", "scorer-2")


def test_a_freshly_assigned_ticket_is_not_born_expired(box):
    import ticket

    fresh = _add(box, status="assigned", agent="scrittore-5", assigned_hours_ago=2)
    stuck = _add(box, status="assigned", agent="scrittore-5", assigned_hours_ago=30)

    reclaimed = ticket.reclaim_stale(box, live={"SCRITTORE-5"})

    assert [r[0] for r in reclaimed] == [stuck]
    assert _status(box, fresh) == ("assigned", "scrittore-5")


def test_unknown_liveness_reclaims_nothing_for_a_missing_agent(box):
    """Il caso che trasformerebbe il fix in un guasto peggiore del difetto.

    `live_sessions()` risponde con un set vuoto sia quando non c'è nessun
    agente sia quando tmux non risponde. Se `None` (= non lo so) venisse
    trattato come «sono tutti morti», il primo singhiozzo di tmux svuoterebbe
    in blocco le assegnazioni di tutto il team.
    """
    import ticket

    recent = _add(box, status="assigned", agent="analista-4", assigned_hours_ago=1)

    assert ticket.reclaim_stale(box, live=None) == []
    assert _status(box, recent) == ("assigned", "analista-4")

    # L'immobilità, invece, non dipende dalla liveness ed è il criterio
    # principale: si misura anche quando di tmux non sappiamo niente.
    old = _add(box, status="assigned", agent="analista-4", assigned_hours_ago=99)
    assert [r[0] for r in ticket.reclaim_stale(box, live=None)] == [old]


# ── 2. la coda non mente ───────────────────────────────────────────────────

def test_the_queue_cannot_look_empty_while_tickets_wait(box, capsys):
    """Il caso del report, riprodotto: quattro ticket, tutti `assigned`."""
    import ticket

    dead = [
        _add(box, status="assigned", agent="scrittore-5",
             created_days_ago=3, assigned_hours_ago=70),
        _add(box, status="assigned", agent="analista-4",
             created_days_ago=2, assigned_hours_ago=48),
    ]
    alive = [
        _add(box, status="assigned", agent="scorer-2", assigned_hours_ago=1),
        _add(box, status="assigned", agent="scorer-2", assigned_hours_ago=2),
    ]

    ticket.list_open(box, live={"SCORER-2"})
    out = capsys.readouterr().out

    assert "No open tickets." not in out, (
        "quattro utenti stanno aspettando: questa riga è il difetto di O-164"
    )
    for ticket_id in dead + alive:
        assert f"#{ticket_id}" in out, f"#{ticket_id} non compare nella coda"
    # I due orfani sono tornati assegnabili, e il recupero si VEDE.
    assert out.count("back in the queue") == 2
    for ticket_id in dead:
        assert _status(box, ticket_id)[0] == "open"
    # Gli altri due restano di chi ci lavora, dichiarati come tali.
    assert "do NOT reassign" in out
    for ticket_id in alive:
        assert _status(box, ticket_id) == ("assigned", "scorer-2")


def test_no_tickets_at_all_still_says_so(box, capsys):
    import ticket

    ticket.list_open(box, live={"SCORER-2"})
    assert "No open tickets." in capsys.readouterr().out


def test_the_monitor_counts_what_nobody_is_working_on(box, capsys):
    """`count-open` è l'anello che teneva chiuso il cerchio.

    Il bridge sveglia il Capitano solo se questo numero è > 0, il Capitano è
    l'unico che esegue `list-open`, e `list-open` è dove i ticket orfani
    rientrano: con quattro `assigned` il numero era 0 e non si muoveva niente.
    """
    import ticket

    _add(box, status="assigned", agent="scrittore-5", assigned_hours_ago=70)
    _add(box, status="assigned", agent="scorer-2", assigned_hours_ago=1)
    _add(box, status="open")

    ticket.count_open(box, live={"SCORER-2"})

    # 1 open + 1 orfano. NON il ticket che scorer-2 sta lavorando davvero:
    # mai più di quanto è vero, o il Capitano insegue una coda gonfiata.
    assert capsys.readouterr().out.strip() == "2"
    # E resta read-only: il monitor lo chiama a ripetizione.
    assert box.execute(
        "SELECT COUNT(*) FROM position_tickets WHERE status = 'assigned'"
    ).fetchone()[0] == 2


# ── 3. l'attesa si vede ────────────────────────────────────────────────────

def test_a_three_day_old_ticket_looks_like_one(box, capsys):
    import ticket

    _add(box, status="open", created_days_ago=3.2)
    ticket.list_open(box, live={"SCORER-2"})
    out = capsys.readouterr().out
    assert "waiting 3g" in out, out


def test_age_reads_created_at_as_utc_not_as_local_time(box):
    """La trappola del fuso, misurata invece che commentata.

    `created_at` è UTC (DEFAULT CURRENT_TIMESTAMP) e `assigned_at` è ora
    locale (`assign()` scrive `datetime('now','localtime')`). Chi misura
    entrambi con lo stesso `now` sbaglia di tutto l'offset — due ore in
    Italia — e sbaglia in silenzio, che su un'attesa è il modo peggiore.
    """
    import ticket

    just_now = _add(box, status="open", created_days_ago=0)
    row = box.execute(
        f"SELECT {ticket._AGE_HOURS} AS age_hours FROM position_tickets WHERE id = ?",
        (just_now,),
    ).fetchone()
    assert abs(row["age_hours"]) < 0.05, (
        "un ticket appena creato non può risultare vecchio di ore: "
        "la base oraria di created_at non è quella usata per misurarlo"
    )

    held = _add(box, status="assigned", agent="scorer-2", assigned_hours_ago=0)
    row = box.execute(
        f"SELECT {ticket._ASSIGNED_HOURS} AS assigned_hours "
        "FROM position_tickets WHERE id = ?",
        (held,),
    ).fetchone()
    assert abs(row["assigned_hours"]) < 0.05


def test_age_text_reads_like_a_person_wrote_it():
    import ticket

    assert ticket._age_text(0.2) == "12m"
    assert ticket._age_text(5.5) == "5h 30m"
    assert ticket._age_text(76) == "3g 4h"
    assert ticket._age_text(None) == "?"


# ── 4. la CLI vera, dall'esterno ───────────────────────────────────────────

def test_the_command_line_reclaims_and_shows(box, tmp_path):
    """End-to-end sul comando che esegue il Capitano.

    `PATH` è vuoto di proposito: senza `tmux` raggiungibile la liveness NON è
    stabilibile, che è il caso conservativo — a rientrare è solo il ticket
    scaduto per tempo, e chi ha un assegnatario recente resta dov'è. Senza
    questo accorgimento il test leggerebbe il `tmux` della macchina di chi lo
    esegue (in CI assente, su un portatile pieno di sessioni che non c'entrano)
    e direbbe cose diverse a seconda di dove gira.
    """
    stuck = _add(box, status="assigned", agent="scrittore-5",
                 created_days_ago=3, assigned_hours_ago=70)
    fresh = _add(box, status="assigned", agent="scorer-2", assigned_hours_ago=1)

    result = subprocess.run(
        [sys.executable, str(TICKET_CLI), "list-open"],
        env={"JHT_HOME": str(tmp_path), "PATH": str(tmp_path / "no-tools")},
        capture_output=True, text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "No open tickets." not in result.stdout
    assert f"#{stuck}" in result.stdout
    assert f"#{fresh}" in result.stdout
    assert "back in the queue" in result.stdout
    assert _status(box, stuck)[0] == "open"
    assert _status(box, fresh) == ("assigned", "scorer-2")


# ── 6. O-173: la convenzione e il lavoro silenzioso ────────────────────────

def test_a_lowercase_session_does_not_make_every_agent_look_dead(box):
    """La convenzione che reggeva il confronto, tolta di mezzo.

    `live_sessions()` restituisce i nomi tmux GREZZI, e il confronto funzionava
    perché le sessioni si chiamano `SCORER-2` e gli agenti stanno in minuscolo
    nel DB. Il giorno che una sessione nascesse minuscola, ogni assegnatario
    risulterebbe morto e le assegnazioni si svuoterebbero in blocco — lo stesso
    disastro che il `None` fail-closed evita, entrato da un'altra porta.
    """
    import ticket

    held = _add(box, status="assigned", agent="scorer-2", assigned_hours_ago=1)

    for live in ({"scorer-2"}, {"Scorer-2"}, {"SCORER-2"}, {" scorer-2 "}):
        assert ticket.reclaim_stale(box, live=live) == [], f"live={live!r}"
        assert _status(box, held) == ("assigned", "scorer-2"), f"live={live!r}"

    # E il verso opposto continua a funzionare: chi non c'è resta non-vivo.
    assert [r[0] for r in ticket.reclaim_stale(box, live={"analista-1"})] == [held]


def test_the_liveness_answer_is_yes_when_nobody_can_say(box):
    import ticket

    assert ticket._agent_is_live("scorer-2", None) is True
    assert ticket._agent_is_live("scorer-2", {"scorer-2"}) is True
    assert ticket._agent_is_live("scorer-2", {"ANALISTA-1"}) is False


def test_touching_a_ticket_buys_time_for_silent_work(box):
    """Il contratto che sostituisce l'euristica.

    L'Analista che passa ore sull'azienda non tocca nessuna delle tre tabelle,
    e lo Scrittore scrive la riga solo alla fine: senza un modo esplicito di
    dire «ci sto ancora», quel lavoro si vedrebbe strappare il ticket.
    """
    import ticket

    silent = _add(box, status="assigned", agent="analista-2",
                  created_days_ago=2, assigned_hours_ago=40)
    # Prima del touch: fermo da 40 ore, rientra.
    fermi = ticket.stale_assignments(box, live={"ANALISTA-2"})
    assert [row["id"] for row, _ in fermi] == [silent]

    ticket.touch(box, silent)

    assert ticket.reclaim_stale(box, live={"ANALISTA-2"}) == []
    assert _status(box, silent) == ("assigned", "analista-2")


def test_only_the_holder_of_an_assigned_ticket_can_touch_it(box, capsys):
    import ticket

    queued = _add(box, status="open")
    with pytest.raises(SystemExit) as exit_code:
        ticket.touch(box, queued)
    assert exit_code.value.code == 1
    # Un 'open' toccato resterebbe assegnabile mentre qualcuno lo lavora.
    assert _status(box, queued) == ("open", None)


def test_the_touch_is_reachable_from_the_command_line(box, tmp_path):
    """Deve essere raggiungibile da una skill, non solo dal database."""
    held = _add(box, status="assigned", agent="analista-2", assigned_hours_ago=40)

    done = subprocess.run(
        [sys.executable, str(TICKET_CLI), "touch", str(held)],
        env={"JHT_HOME": str(tmp_path), "PATH": str(tmp_path / "no-tools")},
        capture_output=True, text=True,
    )

    assert done.returncode == 0, done.stderr
    assert "still in progress" in done.stdout
    assert _status(box, held) == ("assigned", "analista-2")

    listed = subprocess.run(
        [sys.executable, str(TICKET_CLI), "list-open"],
        env={"JHT_HOME": str(tmp_path), "PATH": str(tmp_path / "no-tools")},
        capture_output=True, text=True,
    )
    assert "back in the queue" not in listed.stdout, listed.stdout
    assert _status(box, held) == ("assigned", "analista-2")


def test_every_language_tells_the_agent_how_to_declare_long_work():
    """Il contratto esiste solo se l'agente sa che esiste — in tutte le lingue.

    Una skill raggiungibile citata in un prompt solo non è un contratto: è un
    contratto per chi legge l'inglese. La regola del repo è che una stringa
    nuova nasce in tutte e sette le lingue, e qui vale doppio, perché il prezzo
    di non sapere è il proprio lavoro rifatto da un altro.
    """
    prompts = sorted((ROOT / "agents" / "analista").glob("analista*.md"))
    assert len(prompts) == 7, [p.name for p in prompts]
    for prompt in prompts:
        text = prompt.read_text(encoding="utf-8")
        assert "ticket.py touch <id>" in text, (
            f"{prompt.name}: l'Analista non sa come dire «ci sto ancora lavorando»"
        )
        # Dev'essere nel workflow del ticket, non in una nota sciolta a fondo
        # pagina: si legge dove si lavora.
        assert text.index("ticket.py touch <id>") > text.index("ticket.py show <id>")
        assert text.index("ticket.py touch <id>") < text.index("ticket.py resolve <id>")
