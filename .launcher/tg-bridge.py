#!/usr/bin/env python3
"""
Telegram Inbound Bridge — long-poll Bot API → tmux ASSISTENTE.

Architettura (pattern simile a sentinel-bridge.py):
  • Long-poll su /getUpdates con timeout 30s
  • Per ogni messaggio text: invia [@utente -> @<target>] [TG] <body>
    al tmux ASSISTENTE via jht-tmux-send
  • Per allegati document/photo/voice: scarica via getFile + salva in
    $JHT_HOME/profile/inbox/<filename>, invia [TG-DOC] path=... name=...
  • Whitelist su chat_id: solo l'utente del config (canale 1:1, anti-spam)
  • Persistenza offset in $JHT_HOME/tg-bridge-state.json (sopravvive restart)
  • Singleton: kill preesistenti via /proc/*/cmdline

Config:
  $JHT_HOME/jht.config.json → channels.telegram.{bot_token, chat_id}
  JHT_TG_TARGET_SESSION                       — default ASSISTENTE
  JHT_TG_OFFSET_RESET=1                       — reset offset (skip backlog)
  JHT_HOME                                    — dir config (default /jht_home)

Outbound (telegram-send) e' una skill agente che usa jht-telegram-send
direttamente. Questo bridge gestisce solo l'inbound.
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
CONFIG_PATH = JHT_HOME / "jht.config.json"
STATE_PATH = JHT_HOME / "tg-bridge-state.json"
INBOX_DIR = JHT_HOME / "profile" / "inbox"
LOG_PATH = Path("/tmp/tg-bridge.log")

TARGET_SESSION = os.environ.get("JHT_TG_TARGET_SESSION", "ASSISTENTE")
POLL_TIMEOUT_SEC = 30
MAX_DOC_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB hard limit Bot API


# ── Helpers ─────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def read_config() -> tuple[str, int]:
    """Token + chat_id whitelist dal config. Exit se mancanti."""
    try:
        cfg = json.loads(CONFIG_PATH.read_text())
        tg = cfg.get("channels", {}).get("telegram", {})
        token = tg.get("bot_token", "").strip()
        chat_id = tg.get("chat_id", "")
        chat_id = int(chat_id) if str(chat_id).strip() else 0
        if not token or not chat_id:
            log(f"FATAL: token o chat_id mancante in {CONFIG_PATH}")
            sys.exit(2)
        return token, chat_id
    except FileNotFoundError:
        log(f"FATAL: {CONFIG_PATH} non trovato — il wizard non e' completato")
        sys.exit(2)
    except Exception as e:
        log(f"FATAL: errore lettura config: {e}")
        sys.exit(2)


def load_offset() -> int:
    if os.environ.get("JHT_TG_OFFSET_RESET") == "1":
        log("offset reset richiesto via env — skip backlog")
        return -1  # sentinella per "ricalcola dal max attuale al primo poll"
    try:
        return int(json.loads(STATE_PATH.read_text()).get("last_offset", 0))
    except Exception:
        return 0


def save_offset(offset: int) -> None:
    try:
        STATE_PATH.write_text(json.dumps({"last_offset": offset}))
    except Exception as e:
        log(f"warn: save offset failed: {e}")


def tmux_send(text: str) -> None:
    """Wrapper safe: errori loggati ma non fatali."""
    try:
        r = subprocess.run(
            ["/usr/local/bin/jht-tmux-send", TARGET_SESSION, text],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode != 0:
            log(f"jht-tmux-send rc={r.returncode}: {r.stderr.strip()}")
    except Exception as e:
        log(f"jht-tmux-send error: {e}")


def fetch_file(token: str, file_id: str, dest_name: str) -> Path | None:
    """Bot API getFile + download via file_path. Restituisce Path locale o None."""
    try:
        url = f"https://api.telegram.org/bot{token}/getFile?file_id={file_id}"
        meta = json.loads(urllib.request.urlopen(url, timeout=10).read())
        if not meta.get("ok"):
            log(f"getFile failed: {meta}")
            return None
        file_path = meta["result"]["file_path"]
        dl_url = f"https://api.telegram.org/file/bot{token}/{file_path}"
        INBOX_DIR.mkdir(parents=True, exist_ok=True)
        # Anti-clobber: prefisso timestamp se nome gia' presente
        local = INBOX_DIR / dest_name
        if local.exists():
            ts = datetime.now().strftime("%Y%m%d-%H%M%S")
            local = INBOX_DIR / f"{ts}-{dest_name}"
        with urllib.request.urlopen(dl_url, timeout=60) as r, open(local, "wb") as f:
            f.write(r.read())
        # Owner: il container gira come jht (uid 1001); siamo gia' jht quindi
        # il file e' suo. Niente chown necessario.
        return local
    except Exception as e:
        log(f"fetch_file error: {e}")
        return None


# ── Dispatch messaggi ───────────────────────────────────────────────────

def handle_text(msg: dict) -> None:
    text = msg.get("text", "").strip()
    if not text:
        return
    envelope = f"[@utente -> @{TARGET_SESSION.lower()}] [TG] {text}"
    log(f"text len={len(text)} → {TARGET_SESSION}")
    tmux_send(envelope)


def handle_document(token: str, msg: dict) -> None:
    doc = msg["document"]
    size = doc.get("file_size", 0)
    name = doc.get("file_name", f"file-{doc['file_id'][:8]}")
    mime = doc.get("mime_type", "application/octet-stream")
    if size > MAX_DOC_SIZE_BYTES:
        log(f"doc {name} oltre limite ({size}B) — skip")
        tmux_send(
            f"[@system -> @{TARGET_SESSION.lower()}] [TG-DOC-REJECT] "
            f"file '{name}' oltre 20 MB ({size//1024//1024} MB). "
            f"Chiedi all'utente di rimandarlo in formato piu' piccolo."
        )
        return
    local = fetch_file(token, doc["file_id"], name)
    if not local:
        tmux_send(
            f"[@system -> @{TARGET_SESSION.lower()}] [TG-DOC-ERROR] "
            f"download di '{name}' fallito — chiedi all'utente di riprovare."
        )
        return
    envelope = (
        f"[@utente -> @{TARGET_SESSION.lower()}] [TG-DOC] "
        f"path={local} name={name} mime={mime} size={size}"
    )
    log(f"doc {name} → {local} ({size}B)")
    tmux_send(envelope)


def handle_photo(token: str, msg: dict) -> None:
    """Photo array — prendi quella piu' grande."""
    photos = msg.get("photo", [])
    if not photos:
        return
    largest = max(photos, key=lambda p: p.get("file_size", 0))
    name = f"photo-{largest['file_id'][:10]}.jpg"
    local = fetch_file(token, largest["file_id"], name)
    if not local:
        return
    envelope = (
        f"[@utente -> @{TARGET_SESSION.lower()}] [TG-DOC] "
        f"path={local} name={name} mime=image/jpeg size={largest.get('file_size', 0)}"
    )
    log(f"photo → {local}")
    tmux_send(envelope)


