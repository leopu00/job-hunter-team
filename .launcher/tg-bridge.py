#!/usr/bin/env python3
"""
Telegram Inbound Bridge — long-poll Bot API → cronologia unificata.

Schema 2026-05-13 rev2: 3 bot dedicati (assistente, capitano, mentor). Ogni
istanza del bridge gestisce UN solo bot/ruolo (one process per role). Lo
script da' per scontato di essere lanciato da start-agent.sh con env:

  --role <nome>            — assistente | capitano | mentor (preferito: e' il
                             solo modo per cui il ruolo compaia nel cmdline,
                             che e' come il watchdog conta i bridge per ruolo)
  JHT_TG_BOT_ROLE          — stesso valore, fallback storico
  JHT_TG_TARGET_SESSION    — sessione tmux destinataria (default = ROLE.upper())
  JHT_TG_OFFSET_RESET=1    — reset offset (skip backlog)
  JHT_HOME                 — dir config (default /jht_home)

Config:
  $JHT_HOME/jht.config.json → channels.telegram.bots.<role>.{bot_token,chat_id}

Architettura (pattern simile a sentinel-bridge.py):
  • Long-poll su /getUpdates con timeout 30s
  • Prima di avanzare l'offset, ogni turno autorizzato entra in un journal
    atomico per-update sotto $JHT_HOME/tg-inbound-queue-<role>/
  • A ogni poll il journal confluisce in pending_user_messages (jobs.db):
    chat-sync lo specchia in chat.jsonl e resta l'UNICO consumer verso tmux
  • Per allegati document/photo/voice: scarica via getFile + salva in
    $JHT_HOME/profile/inbox/<filename>, conserva [TG-DOC] path=... name=...
  • Whitelist su chat_id: solo l'utente del config (canale 1:1, anti-spam)
  • Persistenza offset in $JHT_HOME/tg-bridge-state-<role>.json (per-ruolo)
  • No-loss: l'offset avanza DOPO il journal durevole; source_id rende
    idempotenti replay e crash fra journal, COMMIT SQLite e cleanup. Un
    payload non journalizzabile tiene l'offset fermo senza soglia
  • Un handler applicativo sempre rotto viene ritentato (max
    MAX_UPDATE_ATTEMPTS), poi produce dead-letter e [TG-UNDELIVERED] sulla
    stessa strada unificata
  • Singleton per-ruolo: kill orchestrato da start-agent.sh

Outbound (telegram-send) e' una skill agente che usa jht-telegram-send
direttamente. Questo bridge gestisce solo l'inbound.
"""

import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# i18n: shared/i18n.py sits in <repo>/shared/, this file in <repo>/.launcher/.
# Try multiple resolution paths so bridge works both in-container
# (/app/shared) and host (<repo>/shared) and from cwd.
_THIS_DIR = Path(__file__).resolve().parent
for _candidate in (
    _THIS_DIR.parent / "shared",       # <repo>/shared
    Path("/app/shared"),                # container path
):
    if (_candidate / "i18n.py").exists():
        sys.path.insert(0, str(_candidate))
        break
try:
    from i18n import t as _i18n_t  # type: ignore
except Exception:
    def _i18n_t(key: str) -> str:  # type: ignore
        return key

# L'appiattimento dei campi scelti da chi invia (vedi `_one_line`) e' lo stesso
# problema del recinto anti-prompt-injection degli agenti, quindi e' lo stesso
# codice: `shared/skills/external_content.py` tiene l'elenco degli invisibili
# che comandano e la regola su cosa sparisce e cosa diventa uno spazio. Due
# elenchi in due file sarebbero due criteri diversi per lo stesso problema.
for _skills_candidate in (
    _THIS_DIR.parent / "shared" / "skills",   # <repo>/shared/skills
    Path("/app/shared/skills"),               # container path
):
    if (_skills_candidate / "external_content.py").exists():
        sys.path.insert(0, str(_skills_candidate))
        break
# Nessun fallback, a differenza di i18n: una traduzione mancante e' cosmetica,
# una sanificazione che si spegne da sola no. Meglio un bridge che non parte.
from external_content import flatten_to_one_line  # noqa: E402  (dopo sys.path)

# [JHT-CLOSER-ANSWERS] Una risposta a una domanda del CLOSER va risolta qui,
# nella stessa transazione che la scrive in cronologia. Senza il modulo il
# bridge continua a consegnare la chat: la domanda resta aperta e la dashboard
# puo' ancora risponderle, quindi niente si perde.
try:
    import application_answers  # noqa: E402
except Exception as _answers_import_error:  # pragma: no cover - degraded image
    application_answers = None

VALID_ROLES = ("assistente", "capitano", "mentor")

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
CONFIG_PATH = JHT_HOME / "jht.config.json"
INBOX_DIR = JHT_HOME / "profile" / "inbox"

def _role_from_argv(argv):
    """Il ruolo passato come `--role <nome>` (o `--role=<nome>`).

    O-58 — non è una comodità: è l'unico modo perché il ruolo finisca nel
    cmdline del processo python. Con la sola env il cmdline è
    `python3 -u tg-bridge.py` per tutti e tre i bridge, e la variabile vive
    nella shell wrapper: contare i bridge PER RUOLO leggendo /proc — che è
    quello che serve al watchdog per non ammazzare i sani — era letteralmente
    impossibile. La env resta come fallback: un avvio a mano continua a
    funzionare come prima.
    """
    for i, arg in enumerate(argv):
        if arg == "--role" and i + 1 < len(argv):
            return argv[i + 1]
        if arg.startswith("--role="):
            return arg.split("=", 1)[1]
    return ""


BOT_ROLE = (
    _role_from_argv(sys.argv[1:]) or os.environ.get("JHT_TG_BOT_ROLE", "") or ""
).strip().lower()
if BOT_ROLE not in VALID_ROLES:
    print(f"FATAL: --role (or JHT_TG_BOT_ROLE) must be one of {VALID_ROLES} "
          f"(received: '{BOT_ROLE}')", flush=True)
    sys.exit(2)

