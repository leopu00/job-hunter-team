#!/usr/bin/env python3
"""
apply_gate.py — il cancello che sta fra il team e la casella di posta di un
recruiter. [JHT-CLOSER]

Una candidatura parte SOLO se l'utente l'ha chiesta, e «l'ha chiesta» sono DUE
condizioni, non una:

  1. **consenso generale** — il blocco `applications.auto_apply` nel config
     utente (`$JHT_HOME/jht.config.json`, lo stesso file di `working_hours`);
  2. **autorizzazione per-posizione** — `positions.apply_requested` acceso
     dall'utente su QUELLA posizione, con un `apply_requested_by` che nomina
     una persona e non un processo.

Entrambe **fail-closed**: assente = disattivato. Non esiste un percorso in cui
il team si candida da solo, e se qualcuno ne trova uno quello è un bug P0 anche
con tutti i test verdi.

⚠️ **Questo modulo si comporta all'opposto di `working_hours.py`, e la
differenza è deliberata.** Là un config corrotto vale 24/7, perché il danno di
un team fermo per un JSON malformato è più grande del danno di un tick fuori
orario. Qui il danno è una lettera spedita a un recruiter con il nome
dell'utente sopra, che non si richiama indietro: qualunque dubbio — file
assente, JSON rotto, colonna mancante, DB illeggibile, valore che non
riconosciamo — vale NO. Chi in futuro aggiunge un ramo a questo file deve
chiudere il `else`, non aprirlo.

**Un solo cancello, in un posto solo**, come `cli/src/lib/halt-gate.js`: lo
applicano il launcher (che non spawna il CLOSER senza consenso) e la skill di
invio (che non manda senza flag). Due copie divergono al primo cambio, e qui
divergere significa che il launcher crede di aver chiuso una porta che la skill
tiene aperta.

**Il rifiuto parla.** Ogni verdetto porta un `reason` che è un token stabile
(`consent_absent`, `position_not_authorised`, …) e una riga leggibile: il
sintomo di un cancello scritto male è il silenzio, in cui «non ha inviato
niente» e «non ha nemmeno provato» si somigliano troppo.

Uso come libreria::

    from shared.skills.apply_gate import consent_verdict, position_verdict, apply_verdict

    v = apply_verdict(position_id=42)
    if not v.allowed:
        log(v.log_line())
        return

Uso come CLI (gate da shell)::

    python3 -m shared.skills.apply_gate consent            # exit 0 = spawn ammesso
    python3 -m shared.skills.apply_gate position 42        # exit 0 = invio ammesso
    python3 -m shared.skills.apply_gate position 42 --json # verdetto su stdout
    python3 -m shared.skills.apply_gate queue --json       # cosa c'è da inviare ORA

    # exit 0 = passa · exit 1 = rifiutato (il perché su stderr) · exit 2 = uso errato
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

__all__ = [
    "AUTO_APPLY_MODES",
    "DEFAULT_MAX_PER_DAY",
    "USER_REQUEST_ORIGINS",
    "Verdict",
    "application_queue",
    "apply_verdict",
    "toggle_verdict",
    "consent_verdict",
    "daily_cap_verdict",
    "position_verdict",
    "release_daily_slot",
    "reserve_daily_slot",
]


# I due modi in cui il CLOSER può girare. `authorised` è il comportamento di
# consegna, deciso dall'operatore il 2026-09-12: «se ho fatto la richiesta,
# deve inviare in automatico, non si deve fermare al bottone» — il flag
# per-posizione È l'autorizzazione a inviare, non la richiesta di un secondo
# click. `dry_run` resta come DIAGNOSTICA nostra, per collaudare una ricetta
# ATS nuova senza spedire davvero: non è il percorso dell'utente.
AUTO_APPLY_MODES = ("authorised", "dry_run")

# Tetto giornaliero di default. Lo applica `application_queue` (la coda si
# chiude quando il CLOSER ha già spedito `max_per_day` candidature oggi), e il
# valore deve avere un default sano perché un config a metà non autorizzi un
# numero indefinito di invii.
DEFAULT_MAX_PER_DAY = 3

# ── La regola di chi può chiedere cosa: UN file, letto da due linguaggi ──────
#
# `shared/cloud/apply-request-rule.json` porta i tre vocabolari che decidono
# un'autorizzazione: lo stato in cui la si può dare, gli stati in cui la
# candidatura è già partita, i canali che nominano una persona. Li legge
# questo gate (Python, dentro il box) e li legge la route del sito (TS), che
# prima ne teneva una copia sua: una regola copiata in due linguaggi diverge
# al primo cambio, e qui divergere vuol dire che il bottone accende un flag che
# il gate poi rifiuta — o, peggio, il contrario.
#
# ⚠️ Fail-closed anche qui: un file assente o rotto lascia i tre vocabolari
# VUOTI. Nessuno stato autorizzabile, nessun canale utente → ogni
# `position_verdict` rifiuta e ogni richiesta dell'utente viene respinta, e il
# motivo (`rule_unavailable`) lo dice invece di sembrare un flag spento.
RULE_PATH = Path(__file__).resolve().parents[1] / "cloud" / "apply-request-rule.json"


def _load_rule(path: Path = RULE_PATH) -> tuple[str | None, tuple[str, ...], tuple[str, ...], str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        status = data["authorisable_status"]
        states = tuple(data["post_submission_states"])
        origins = tuple(data["user_request_origins"])
        if not (
            isinstance(status, str)
            and status
            and states
            and origins
            and all(isinstance(v, str) and v for v in states + origins)
        ):
            raise ValueError("empty or non-string vocabulary")
    except (OSError, ValueError, KeyError, TypeError) as err:
        return None, (), (), f"{type(err).__name__}: {err}"
    return status, states, origins, ""


# Chi può accendere il flag per-posizione (`user_web`, `user_local`). Il
# vocabolario non sta in un CHECK di Postgres, per la stessa ragione di
# `rejection_reason` (mig 087): un canale nuovo deve costare una riga, non una
# migrazione. Il prezzo è che il gate è l'unico posto che rifiuta un valore
# sconosciuto — ed è scritto per rifiutarlo, `agent_closer` compreso.
#
# Gli stati in cui la candidatura È GIÀ PARTITA (`applied`, `response`):
# `response` è la progressione dell'invio, non il suo contrario. Gemelli di
# `POST_SUBMISSION_STATES` in `shared/cloud/applied-action.js`, che serve al
# backflow per non riportare indietro un esito.
#
# Lo stato in cui l'utente può autorizzare (`ready`): il CV esiste ed è passato
# dal Critico. Prima non c'è niente di approvato da spedire.
AUTHORISABLE_STATUS, POST_SUBMISSION_STATES, USER_REQUEST_ORIGINS, RULE_ERROR = _load_rule()


def _load_automated_channels(path: Path = RULE_PATH) -> tuple[tuple[str, ...], str]:
    """The `applied_via` values that consume the CLOSER's daily cap.

    Browser (`agent_closer`) and email (`agent_closer_email`) sends share ONE
    cap: the cap limits how fast the automation writes to recruiters, and a
    second channel with its own budget would double that pace silently. An
    absent or malformed list leaves the cap closed, not unlimited.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        channels = tuple(data["automated_applied_via"])
        if not channels or not all(isinstance(v, str) and v for v in channels):
            raise ValueError("empty or non-string vocabulary")
    except (OSError, ValueError, KeyError, TypeError) as err:
        return (), f"{type(err).__name__}: {err}"
    return channels, ""


