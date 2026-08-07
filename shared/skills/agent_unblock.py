#!/usr/bin/env python3
"""agent_unblock.py — rilevare e SCIOGLIERE i blocchi del team (fase di sblocco
del Dottore).

Origine: incidente 2026-07-28/29. Con weekly al 19% (sotto-pace) e load 0,12 il
team e' rimasto fermo **undici ore**. Nel pane del Capitano c'era una riga
digitata e mai inviata: quel pane non era ricettivo, `jht-tmux-send` lo vedeva
occupato, i messaggi fallivano, nessuno assegnava lavoro e tutti finivano il
turno al prompt vuoto. Uno Scorer era in retry-loop da ore ("decimo tentativo,
occupato"). Il Dottore ha visto tutto, l'ha scritto nel suo log, ed e' rimasto in
standby: il team e' rimasto fermo altre sei ore.

Il problema non era la diagnosi, era il mandato. Questo modulo e' la META'
DETERMINISTICA della cura: rilevare i blocchi con dati oggettivi e agire dove
l'azione e' meccanica, lasciando all'LLM solo il testo dei messaggi.

## I due stati che si somigliano e vogliono cure opposte

| stato            | sintomo                                            | cura              |
|------------------|----------------------------------------------------|-------------------|
| testo pendente   | `Enter` da solo ignorato, `Space` **poi** `Enter` no | sblocco via input |
| TUI congelata    | non accetta nulla                                   | kill + recreate   |

Un `Enter` "a freddo" non viene processato dalle TUI Ink (Codex, Kimi, Claude
Code) — e' lo stesso motivo documentato in testa a `jht-tmux-send`. Chi tenta
solo `Enter` **fallisce in silenzio** e conclude che il pane e' irrecuperabile.
La sonda qui manda `Space` e POI `Enter`, una volta sola: se il pane cambia, era
testo pendente ed e' sbloccato; se non cambia nulla, e' TUI congelata → recreate.

## Il vincolo non negoziabile: il testo dell'utente non si tocca

Il Dottore non puo' sapere se una riga digitata dall'utente e' completa o voluta.
Quindi non la invia e non la cancella — mai, nemmeno "per un attimo". La sonda
`Space+Enter` **submitta** il contenuto del composer, quindi si applica SOLO
quando il contenuto e' attribuibile a un agente (una busta `[@x -> @y] ...`
rimasta appesa: era gia' destinata a partire). Su testo non attribuibile
`probe` rifiuta e il chiamante deve aggirare il blocco:

  1. `relay` — consegna al coordinatore SENZA toccare il pane, appendendo alla
     mailbox che il Capitano drena in testa a ogni turno (`bridge-mailbox`) e a
     `messages.jsonl` (tracciabilita');
  2. l'Assistente — il ruolo che parla con l'utente — riceve la domanda perche'
     la giri all'utente sul canale in-app;
  3. i worker ripartono lo stesso (kick-off diretto), senza attendere il
     coordinatore.

Il testo dell'utente resta nel pane, intatto, e viene comunque messo al sicuro in
`logs/pending-input.jsonl` (se piu' tardi il TTL ricrea la sessione, la riga non
va persa: e' l'unica difesa sistematica contro la TUI congelata).

CLI::

    python3 agent_unblock.py scan                      # JSON: blocchi rilevati
    python3 agent_unblock.py classify SCOUT-1          # stato di un pane
    python3 agent_unblock.py probe CAPITANO            # Space+Enter (una volta)
    python3 agent_unblock.py relay CAPITANO "<msg>"    # consegna senza pane
    python3 agent_unblock.py record-round --round-id R --found 3 --cleared 3
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Sessioni da non toccare mai: se stesso, lo scheduler, le sessioni non-agente.
NEVER_TOUCH = {"DOTTORE", "DOCTOR-WATCHDOG", "MANTENITORE"}
COORDINATORS = ("CAPITANO", "ASSISTENTE", "MENTOR", "SENTINELLA")
OPERATIVE_PREFIXES = ("SCOUT", "ANALISTA", "SCORER", "SCRITTORE", "CRITICO")

# Riga del composer nelle TUI Ink: `> testo`, `│ > testo │`, `▌ testo` (codex).
_COMPOSER_RE = re.compile(r"^\s*[│┃╎|]?\s*[>▌❯]\s?(.*?)\s*[│┃╎|]?\s*$")
# Placeholder renderizzati a composer VUOTO (non sono testo dell'utente).
_PLACEHOLDER_RE = re.compile(
    r"^(try\s|ask\s|type\s|write\s|send\s|scrivi\s|\?\s*for\s|/\s*for\s)", re.I)
# Busta agente→agente e prefissi di sistema: testo che ERA destinato a partire.
_AGENT_ENVELOPE_RE = re.compile(r"^\s*\[@[A-Za-z0-9_-]+\s*->\s*@[A-Za-z0-9_-]+\]")
_SYSTEM_PREFIX_RE = re.compile(r"^\s*\[(BRIDGE|SENTINELLA|WATCHDOG|DOTTORE|RESUME|RETRO|HEALTH)\b")
_BUSY_RE = re.compile(r"esc to interrupt|to interrupt|\bworking\b\s*[….]", re.I)
_SHELL_PROMPT_RE = re.compile(r"[\$#]\s*$")


def jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse_iso(s):
    if not s:
        return None
    try:
        t = str(s).replace("Z", "+00:00")
        dt = datetime.fromisoformat(t)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


# ── classificazione del pane (funzioni PURE, testabili senza tmux) ───────────

def extract_draft(pane_text: str, tail_lines: int = 14) -> str:
    """Contenuto del composer, o "" se vuoto.

    Si guardano solo le ultime righe: piu' su ci sono i turni gia' inviati, che
    nelle TUI iniziano anch'essi con `>` e darebbero un falso positivo.
    """
    lines = [ln.rstrip() for ln in (pane_text or "").splitlines()]
    for line in reversed(lines[-tail_lines:] if tail_lines else lines):
        m = _COMPOSER_RE.match(line)
        if not m:
            continue
        draft = m.group(1).strip()
        if not draft or _PLACEHOLDER_RE.match(draft):
            return ""
        return draft
    return ""


def classify_draft(draft: str) -> str:
    """`empty` · `agent` (busta gia' destinata a partire) · `user` (mai toccare).

    Conservativa per costruzione: tutto cio' che non e' riconoscibile come busta
    di un agente e' trattato come testo dell'utente.
    """
    if not (draft or "").strip():
        return "empty"
    if _AGENT_ENVELOPE_RE.match(draft) or _SYSTEM_PREFIX_RE.match(draft):
        return "agent"
    return "user"


def classify_pane(pane_text: str) -> dict:
    """Stato di un pane: `busy` · `shell` · `draft_agent` · `draft_user` · `idle`."""
    text = pane_text or ""
    tail = "\n".join(text.splitlines()[-14:])
    if _BUSY_RE.search(tail):
        # Turno in corso: VIVO e occupato. Non e' un blocco (lezione overspawn
        # 2026-06-07: busy != morto).
        return {"state": "busy", "draft": "", "owner": "empty"}
    draft = extract_draft(text)
    owner = classify_draft(draft)
    if owner == "agent":
        return {"state": "draft_agent", "draft": draft, "owner": owner}
    if owner == "user":
        return {"state": "draft_user", "draft": draft, "owner": owner}
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if lines and _SHELL_PROMPT_RE.search(lines[-1]) and not _COMPOSER_RE.match(lines[-1]):
        return {"state": "shell", "draft": "", "owner": "empty"}
    return {"state": "idle", "draft": "", "owner": "empty"}


def detect_retry_loops(entries, now=None, window_min: int = 90,
                       min_attempts: int = 3) -> list:
    """Mittenti che ritentano verso un destinatario MUTO.

    `messages.jsonl` registra il TENTATIVO (jht-tmux-send logga prima di
    digitare), quindi N righe `from=scorer-5 to=capitano` senza nessuna riga
    `from=capitano to=scorer-5` nella finestra = retry-loop. E' il segnale
    oggettivo che separa "in pausa perche' non c'e' lavoro" da "fermo perche' il
    coordinamento e' rotto": **se un agente sta ritentando di contattare il
    Capitano senza risposta, non e' parcheggiato, e' bloccato.**
    """
    now = now or _now()
    cutoff = now - timedelta(minutes=window_min)
    attempts, replies = {}, set()
    for d in entries or []:
        if not isinstance(d, dict):
            continue
        ts = _parse_iso(d.get("ts"))
        if ts is None or ts < cutoff:
            continue
        frm = (d.get("from") or "").strip().lower()
        to = (d.get("to") or "").strip().lower()
        if not frm or not to:
            continue
        attempts[(frm, to)] = attempts.get((frm, to), 0) + 1
        replies.add((frm, to))
    out = []
    for (frm, to), n in sorted(attempts.items()):
        if n < min_attempts:
            continue
        if (to, frm) in replies:
            continue          # ha risposto: non e' un loop
        out.append({"from": frm, "to": to, "attempts": n, "window_min": window_min})
    return out


def read_messages(path: Path | None = None, tail_bytes: int = 2_000_000) -> list:
    p = path or (jht_home() / "logs" / "messages.jsonl")
    out = []
    try:
        with open(p, "rb") as f:
            try:
                size = os.fstat(f.fileno()).st_size
                if size > tail_bytes:
                    f.seek(size - tail_bytes)
                    f.readline()
            except OSError:
                pass
            for raw in f:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        pass
    return out


# ── tmux ─────────────────────────────────────────────────────────────────────

def _tmux(*args, timeout: int = 10):
    try:
        return subprocess.run(["tmux", *args], capture_output=True, text=True,
                              timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None


def agent_sessions() -> list:
    r = _tmux("list-sessions", "-F", "#{session_name}")
    if not r or r.returncode != 0:
        return []
    out = []
    for ln in r.stdout.splitlines():
        s = ln.strip()
        if not s or s in NEVER_TOUCH or s.startswith("DOTTORE"):
            continue
        if s in COORDINATORS or any(s == p or s.startswith(p + "-") for p in OPERATIVE_PREFIXES):
            out.append(s)
    return out


def capture(session: str) -> str:
    r = _tmux("capture-pane", "-p", "-t", session)
    return r.stdout if r and r.returncode == 0 else ""


def save_pending_input(session: str, draft: str) -> None:
    """Mette al sicuro il testo dell'utente PRIMA di qualunque altra cosa.

    Non lo cancella e non lo invia: lo copia. Se piu' tardi il TTL ricrea la
    sessione (l'unica cura per una TUI congelata) la riga non e' persa e
    l'Assistente puo' restituirla all'utente.
    """
    try:
        d = jht_home() / "logs"
        d.mkdir(parents=True, exist_ok=True)
        with (d / "pending-input.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": _iso(_now()), "session": session,
                                "draft": draft[:4096]}, ensure_ascii=False) + "\n")
    except OSError as e:
        print(f"[agent_unblock] WARN pending-input: {e}", file=sys.stderr)


def probe(session: str, settle_sec: float = 2.5) -> dict:
    """UNA sonda `Space`+`Enter`. Verdetto: `unblocked` | `frozen` | `refused`.

    Rifiuta (senza inviare nulla) se il composer contiene testo non attribuibile
    a un agente: quello e' testo dell'utente e submittarlo sarebbe esattamente
    la cosa che il Dottore non deve fare.
    """
    before = capture(session)
    st = classify_pane(before)
    if st["state"] == "draft_user":
        save_pending_input(session, st["draft"])
        return {"session": session, "verdict": "refused", "reason": "user-text",
                "draft": st["draft"], "state": st["state"]}
    if st["state"] == "busy":
        return {"session": session, "verdict": "busy", "reason": "turn-in-progress",
                "draft": "", "state": st["state"]}

    # `Space` PRIMA di `Enter`: un Enter "a freddo" non viene processato dalla
    # TUI Ink. Una volta sola — se non basta, lo stato e' TUI congelata.
    _tmux("send-keys", "-t", session, "Space")
    time.sleep(0.3)
    _tmux("send-keys", "-t", session, "Enter")
    time.sleep(settle_sec)
    after = capture(session)
    st_after = classify_pane(after)

    # Il verdetto NON e' "il pane e' cambiato": lo Space da solo cambia il pane
    # senza che il messaggio parta, e leggerlo come sblocco sarebbe il falso
    # positivo peggiore (si dichiara sbloccato un pane ancora ostaggio).
    # Due prove positive: la TUI ha iniziato un turno, oppure il composer si e'
    # svuotato del testo che c'era.
    if st_after["state"] == "busy":
        verdict, reason = "unblocked", "turn-started"
    elif st["draft"] and st_after.get("draft", "").strip() != st["draft"].strip():
        verdict, reason = "unblocked", "composer-emptied"
    elif not st["draft"] and after.strip() != before.strip():
        verdict, reason = "unblocked", "pane-reacted"
    else:
        verdict, reason = "frozen", "no-reaction-to-space-enter"
    return {"session": session, "verdict": verdict, "reason": reason,
            "draft": st["draft"], "state": st["state"]}


# ── consegna che NON tocca il pane ───────────────────────────────────────────

def relay(session: str, message: str, kind: str = "UNBLOCK",
          home: Path | None = None) -> dict:
    """Consegna un messaggio a un coordinatore senza digitare nel suo pane.

    Due destinazioni, entrambe durature:
      • `logs/bridge-mailbox.jsonl` — il Capitano la drena in testa a OGNI turno
        (skill `bridge-mailbox`), quindi il messaggio lo raggiunge appena riparte;
      • `logs/messages.jsonl` — stessa riga JSONL che scrive `jht-tmux-send`, cosi'
        il messaggio compare nell'audit trail e nella UI come tutti gli altri.

    Serve quando il pane e' ostaggio di testo dell'utente: non si puo' digitare
    (concatenerebbe) e non si puo' submittare (invierebbe la riga dell'utente).
    """
    h = home or jht_home()
    logs = h / "logs"
    ts = _iso(_now())
    to = session.strip().lower()
    ok_mailbox = ok_messages = False
    try:
        logs.mkdir(parents=True, exist_ok=True)
        with (logs / "bridge-mailbox.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": ts, "kind": kind, "msg": message,
                                "delivered_via_tmux": False,
                                "src": "dottore/agent-unblock"},
                               ensure_ascii=False) + "\n")
        ok_mailbox = True
    except OSError as e:
        print(f"[agent_unblock] WARN mailbox: {e}", file=sys.stderr)
    try:
        logs.mkdir(parents=True, exist_ok=True)
        with (logs / "messages.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": ts, "session": session.strip().upper(),
                                "from": "dottore", "to": to, "type": kind,
                                "preview": message[:80], "body": message[:4096],
                                "via": "mailbox"}, ensure_ascii=False) + "\n")
        ok_messages = True
    except OSError as e:
        print(f"[agent_unblock] WARN messages: {e}", file=sys.stderr)
    return {"session": session, "mailbox": ok_mailbox, "messages": ok_messages}


# ── log del giro ─────────────────────────────────────────────────────────────

def round_event(found: int, cleared: int) -> str:
    """Un giro che lascia vivo un blocco e' un giro FALLITO, non completo."""
    return "round_complete" if int(cleared) >= int(found) else "round_failed"


def record_round(round_id: str, found: int, cleared: int, duration_sec=None,
                 extra: dict | None = None, home: Path | None = None) -> dict:
    h = home or jht_home()
    entry = {
        "ts": _iso(_now()),
        "round_id": round_id,
        "event": round_event(found, cleared),
        "blocks_found": int(found),
        "blocks_cleared": int(cleared),
        "blocks_open": max(0, int(found) - int(cleared)),
    }
    if duration_sec is not None:
        entry["duration_sec"] = duration_sec
    if extra:
        entry.update(extra)
    try:
        d = h / "logs"
        d.mkdir(parents=True, exist_ok=True)
        with (d / "dottore-actions.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as e:
        print(f"[agent_unblock] WARN dottore-actions: {e}", file=sys.stderr)
    return entry


# ── scan ─────────────────────────────────────────────────────────────────────

def build_scan(pane_states: dict, messages: list, now=None,
               mute_after_min: int = 45) -> dict:
    """Funzione PURA: dai pane + messages.jsonl, l'elenco dei blocchi.

    `pane_states` = {SESSION: classify_pane(...)}.
    """
    now = now or _now()
    blocks = []

    for sess, st in sorted(pane_states.items()):
        if st.get("state") == "draft_user" and sess in COORDINATORS:
            blocks.append({
                "kind": "pending_user_input", "session": sess,
                "draft": st.get("draft", ""),
                "cure": "relay to the coordinator + ask the Assistant; DO NOT alter the text",
            })
        elif st.get("state") == "draft_agent":
            blocks.append({
                "kind": "pending_agent_input", "session": sess,
                "draft": st.get("draft", ""),
                "cure": "probe Space+Enter once; if frozen, recreate the session",
            })
        elif st.get("state") == "shell":
            blocks.append({"kind": "bare_shell", "session": sess, "draft": "",
                           "cure": "kill + start-agent.sh <role> <SAME-N> + kick-off"})

    for loop in detect_retry_loops(messages, now=now):
        blocks.append({
            "kind": "retry_loop", "session": loop["from"].upper(),
            "target": loop["to"].upper(), "attempts": loop["attempts"],
            "cure": "unblock the recipient; if that is not possible, reassign "
                    "or instruct the sender to proceed",
        })

    operatives = [s for s in pane_states
                  if any(s == p or s.startswith(p + "-") for p in OPERATIVE_PREFIXES)]
    idle_ops = [s for s in operatives if pane_states[s].get("state") == "idle"]
    if operatives and len(idle_ops) == len(operatives):
        blocks.append({
            "kind": "all_operatives_idle", "session": ",".join(sorted(idle_ops)),
            "cure": "kick off operational roles WITHOUT waiting for the coordinator",
        })

    last_captain = None
    for d in messages or []:
        if not isinstance(d, dict):
            continue
        if (d.get("from") or "").lower() != "capitano":
            continue
        ts = _parse_iso(d.get("ts"))
        if ts and (last_captain is None or ts > last_captain):
            last_captain = ts
    if last_captain is None or (now - last_captain) > timedelta(minutes=mute_after_min):
        if "CAPITANO" in pane_states:
            blocks.append({
                "kind": "mute_coordinator", "session": "CAPITANO",
                "silent_min": None if last_captain is None
                else int((now - last_captain).total_seconds() // 60),
                "cure": "escalate to the Assistant + resume workers autonomously",
            })

    return {"ts": _iso(now), "blocks_found": len(blocks), "blocks": blocks,
            "pane_states": {k: v.get("state") for k, v in pane_states.items()}}


def scan() -> dict:
    states = {}
    for s in agent_sessions():
        states[s] = classify_pane(capture(s))
    return build_scan(states, read_messages())


# ── CLI ──────────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Detect and clear team blockages")
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("scan", help="detected blockages (JSON)")
    pc = sub.add_parser("classify", help="state of a session pane")
    pc.add_argument("session")
    pp = sub.add_parser("probe", help="ONE Space+Enter probe")
    pp.add_argument("session")
    prl = sub.add_parser("relay", help="deliver without touching the pane")
    prl.add_argument("session")
    prl.add_argument("message")
    prl.add_argument("--kind", default="UNBLOCK")
    prr = sub.add_parser("record-round", help="close the round in the Doctor log")
    prr.add_argument("--round-id", required=True)
    prr.add_argument("--found", type=int, required=True)
    prr.add_argument("--cleared", type=int, required=True)
    prr.add_argument("--duration-sec", type=int, default=None)

    args = p.parse_args(argv)
    if args.cmd == "scan":
        print(json.dumps(scan(), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "classify":
        print(json.dumps(classify_pane(capture(args.session)), ensure_ascii=False))
        return 0
    if args.cmd == "probe":
        out = probe(args.session)
        print(json.dumps(out, ensure_ascii=False))
        return {"unblocked": 0, "frozen": 2, "refused": 3, "busy": 4}.get(out["verdict"], 1)
    if args.cmd == "relay":
        print(json.dumps(relay(args.session, args.message, args.kind), ensure_ascii=False))
        return 0
    if args.cmd == "record-round":
        out = record_round(args.round_id, args.found, args.cleared, args.duration_sec)
        print(json.dumps(out, ensure_ascii=False))
        return 0 if out["event"] == "round_complete" else 1
    p.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