# State file e default target session sono derivati dal ruolo. Cosi' 3 bridge
# paralleli (uno per bot) non si pestano i piedi sull'offset file.
STATE_PATH = JHT_HOME / f"tg-bridge-state-{BOT_ROLE}.json"
DEADLETTER_PATH = JHT_HOME / f"tg-bridge-deadletter-{BOT_ROLE}.jsonl"
INBOUND_QUEUE_DIR = JHT_HOME / f"tg-inbound-queue-{BOT_ROLE}"
JOBS_DB_PATH = JHT_HOME / "jobs.db"
TARGET_SESSION = os.environ.get("JHT_TG_TARGET_SESSION", BOT_ROLE.upper())
# Il bot da cui escono le domande del CLOSER (jht-notify-user: chi non ha un bot
# suo parla da quello dell'Assistente). Solo su questo bot un messaggio senza
# reply e senza codice puo' valere come risposta all'unica domanda aperta.
CLOSER_QUESTION_BOT = "assistente"
POLL_TIMEOUT_SEC = 30
MAX_DOC_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB hard limit Bot API
DOWNLOAD_CHUNK_BYTES = 64 * 1024

# Quante volte riprovare un update che sollleva prima di dichiararlo veleno.
# Il compromesso: sotto questa soglia l'offset NON avanza (nessun messaggio
# perso per un errore transitorio), sopra l'update finisce in dead-letter e la
# coda riparte (nessun update velenoso puo' bloccare i messaggi dietro di se').
MAX_UPDATE_ATTEMPTS = 3
RETRY_BACKOFF_SEC = 2


class DocumentTooLarge(Exception):
    """Il download ha superato MAX_DOC_SIZE_BYTES mentre era in corso.

    Serve quando l'API omette `file_size`: il limite non e' verificabile
    prima, quindi lo si applica sullo stream.
    """

    def __init__(self, downloaded: int):
        super().__init__(f"{downloaded}B > {MAX_DOC_SIZE_BYTES}B")
        self.downloaded = downloaded


class DurableQueueError(Exception):
    """Il turno non e' ancora su un supporto che sopravvive al processo.

    Questo errore non diventa mai dead-letter per numero di tentativi: finche'
    il journal non e' durevole l'offset Telegram deve restare fermo.
    """


# ── Commands per Telegram Bot API setMyCommands ────────────────────────
# F-1 task #50 (bug #16): slash commands cliccabili nel menu "/" del client
# Telegram. Bootstrap idempotente al primo boot del bridge. Le keys del
# dict sono i 3 ruoli user-facing; ogni lista è un set di (command, key)
# dove `key` è la i18n key da risolvere via shared/i18n.py → locale canonico.
# Senza questi, l'utente nuovo non sa cosa chiedere — vede una chat vuota
# e cerca di indovinare.
#
# i18n: descrizioni vengono da shared/locales/<lang>.json. Stesso pattern
# di welcome-send.sh / auto_report.py. Fallback alla key se locale missing.
BOT_COMMANDS = {
    "assistente": [
        ("budget",      "bot_commands.assistente.budget"),
        ("budget_prev", "bot_commands.assistente.budget_prev"),
        ("budget_week", "bot_commands.assistente.budget_week"),
        ("pipeline",    "bot_commands.assistente.pipeline"),
        ("candles",     "bot_commands.assistente.candles"),
        ("mappa",       "bot_commands.assistente.mappa"),
        ("mappa_it",    "bot_commands.assistente.mappa_it"),
        # Gli ultimi due bottoni della vecchia tastiera persistente (⭐ Top CV,
        # 📅 Reset) non avevano un comando: senza tastiera sparirebbero.
        ("top_cv",      "bot_commands.assistente.top_cv"),
        ("reset",       "bot_commands.assistente.reset"),
        ("stato",       "bot_commands.assistente.stato"),
        ("help",        "bot_commands.assistente.help"),
    ],
    "capitano": [
        ("pipeline", "bot_commands.capitano.pipeline"),
        ("budget",   "bot_commands.capitano.budget"),
        ("team",     "bot_commands.capitano.team"),
        ("ready",    "bot_commands.capitano.ready"),
        ("triage",   "bot_commands.capitano.triage"),
        ("help",     "bot_commands.capitano.help"),
    ],
    "mentor": [
        ("digest",   "bot_commands.mentor.digest"),
        ("patterns", "bot_commands.mentor.patterns"),
        ("top",      "bot_commands.mentor.top"),
        ("salary",   "bot_commands.mentor.salary"),
        ("help",     "bot_commands.mentor.help"),
    ],
}


def setup_bot_commands(token: str) -> None:
    """Registra setMyCommands + setMyDescription per il bot corrente.

    Idempotente: re-chiama OK senza side-effect. Best-effort: se l'API
    è momentaneamente irraggiungibile non blocca il long-poll (la
    registrazione si farà al prossimo boot).
    """
    cmds = BOT_COMMANDS.get(BOT_ROLE)
    if not cmds:
        log("setMyCommands: no command list for this role, skip")
        return
    payload = json.dumps({
        "commands": [{"command": c, "description": _i18n_t(k)} for c, k in cmds]
    }).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/setMyCommands",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
        result = json.loads(body)
        if result.get("ok"):
            log(f"setMyCommands: ok ({len(cmds)} cmds registered)")
        else:
            log(f"setMyCommands: {body}")
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, TimeoutError, OSError) as e:
        log(f"setMyCommands: failed ({e}) — retrying at the next boot")


# ── Helpers ─────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}][{BOT_ROLE}] {msg}", flush=True)