AUTOMATED_APPLIED_VIA, AUTOMATED_RULE_ERROR = _load_automated_channels()


@dataclass(frozen=True)
class Verdict:
    """L'esito di un cancello, con il PERCHÉ attaccato.

    `reason` è un token stabile: è quello che si greppa in un log e quello su
    cui si asserisce in un test. `detail` è la frase per un umano. Tenerli
    separati evita il caso in cui migliorare un messaggio rompe una ricerca.
    """

    allowed: bool
    reason: str
    detail: str
    context: dict[str, Any] = field(default_factory=dict)

    def log_line(self) -> str:
        """La riga che finisce nel log. Un rifiuto DEVE lasciarne una."""
        mark = "ALLOW" if self.allowed else "DENY"
        extra = " ".join(f"{k}={v}" for k, v in sorted(self.context.items()))
        return f"[apply-gate] {mark} {self.reason} — {self.detail}" + (
            f" ({extra})" if extra else ""
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "detail": self.detail,
            "context": dict(self.context),
        }


# ── Consenso generale ────────────────────────────────────────────────────────


def _config_path() -> Path:
    """Lo STESSO file di `working_hours.py`. Non se ne inventa un secondo."""
    jht_home = os.environ.get("JHT_HOME") or str(Path.home() / ".jht")
    return Path(jht_home) / "jht.config.json"


def _load_config(path: Path | None = None) -> tuple[dict | None, str]:
    """Legge il config. Ritorna `(dati, motivo_del_fallimento)`.

    `None` non è «vuoto»: è «non lo so», ed è diverso da un config valido senza
    il blocco. Il chiamante deve poter distinguere «l'utente non ha dato il
    consenso» da «il file è illeggibile», perché la seconda è una cosa da
    riparare e la prima no — ma entrambe chiudono il cancello.
    """
    p = path or _config_path()
    try:
        raw = p.read_text()
    except FileNotFoundError:
        return None, "config_missing"
    except OSError:
        return None, "config_unreadable"
    try:
        data = json.loads(raw)
    except ValueError:
        return None, "config_malformed"
    if not isinstance(data, dict):
        return None, "config_malformed"
    return data, ""


def consent_verdict(config: dict | None = None, path: Path | None = None) -> Verdict:
    """Il consenso generale dell'utente: c'è o non c'è.

    Chiuso quando: il file non esiste, non si legge, non è JSON, il blocco
    `applications.auto_apply` manca, `enabled` non è esattamente `true`, o
    `mode` non è uno dei due che conosciamo.

    ⚠️ `enabled` deve essere il booleano `True`, non un valore verosimile.
    `"false"`, `"no"` e `0` sono tutti *truthy* o *falsy* in modi che non
    coincidono con l'intenzione di chi scrive un config a mano: un consenso
    dedotto da una stringa non è un consenso.
    """
    if config is None:
        config, failure = _load_config(path)
        if config is None:
            return Verdict(
                False,
                failure,
                "user config not readable: no consent can be established",
                {"path": str(path or _config_path())},
            )

    apps = config.get("applications")
    if not isinstance(apps, dict):
        return Verdict(
            False,
            "consent_absent",
            "no `applications` block in the user config: auto-apply is off",
        )
    auto = apps.get("auto_apply")
    if not isinstance(auto, dict):
        return Verdict(
            False,
            "consent_absent",
            "no `applications.auto_apply` block in the user config: auto-apply is off",
        )

    enabled = auto.get("enabled")
    if enabled is not True:
        return Verdict(
            False,
            "consent_disabled",
            "`applications.auto_apply.enabled` is not true: the user has not consented",
            {"enabled": repr(enabled)},
        )

    mode = auto.get("mode", "authorised")
    if mode not in AUTO_APPLY_MODES:
        return Verdict(
            False,
            "consent_mode_unknown",
            "`applications.auto_apply.mode` is not one of "
            + "/".join(AUTO_APPLY_MODES)
            + ": refusing rather than guessing what the user meant",
            {"mode": repr(mode)},
        )

    max_per_day = auto.get("max_per_day", DEFAULT_MAX_PER_DAY)
    # `True` è un `int` in Python e passerebbe l'isinstance: un config con
    # `max_per_day: true` autorizzerebbe UNA candidatura al giorno per un
    # errore di battitura, che è un modo silenzioso di sbagliare.
    if isinstance(max_per_day, bool) or not isinstance(max_per_day, int) or max_per_day < 1:
        return Verdict(
            False,
            "consent_cap_invalid",
            "`applications.auto_apply.max_per_day` is not a positive integer: "
            "an unbounded cap is not a cap",
            {"max_per_day": repr(max_per_day)},
        )

    return Verdict(
        True,
        "consent_granted",
        "the user consented to auto-apply",
        {"mode": mode, "max_per_day": max_per_day},
    )


