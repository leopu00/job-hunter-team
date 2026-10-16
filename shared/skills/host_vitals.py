#!/usr/bin/env python3
"""host_vitals.py — campionamento RAM/CPU/disco del container + summary.

Una SOLA fonte di verità per i vitals di sistema, usata da due consumatori:

  - **sentinel-bridge.py** (a ogni tick, ~2-10 min): `append_sample()` scrive un
    record su `vitals.jsonl` — un FILE DEDICATO, NON il tick della Sentinella (la
    Sentinella NON viene avvisata del consumo PC nel suo flusso decisionale di
    quota). Il bridge usa `over_threshold()` per mandare un `[VITALS ALERT]` alla
    Sentinella **solo** se RAM o CPU superano la soglia (default 95%).
  - **Mantenitore** (1×/giorno): `summary` (CLI) per leggere picchi/trend delle
    ultime 24h e metterli IN CROCE con la diagnosi infra.

Letture (Linux): RAM da **cgroup v2** (`memory.current`/`memory.max` = uso reale
del container vs limite) con fallback `/proc/meminfo`; CPU da delta `/proc/stat`
(% sull'intervallo di campionamento) + `/proc/loadavg` come contesto. Zero LLM,
zero dipendenze esterne. Degrada a campi `None` fuori da Linux.

Disco: spazio libero (e percentuale) del volume di JHT_HOME e di quello del
motore container, letti con `os.statvfs`. Un volume che non si risolve vale
«sconosciuto» (livello `unknown`), mai un errore: la misura non deve fermare né
il bridge né un avvio. Due soglie sullo spazio LIBERO, uguali per ogni
consumatore (launcher, `jht team start`, `jht upgrade`). Ognuna è combinata:
la percentuale da sola rifiutava un disco da 500 GiB con 14 GiB ancora liberi (2,8%).

  - sotto `DISK_WARN_FREE_PCT` (10%) E sotto `DISK_WARN_FREE_BYTES` (20 GiB)
    → livello `warn`, codice `disk_warning`: avviso all'utente
    (`notify-disk`), non si ferma niente;
  - sotto `DISK_BLOCK_FREE_PCT` (3%) E sotto `DISK_BLOCK_FREE_BYTES` (8 GiB)
    → livello `low`, codice `disk_low`: nessun nuovo avvio, nessuno spawn di
    worker, nessun upgrade. Gli agenti già avviati NON vengono toccati: la
    guardia gira solo prima di partire.

La frase che l'utente legge sta nella tabella codice→frase (`disk.warning` e
`disk.low` in shared/locales/*.json), mai scritta da un agente.

CLI:
    python3 host_vitals.py sample [--file PATH]     # campiona + append (bridge)
    python3 host_vitals.py current                  # solo lettura, stampa JSON
    python3 host_vitals.py check [--pct 95]         # exit 1 + righe se sopra soglia
    python3 host_vitals.py summary [--hours 24]     # picchi/medie (Mantenitore)
    python3 host_vitals.py disk                     # solo disco, stampa JSON
    python3 host_vitals.py disk-guard               # exit 3 + `disk_low: frase` se < 3% E < 8 GiB
    python3 host_vitals.py notify-disk              # avviso utente se < 10% E < 20 GiB (cooldown)
"""
import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

CGROUP = Path("/sys/fs/cgroup")
DEFAULT_FILE = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht"))) / "logs" / "vitals.jsonl"
DISK_NOTICE_FILE = DEFAULT_FILE.parent / "disk-notice.json"
MAX_LINES = 4000  # ~7+ giorni a 1 sample / 2-10 min — cap anti-crescita