def read_config() -> tuple[str, int]:
    """Token + chat_id whitelist per il ruolo corrente. Exit se mancanti."""
    try:
        cfg = json.loads(CONFIG_PATH.read_text())
        bots = cfg.get("channels", {}).get("telegram", {}).get("bots", {}) or {}
        bot = bots.get(BOT_ROLE) or {}
        token = (bot.get("bot_token") or "").strip()
        chat_id_raw = bot.get("chat_id", "")
        chat_id = int(chat_id_raw) if str(chat_id_raw).strip() else 0
        if not token or not chat_id:
            log(f"FATAL: token or chat_id missing for role '{BOT_ROLE}' in {CONFIG_PATH}")
            sys.exit(2)
        return token, chat_id
    except FileNotFoundError:
        log(f"FATAL: {CONFIG_PATH} not found — the wizard is incomplete")
        sys.exit(2)
    except Exception as e:
        log(f"FATAL: failed to read config: {e}")
        sys.exit(2)


def load_offset() -> int:
    if os.environ.get("JHT_TG_OFFSET_RESET") == "1":
        log("offset reset requested through the environment — skipping backlog")
        return -1  # sentinella per "ricalcola dal max attuale al primo poll"
    try:
        return int(json.loads(STATE_PATH.read_text()).get("last_offset", 0))
    except Exception:
        return 0


def load_attempts() -> dict[int, int]:
    """Tentativi gia' spesi per update_id, persistiti insieme all'offset.

    Vivono su disco e non in memoria perche' altrimenti un riavvio del bridge
    (start-agent.sh lo respawna) azzererebbe il contatore: un update velenoso
    tornerebbe a bloccare la coda per sempre, un riavvio alla volta.
    """
    if os.environ.get("JHT_TG_OFFSET_RESET") == "1":
        return {}
    try:
        raw = json.loads(STATE_PATH.read_text()).get("attempts") or {}
        return {int(k): int(v) for k, v in raw.items()}
    except Exception:
        return {}


def _fsync_dir(path: Path) -> None:
    """Rende durevole rename/unlink quando il filesystem lo supporta."""
    try:
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def _atomic_json(path: Path, value: dict, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        try:
            os.chmod(path, mode)
        except OSError:
            pass
        _fsync_dir(path.parent)
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def save_offset(offset: int, attempts: dict[int, int] | None = None) -> None:
    state: dict = {"last_offset": offset}
    if attempts:
        state["attempts"] = {str(k): int(v) for k, v in attempts.items()}
    try:
        _atomic_json(STATE_PATH, state)
    except Exception as e:
        log(f"warn: save offset failed: {e}")


def _queue_file(update_id: int) -> Path:
    return INBOUND_QUEUE_DIR / f"update-{update_id}.json"


def _telegram_created_at(msg: dict) -> str:
    raw = msg.get("date")
    try:
        stamp = int(raw)
    except (TypeError, ValueError):
        stamp = int(time.time())
    # Stesso formato UTC scritto dagli altri producer SQLite. Il mirror usa
    # `created_at` per ricavare un chat_ts deterministico: un ISO gia' dotato
    # di offset seguito da un secondo `Z` cadrebbe sul fallback `now` e, dopo
    # un crash fra append e timbro, potrebbe riscrivere lo stesso turno.
    return datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _reply_to_text(msg: dict) -> str | None:
    replied = msg.get("reply_to_message")
    if not isinstance(replied, dict):
        return None
    text = replied.get("text") or replied.get("caption")
    return str(text) if text else None


def enqueue_inbound_turn(update_id: int, msg: dict, body: str,
                         *, edited: bool = False, login_text: str | None = None) -> bool:
    """Journal atomico PRIMA dell'offset; update_id e' la chiave di dedup.

    Un file per update evita rewrite non atomiche della coda. Se il processo
    cade dopo il rename ma prima di `save_offset`, Telegram ripropone lo stesso
    update e trova gia' la stessa identita': nessuna seconda riga.
    """
    if not isinstance(update_id, int) or not str(body).strip():
        raise DurableQueueError("update_id/body non validi")
    path = _queue_file(update_id)
    if path.exists():
        return False
    record = {
        "version": 1,
        "source_id": f"telegram:{BOT_ROLE}:{update_id}",
        "update_id": update_id,
        "agent": BOT_ROLE,
        "body": str(body),
        "author": "user",
        "delivered_via": "telegram",
        "created_at": _telegram_created_at(msg),
        "edited": bool(edited),
        # Il testo del messaggio a cui l'utente ha risposto: e' cosi' che una
        # risposta trova la SUA domanda quando ce n'e' piu' d'una aperta.
        "reply_to_text": _reply_to_text(msg),
    }
    if login_text is not None:
        # A verification code: `body` is the mask the chat keeps, the text
        # lives only in this 0600 journal until the flush hands it over.
        record["login_text"] = str(login_text)
    try:
        _atomic_json(path, record)
    except Exception as e:
        raise DurableQueueError(f"journal write failed: {e}") from e
    return True


def _ensure_inbound_schema(db: sqlite3.Connection) -> None:
    columns = {
        row[1] for row in db.execute("PRAGMA table_info(pending_user_messages)")
    }
    if not columns:
        raise DurableQueueError("pending_user_messages non disponibile")
    if "author" not in columns:
        db.execute(
            "ALTER TABLE pending_user_messages "
            "ADD COLUMN author TEXT NOT NULL DEFAULT 'agent'"
        )
    if "chat_ts" not in columns:
        db.execute("ALTER TABLE pending_user_messages ADD COLUMN chat_ts REAL")
    if "source_id" not in columns:
        db.execute("ALTER TABLE pending_user_messages ADD COLUMN source_id TEXT")
    db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_messages_source_id "
        "ON pending_user_messages(source_id) WHERE source_id IS NOT NULL"
    )