def consent_mode(config: dict | None = None, path: Path | None = None) -> str | None:
    """Il modo di lavoro, o `None` se il consenso non c'è.

    Non è una scorciatoia per saltare il verdetto: chi chiama questo DEVE aver
    già passato `consent_verdict`, altrimenti sta leggendo un `mode` da un
    config che non autorizza niente.
    """
    v = consent_verdict(config, path)
    return v.context.get("mode") if v.allowed else None


# ── Autorizzazione per-posizione ─────────────────────────────────────────────


def _db_path() -> str:
    """Il percorso che usa `_db.py`. Importato pigramente per non tirarsi
    dietro l'intero modulo (e la sua `ensure_schema`) in un gate che deve poter
    girare anche da una shell del launcher."""
    try:
        from _db import DB_PATH  # type: ignore

        return str(DB_PATH)
    except Exception:
        pass
    try:
        from shared.skills._db import DB_PATH  # type: ignore

        return str(DB_PATH)
    except Exception:
        pass
    jht_home = os.environ.get("JHT_HOME") or str(Path.home() / ".jht")
    return os.environ.get("JHT_DB") or str(Path(jht_home) / "data" / "jobs.db")


def position_verdict(
    position_id: int,
    conn: sqlite3.Connection | None = None,
    db_path: str | None = None,
) -> Verdict:
    """L'utente ha autorizzato QUESTA posizione?

    Chiuso quando: la posizione non esiste, il flag è spento, il timestamp
    manca (un flag senza istante non è un'azione databile e il pull non
    saprebbe collocarlo), l'autore manca o non è uno di
    `USER_REQUEST_ORIGINS` — e chiuso anche quando il DB non si apre o la
    colonna non c'è, perché un cancello che non sa rispondere risponde no.

    ⚠️ Il flag da solo non basta. `apply_requested_by` deve nominare una
    persona: è la regola #186 applicata al verso dell'autorizzazione — dal
    cloud si prende l'AZIONE dell'utente, mai lo stato generico. Un flag acceso
    da un processo è esattamente il percorso che non deve esistere.
    """
    try:
        pid = int(position_id)
    except (TypeError, ValueError):
        return Verdict(
            False,
            "position_id_invalid",
            "position id is not an integer",
            {"position_id": repr(position_id)},
        )
    if pid <= 0:
        return Verdict(
            False,
            "position_id_invalid",
            "position id is not a positive integer",
            {"position_id": pid},
        )

    if RULE_ERROR:
        return Verdict(
            False,
            "rule_unavailable",
            f"the authorisation rule cannot be read: {RULE_ERROR}",
            {"position_id": pid, "path": str(RULE_PATH)},
        )

    own_conn = conn is None
    if own_conn:
        try:
            conn = sqlite3.connect(db_path or _db_path())
        except sqlite3.Error as err:
            return Verdict(
                False,
                "db_unavailable",
                f"cannot open the local database: {err}",
                {"position_id": pid},
            )
    try:
        try:
            row = conn.execute(
                "SELECT status, apply_requested, apply_requested_at, apply_requested_by "
                "FROM positions WHERE id = ?",
                (pid,),
            ).fetchone()
            # La candidatura si legge SEPARATAMENTE dallo stato della
            # posizione, e non è una cintura in più sulle bretelle: i due lati
            # divergono davvero (è la classe di difetto di #186), e qui basta
            # che diverga uno perché la lettera parta due volte.
            already = conn.execute(
                "SELECT applied, applied_via FROM applications WHERE position_id = ?",
                (pid,),
            ).fetchone()
        except sqlite3.Error as err:
            # Colonna assente (immagine vecchia, `ensure_schema` mai girata) o
            # tabella mancante. Non è un caso da ricostruire: è un no.
            return Verdict(
                False,
                "authorisation_unreadable",
                f"cannot read the authorisation columns: {err}",
                {"position_id": pid},
            )
    finally:
        if own_conn and conn is not None:
            conn.close()

    if row is None:
        return Verdict(
            False,
            "position_not_found",
            "no such position in the local database",
            {"position_id": pid},
        )

    status, flag, at, by = row[0], row[1], row[2], row[3]

    # ⚠️ Questo rifiuto viene PRIMA di quello sul flag, e l'ordine è il punto.
    #
    # Il flag NON si spegne quando la candidatura parte: resta acceso, e lo
    # stato passa ad `applied`. Finché a fermare il secondo invio è soltanto il
    # checkpoint su disco di `apply_flow` — che vive in `.cache/`, cioè in una
    # cartella che un wipe, un'immagine nuova o una pulizia si portano via —
    # una posizione già inviata col flag ancora acceso è una seconda lettera
    # allo stesso recruiter. Il guard che `apply_flow` ha nel recorder gira
    # DOPO il click: a quel punto la candidatura è partita.
    #
    # Trovato rivedendo la fase C di @fullstack-1 il 2026-09-12; sta qui e non
    # là perché questo è il posto che entrambi i chiamanti attraversano.
    if status in POST_SUBMISSION_STATES:
        return Verdict(
            False,
            "already_submitted",
            "this application has already gone out: the flag stays on after a "
            "submission, so it is not evidence that another one was asked for",
            {"position_id": pid, "status": status},
        )
    if already and (already[0] == 1 or already[0] is True):
        return Verdict(
            False,
            "already_submitted",
            "an application row for this position is already marked applied",
            {"position_id": pid, "status": status, "applied_via": already[1]},
        )

    if not (flag == 1 or flag is True):
        return Verdict(
            False,
            "position_not_authorised",
            "the user has not flagged this position: no application goes out, "
            "whatever the score",
            {"position_id": pid, "status": status},
        )
    if not at:
        return Verdict(
            False,
            "authorisation_undated",
            "`apply_requested` is on but `apply_requested_at` is empty: an "
            "authorisation with no instant cannot be told from a stale write",
            {"position_id": pid},
        )
    if by not in USER_REQUEST_ORIGINS:
        return Verdict(
            False,
            "authorisation_not_from_user",
            "`apply_requested_by` does not name a user channel ("
            + "/".join(USER_REQUEST_ORIGINS)
            + "): a flag turned on by a process is not an authorisation",
            {"position_id": pid, "by": repr(by)},
        )

    return Verdict(
        True,
        "position_authorised",
        "the user authorised this position",
        {"position_id": pid, "status": status, "by": by, "at": at},
    )


