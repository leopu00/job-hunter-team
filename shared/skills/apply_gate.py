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
    "apply_verdict",
    "consent_verdict",
    "position_verdict",
]


# I due modi in cui il CLOSER può girare. `authorised` è il comportamento di
# consegna, deciso dall'operatore il 2026-09-12: «se ho fatto la richiesta,
# deve inviare in automatico, non si deve fermare al bottone» — il flag
# per-posizione È l'autorizzazione a inviare, non la richiesta di un secondo
# click. `dry_run` resta come DIAGNOSTICA nostra, per collaudare una ricetta
# ATS nuova senza spedire davvero: non è il percorso dell'utente.
AUTO_APPLY_MODES = ("authorised", "dry_run")

# Tetto giornaliero di default. Non è una politica di rate qui dentro — quella
# è roba della fase C — ma il valore deve avere un default sano perché un
# config a metà non autorizzi un numero indefinito di invii.
DEFAULT_MAX_PER_DAY = 3

# Chi può accendere il flag per-posizione. Il vocabolario vive QUI e non in un
# CHECK di Postgres, per la stessa ragione di `rejection_reason` (mig 087): un
# canale nuovo deve costare una riga, non una migrazione. Il prezzo è che
# questo è l'unico posto che rifiuta un valore sconosciuto — ed è scritto per
# rifiutarlo, `agent_closer` compreso.
USER_REQUEST_ORIGINS = ("user_web", "user_local")

# Gli stati in cui la candidatura È GIÀ PARTITA.
#
# Gemella di `POST_SUBMISSION_STATES` in `shared/cloud/applied-action.js`, e
# tenuta allineata a mano perché le due vivono in linguaggi diversi: là serve
# al backflow per non riportare indietro un esito, qui a non spedire una
# seconda volta. `response` sta accanto ad `applied` per la stessa ragione di
# sempre — è la progressione dell'invio, non il suo contrario. Chi domani
# aggiunge uno stato post-invio deve aggiungerlo in ENTRAMBI i posti.
POST_SUBMISSION_STATES = ("applied", "response")


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
        choices=("consent", "position"),
        help="consent = may the CLOSER exist at all · position = may THIS one go out",
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

    if args.position_id is None:
        parser.error("the `position` check needs a position id")
    return _emit(
        apply_verdict(args.position_id, config_path=cfg_path, db_path=args.db),
        args.json,
    )


if __name__ == "__main__":
    sys.exit(main())