def _resolve_closer_answer(db: sqlite3.Connection, rec: dict):
    """La risposta dell'utente a una domanda del CLOSER, se lo e'.

    Dentro un SAVEPOINT: un errore della risoluzione non deve far perdere il
    turno di chat appena scritto, ne' lasciare mezza risposta salvata.
    """
    if application_answers is None:
        return None
    db.execute("SAVEPOINT closer_answer")
    try:
        outcome = application_answers.resolve_telegram_reply(
            db,
            text=str(rec.get("body") or ""),
            reply_to_text=rec.get("reply_to_text"),
            direct=BOT_ROLE == CLOSER_QUESTION_BOT,
        )
    except Exception as e:
        db.execute("ROLLBACK TO closer_answer")
        db.execute("RELEASE closer_answer")
        log(f"closer answer resolution failed: {type(e).__name__} — chat turn kept")
        return None
    db.execute("RELEASE closer_answer")
    if outcome.status == "resolved":
        log(f"closer answer resolved message={outcome.message_id} position={outcome.position_id}")
        return outcome
    if outcome.status == "rejected":
        log(f"closer answer rejected message={outcome.message_id} reason={outcome.reason}")
        return outcome
    if outcome.status in {"already_answered", "unknown_code"} and (
        rec.get("reply_to_text") or BOT_ROLE == CLOSER_QUESTION_BOT
    ):
        # A quoted code, or a code written to the bot the questions leave
        # from: the user meant to answer. A "Q2025" chatted elsewhere is chat.
        return outcome
    if outcome.status == "ambiguous" and (
        rec.get("reply_to_text") or application_answers._CODE.search(str(rec.get("body") or ""))
    ):
        return outcome
    return None


def _login_code_masked(msg: dict) -> bool:
    """Is this text a LinkedIn verification code? Then it never reaches the chat.

    Read only, before the journal: the ASSISTENTE and the chat history (pushed
    to the cloud) must never see the digits. No jobs.db, no login request.
    """
    if application_answers is None or not JOBS_DB_PATH.exists():
        return False
    db = sqlite3.connect(f"file:{JOBS_DB_PATH}?mode=ro", uri=True, timeout=5)
    try:
        return application_answers.login_code_candidate(
            db,
            text=str(msg.get("text") or ""),
            reply_to_text=_reply_to_text(msg),
            direct=BOT_ROLE == CLOSER_QUESTION_BOT,
        )
    finally:
        db.close()


def _resolve_login_code(db: sqlite3.Connection, rec: dict):
    """Hand a masked verification code to the flow waiting for it; the outcome for the user."""
    if application_answers is None:
        return None
    db.execute("SAVEPOINT closer_login_code")
    try:
        outcome = application_answers.resolve_login_code(
            db,
            text=str(rec.get("login_text") or ""),
            reply_to_text=rec.get("reply_to_text"),
            direct=BOT_ROLE == CLOSER_QUESTION_BOT,
            jht_home=JHT_HOME,
        )
    except Exception as e:
        db.execute("ROLLBACK TO closer_login_code")
        db.execute("RELEASE closer_login_code")
        log(f"closer login code failed: {type(e).__name__}")
        return application_answers.LoginCodeOutcome("failed")
    db.execute("RELEASE closer_login_code")
    log(f"closer login code {outcome.status}")
    return outcome


_LOGIN_FEEDBACK = {
    "received": "Verification code received. CLOSER is signing in with it.",
    "expired": "That verification code request has expired. CLOSER will ask again.",
    "closed": "That verification code request is already closed. CLOSER will ask again if it still needs one.",
    "ambiguous": "This message was not used as a verification code. Reply to the code request message with the code.",
    "failed": "The verification code could not be handed over. CLOSER will ask again.",
}


_REJECTION_TEXT = {
    "closer_answer_not_exact_option": "it must be one of the listed choices, written exactly as shown",
    "closer_answer_empty": "the answer is empty",
    "closer_answer_already_submitted": "this application has already been sent",
    "closer_answer_position_not_ready": "this position is no longer ready to apply",
}


def _answer_feedback_text(outcome) -> str:
    if application_answers is not None and isinstance(outcome, application_answers.LoginCodeOutcome):
        return _LOGIN_FEEDBACK.get(outcome.status, _LOGIN_FEEDBACK["failed"])
    if outcome.status == "resolved" and outcome.reason == "position_withdrawn":
        return (
            "Answer saved. That application is withdrawn, so CLOSER will not send it: "
            "the answer is used only if you ask to apply again."
        )
    if outcome.status == "resolved":
        return "Answer saved. CLOSER will use it for this application and will not ask it again."
    if outcome.status == "already_answered":
        return "That CLOSER question already has an answer, so this message was not saved as a new one."
    if outcome.status == "unknown_code":
        return "No open CLOSER question has that code, so this message was not saved as an answer."
    if outcome.status == "rejected":
        why = _REJECTION_TEXT.get(outcome.reason, "it does not fit this question")
        return f"That answer was not saved: {why}. Here is the question again:\n\n{outcome.question}"
    return (
        "More than one CLOSER question is open and this message does not say which one it answers. "
        "Reply to the question message, or start your answer with its code."
    )


def _answer_feedback(outcome) -> None:
    """Best-effort: la risposta e' gia' salvata (o rifiutata) nel DB."""
    try:
        subprocess.run(
            ["jht-telegram-send", "--from", BOT_ROLE, _answer_feedback_text(outcome)],
            capture_output=True, text=True, timeout=25, check=False,
        )
    except Exception as e:
        log(f"closer answer feedback not sent: {type(e).__name__}")