# ── Disco: soglie sullo spazio LIBERO, codici chiusi ───────────────────────
# Le stesse quattro cifre stanno in cli/src/lib/disk-guard.js e in
# scripts/jht-wrapper.sh (in KiB, per restare in aritmetica intera):
# tests/test_disk_guard.py le confronta, perché una soglia che differisce fra i
# posti è un avvio che passa da uno e viene rifiutato dall'altro.
DISK_GIB = 1024 ** 3
DISK_WARN_FREE_PCT = 10.0
DISK_WARN_FREE_BYTES = 20 * DISK_GIB
DISK_BLOCK_FREE_PCT = 3.0
DISK_BLOCK_FREE_BYTES = 8 * DISK_GIB
DISK_CODE_WARNING = "disk_warning"
DISK_CODE_LOW = "disk_low"
# Chiave della frase nella tabella codice→frase (shared/locales/*.json).
DISK_PHRASE_KEYS = {DISK_CODE_WARNING: "disk.warning", DISK_CODE_LOW: "disk.low"}
DISK_GUARD_EXIT = 3  # `disk-guard`: rifiutato. Qualunque altro rc = non rifiutare.
DISK_NOTICE_COOLDOWN_S = 6 * 3600


def _read_int(p):
    try:
        return int(Path(p).read_text().strip())
    except Exception:
        return None


def _mem():
    """RAM dal cgroup v2 (uso reale container vs limite); fallback /proc/meminfo."""
    cur = _read_int(CGROUP / "memory.current")
    mx = None
    try:
        raw = (CGROUP / "memory.max").read_text().strip()
        mx = None if raw == "max" else int(raw)
    except Exception:
        pass
    swap_pct = None
    try:
        sc = _read_int(CGROUP / "memory.swap.current")
        sm = (CGROUP / "memory.swap.max").read_text().strip()
        sm = None if sm == "max" else int(sm)
        if sc is not None and sm:
            swap_pct = round(sc / sm * 100, 1)
    except Exception:
        pass
    if cur is not None and mx:
        return {"src": "cgroup", "used_bytes": cur, "total_bytes": mx,
                "pct": round(cur / mx * 100, 1), "swap_pct": swap_pct}
    # fallback /proc/meminfo
    info = {}
    try:
        for ln in Path("/proc/meminfo").read_text().splitlines():
            k, _, v = ln.partition(":")
            if v.strip():
                info[k.strip()] = int(v.strip().split()[0]) * 1024
    except Exception:
        return {"src": "none", "used_bytes": None, "total_bytes": None, "pct": None, "swap_pct": None}
    total = info.get("MemTotal")
    avail = info.get("MemAvailable")
    used = (total - avail) if (total and avail is not None) else None
    st = info.get("SwapTotal")
    sf = info.get("SwapFree")
    if st and sf is not None and st > 0:
        swap_pct = round((st - sf) / st * 100, 1)
    return {"src": "meminfo", "used_bytes": used, "total_bytes": total,
            "pct": round(used / total * 100, 1) if (used and total) else None,
            "swap_pct": swap_pct}


def _cpu(sample_s=0.25):
    """CPU% sull'intervallo (delta /proc/stat) + loadavg di contesto."""
    def snap():
        parts = Path("/proc/stat").read_text().splitlines()[0].split()[1:]
        vals = [int(x) for x in parts]
        idle = vals[3] + (vals[4] if len(vals) > 4 else 0)  # idle + iowait
        return sum(vals), idle
    pct = None
    try:
        t0, i0 = snap()
        time.sleep(sample_s)
        t1, i1 = snap()
        dt, di = t1 - t0, i1 - i0
        if dt > 0:
            pct = round((1 - di / dt) * 100, 1)
    except Exception:
        pass
    load = None
    try:
        load = [float(x) for x in Path("/proc/loadavg").read_text().split()[:3]]
    except Exception:
        pass
    return {"pct": pct, "ncpu": os.cpu_count() or 1,
            "load1": load[0] if load else None,
            "load5": load[1] if load else None,
            "load15": load[2] if load else None}


# ── Disco ───────────────────────────────────────────────────────────────────