# ── I due insieme ────────────────────────────────────────────────────────────


def apply_verdict(
    position_id: int,
    config: dict | None = None,
    config_path: Path | None = None,
    conn: sqlite3.Connection | None = None,
    db_path: str | None = None,
) -> Verdict:
    """Il verdetto completo: consenso E autorizzazione, in quest'ordine.

    L'ordine non è estetico. Il consenso si legge da un file e costa niente;
    l'autorizzazione apre il database. Ma soprattutto: senza consenso il CLOSER
    non dovrebbe nemmeno essere vivo, quindi un rifiuto su `consent_*` con un
    `position_id` accanto dice a chi legge il log che qualcosa lo ha spawnato
    lo stesso — che è un'informazione diversa da «posizione non flaggata».
    """
    c = consent_verdict(config, config_path)
    if not c.allowed:
        ctx = dict(c.context)
        ctx["position_id"] = position_id
        return Verdict(False, c.reason, c.detail, ctx)

    p = position_verdict(position_id, conn=conn, db_path=db_path)
    if not p.allowed:
        return p

    ctx = dict(p.context)
    ctx["mode"] = c.context.get("mode")
    ctx["max_per_day"] = c.context.get("max_per_day")
    return Verdict(
        True,
        "apply_allowed",
        "consent granted and position authorised by the user",
        ctx,
    )


# ── La richiesta dell'utente: può accendere (o spegnere) il flag? ────────────
#
# È l'altra metà della stessa regola. `position_verdict` risponde al CLOSER
# («posso inviare?»); questa risponde a chi SCRIVE il flag per conto
# dell'utente — `jht apply` sul box e la route del sito — con gli stessi
# vocabolari, così il flag che l'utente riesce ad accendere è esattamente
# quello che il gate poi accetta.


def toggle_verdict(position_id: int, requested: bool, conn: sqlite3.Connection) -> Verdict:
    """L'utente può autorizzare (`requested=True`) o ritirare questa posizione?

    Autorizzare: la posizione esiste, non è già partita, è in
    `AUTHORISABLE_STATUS`. Ritirare: la posizione esiste e non è già partita —
    dopo l'invio il ritiro non ferma niente, e un flag spento accanto a una
    candidatura spedita racconterebbe all'utente una cosa falsa.

    Il chiamante tiene la transazione: il verdetto e la UPDATE devono vedere
    la stessa riga.
    """
    try:
        pid = int(position_id)
    except (TypeError, ValueError):
        return Verdict(False, "position_id_invalid", "position id is not an integer")
    if pid <= 0:
        return Verdict(False, "position_id_invalid", "position id is not a positive integer")
    if RULE_ERROR:
        return Verdict(
            False,
            "rule_unavailable",
            f"the authorisation rule cannot be read: {RULE_ERROR}",
            {"position_id": pid},
        )
    try:
        row = conn.execute(
            "SELECT status, apply_requested FROM positions WHERE id = ?", (pid,)
        ).fetchone()
        sent = conn.execute(
            "SELECT applied FROM applications WHERE position_id = ?", (pid,)
        ).fetchone()
    except sqlite3.Error as err:
        return Verdict(
            False,
            "authorisation_unreadable",
            f"cannot read the authorisation columns: {err}",
            {"position_id": pid},
        )
    if row is None:
        return Verdict(False, "position_not_found", "no such position", {"position_id": pid})
    status = row[0]
    if status in POST_SUBMISSION_STATES or (sent and sent[0] in (1, True)):
        return Verdict(
            False,
            "already_submitted",
            "this application has already gone out: there is nothing left to "
            + ("authorise" if requested else "withdraw"),
            {"position_id": pid, "status": status},
        )
    if requested and status != AUTHORISABLE_STATUS:
        return Verdict(
            False,
            "position_not_ready",
            f"only a '{AUTHORISABLE_STATUS}' position can be authorised: the CV must "
            "exist and have passed the Critic first",
            {"position_id": pid, "status": status},
        )
    return Verdict(
        True,
        "toggle_allowed",
        "the user may " + ("authorise" if requested else "withdraw") + " this position",
        {"position_id": pid, "status": status, "flag": row[1]},
    )