def handle_voice(token: str, msg: dict) -> None:
    v = msg["voice"]
    name = f"voice-{v['file_id'][:10]}.ogg"
    local = fetch_file(token, v["file_id"], name)
    if not local:
        return
    envelope = (
        f"[@utente -> @{TARGET_SESSION.lower()}] [TG-DOC] "
        f"path={local} name={name} mime=audio/ogg size={v.get('file_size', 0)} "
        f"duration={v.get('duration', 0)}s"
    )
    log(f"voice → {local}")
    tmux_send(envelope)


# ── Main loop ───────────────────────────────────────────────────────────

def main() -> None:
    token, allowed_chat = read_config()
    offset = load_offset()
    log(f"start: target={TARGET_SESSION} allowed_chat={allowed_chat} offset={offset}")

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
            log(f"reset: skip backlog, partendo da offset={offset}")
            save_offset(offset)
        except Exception as e:
            log(f"reset failed, partiamo da 0: {e}")
            offset = 0

    while True:
        try:
            url = (
                f"https://api.telegram.org/bot{token}/getUpdates"
                f"?offset={offset + 1}&timeout={POLL_TIMEOUT_SEC}"
            )
            r = urllib.request.urlopen(url, timeout=POLL_TIMEOUT_SEC + 5).read()
            d = json.loads(r)
            for u in d.get("result", []):
                uid = u["update_id"]
                if uid > offset:
                    offset = uid
                m = u.get("message") or u.get("edited_message")
                if not m:
                    continue
                chat_id = m.get("chat", {}).get("id")
                if chat_id != allowed_chat:
                    log(f"drop update uid={uid} chat={chat_id} (not whitelisted)")
                    continue
                # Skippa /start: e' solo per attivare la chat col bot,
                # l'Assistente non deve trattarlo come messaggio reale.
                if m.get("text", "").strip() == "/start":
                    log(f"uid={uid} /start ack (no forward)")
                    continue
                if "text" in m:
                    handle_text(m)
                elif "document" in m:
                    handle_document(token, m)
                elif "photo" in m:
                    handle_photo(token, m)
                elif "voice" in m:
                    handle_voice(token, m)
                else:
                    log(f"uid={uid} message kind sconosciuto, skip")
            save_offset(offset)
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
