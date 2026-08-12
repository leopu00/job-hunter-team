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


def enqueue_inbound_turn(update_id: int, msg: dict, body: str,
                         *, edited: bool = False) -> bool:
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
    }
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
            for _path, rec in records:
                db.execute(insert, (
                    rec["agent"], rec["body"], rec["created_at"], rec["source_id"],
                ))
            db.commit()
        finally:
            db.close()
    except (OSError, ValueError, KeyError, sqlite3.Error, DurableQueueError) as e:
        log(f"inbound queue flush failed: {e} — durable journal retained")
        return 0

    for path, _rec in records:
        try:
            path.unlink()
        except OSError as e:
            # La riga e' gia' nel DB. Lasciare il file significa solo un replay
            # idempotente al prossimo poll, mai una perdita o un doppione.
            log(f"inbound queue cleanup warn ({path.name}): {e}")
    _fsync_dir(INBOUND_QUEUE_DIR)
    return len(records)


def fetch_file(token: str, file_id: str, dest_name: str) -> Path | None:
    """Bot API getFile + download via file_path. Restituisce Path locale o None.

    Il tetto dei 20 MB e' applicato **sullo stream**, non solo sul `file_size`
    dichiarato: l'API puo' omettere il campo, e un campo assente non e' un file
    piccolo. Se lo supera solleva DocumentTooLarge (il parziale viene rimosso),
    cosi' il chiamante puo' dire all'utente *perche'* e non solo che e' fallito.
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
        # Anti-clobber: prefisso timestamp se nome gia' presente
        local = INBOX_DIR / dest_name
        if local.exists():
            ts = datetime.now().strftime("%Y%m%d-%H%M%S")
            local = INBOX_DIR / f"{ts}-{dest_name}"
        written = 0
        with urllib.request.urlopen(dl_url, timeout=60) as r, open(local, "wb") as f:
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

def handle_text(msg: dict) -> str | None:
    text = msg.get("text", "").strip()
    if not text:
        return None
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
    log(f"doc {name} exceeds the limit ({size_bytes}B) — skipping")
    return (
        f"[TG-DOC-REJECT] "
        f"file '{name}' exceeds 20 MB ({quanto}). "
        f"Ask the user to send it again in a smaller format."
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
        return (
            f"[TG-DOC-ERROR] "
            f"download of '{name}' failed — ask the user to try again."
        )
    if size is None:
        size = _size_on_disk(local)
    body = (
        f"[TG-DOC] "
        f"path={local} name={name} mime={mime} size={size}"
    )
    log(f"doc {name} → {local} ({size}B)")
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
    largest = max(photos, key=lambda p: p.get("file_size", 0))
    name = f"photo-{largest['file_id'][:10]}.jpg"
    try:
        local = fetch_file(token, largest["file_id"], name)
    except DocumentTooLarge as e:
        return reject_too_large(name, e.downloaded)
    if not local:
        return f"[TG-DOC-ERROR] download of '{name}' failed — ask the user to try again."
    body = (
        f"[TG-DOC] "
        f"path={local} name={name} mime=image/jpeg size={largest.get('file_size', 0)}"
    )
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
        return f"[TG-DOC-ERROR] download of '{name}' failed — ask the user to try again."
    body = (
        f"[TG-DOC] "
        f"path={local} name={name} mime=audio/ogg size={v.get('file_size', 0)} "
        f"duration={v.get('duration', 0)}s"
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
    if "text" in m:
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
        enqueue_inbound_turn(uid, m, body, edited=edited)


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
        "error": reason,
        "update": u,
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
        f"update_id={uid} attempts={attempts} error={reason} file={DEADLETTER_PATH} — "
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