# ── La coda: cosa c'è da inviare ADESSO ──────────────────────────────────────
#
# La domanda che si fanno in due, con lo stesso bisogno di una risposta sola:
# il CAPITANO («devo spawnare il CLOSER?») e il CLOSER («quale posizione
# prendo?»). Se la risposta del primo fosse una query scritta nel suo prompt e
# quella del secondo un'altra, il giorno che divergono il Capitano spawna un
# agente che non trova niente da fare — e lo rispawna a ogni tick, che è il
# giro a vuoto che la regola di spawn esiste per impedire.
#
# ⚠️ Una posizione autorizzata NON è per forza una posizione da prendere. Tre
# casi la tengono ferma, e nessuno dei tre si risolve riprovando:
#
#   - il flusso si è già fermato su di lei (`blocked_human`): serve una persona,
#     e rilanciarlo è esattamente il «tentativo cieco» che la spec vieta;
#   - è già stata compilata in `dry_run`: rifarlo non aggiunge niente;
#   - manca ciò che serve a compilare (URL, PDF del CV).
#
# Ferma finché l'utente non la ri-autorizza: un `apply_requested_at` PIÙ
# RECENTE del checkpoint è una nuova azione dell'utente (spegne e riaccende il
# flag dopo aver aggiunto la risposta mancante), ed è l'unica cosa che la
# rimette in coda. Un timestamp che non si confronta vale «ferma».

# Il checkpoint di `apply_flow.ApplicationFlow`, relativo a `$JHT_HOME`. Stesso
# percorso di là, ripetuto qui per non importare Playwright in un gate da
# shell; `tests/test_closer_wiring.py` asserisce che i due coincidano.
CHECKPOINT_SUBDIR = (".cache", "apply-flow")

# Stati del checkpoint che tengono la posizione fuori dalla coda.
HELD_CHECKPOINT_STATES = ("blocked_human", "dry_run")

# ── The email channel (`email_application.py`) ───────────────────────────────
#
# Its durable register is the `email_application_attempts` table; its human
# stops live in a state file next to the browser checkpoint. Both are read
# here, not in the email module, because the queue and the cap are this
# gate's decisions: an email the skill may have sent must hold the position
# and consume the cap whoever asks.
EMAIL_ATTEMPTS_TABLE = "email_application_attempts"
EMAIL_STATE_SUBDIR = (".cache", "email-application")
# After `send_started` nobody knows whether the recruiter got the email until
# a receipt says so. These states are never retried and always counted.
EMAIL_UNRESOLVED_STATES = ("send_started", "send_outcome_unknown", "receipt_incomplete")
# Human stops of the email flow, released by a newer user authorisation.
EMAIL_HELD_STATES = ("blocked_human", "denied")


def _jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))


def checkpoint_path(position_id: int, jht_home: Path | None = None) -> Path:
    return (jht_home or _jht_home()).joinpath(*CHECKPOINT_SUBDIR, f"{int(position_id)}.json")


def _parse_instant(value: Any):
    """ISO (`…Z`, `…+00:00`) o il `YYYY-MM-DD HH:MM:SS` di SQLite. `None` se no.

    Un istante senza fuso si legge come UTC: è ciò che scrivono sia la route
    web sia `datetime('now')`. Sbagliare il fuso qui sposta al massimo di
    qualche ora il momento in cui una posizione ferma torna in coda, e sempre
    dopo un'azione dell'utente — mai prima.
    """
    from datetime import datetime, timezone

    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _checkpoint_hold(position_id: int, authorised_at: Any, jht_home: Path | None) -> str:
    """Il motivo per cui il checkpoint tiene ferma la posizione, o `""`."""
    path = checkpoint_path(position_id, jht_home)
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""
    except OSError:
        return "checkpoint_unreadable"
    try:
        data = json.loads(raw)
    except ValueError:
        return "checkpoint_unreadable"
    if not isinstance(data, dict):
        return "checkpoint_unreadable"
    state = data.get("state")
    if state not in HELD_CHECKPOINT_STATES:
        return ""
    request = data.get("answer_request")
    if (
        isinstance(request, dict)
        and request.get("asked") is False
        and not str(request.get("message_id") or "").strip()
    ):
        # A form question the flow stopped on and nobody asked: no answer will
        # ever wake the CLOSER, so the position stays in the queue for it to
        # work the answer out (or ask) at its next run.
        return ""
    held_at = _parse_instant(data.get("updated_at"))
    asked_at = _parse_instant(authorised_at)
    if held_at and asked_at and asked_at > held_at:
        return ""
    return f"checkpoint_{state}"


# Test suites build queues on placeholder PDFs that no layout check can measure;
# they set this to "1" once for the whole run. Never set on a box.
PDF_LAYOUT_SKIP_ENV = "JHT_TEST_SKIP_PDF_LAYOUT"


def cv_layout_hold(cv: Path) -> str:
    """Why this CV PDF must not go out, or `""`.

    `cv_pdf_layout_bad` when the visual check fails (narrow column, near-empty
    page, too many pages, fonts not embedded); `cv_pdf_check_unavailable` when
    it cannot be measured (poppler missing, unreadable file): an unmeasured CV
    is not a pass. Computed from the file every time, never cached: a CV the
    Scrittore renders again lifts the hold by itself, and no stale verdict can
    wave a new file through.
    """
    if os.environ.get(PDF_LAYOUT_SKIP_ENV) == "1":
        return ""
    try:
        from pdf_layout_check import CheckError, analyze
    except ImportError:
        try:
            from shared.skills.pdf_layout_check import CheckError, analyze
        except ImportError:
            return "cv_pdf_check_unavailable"
    try:
        report = analyze(Path(cv))
    except CheckError:
        return "cv_pdf_check_unavailable"
    except Exception as err:  # noqa: BLE001 — a crashing check is an unmeasured CV
        print(f"[apply-gate] CV layout check failed: {type(err).__name__}", file=sys.stderr)
        return "cv_pdf_check_unavailable"
    return "" if isinstance(report, dict) and report.get("ok") is True else "cv_pdf_layout_bad"


