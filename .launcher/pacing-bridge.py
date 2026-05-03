#!/usr/bin/env python3
"""
pacing-bridge.py — tick orario al Capitano sul ritmo di consumo del team.

Ogni 15 minuti, allineato all'orologio (:00, :15, :30, :45 UTC), calcola:

  - Δusage del team nella finestra (dal sentinel-data.jsonl del bridge)
  - velocità del team in %/h
  - velocità ottimale per atterrare nel target band 90-95% al reset
  - per ogni agente attivo: kT consumati nei 15min, kT che vale 1% in
    questa finestra (ratio = team_kT / Δusage), divisione, %/h risultante
  - verdetto: SFORO (riduci) | MARGINE (puoi accelerare) | ALLINEATO

Tutti i calcoli riusano gli stessi moduli che alimentano la skill
agent-speed-table e la UI: nessuna formula duplicata. Pesi token Kimi
hardcoded (1, 1, 0, 0) ereditati da token-by-agent-series.

Output:
  - stdout (catturato da /tmp/pacing-bridge.log)
  - tmux send al CAPITANO via jht-tmux-send (single-line, parsabile dall'LLM)

Non scrive su sentinel-data.jsonl (non e' un sensore, e' un report).
Singleton: kill processi pacing-bridge preesistenti gestito dallo
spawner in start-agent.sh.

Override env:
  JHT_HOME                 (default /jht_home)
  JHT_PACING_TARGET_PCT    (default 92.0 — centro del band 90-95)
  JHT_PACING_TARGET_SESSION (default CAPITANO)
  JHT_PACING_TICK_MIN      (default 15)
  JHT_PACING_MIN_PCT_H     (default 0.20 — soglia rumore per agente)

Modi:
  python3 pacing-bridge.py            # loop infinito allineato all'orologio
  python3 pacing-bridge.py --once     # un solo tick, stampa, niente send
  python3 pacing-bridge.py --once --send  # un solo tick + send al CAPITANO
"""
import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
LOGS_DIR = JHT_HOME / "logs"
SENTINEL_JSONL = LOGS_DIR / "sentinel-data.jsonl"
PID_FILE = LOGS_DIR / "pacing-bridge.pid"
# Stato pubblico letto dalla UI (/api/team/pacing-bridge). Scritto
# atomicamente a ogni tick + al boot. Stesso pattern del sentinel-bridge.
STATE_FILE = LOGS_DIR / "pacing-bridge-state.json"

# Sotto questo numero di minuti effettivi nella finestra (dopo aver
# isolato l'ultima session_id) il calcolo è troppo rumoroso. Salta tick.
MIN_EFFECTIVE_MIN = 5.0

TARGET_BAND_CENTER = float(os.environ.get("JHT_PACING_TARGET_PCT", "92"))
TARGET_SESSION = os.environ.get("JHT_PACING_TARGET_SESSION", "CAPITANO")
TICK_MIN = int(os.environ.get("JHT_PACING_TICK_MIN", "15"))
MIN_PCT_H = float(os.environ.get("JHT_PACING_MIN_PCT_H", "0.20"))

# Soglia in %/h sotto la quale "ALLINEATO" — evita oscillazioni stupide.
ALIGN_TOL = 0.20


def _path_import(p: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(p))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_helpers():
    """Carica le formule dal monorepo. Funziona sia in container
    (/app/shared/skills) sia su host (<repo>/shared/skills)."""
    here = Path(__file__).resolve().parent
    candidates = [
        Path("/app/shared/skills"),
        here.parent / "shared" / "skills",
    ]
    skills_dir = next((p for p in candidates if p.exists()), None)
    if skills_dir is None:
        raise RuntimeError(
            f"shared/skills non trovata: ho provato {[str(p) for p in candidates]}"
        )
    ast = _path_import(skills_dir / "agent-speed-table.py", "_ast")
    tba = _path_import(skills_dir / "token-by-agent-series.py", "_tba")
    rb = _path_import(skills_dir / "rate_budget.py", "_rb")
    return ast, tba, rb