def _nearest_existing(path):
    """Il primo antenato che esiste: JHT_HOME può non esserci ancora al primo avvio."""
    p = Path(path)
    for cand in (p, *p.parents):
        try:
            if cand.exists():
                return str(cand)
        except OSError:
            continue
    return None


def disk_level(free_bytes, total_bytes):
    """`ok|warn|low` per uno spazio libero: serve la percentuale E i byte.

    Una sola delle due non basta a dichiarare il disco pieno: il 3% di un disco
    da 500 GiB sono 15 GiB, il 40% di uno da 10 GiB sono 4 GiB. Entrambe strette.
    La percentuale si confronta per moltiplicazione (libero*100 < soglia*totale):
    in interi, come fanno JS e shell, senza un arrotondamento sul confine.
    """
    if free_bytes * 100 < DISK_BLOCK_FREE_PCT * total_bytes and free_bytes < DISK_BLOCK_FREE_BYTES:
        return "low"
    if free_bytes * 100 < DISK_WARN_FREE_PCT * total_bytes and free_bytes < DISK_WARN_FREE_BYTES:
        return "warn"
    return "ok"


def _volume(path):
    """Spazio del volume che contiene `path`. Non si risolve → «sconosciuto»."""
    unknown = {"path": str(path) if path else None, "total_bytes": None, "free_bytes": None,
               "free_pct": None, "level": "unknown"}
    target = _nearest_existing(path) if path else None
    if not target:
        return unknown
    try:
        st = os.statvfs(target)
        frsize = st.f_frsize or st.f_bsize
        total = st.f_blocks * frsize
        free = st.f_bavail * frsize
    except Exception:
        return unknown
    if not total or total < 0 or free < 0:
        return unknown
    pct = free / total * 100  # grezza: la decisione NON passa da un arrotondamento
    level = disk_level(free, total)
    return {"path": str(path), "total_bytes": total, "free_bytes": free,
            "free_pct": round(pct, 2), "level": level, "_raw_pct": pct}


_LEVEL_RANK = {"ok": 0, "warn": 1, "low": 2}


def _in_container():
    return Path("/.dockerenv").exists() or Path("/run/.containerenv").exists()


def engine_disk_path(env=None):
    """Dove vive il volume del motore container, se da qui si può sapere.

    Dentro il container è `/` (l'overlay sta sul disco del motore). Su un host
    Linux è la radice dati di Docker/Podman. Su macOS e Windows il disco del
    motore è dentro una VM che l'host non vede: `None` = «sconosciuto», MAI il
    disco del Mac al suo posto. `JHT_ENGINE_DISK_PATH` forza il percorso.
    """
    env = os.environ if env is None else env
    forced = env.get("JHT_ENGINE_DISK_PATH")
    if forced is not None:
        return forced or None
    if _in_container():
        return "/"
    if sys.platform.startswith("linux"):
        for cand in ("/var/lib/docker", "/var/lib/containers"):
            if os.path.isdir(cand):
                return cand
    return None


def read_disk(env=None):
    """Spazio libero dei due volumi e il livello peggiore (`ok|warn|low|unknown`)."""
    env = os.environ if env is None else env
    home = env.get("JHT_HOME") or str(Path.home() / ".jht")
    vols = {"jht_home": _volume(home), "engine": _volume(engine_disk_path(env))}
    known = [v for v in vols.values() if v["level"] != "unknown"]
    # Il peggiore: prima la gravità, a parità la percentuale più bassa. Un volume
    # al 2% ma da 500 GB liberi è `ok` e non deve coprirne uno `warn` accanto.
    worst = max(known, key=lambda v: (_LEVEL_RANK[v["level"]], -v["_raw_pct"])) if known else None
    for v in vols.values():
        v.pop("_raw_pct", None)
    level = worst["level"] if worst else "unknown"
    code = {"low": DISK_CODE_LOW, "warn": DISK_CODE_WARNING}.get(level)
    return {"level": level, "code": code,
            "min_free_pct": worst["free_pct"] if worst else None, **vols}