def _essentials_hold(conn: sqlite3.Connection, jht_home: Path | None) -> str:
    """`essential_answers_pending` while an essential fact was asked and is still unknown.

    Global but never permanent: a question left unanswered for a day stops
    holding (`application_answers.ESSENTIAL_QUESTION_TTL`).

    Without it a position waiting for the user's answers would stay
    `queue_ready`: the CLOSER would run the flow again at every iteration and
    the Capitano would keep spawning it for nothing. Not asked yet is not a
    hold — the flow has to run once to ask. Once the answers exist the hold
    lifts by itself and the CLOSER is woken (`application_answers.wake_closer`).
    """
    try:
        import application_answers
        import yaml
    except ImportError:
        return ""
    try:
        path = (jht_home or _jht_home()) / "profile" / "candidate_profile.yml"
        try:
            profile = yaml.safe_load(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            profile = None
        except Exception as err:  # noqa: BLE001 — a broken profile never breaks the queue
            print(f"[apply-gate] profile unreadable for the essentials hold: {type(err).__name__}", file=sys.stderr)
            profile = None
        report = application_answers.check_essentials(conn, profile if isinstance(profile, dict) else {})
    except (sqlite3.Error, ValueError):
        return ""
    return "essential_answers_pending" if report["already_asked"] else ""


def email_state_path(position_id: int, jht_home: Path | None = None) -> Path:
    return (jht_home or _jht_home()).joinpath(*EMAIL_STATE_SUBDIR, f"{int(position_id)}.json")


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
        ).fetchone()
        is not None
    )


def _email_hold(
    conn: sqlite3.Connection, position_id: int, authorised_at: Any, jht_home: Path | None
) -> str:
    """Why the email channel holds this position out of the queue, or `""`."""
    try:
        if _table_exists(conn, EMAIL_ATTEMPTS_TABLE):
            marks = ",".join("?" for _ in EMAIL_UNRESOLVED_STATES)
            row = conn.execute(
                f"SELECT state FROM {EMAIL_ATTEMPTS_TABLE} "
                f"WHERE position_id = ? AND state IN ({marks}) ORDER BY id DESC LIMIT 1",
                (int(position_id), *EMAIL_UNRESOLVED_STATES),
            ).fetchone()
            if row:
                return f"email_{row[0]}"
    except sqlite3.Error:
        # An unreadable register may hide a send in flight: hold, never pass.
        return "email_attempts_unreadable"
    path = email_state_path(position_id, jht_home)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return ""
    except (OSError, ValueError):
        return "email_state_unreadable"
    if not isinstance(data, dict):
        return "email_state_unreadable"
    state = data.get("state")
    if state not in EMAIL_HELD_STATES:
        return ""
    held_at = _parse_instant(data.get("updated_at"))
    asked_at = _parse_instant(authorised_at)
    if held_at and asked_at and asked_at > held_at:
        return ""
    return f"email_{state}"


CAP_RESERVATIONS_TABLE = "apply_cap_reservations"
CAP_CHANNELS = ("email", "browser")


def _sent_today(conn: sqlite3.Connection, *, except_position: int | None = None) -> int:
    """Automated sends that consume today's cap, browser and email together.

    One per position, from three sources: an application recorded as sent by
    an automated channel; an email attempt whose outcome is still open (it may
    have reached the recruiter); a cap reservation not released (a send in
    flight, or one whose outcome was never known). The day rule is the one the
    cap always had.

    `except_position` leaves one position out: the one about to reserve, which
    cannot take a second slot for itself.
    """
    if AUTOMATED_RULE_ERROR:
        raise sqlite3.DatabaseError(f"automated channels unreadable: {AUTOMATED_RULE_ERROR}")
    marks = ",".join("?" for _ in AUTOMATED_APPLIED_VIA)
    parts = [
        f"SELECT position_id FROM applications WHERE applied = 1 "
        f"AND applied_via IN ({marks}) "
        f"AND date(applied_at) = date('now', 'localtime')"
    ]
    params: list[Any] = list(AUTOMATED_APPLIED_VIA)
    if _table_exists(conn, EMAIL_ATTEMPTS_TABLE):
        states = ",".join("?" for _ in EMAIL_UNRESOLVED_STATES)
        parts.append(
            f"SELECT e.position_id FROM {EMAIL_ATTEMPTS_TABLE} e "
            f"LEFT JOIN applications a ON a.position_id = e.position_id "
            f"WHERE e.state IN ({states}) "
            f"AND date(e.send_started_at, 'localtime') = date('now', 'localtime') "
            f"AND COALESCE(a.applied, 0) != 1"
        )
        params.extend(EMAIL_UNRESOLVED_STATES)
    if _table_exists(conn, CAP_RESERVATIONS_TABLE):
        parts.append(
            f"SELECT position_id FROM {CAP_RESERVATIONS_TABLE} "
            f"WHERE state = 'reserved' "
            f"AND date(reserved_at, 'localtime') = date('now', 'localtime')"
        )
    query = f"SELECT COUNT(*) FROM ({' UNION '.join(parts)})"
    if except_position is not None:
        query += " WHERE position_id != ?"
        params.append(int(except_position))
    return int(conn.execute(query, params).fetchone()[0])