def wake_closer_after_answers(db_path: Path | None = None) -> None:
    """Sveglia il CLOSER vivo quando le risposte dell'utente sbloccano qualcosa.

    Stessa funzione per le risposte arrivate da Telegram e da dashboard: le une
    e le altre finiscono sulle righe delle domande, e la chiave di sveglia e'
    in jobs.db, quindi una sola sveglia per posizione anche con tre bridge.
    Best-effort: senza sveglia la posizione e' comunque pronta in coda e la
    regola di spawn del Capitano la vede.
    """
    if application_answers is None or BOT_ROLE != CLOSER_QUESTION_BOT:
        return
    target = db_path or JOBS_DB_PATH
    if not target.exists():
        return
    try:
        # Every poll comes here: jobs.db alone says whether there is anything
        # to announce, before the profile is parsed or the queue is read.
        probe = sqlite3.connect(target, timeout=5)
        try:
            if not application_answers.wake_candidates(probe):
                return
        finally:
            probe.close()
        profile = {}
        profile_path = JHT_HOME / "profile" / "candidate_profile.yml"
        try:
            import yaml

            loaded = yaml.safe_load(profile_path.read_text(encoding="utf-8"))
            profile = loaded if isinstance(loaded, dict) else {}
        except Exception:
            profile = {}
        db = sqlite3.connect(target, timeout=5)
        try:
            for wake in application_answers.wake_closer(db, profile):
                log(f"closer woken: {wake.reason} key={wake.key}")
        finally:
            db.close()
    except Exception as e:
        log(f"closer wake check failed: {type(e).__name__}")


def flush_inbound_queue(db_path: Path | None = None) -> int:
    """Trasferisce il journal nella cronologia unificata, poi lo elimina.

    Il COMMIT SQLite viene prima dell'unlink. Un crash fra i due lascia sia la
    riga sia il file; al riavvio l'indice su source_id rende il replay un no-op
    e il file viene rimosso. Dopo il commit il solo consumer verso il pane e'
    `chat-sync.js`, quindi non esistono due consegne concorrenti.
    """
    if not INBOUND_QUEUE_DIR.exists():
        return 0
    paths = sorted(
        INBOUND_QUEUE_DIR.glob("update-*.json"),
        key=lambda p: int(p.stem.split("-", 1)[1]),
    )
    if not paths:
        return 0
    target = db_path or JOBS_DB_PATH
    if not target.exists():
        log(f"inbound queue waiting: {target} not found")
        return 0

    records = []
    try:
        for path in paths:
            rec = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(rec, dict) or not rec.get("source_id"):
                raise DurableQueueError(f"journal corrotto: {path.name}")
            records.append((path, rec))
        db = sqlite3.connect(target, timeout=5)
        try:
            _ensure_inbound_schema(db)
            insert = (
                "INSERT OR IGNORE INTO pending_user_messages "
                "(agent, body, kind, author, chat_ts, delivered_via, "
                " delivered_at, created_at, source_id) "
                "VALUES (?, ?, 'notification', 'user', NULL, 'telegram', "
                "        NULL, ?, ?)"
            )
            resolutions = []
            for _path, rec in records:
                inserted = db.execute(insert, (
                    rec["agent"], rec["body"], rec["created_at"], rec["source_id"],
                )).rowcount
                # Solo la prima volta: un replay del journal trova la riga gia'
                # scritta e non deve risolvere (o rifiutare) una seconda volta.
                if inserted == 1 and "login_text" in rec:
                    outcome = _resolve_login_code(db, rec) if not rec.get("edited") else None
                    if outcome is not None:
                        resolutions.append(outcome)
                elif inserted == 1 and not rec.get("edited"):
                    outcome = _resolve_closer_answer(db, rec)
                    if outcome is not None:
                        resolutions.append(outcome)
            db.commit()
        finally:
            db.close()
    except (OSError, ValueError, KeyError, sqlite3.Error, DurableQueueError) as e:
        log(f"inbound queue flush failed: {e} — durable journal retained")
        return 0

    for outcome in resolutions:
        _answer_feedback(outcome)
    if any(outcome.status == "resolved" for outcome in resolutions):
        wake_closer_after_answers(target)

    for path, _rec in records:
        try:
            path.unlink()
        except OSError as e:
            # La riga e' gia' nel DB. Lasciare il file significa solo un replay
            # idempotente al prossimo poll, mai una perdita o un doppione.
            log(f"inbound queue cleanup warn ({path.name}): {e}")
    _fsync_dir(INBOUND_QUEUE_DIR)
    return len(records)


def _one_line(value) -> str:
    """Un campo scelto da chi invia sta su UNA riga, sempre.

    Non e' una questione di lunghezza ma di provenienza: `file_name` e
    `mime_type` li sceglie chi invia, e finiscono in un testo STRUTTURATO che
    un agente legge (`[TG-DOC] path=... name=...`). Un a-capo dentro il nome
    simula righe della busta, cioe' fabbrica struttura che nessuno ha scritto.

    La regola sta in `shared/skills/external_content.py` e vale anche per i
    campi scrapati che finiscono nel prompt degli agenti: spariscono gli
    invisibili che COMANDANO (override e isolate bidi, soft hyphen), diventano
    uno spazio i controlli e i separatori di riga, e restano intatti gli
    invisibili con cui si SCRIVE.

    ⚠️ Qui prima c'era `isprintable()`, che e' comodo ma cade sull'intera
    categoria Cf: in un nome persiano lo ZWNJ diventava uno spazio e una parola
    sola ne diventava due. Non e' formattazione persa, e' ortografia.
    """
    return flatten_to_one_line(value)