def disk_phrase(disk):
    """La frase dell'utente per `disk["code"]`, dalla tabella codice→frase.

    Vuota se non c'è un codice o la tabella non risponde: niente testo
    improvvisato al suo posto.
    """
    code = disk.get("code")
    key = DISK_PHRASE_KEYS.get(code)
    if not key:
        return ""
    try:
        shared = str(Path(__file__).resolve().parents[1])
        if shared not in sys.path:
            sys.path.insert(0, shared)
        import i18n
        phrase = i18n.tf(key, f"{disk['min_free_pct']:g}%")
    except Exception:
        return ""
    return "" if phrase == key else phrase


def _send_user_notice(code, phrase, bucket):
    """Consegna deterministica: riga in pending_user_messages + Telegram se c'è."""
    here = Path(__file__).resolve()
    tool = next((p for p in (here.parents[2] / "agents" / "_tools" / "jht-notify-user",
                             Path("/app/agents/_tools/jht-notify-user")) if p.exists()), None)
    if tool is None:
        return False
    try:
        r = subprocess.run(
            [sys.executable, str(tool), "--agent", "sentinella", "--kind", "alert",
             "--source-id", f"{code}:{bucket}", "--source-action", "disk_guard",
             "--source-payload", json.dumps({"code": code}), phrase],
            capture_output=True, text=True, timeout=20)
    except Exception:
        return False
    return r.returncode == 0


def notify_disk(disk, state_path=None, notifier=_send_user_notice, now=None):
    """Avvisa l'utente se il disco è sotto soglia. True = avviso consegnato ora.

    Un solo avviso per livello e per `DISK_NOTICE_COOLDOWN_S`; un peggioramento
    (warn → low) avvisa subito. Quando il disco torna sano lo stato si azzera,
    così la prossima discesa avvisa di nuovo. Lo stato si scrive solo a consegna
    riuscita: un avviso fallito si ritenta al tick dopo.
    """
    path = Path(state_path) if state_path else DISK_NOTICE_FILE
    now = time.time() if now is None else now
    code = disk.get("code")
    if not code:
        try:
            path.unlink()
        except OSError:
            pass
        return False
    try:
        prev = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        prev = {}
    if prev.get("code") == code and now - float(prev.get("ts") or 0) < DISK_NOTICE_COOLDOWN_S:
        return False
    phrase = disk_phrase(disk)
    if not phrase:
        return False
    if not notifier(code, phrase, int(now // DISK_NOTICE_COOLDOWN_S)):
        return False
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"code": code, "ts": now}), encoding="utf-8")
    except OSError:
        pass
    return True


def read_vitals(ts=None):
    return {"ts": ts or datetime.now(timezone.utc).isoformat(), "cpu": _cpu(), "mem": _mem(),
            "disk": read_disk()}


def over_threshold(v, pct=95):
    """Ritorna lista di stringhe 'risorsa N%' per ciò che supera la soglia."""
    out = []
    cp = (v.get("cpu") or {}).get("pct")
    mp = (v.get("mem") or {}).get("pct")
    sp = (v.get("mem") or {}).get("swap_pct")
    if cp is not None and cp >= pct:
        out.append(f"CPU {cp}%")
    if mp is not None and mp >= pct:
        out.append(f"RAM {mp}%")
    if sp is not None and sp >= pct:
        out.append(f"SWAP {sp}%")
    return out


def append_sample(path=None, max_lines=MAX_LINES):
    """Campiona e appende a vitals.jsonl; tronca ai max_lines più recenti."""
    path = Path(path) if path else DEFAULT_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    v = read_vitals()
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(v) + "\n")
    # prune cheap: solo se sforiamo il cap
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        if len(lines) > max_lines:
            path.write_text("\n".join(lines[-max_lines:]) + "\n", encoding="utf-8")
    except Exception:
        pass
    return v