def reserve_daily_slot(
    position_id: int,
    channel: str,
    *,
    config: dict | None = None,
    config_path: Path | None = None,
    db_path: str | None = None,
) -> Verdict:
    """Take one slot of today's cap, atomically, just before an irreversible send.

    `BEGIN IMMEDIATE` on jobs.db, today's sends counted (`_sent_today`), the
    reservation inserted, COMMIT — then, and only then, the caller sends. A
    second run racing for the last slot waits for this commit and counts it:
    it gets `daily_cap_reached`. Anything unreadable closes the cap.

    The reservation keeps counting for the rest of the day, whatever happens
    after it; `release_daily_slot` is only for a send that certainly did not
    happen. The caller owns the connection: this opens its own and never
    joins an open transaction.
    """
    consent = consent_verdict(config, config_path)
    if not consent.allowed:
        return consent
    if channel not in CAP_CHANNELS:
        return Verdict(False, "cap_channel_invalid", f"unknown application channel: {channel!r}")
    if AUTOMATED_RULE_ERROR:
        return Verdict(
            False,
            "rule_unavailable",
            f"the automated channel list cannot be read: {AUTOMATED_RULE_ERROR}",
            {"path": str(RULE_PATH)},
        )
    try:
        pid = int(position_id)
    except (TypeError, ValueError):
        return Verdict(False, "position_id_invalid", "position id is not an integer")
    max_per_day = int(consent.context.get("max_per_day"))
    token = os.urandom(16).hex()
    try:
        from _db import _migrate_apply_cap_reservations  # type: ignore

        conn = sqlite3.connect(db_path or _db_path(), timeout=30, isolation_level=None)
    except Exception as err:  # noqa: BLE001 — no register, no send
        return Verdict(False, "cap_unreadable", f"cannot open the cap register: {type(err).__name__}")
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            _migrate_apply_cap_reservations(conn)
            sent_today = _sent_today(conn, except_position=pid)
            context = {
                "max_per_day": max_per_day,
                "sent_today": sent_today,
                "remaining_today": max(0, max_per_day - sent_today),
                "position_id": pid,
                "channel": channel,
            }
            if sent_today >= max_per_day:
                conn.execute("ROLLBACK")
                return Verdict(
                    False,
                    "daily_cap_reached",
                    "the daily cap of automated applications is reached; nothing may be sent",
                    context,
                )
            conn.execute(
                f"INSERT INTO {CAP_RESERVATIONS_TABLE} (position_id, channel, token) VALUES (?, ?, ?)",
                (pid, channel, token),
            )
            conn.execute("COMMIT")
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
    except sqlite3.Error as err:
        return Verdict(False, "cap_unreadable", f"cannot reserve today's slot: {type(err).__name__}")
    finally:
        conn.close()
    return Verdict(True, "cap_reserved", "one slot of today's cap is reserved for this send", {**context, "token": token})


def release_daily_slot(token: str, *, db_path: str | None = None) -> bool:
    """Give back a slot whose send certainly did not happen. Never for an unknown outcome."""
    if not token:
        return False
    try:
        conn = sqlite3.connect(db_path or _db_path(), timeout=30)
        try:
            changed = conn.execute(
                f"UPDATE {CAP_RESERVATIONS_TABLE} SET state = 'released', "
                f"released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
                f"WHERE token = ? AND state = 'reserved'",
                (str(token),),
            ).rowcount
            conn.commit()
        finally:
            conn.close()
    except sqlite3.Error:
        return False
    return changed == 1


def daily_cap_verdict(
    config: dict | None = None,
    config_path: Path | None = None,
    conn: sqlite3.Connection | None = None,
    db_path: str | None = None,
) -> Verdict:
    """May ONE more automated application go out today?

    The queue asks it before a run and the email skill asks it again
    immediately before the transport: between the two, another send may have
    used the last slot. Closed when consent is off, the channel list is
    unreadable, or the database cannot be counted.
    """
    consent = consent_verdict(config, config_path)
    if not consent.allowed:
        return consent
    if AUTOMATED_RULE_ERROR:
        return Verdict(
            False,
            "rule_unavailable",
            f"the automated channel list cannot be read: {AUTOMATED_RULE_ERROR}",
            {"path": str(RULE_PATH)},
        )
    max_per_day = int(consent.context.get("max_per_day"))
    own_conn = conn is None
    if own_conn:
        try:
            conn = sqlite3.connect(db_path or _db_path())
        except sqlite3.Error as err:
            return Verdict(False, "db_unavailable", f"cannot open the local database: {err}")
    try:
        try:
            sent_today = _sent_today(conn)
        except sqlite3.Error as err:
            return Verdict(False, "cap_unreadable", f"cannot count today's sends: {err}")
    finally:
        if own_conn and conn is not None:
            conn.close()
    remaining = max(0, max_per_day - sent_today)
    context = {"max_per_day": max_per_day, "sent_today": sent_today, "remaining_today": remaining}
    if remaining <= 0:
        return Verdict(
            False,
            "daily_cap_reached",
            "the daily cap of automated applications is reached",
            context,
        )
    return Verdict(True, "cap_available", "the daily cap leaves room for one more send", context)


def _resolve_file(value: Any, jht_home: Path | None) -> Path | None:
    if not value or not str(value).strip():
        return None
    p = Path(str(value).strip())
    if not p.is_absolute():
        p = (jht_home or _jht_home()) / p
    return p if p.is_file() else None