def _quoted(value) -> str:
    """Campo delimitato: senza virgolette il valore puo' fingersi un campo.

    Gli spazi in un nome di file sono legittimi («CV Mario Rossi.pdf»), quindi
    lo spazio non puo' fare da confine: `name=x mime=text/plain` sarebbe
    indistinguibile da due campi veri. Le virgolette lo chiudono, e quelle
    contenute nel valore vengono neutralizzate invece di poterlo riaprire.
    """
    text = _one_line(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{text}"'


def _int_field(value, default: int = 0) -> int:
    """Un numero nella busta e' un numero.

    `file_size` e `duration` li dichiara chi invia: una stringa al posto di un
    intero sarebbe l'ennesimo campo libero dentro un testo strutturato.
    """
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def _doc_envelope(local: Path, name: str, mime: str, size, extra: str = "") -> str:
    """La busta [TG-DOC] si costruisce QUI, non in ogni handler.

    Come per `_inbox_leaf`: la neutralizzazione sta dove la struttura viene
    prodotta, cosi' foto, vocali e ogni allegato futuro la ereditano anche se
    oggi passano nomi che il programma sceglie da se'.
    """
    label = _one_line(name) or local.name
    # Regola unica e leggibile: i campi di testo sono delimitati, i numeri no.
    # `mime` lo sceglie chi invia esattamente come il nome; il path lo sceglie
    # il programma, ma la sua foglia nasce dal nome dell'utente.
    body = (
        f"[TG-DOC] "
        f"path={_quoted(local)} name={_quoted(label)} "
        f"mime={_quoted(mime)} size={_int_field(size, _size_on_disk(local))}"
    )
    return f"{body} {extra}".rstrip()


def _inbox_leaf(dest_name: str, file_id: str) -> str:
    """Il nome proposto dal chiamante diventa una FOGLIA della inbox, mai un path.

    `file_name` di un documento e' un campo del messaggio, quindi lo sceglie chi
    invia: senza basename un `../../.claude/CLAUDE.md` esce dalla inbox e scrive
    nel bind mount di ~/.jht sull'host, dove vivono le credenziali. E cercare
    `..` non basterebbe — in pathlib un componente **assoluto** non si appende
    alla base, la SOSTITUISCE (`Path('/a/inbox') / '/etc/x'` e' `/etc/x`).

    Il guard sta qui e non nel chiamante perche' e' fetch_file a possedere
    INBOX_DIR: cosi' anche un chiamante futuro nasce protetto. Il nome
    dichiarato non si perde, resta l'etichetta `name=` nella busta.
    """
    # `_one_line` dopo il basename: il file su disco non deve portarsi dentro
    # a-capo o invisibili, che finirebbero nel `path=` della busta e nei log.
    leaf = _one_line(os.path.basename(str(dest_name or "").strip()))
    if leaf in ("", ".", ".."):
        stem = "".join(c for c in str(file_id) if c.isalnum())[:8]
        leaf = f"file-{stem or 'unnamed'}"
    return leaf


def fetch_file(token: str, file_id: str, dest_name: str) -> Path | None:
    """Bot API getFile + download via file_path. Restituisce Path locale o None.

    Il tetto dei 20 MB e' applicato **sullo stream**, non solo sul `file_size`
    dichiarato: l'API puo' omettere il campo, e un campo assente non e' un file
    piccolo. Se lo supera solleva DocumentTooLarge (il parziale viene rimosso),
    cosi' il chiamante puo' dire all'utente *perche'* e non solo che e' fallito.

    Il nome di destinazione non e' mai un percorso: vedi `_inbox_leaf`.
    """
    local: Path | None = None
    try:
        url = f"https://api.telegram.org/bot{token}/getFile?file_id={file_id}"
        meta = json.loads(urllib.request.urlopen(url, timeout=10).read())
        if not meta.get("ok"):
            log(f"getFile failed: {meta}")
            return None
        result = meta.get("result") or {}
        declared = result.get("file_size")
        if isinstance(declared, int) and not isinstance(declared, bool) and declared > MAX_DOC_SIZE_BYTES:
            raise DocumentTooLarge(declared)
        file_path = result["file_path"]
        dl_url = f"https://api.telegram.org/file/bot{token}/{file_path}"
        INBOX_DIR.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(INBOX_DIR, 0o700)
        except OSError:
            pass
        # Anti-clobber: prefisso timestamp se nome gia' presente
        leaf = _inbox_leaf(dest_name, file_id)
        local = INBOX_DIR / leaf
        if local.exists():
            ts = datetime.now().strftime("%Y%m%d-%H%M%S")
            local = INBOX_DIR / f"{ts}-{leaf}"
        written = 0
        fd = os.open(local, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with urllib.request.urlopen(dl_url, timeout=60) as r, os.fdopen(fd, "wb") as f:
            while True:
                chunk = r.read(DOWNLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_DOC_SIZE_BYTES:
                    raise DocumentTooLarge(written)
                f.write(chunk)
        # Owner: il container gira come jht (uid 1001); siamo gia' jht quindi
        # il file e' suo. Niente chown necessario.
        return local
    except DocumentTooLarge as e:
        log(f"fetch_file: size limit exceeded ({e}) — download stopped")
        _discard_partial(local)
        raise
    except Exception as e:
        log(f"fetch_file error: {e}")
        _discard_partial(local)
        return None


def _discard_partial(local: Path | None) -> None:
    """Niente file mezzi scaricati nella inbox: un agente li leggerebbe come buoni."""
    if local is None:
        return
    try:
        local.unlink(missing_ok=True)
    except Exception as e:
        log(f"warn: partial cleanup failed: {e}")


# ── Dispatch messaggi ───────────────────────────────────────────────────

# Buste che scrive solo il trasporto o un agente: in testa a una riga di un
# testo dell'utente farebbero passare le sue parole per un messaggio del daemon
# ([BRIDGE INFO]) o di un collega ([@x -> @y]). Il testo resta intatto, ma
# chi lo legge vede per prima cosa che l'ha scritto l'utente.
_FORGED_ENVELOPE_RE = re.compile(r"^\s*\[\s*(?:BRIDGE\b|TG-|@[^\]]*->|!\s*(?:UNVERIFIED|RELAYED)\b)", re.I)
USER_TEXT_MARK = "[USER TEXT]"


def handle_text(msg: dict) -> str | None:
    text = msg.get("text", "").strip()
    if not text:
        return None
    lines = text.split("\n")
    if any(_FORGED_ENVELOPE_RE.match(line) for line in lines):
        # Ogni riga che comincia come una busta porta il marchio, e anche la
        # prima: chi legge il pane vede una riga per volta.
        lines = [f"{USER_TEXT_MARK} {line}" if _FORGED_ENVELOPE_RE.match(line) else line for line in lines]
        if not lines[0].startswith(USER_TEXT_MARK):
            lines[0] = f"{USER_TEXT_MARK} {lines[0]}"
        text = "\n".join(lines)
    log(f"text len={len(text)} → {TARGET_SESSION}")
    return text


def declared_size(payload: dict) -> int | None:
    """`file_size` solo se e' davvero un intero. Campo assente ≠ file piccolo.

    Ritornare None significa "sconosciuto": il limite non e' verificabile prima
    del download e va applicato sullo stream, mai dato per rispettato.
    """
    size = payload.get("file_size")
    if isinstance(size, bool) or not isinstance(size, int):
        return None
    return size


def reject_too_large(name: str, size_bytes: int | None) -> str:
    quanto = f"{size_bytes // 1024 // 1024} MB" if size_bytes is not None else "over the limit"
    etichetta = _quoted(name)
    log(f"doc {etichetta} exceeds the limit ({size_bytes}B) — skipping")
    return (
        f"[TG-DOC-REJECT] "
        f"file {etichetta} exceeds 20 MB ({quanto}). "
        f"Ask the user to send it again in a smaller format."
    )


def download_failed(name: str) -> str:
    """Anche il messaggio d'errore e' testo che un agente legge: stesso confine."""
    return (
        f"[TG-DOC-ERROR] "
        f"download of {_quoted(name)} failed — ask the user to try again."
    )


def handle_document(token: str, msg: dict) -> str:
    doc = msg["document"]
    size = declared_size(doc)
    name = doc.get("file_name", f"file-{doc['file_id'][:8]}")
    mime = doc.get("mime_type", "application/octet-stream")
    if size is not None and size > MAX_DOC_SIZE_BYTES:
        return reject_too_large(name, size)
    if size is None:
        log(f"doc {name}: file_size missing — the limit will be enforced on the stream")
    try:
        local = fetch_file(token, doc["file_id"], name)
    except DocumentTooLarge as e:
        return reject_too_large(name, e.downloaded)
    if not local:
        return download_failed(name)
    if size is None:
        size = _size_on_disk(local)
    body = _doc_envelope(local, name, mime, size)
    log(f"doc {_quoted(name)} → {local} ({size}B)")
    return body


def _size_on_disk(local: Path) -> int:
    try:
        return local.stat().st_size
    except Exception:
        return 0


def handle_photo(token: str, msg: dict) -> str | None:
    """Photo array — prendi quella piu' grande."""
    photos = msg.get("photo", [])
    if not photos:
        return None
    largest = max(photos, key=lambda p: _int_field(p.get("file_size")))
    name = f"photo-{largest['file_id'][:10]}.jpg"
    try:
        local = fetch_file(token, largest["file_id"], name)
    except DocumentTooLarge as e:
        return reject_too_large(name, e.downloaded)
    if not local:
        return download_failed(name)
    body = _doc_envelope(local, name, "image/jpeg", largest.get("file_size", 0))
    log(f"photo → {local}")
    return body


def handle_voice(token: str, msg: dict) -> str:
    v = msg["voice"]
    name = f"voice-{v['file_id'][:10]}.ogg"
    try:
        local = fetch_file(token, v["file_id"], name)
    except DocumentTooLarge as e:
        return reject_too_large(name, e.downloaded)
    if not local:
        return download_failed(name)
    body = _doc_envelope(
        local, name, "audio/ogg", v.get("file_size", 0),
        extra=f"duration={_int_field(v.get('duration'))}s",
    )
    log(f"voice → {local}")
    return body


# ── Dispatch di un singolo update ───────────────────────────────────────

def dispatch_update(token: str, allowed_chat: int, u: dict) -> None:
    """Instrada UN update. Solleva: e' main() a decidere ritentare o scartare.

    Tutto cio' che e' una decisione legittima (chat non in whitelist, /start,
    tipo sconosciuto) ritorna normalmente: quegli update sono *gestiti*, non
    falliti, e la coda deve avanzare oltre.
    """
    uid = u.get("update_id")
    edited = "edited_message" in u and "message" not in u
    m = u.get("message") or u.get("edited_message")
    if not m:
        return
    chat_id = m.get("chat", {}).get("id")
    if chat_id != allowed_chat:
        log(f"drop update uid={uid} chat={chat_id} (not whitelisted)")
        return
    # Skippa /start: e' solo per attivare la chat col bot,
    # l'Assistente non deve trattarlo come messaggio reale.
    if (m.get("text") or "").strip() == "/start":
        log(f"uid={uid} /start ack (no forward)")
        return
    body = None
    login_text = None
    if "text" in m and _login_code_masked(m):
        login_text = str(m.get("text") or "")
        body = application_answers.LOGIN_CODE_MASK
        log(f"uid={uid} verification code masked")
    elif "text" in m:
        body = handle_text(m)
    elif "document" in m:
        body = handle_document(token, m)
    elif "photo" in m:
        body = handle_photo(token, m)
    elif "voice" in m:
        body = handle_voice(token, m)
    else:
        log(f"uid={uid} unknown message kind, skipped")
    if body:
        # Un edit e' un NUOVO turno con il proprio update_id: non riscrive lo
        # storico gia' consegnato e non puo' collidere col messaggio originale.
        if edited:
            body = f"[TG-EDITED] {body}"
        enqueue_inbound_turn(uid, m, body, edited=edited, login_text=login_text)


_CODE_DIGITS_RE = re.compile(r"(?<![A-Za-z0-9])\d(?:[ -]?\d){3,}(?![A-Za-z0-9])")


def _mask_code_digits(text):
    """A group of 4+ digits may be a verification code: never written to disk raw."""
    return _CODE_DIGITS_RE.sub("[digits]", text) if isinstance(text, str) else text


def _mask_update_digits(u: dict) -> dict:
    """The dead letter keeps the update, not a code it may carry (the DB may be why it failed)."""
    masked = json.loads(json.dumps(u, default=str))
    for key in ("message", "edited_message"):
        m = masked.get(key)
        if not isinstance(m, dict):
            continue
        for field in ("text", "caption"):
            m[field] = _mask_code_digits(m.get(field)) if field in m else None
            if m[field] is None:
                m.pop(field)
        replied = m.get("reply_to_message")
        if isinstance(replied, dict) and "text" in replied:
            replied["text"] = _mask_code_digits(replied["text"])
    return masked


def dead_letter(u: dict, err: BaseException, attempts: int) -> None:
    """Ultima spiaggia per un update che fallisce sempre.

    Lo mette su file *e* lo dice all'agente: la regola di progetto e' che
    l'utente non deve aprire un terminale, quindi un messaggio non consegnato
    dev'essere annunciato, non lasciato dedurre dal silenzio.
    """
    uid = u.get("update_id")
    reason = f"{type(err).__name__}: {err}"
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "role": BOT_ROLE,
        "update_id": uid,
        "attempts": attempts,
        "error": _mask_code_digits(reason),
        "update": _mask_update_digits(u),
    }
    try:
        DEADLETTER_PATH.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(DEADLETTER_PATH, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
                f.flush()
                os.fsync(f.fileno())
        except Exception:
            try:
                os.close(fd)
            except OSError:
                pass
            raise
    except Exception as e:
        log(f"warning: failed to write dead letter: {e}")
    log(f"DEAD-LETTER uid={uid} after {attempts} attempts ({reason}) — resuming the queue")
    m = u.get("message") or u.get("edited_message") or {}
    enqueue_inbound_turn(
        uid,
        m,
        f"[TG-UNDELIVERED] "
        f"update_id={uid} attempts={attempts} error={_mask_code_digits(reason)} file={DEADLETTER_PATH} — "
        f"a user message was not delivered: notify the user and ask them to send it again.",
    )


# ── Main loop ───────────────────────────────────────────────────────────

def main() -> None:
    token, allowed_chat = read_config()
    offset = load_offset()
    attempts = load_attempts()
    log(f"start: role={BOT_ROLE} target={TARGET_SESSION} allowed_chat={allowed_chat} "
        f"offset={offset} pending_retry={len(attempts)}")

    # F-1.A: bootstrap commands cliccabili nel menu Telegram. Idempotente,
    # non blocca il long-poll se l'API è temporaneamente irraggiungibile.
    setup_bot_commands(token)

    # offset == -1 → ricalcola dal max attuale (skip backlog post-reset)
    if offset == -1:
        try:
            r = urllib.request.urlopen(
                f"https://api.telegram.org/bot{token}/getUpdates?offset=-1",
                timeout=10,
            ).read()
            d = json.loads(r)
            updates = d.get("result", [])
            offset = max((u["update_id"] for u in updates), default=0)
            log(f"reset: skipping backlog, starting at offset={offset}")
            save_offset(offset)
        except Exception as e:
            log(f"reset failed; starting from offset 0: {e}")
            offset = 0

    while True:
        try:
            # Journal Telegram → SQLite a ogni poll. Se jobs.db non e' ancora
            # pronto il file resta: leggere nuovi update e' comunque sicuro,
            # perche' l'offset puo' avanzare solo dopo il journal atomico.
            flush_inbound_queue()
            url = (
                f"https://api.telegram.org/bot{token}/getUpdates"
                f"?offset={offset + 1}&timeout={POLL_TIMEOUT_SEC}"
            )
            r = urllib.request.urlopen(url, timeout=POLL_TIMEOUT_SEC + 5).read()
            d = json.loads(r)
            ritenta = False
            for u in d.get("result", []):
                uid = u.get("update_id")
                if not isinstance(uid, int):
                    log(f"update has no valid update_id; skipping: {str(u)[:120]}")
                    continue
                try:
                    dispatch_update(token, allowed_chat, u)
                except DurableQueueError as e:
                    # Fail-closed senza soglia: un disco/DB non scrivibile non
                    # trasforma mai un messaggio reale in dead-letter. Fermiamo
                    # anche il batch, cosi' l'ordine resta quello di Telegram.
                    attempts[uid] = attempts.get(uid, 0) + 1
                    log(f"durable enqueue uid={uid} failed ({e}) — offset held; "
                        "retrying on the next poll")
                    ritenta = True
                    break
                except Exception as e:
                    tentativi = attempts.get(uid, 0) + 1
                    if tentativi < MAX_UPDATE_ATTEMPTS:
                        # Offset fermo prima di uid: Telegram ce lo ripropone.
                        # Fermiamo anche il resto del batch per non consegnare
                        # fuori ordine i messaggi che stanno dietro.
                        attempts[uid] = tentativi
                        log(f"dispatch uid={uid} failed ({e}) — attempt "
                            f"{tentativi}/{MAX_UPDATE_ATTEMPTS}; retrying on the next poll")
                        ritenta = True
                        break
                    # Veleno: tentativi esauriti. Si scarta, si avvisa, si va
                    # avanti — un update rotto non puo' zittire tutta la coda.
                    try:
                        dead_letter(u, e, tentativi)
                    except DurableQueueError as queue_err:
                        attempts[uid] = tentativi
                        log(f"dead-letter enqueue uid={uid} failed ({queue_err}) — "
                            "offset held; retrying")
                        ritenta = True
                        break
                    else:
                        attempts.pop(uid, None)
                else:
                    attempts.pop(uid, None)
                if uid > offset:
                    offset = uid
            save_offset(offset, attempts)
            # Riduce la latenza normale: il journal appena scritto entra nella
            # cronologia senza aspettare i 30s del long-poll successivo.
            flush_inbound_queue()
            # Anche le risposte date dalla dashboard: nessun evento le annuncia
            # al bridge, quindi le si guarda a ogni giro (una query leggera).
            wake_closer_after_answers()
            if ritenta:
                time.sleep(RETRY_BACKOFF_SEC)
        except urllib.error.HTTPError as e:
            log(f"HTTP {e.code}: {e.reason} — sleep 10s")
            time.sleep(10)
        except urllib.error.URLError as e:
            log(f"network: {e} — sleep 5s")
            time.sleep(5)
        except Exception as e:
            log(f"unexpected: {e} — sleep 5s")
            time.sleep(5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("interrupted, exit")