def next_quarter(now: datetime | None = None) -> datetime:
    """Prossimo multiplo di TICK_MIN dopo `now` (UTC), allineato al minuto 0."""
    now = now or datetime.now(timezone.utc)
    minute_block = (now.minute // TICK_MIN + 1) * TICK_MIN
    if minute_block >= 60:
        return (now + timedelta(hours=1)).replace(
            minute=0, second=0, microsecond=0
        )
    return now.replace(minute=minute_block, second=0, microsecond=0)


def _read_window_samples(since_ts: float, now_ts: float):
    """Ritorna lista di (ts_unix, usage, session_id) ordinata per ts,
    SOLO quella relativa all'ULTIMA session_id presente nella finestra.

    Motivo: il bridge scrive un nuovo sample ad ogni provider tick, ma
    le sessioni Kimi (session_id) si rinnovano ogni 5h al reset → usage
    riparte da 0. Se la finestra di 15 min cattura il bordo di un reset
    (es. samples [usage=46, 0, 0, 2, 3]) calcolare Δusage = u_last - u_first
    dà valori negativi e ratio bagger. Soluzione: isoliamo solo gli
    eventi della sessione più recente vista nella finestra. Ritorna
    [] se file mancante o nessun sample.
    """
    if not SENTINEL_JSONL.exists():
        return []
    samples = []
    try:
        with SENTINEL_JSONL.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts_iso = e.get("ts")
                if not isinstance(ts_iso, str):
                    continue
                try:
                    ts_dt = datetime.fromisoformat(
                        ts_iso.replace("Z", "+00:00")
                    )
                except ValueError:
                    continue
                if ts_dt.tzinfo is None:
                    ts_dt = ts_dt.replace(tzinfo=timezone.utc)
                ts = ts_dt.timestamp()
                if ts < since_ts or ts > now_ts:
                    continue
                u = e.get("usage")
                if not isinstance(u, (int, float)):
                    continue
                samples.append((ts, float(u), e.get("session_id")))
    except OSError:
        return []
    samples.sort(key=lambda r: r[0])
    if not samples:
        return []
    last_session = samples[-1][2]
    if last_session is None:
        # Nessun session_id (jsonl vecchio): usa tutto, accetta il rischio
        # che un reset finisca dentro la finestra una volta ogni 5h.
        return samples
    return [s for s in samples if s[2] == last_session]


def _read_throttle_events(since_ts: float, now_ts: float) -> dict[str, int]:
    """Conta gli eventi `throttle-events.jsonl` per agente nella finestra.

    Conta solo `event in {start, checkpoint}` perché ognuno corrisponde a
    UN checkpoint dell'agente:
      - `checkpoint` = arrivo a fine task con config=0 (heartbeat).
      - `start`      = arrivo a fine task con config>0 (pausa vera che parte).
      - `end`        = chiusura dello `start`, NON un nuovo checkpoint → escluso.

    La cadenza per agente (eventi/min nella finestra effettiva) è il dato
    che permette al Capitano di calibrare la durata in config:
        throttle_effettivo = cadenza_per_min × durata_config_sec / 60
    """
    path = LOGS_DIR / "throttle-events.jsonl"
    if not path.exists():
        return {}
    counts: dict[str, int] = {}
    try:
        with path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if e.get("event") not in ("start", "checkpoint"):
                    continue
                ts = e.get("ts_unix")
                if not isinstance(ts, (int, float)):
                    continue
                if ts < since_ts or ts > now_ts:
                    continue
                agent = e.get("agent")
                if not isinstance(agent, str):
                    continue
                counts[agent] = counts.get(agent, 0) + 1
    except OSError:
        return {}
    return counts


def hours_to_reset(reset_hhmm: str | None, now: datetime) -> float | None:
    """Ore (float) tra `now` e il prossimo reset_hhmm UTC. None se input invalido."""
    if not reset_hhmm:
        return None
    try:
        h, m = map(int, reset_hhmm.split(":"))
    except (ValueError, AttributeError):
        return None
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    return (target - now).total_seconds() / 3600.0


def compute_tick(ast, tba, rb, now: datetime) -> dict:
    """Calcola tutto il payload del tick. Ritorna dict con `ok` true/false.

    La finestra nominale è TICK_MIN minuti, ma se al suo interno cambia
    session_id Kimi (reset 5h) usiamo solo l'ultima session: questo da'
    Δusage monotona ma riduce la finestra effettiva. Se la finestra
    effettiva è < MIN_EFFECTIVE_MIN, saltiamo il tick (dati troppo
    rumorosi appena dopo un reset).
    """
    nominal_since = now - timedelta(minutes=TICK_MIN)
    now_ts = now.timestamp()
    nominal_since_ts = nominal_since.timestamp()

    # 1) Sample del bridge nella finestra, filtrati su ULTIMA session_id.
    window = _read_window_samples(nominal_since_ts, now_ts)
    if len(window) < 2:
        return {
            "ok": False,
            "now": now,
            "error": "insufficient_samples",
            "n_samples_window": len(window),
            "hint": "il bridge non ha pollato abbastanza nella finestra "
                    "(o reset Kimi appena avvenuto)",
        }

    effective_since_ts = window[0][0]
    effective_window_h = (now_ts - effective_since_ts) / 3600.0
    if effective_window_h * 60.0 < MIN_EFFECTIVE_MIN:
        return {
            "ok": False,
            "now": now,
            "error": "effective_window_too_short",
            "effective_min": effective_window_h * 60.0,
            "min_required": MIN_EFFECTIVE_MIN,
            "hint": "reset Kimi recente: aspetta il prossimo tick",
        }

    u_first = window[0][1]
    u_last = window[-1][1]
    n_samples = len(window)
    delta_usage = u_last - u_first

    # 2) Token per agente nella finestra EFFETTIVA (a partire da
    #    effective_since_ts, non nominal). Pesi rate-Kimi 1,1,0,0.
    by_agent = tba.collect_events(effective_since_ts)
    agent_kt = {}
    for name, evs in by_agent.items():
        kt = sum(
            w for ts, w in evs if effective_since_ts <= ts <= now_ts
        ) / 1000.0
        if kt > 0:
            agent_kt[name] = kt
    team_kt = sum(agent_kt.values())

    if delta_usage <= 0 or team_kt <= 0:
        return {
            "ok": False,
            "now": now,
            "error": "non_positive_delta",
            "delta_usage": delta_usage,
            "team_kt": team_kt,
            "u_first": u_first,
            "u_last": u_last,
            "hint": "ratio non calcolabile — il team non ha bruciato "
                    "budget misurabile, oppure usage piatto",
        }

    ratio = team_kt / delta_usage              # kT per 1% di budget
    vel_team = delta_usage / effective_window_h  # %/h sulla finestra effettiva

    # 3) Sample fresco del bridge (proj/usage_now/reset_at).
    sample = rb.load_last_sample() or {}
    usage_now = sample.get("usage", u_last)
    proj = sample.get("projection")
    reset_at = sample.get("reset_at")
    h_to_reset = hours_to_reset(reset_at, now)

    # 4) vel_target: (target_band - usage_now) / hours_to_reset.
    #    Se reset_at o usage mancano, vel_target = None (verdetto N/D).
    if (
        h_to_reset is not None
        and h_to_reset > 0
        and isinstance(usage_now, (int, float))
    ):
        vel_target = max(0.0, (TARGET_BAND_CENTER - usage_now) / h_to_reset)
    else:
        vel_target = None

    # 5) Per ogni agente: kT, kT/h, %/h, share, cadenza checkpoint/min.
    #    Filtra rumore < MIN_PCT_H.
    checkpoint_counts = _read_throttle_events(effective_since_ts, now_ts)
    eff_min = effective_window_h * 60.0
    agents = []
    skipped = []
    for name, kt in sorted(agent_kt.items(), key=lambda kv: -kv[1]):
        kt_per_h = kt / effective_window_h
        pct_per_h = kt_per_h / ratio
        if pct_per_h < MIN_PCT_H:
            skipped.append({"name": name, "pct_per_h": pct_per_h})
            continue
        share = (pct_per_h / vel_team) * 100.0 if vel_team > 0 else 0.0
        events = checkpoint_counts.get(name, 0)
        cadence_per_min = events / eff_min if eff_min > 0 else 0.0
        agents.append(
            {
                "name": name,
                "kt": kt,
                "kt_per_h": kt_per_h,
                "pct_per_h": pct_per_h,
                "share": share,
                "events": events,
                "cadence_per_min": cadence_per_min,
            }
        )

    # 6) Verdetto.
    if vel_target is None:
        verdict = {"kind": "ND", "delta": None, "frac_pct": None}
    else:
        delta_abs = vel_team - vel_target
        if delta_abs > ALIGN_TOL:
            frac_cut = (delta_abs / vel_team) * 100.0 if vel_team > 0 else 0.0
            verdict = {"kind": "SFORO", "delta": delta_abs, "frac_pct": frac_cut}
        elif delta_abs < -ALIGN_TOL:
            frac_grow = (
                (-delta_abs) / vel_team * 100.0 if vel_team > 0 else 0.0
            )
            verdict = {
                "kind": "MARGINE",
                "delta": -delta_abs,
                "frac_pct": frac_grow,
            }
        else:
            verdict = {"kind": "ALLINEATO", "delta": delta_abs, "frac_pct": 0.0}

    return {
        "ok": True,
        "now": now,
        "window_min": TICK_MIN,
        "effective_window_min": effective_window_h * 60.0,
        "n_samples": n_samples,
        "u_first": u_first,
        "u_last": u_last,
        "delta_usage": delta_usage,
        "team_kt": team_kt,
        "ratio": ratio,
        "vel_team": vel_team,
        "vel_target": vel_target,
        "target_band_center": TARGET_BAND_CENTER,
        "usage_now": usage_now,
        "proj": proj,
        "reset_at": reset_at,
        "h_to_reset": h_to_reset,
        "agents": agents,
        "skipped": skipped,
        "verdict": verdict,
    }


def format_message(d: dict) -> str:
    """Costruisce la riga unica da inviare al Capitano. Single-line per non
    rompere l'Enter delle TUI Ink (Kimi/Claude/Codex), parsabile dall'LLM."""
    if not d.get("ok"):
        why = d.get("error", "unknown")
        extra = ""
        if "delta_usage" in d:
            extra = f" delta_usage={d['delta_usage']} team_kt={d.get('team_kt', '?')}"
        return f"[BRIDGE PACING] tick saltato reason={why}{extra}."

    ts = d["now"].strftime("%H:%M UTC")
    usage_now = d["usage_now"]
    proj = d["proj"] if d["proj"] is not None else "?"
    reset_at = d["reset_at"] or "?"
    h_to_reset = d["h_to_reset"]
    h_str = f"{h_to_reset:.2f}h" if isinstance(h_to_reset, (int, float)) else "?"

    eff = d["effective_window_min"]
    eff_str = (
        f"{d['window_min']}m"
        if abs(eff - d["window_min"]) < 0.5
        else f"{d['window_min']}m (effettivi {eff:.1f}m, post-reset session)"
    )
    parts = [
        f"[BRIDGE PACING] {ts} window={eff_str} samples={d['n_samples']}",
        f"usage={usage_now}% proj={proj}% reset_in={h_str} reset_at={reset_at}UTC",
        f"vel_team={d['vel_team']:.2f}%/h",
    ]

    if d["vel_target"] is not None:
        parts.append(
            f"vel_target={d['vel_target']:.2f}%/h "
            f"(per chiudere a {d['target_band_center']:.0f}% al reset)"
        )
    else:
        parts.append("vel_target=N/D")

    parts.append(
        f"ratio={d['ratio']:.1f}kT/% "
        f"(team {d['team_kt']:.2f}kT / Δusage {d['delta_usage']:.2f}%)"
    )

    if d["agents"]:
        # Usa il minuti effettivi (= finestra di calcolo reale) nel
        # dettaglio per agente, così il Capitano vede la divisione esatta.
        eff_min_str = f"{int(round(eff))}m"
        agent_strs = []
        for a in d["agents"]:
            cad = a.get("cadence_per_min", 0.0)
            agent_strs.append(
                f"{a['name']}={a['pct_per_h']:.2f}%/h "
                f"[{a['kt']:.2f}kT/{eff_min_str} → {a['kt_per_h']:.1f}kT/h "
                f"÷ {d['ratio']:.1f}kT/% = {a['pct_per_h']:.2f}%/h, "
                f"share {a['share']:.0f}%, "
                f"cadenza {cad:.2f}/min ({a.get('events', 0)} chk in {eff_min_str})]"
            )
        parts.append("agenti: " + " ; ".join(agent_strs))
    else:
        parts.append("agenti: nessuno sopra soglia "
                     f"({MIN_PCT_H}%/h)")

    if d["skipped"]:
        skipped_names = ", ".join(s["name"] for s in d["skipped"])
        parts.append(f"sotto_soglia: {skipped_names}")

    v = d["verdict"]
    if v["kind"] == "SFORO":
        parts.append(
            f"VERDETTO: SFORO +{v['delta']:.2f}%/h sopra target → "
            f"riduci la velocità del team del {v['frac_pct']:.0f}% "
            f"applicando pause agli agenti più veloci."
        )
    elif v["kind"] == "MARGINE":
        parts.append(
            f"VERDETTO: MARGINE −{v['delta']:.2f}%/h sotto target → "
            f"puoi accelerare il team del {v['frac_pct']:.0f}% "
            f"(rimuovi throttle / spawna)."
        )
    elif v["kind"] == "ALLINEATO":
        parts.append(
            f"VERDETTO: ALLINEATO (Δ {v['delta']:+.2f}%/h, tolleranza ±{ALIGN_TOL}). "
            f"Mantieni il ritmo."
        )
    else:
        parts.append(
            "VERDETTO: N/D — manca reset_at o usage_now nel sample del bridge."
        )

    return " | ".join(parts)


_JHT_TMUX_SEND_FALLBACKS = [
    "/app/agents/_tools/jht-tmux-send",
    str(Path(__file__).resolve().parent.parent / "agents" / "_tools" / "jht-tmux-send"),
]


def _resolve_tmux_send() -> str | None:
    """Prima prova `jht-tmux-send` nel PATH, poi i path canonici. Restituisce
    il primo eseguibile esistente, o None. Senza questo lo spawn detached
    perdeva il PATH ereditato dal container e il send falliva silenziosamente."""
    for cand in ["jht-tmux-send", *_JHT_TMUX_SEND_FALLBACKS]:
        if "/" in cand:
            if Path(cand).is_file() and os.access(cand, os.X_OK):
                return cand
        else:
            # solo nome → cerca nel PATH
            for p in os.environ.get("PATH", "").split(os.pathsep):
                full = os.path.join(p, cand)
                if Path(full).is_file() and os.access(full, os.X_OK):
                    return full
    return None


def send_to_capitano(msg: str) -> bool:
    cmd_path = _resolve_tmux_send()
    if cmd_path is None:
        print(
            "[pacing-bridge] jht-tmux-send non trovato in PATH né nei fallback "
            f"({_JHT_TMUX_SEND_FALLBACKS}), skip send",
            file=sys.stderr,
        )
        return False
    try:
        r = subprocess.run(
            [cmd_path, TARGET_SESSION, msg],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except FileNotFoundError:
        print(f"[pacing-bridge] {cmd_path} sparito tra resolve e exec",
              file=sys.stderr)
        return False
    except subprocess.TimeoutExpired:
        print("[pacing-bridge] jht-tmux-send timeout dopo 30s", file=sys.stderr)
        return False
    if r.returncode != 0:
        print(
            f"[pacing-bridge] jht-tmux-send rc={r.returncode} "
            f"stderr={r.stderr.strip()}",
            file=sys.stderr,
        )
        return False
    return True


def write_pid():
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        PID_FILE.write_text(str(os.getpid()))
    except OSError as e:
        print(f"[pacing-bridge] WARN write pid: {e}", file=sys.stderr)


def _serialize_report(d: dict) -> dict | None:
    """Trasforma il dict di compute_tick in un payload JSON-safe per la UI.
    Drop dei datetime e arrotondamento dei numeri per leggibilità nel popover."""
    if not d.get("ok"):
        return {
            "ok": False,
            "error": d.get("error"),
            "hint": d.get("hint"),
            "ts": d["now"].isoformat() if isinstance(d.get("now"), datetime) else None,
        }
    agents = [
        {
            "name": a["name"],
            "kt": round(a["kt"], 2),
            "kt_per_h": round(a["kt_per_h"], 1),
            "pct_per_h": round(a["pct_per_h"], 2),
            "share": round(a["share"], 1),
            "events": a.get("events", 0),
            "cadence_per_min": round(a.get("cadence_per_min", 0.0), 3),
        }
        for a in d["agents"]
    ]
    skipped = [s["name"] for s in d.get("skipped", [])]
    v = d["verdict"]
    verdict = {
        "kind": v["kind"],
        "delta": round(v["delta"], 2) if isinstance(v.get("delta"), (int, float)) else None,
        "frac_pct": round(v["frac_pct"], 1) if isinstance(v.get("frac_pct"), (int, float)) else None,
    }
    return {
        "ok": True,
        "ts": d["now"].isoformat(),
        "window_min": d["window_min"],
        "effective_window_min": round(d["effective_window_min"], 1),
        "n_samples": d["n_samples"],
        "usage_now": d["usage_now"],
        "proj": d["proj"],
        "reset_at": d["reset_at"],
        "h_to_reset": round(d["h_to_reset"], 2) if d["h_to_reset"] else None,
        "delta_usage": round(d["delta_usage"], 2),
        "team_kt": round(d["team_kt"], 2),
        "ratio_kt_per_pct": round(d["ratio"], 1),
        "vel_team": round(d["vel_team"], 2),
        "vel_target": round(d["vel_target"], 2) if d["vel_target"] else None,
        "target_band_center": d["target_band_center"],
        "agents": agents,
        "skipped": skipped,
        "verdict": verdict,
    }


def write_state(d: dict | None, next_tick_at: datetime, last_message: str | None):
    """Scrive lo stato pubblico letto dall'API web. Atomico (tmp + rename)."""
    state = {
        "version": 1,
        "pid": os.getpid(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "next_tick_at": next_tick_at.isoformat(),
        "tick_interval_min": TICK_MIN,
        "target_band_center": TARGET_BAND_CENTER,
        "target_session": TARGET_SESSION,
        "last_tick_at": (
            d["now"].isoformat() if d and isinstance(d.get("now"), datetime) else None
        ),
        "last_report": _serialize_report(d) if d else None,
        "last_message": last_message,
    }
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        tmp = STATE_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, default=str))
        os.replace(tmp, STATE_FILE)
    except OSError as e:
        print(f"[pacing-bridge] WARN write state: {e}", file=sys.stderr)


def loop():
    ast, tba, rb = _load_helpers()
    write_pid()
    print(
        f"[pacing-bridge] up — target={TARGET_SESSION} tick={TICK_MIN}m "
        f"target_band_center={TARGET_BAND_CENTER}% min_pct_h={MIN_PCT_H} "
        f"jht_home={JHT_HOME}",
        flush=True,
    )
    # Stato iniziale al boot: la UI vede subito il countdown, anche prima
    # del primo tick reale.
    write_state(None, next_quarter(), None)

    while True:
        nxt = next_quarter()
        sleep_s = (nxt - datetime.now(timezone.utc)).total_seconds()
        if sleep_s > 0:
            time.sleep(sleep_s)

        now = datetime.now(timezone.utc)
        try:
            d = compute_tick(ast, tba, rb, now)
            msg = format_message(d)
            print(msg, flush=True)
            send_to_capitano(msg)
            # Aggiorna lo stato DOPO il send: la UI vede il tick appena
            # consegnato e il prossimo countdown già aggiornato.
            write_state(d, next_quarter(now + timedelta(seconds=1)), msg)
        except Exception as e:
            # Non vogliamo che un errore di un tick affossi il loop.
            print(f"[pacing-bridge] errore tick {now.isoformat()}: {e}",
                  file=sys.stderr, flush=True)
            try:
                write_state(None, next_quarter(now + timedelta(seconds=1)),
                            f"errore: {e}")
            except Exception:
                pass


def once(do_send: bool):
    ast, tba, rb = _load_helpers()
    d = compute_tick(ast, tba, rb, datetime.now(timezone.utc))
    msg = format_message(d)
    print(msg)
    if do_send:
        send_to_capitano(msg)


def main():
    args = sys.argv[1:]
    if "--once" in args:
        once(do_send="--send" in args)
        return
    loop()


if __name__ == "__main__":
    main()