def application_queue(
    config: dict | None = None,
    config_path: Path | None = None,
    conn: sqlite3.Connection | None = None,
    db_path: str | None = None,
    jht_home: Path | None = None,
) -> dict[str, Any]:
    """Le posizioni che il CLOSER può prendere adesso, e il perché delle altre.

    `ready` è vero SOLO se il consenso c'è, il tetto giornaliero non è
    raggiunto e almeno una posizione passa `position_verdict` senza essere
    ferma. In ogni altro caso è falso, con un `reason` stabile:
    `consent_*`/`config_*`, `db_unavailable`, `queue_unreadable`,
    `queue_empty`, `daily_cap_reached`.
    """
    out: dict[str, Any] = {
        "ready": False,
        "reason": "",
        "detail": "",
        "mode": None,
        "max_per_day": None,
        "sent_today": None,
        "remaining_today": None,
        "positions": [],
        "held": [],
    }

    consent = consent_verdict(config, config_path)
    if not consent.allowed:
        out.update(reason=consent.reason, detail=consent.detail)
        return out
    out["mode"] = consent.context.get("mode")
    out["max_per_day"] = consent.context.get("max_per_day")

    own_conn = conn is None
    if own_conn:
        try:
            conn = sqlite3.connect(db_path or _db_path())
        except sqlite3.Error as err:
            out.update(reason="db_unavailable", detail=f"cannot open the local database: {err}")
            return out
    try:
        try:
            rows = conn.execute(
                "SELECT p.id, p.url, p.apply_requested_at, a.cv_pdf_path "
                "FROM positions p LEFT JOIN applications a ON a.position_id = p.id "
                "WHERE p.apply_requested = 1 AND p.status = ? "
                "ORDER BY p.apply_requested_at, p.id",
                (AUTHORISABLE_STATUS,),
            ).fetchall()
            # Il tetto conta SOLO ciò che il CLOSER ha davvero spedito oggi. Un
            # invio dell'utente a mano non consuma la sua quota: il tetto
            # esiste per il ritmo dell'automazione, non per quello della persona.
            # Browser ed email condividono lo stesso tetto (`_sent_today`).
            sent_today = _sent_today(conn)
        except sqlite3.Error as err:
            out.update(reason="queue_unreadable", detail=f"cannot read the application queue: {err}")
            return out

        positions, held = [], []
        essentials_hold = _essentials_hold(conn, jht_home)
        for pid, url, asked_at, cv_pdf in rows:
            verdict = position_verdict(pid, conn=conn)
            if not verdict.allowed:
                held.append({"position_id": pid, "reason": verdict.reason})
                continue
            if not url or not str(url).strip():
                held.append({"position_id": pid, "reason": "url_missing"})
                continue
            cv = _resolve_file(cv_pdf, jht_home)
            if cv is None:
                held.append({"position_id": pid, "reason": "cv_pdf_missing"})
                continue
            layout = cv_layout_hold(cv)
            if layout:
                held.append({"position_id": pid, "reason": layout})
                continue
            hold = (
                _checkpoint_hold(pid, asked_at, jht_home)
                or _email_hold(conn, pid, asked_at, jht_home)
                or essentials_hold
            )
            if hold:
                held.append({"position_id": pid, "reason": hold})
                continue
            positions.append({"position_id": pid, "url": str(url).strip(), "cv_pdf_path": str(cv)})
    finally:
        if own_conn and conn is not None:
            conn.close()

    remaining = max(0, int(out["max_per_day"]) - int(sent_today))
    out.update(sent_today=sent_today, remaining_today=remaining, positions=positions, held=held)
    if not positions:
        out.update(reason="queue_empty", detail="no authorised position can be taken now")
    elif remaining <= 0:
        out.update(
            reason="daily_cap_reached",
            detail="the daily cap of automated applications is reached; the queue waits for tomorrow",
        )
    else:
        out.update(ready=True, reason="queue_ready", detail=f"{len(positions)} authorised position(s) can be taken")
    return out


# ── CLI ──────────────────────────────────────────────────────────────────────


def _emit(verdict: Verdict, as_json: bool) -> int:
    if as_json:
        print(json.dumps(verdict.to_dict(), ensure_ascii=False))
    else:
        # Il rifiuto va su stderr perché chi lo invoca da shell è quasi sempre
        # un `if`: lo stdout resta pulito per chi vuole solo il verdetto.
        print(verdict.log_line(), file=sys.stdout if verdict.allowed else sys.stderr)
    return 0 if verdict.allowed else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="apply_gate",
        description="The user-authorisation gate for outgoing applications.",
    )
    parser.add_argument(
        "check",
        choices=("consent", "position", "queue"),
        help="consent = may the CLOSER exist at all · position = may THIS one go out · "
        "queue = what can go out now (exit 0 only if something can)",
    )
    parser.add_argument(
        "position_id",
        nargs="?",
        type=int,
        help="position id, required by the `position` check",
    )
    parser.add_argument("--json", action="store_true", help="verdict as JSON on stdout")
    parser.add_argument("--db", default=None, help="override the SQLite path")
    parser.add_argument("--config", default=None, help="override the config path")
    args = parser.parse_args(argv)

    cfg_path = Path(args.config) if args.config else None

    if args.check == "consent":
        return _emit(consent_verdict(path=cfg_path), args.json)

    if args.check == "queue":
        q = application_queue(config_path=cfg_path, db_path=args.db)
        if args.json:
            print(json.dumps(q, ensure_ascii=False))
        elif q["ready"]:
            print(f"[apply-gate] QUEUE {q['reason']} — {q['detail']} (remaining_today={q['remaining_today']})")
        else:
            print(f"[apply-gate] QUEUE {q['reason']} — {q['detail']}", file=sys.stderr)
        return 0 if q["ready"] else 1

    if args.position_id is None:
        parser.error("the `position` check needs a position id")
    return _emit(
        apply_verdict(args.position_id, config_path=cfg_path, db_path=args.db),
        args.json,
    )


if __name__ == "__main__":
    sys.exit(main())