def summarize(path=None, hours=24):
    """Picchi/medie sulle ultime `hours` ore — per il Mantenitore."""
    path = Path(path) if path else DEFAULT_FILE
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    cpu, mem, swap = [], [], []
    peak_cpu = peak_mem = None
    n = 0
    try:
        for ln in path.read_text(encoding="utf-8").splitlines():
            ln = ln.strip()
            if not ln:
                continue
            try:
                v = json.loads(ln)
                if datetime.fromisoformat(v["ts"]) < cutoff:
                    continue
            except Exception:
                continue
            n += 1
            cp = (v.get("cpu") or {}).get("pct")
            mp = (v.get("mem") or {}).get("pct")
            sp = (v.get("mem") or {}).get("swap_pct")
            if cp is not None:
                cpu.append(cp)
                if peak_cpu is None or cp > peak_cpu[0]:
                    peak_cpu = (cp, v["ts"])
            if mp is not None:
                mem.append(mp)
                if peak_mem is None or mp > peak_mem[0]:
                    peak_mem = (mp, v["ts"])
            if sp is not None:
                swap.append(sp)
    except FileNotFoundError:
        pass
    avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
    return {
        "window_h": hours, "samples": n,
        "cpu_avg": avg(cpu), "cpu_max": peak_cpu[0] if peak_cpu else None, "cpu_peak_ts": peak_cpu[1] if peak_cpu else None,
        "mem_avg": avg(mem), "mem_max": peak_mem[0] if peak_mem else None, "mem_peak_ts": peak_mem[1] if peak_mem else None,
        "swap_max": max(swap) if swap else None,
    }


def main():
    ap = argparse.ArgumentParser(description="Container RAM/CPU vitals")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("sample"); sp.add_argument("--file", default=None)
    sub.add_parser("current")
    ck = sub.add_parser("check"); ck.add_argument("--pct", type=float, default=95); ck.add_argument("--file", default=None)
    sm = sub.add_parser("summary"); sm.add_argument("--hours", type=float, default=24); sm.add_argument("--file", default=None)
    sub.add_parser("disk")
    sub.add_parser("disk-guard")
    nd = sub.add_parser("notify-disk"); nd.add_argument("--state", default=None)
    args = ap.parse_args()

    if args.cmd == "sample":
        print(json.dumps(append_sample(args.file)))
    elif args.cmd == "disk":
        print(json.dumps(read_disk()))
    elif args.cmd == "disk-guard":
        # Rifiuta SOLO con una misura che dice «sotto il 3%». Disco sconosciuto o
        # sano = rc 0 e nessuna riga: la guardia non è un secondo modo di rompere
        # un avvio. La riga `disk_low: …` va su stderr, dove il chiamante la mostra.
        disk = read_disk()
        if disk["level"] == "low":
            phrase = disk_phrase(disk)
            print(f"{DISK_CODE_LOW}: {phrase}" if phrase else DISK_CODE_LOW, file=sys.stderr)
            sys.exit(DISK_GUARD_EXIT)
    elif args.cmd == "notify-disk":
        sent = notify_disk(read_disk(), state_path=args.state)
        print("sent" if sent else "none")
    elif args.cmd == "current":
        print(json.dumps(read_vitals()))
    elif args.cmd == "check":
        v = read_vitals()
        over = over_threshold(v, args.pct)
        if over:
            print("OVER: " + ", ".join(over))
            sys.exit(1)
        print("OK")
    elif args.cmd == "summary":
        s = summarize(args.file, args.hours)
        print(f"VITALS last {s['window_h']}h ({s['samples']} samples):")
        print(f"  CPU: average {s['cpu_avg']}%  peak {s['cpu_max']}% @ {s['cpu_peak_ts']}")
        print(f"  RAM: average {s['mem_avg']}%  peak {s['mem_max']}% @ {s['mem_peak_ts']}")
        if s["swap_max"] is not None:
            print(f"  SWAP peak {s['swap_max']}%")
        print(json.dumps(s))


if __name__ == "__main__":
    main()
