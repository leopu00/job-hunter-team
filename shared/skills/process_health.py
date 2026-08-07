#!/usr/bin/env python3
"""process_health.py — canary di LIVENESS dei processi long-running che "tengono
vivo" il container JHT.

Rete di sicurezza giornaliera del Mantenitore (maintainer-sweep): se anche il
respawn automatico dell'agent-watchdog fallisse (es. watchdog vivo ma con un bug
che gli impedisce di rispawnare, o flap-cap raggiunto), qui — al primo sweep del
giorno — la morte viene RILEVATA e RIPARATA. Worst case = ~1 giorno di degrado,
non infinito. Complementare, non alternativo, al watchdog (recovery in secondi).

Nasce dal crash silenzioso del sentinel-bridge su betaC (2026-06-27): un daemon
detached morto, nessuno se ne accorgeva perché nessuno faceva il canary dei
PROCESSI del team (il maintainer-sweep canariava solo i TOOL: browser/LinkedIn).
Vedi docs/internal/postmortems/2026-06-27-betaC-sentinel-bridge-crash.md.

READ-ONLY: scansiona /proc/*/cmdline e riporta alive/dead per ogni processo
atteso. La RIPARAZIONE (respawn) la guida la skill (start-agent.sh bridge|tg-bridge
per la suite detached; escalation al Capitano per i process più profondi).

Uso:
  process_health.py summary [--json]
Exit code: 0 se tutti i processi NON-opzionali sono vivi, 1 se ne manca uno.
"""
import glob
import json
import os
import sys

# Processi attesi long-running. Per ognuno: (nome, marker-cmdline, gruppo).
#   bridge-suite → un solo `start-agent.sh bridge` li rispawna TUTTI (detached,
#                  fuori dal respawn di pid1) → riparabile dal Mantenitore.
#   tg-bridge    → `start-agent.sh tg-bridge`, OPZIONALE (solo se bot Telegram).
#   pid1-child   → respawnato da pid1 (se morto a lungo = problema di pid1) → ESCALA.
#   daemon       → daemon cloud (lifecycle pid1/cli) → ESCALA.
#   core         → pid1 stesso (se morto, il container è morto) → informativo.
EXPECTED = [
    ("sentinel-bridge",    "sentinel-bridge.py",    "bridge-suite"),
    ("pacing-bridge",      "pacing-bridge.py",      "bridge-suite"),
    ("heartbeat-bridge",   "heartbeat-bridge.py",   "bridge-suite"),
    ("window-ratio-meter", "window_ratio_meter.py", "bridge-suite"),
    ("codex-auth-healer",  "codex-auth-healer.sh",  "bridge-suite"),
    # 19/07: token-meter era FUORI lista → morto 6 giorni in silenzio
    # (13→19/07). Ora parte con la suite ed è risorvegliato come gli altri.
    ("token-meter",        "token-meter.py",        "bridge-suite"),
    ("agent-vitals",       "agent_vitals.py",       "bridge-suite"),
    ("agent-watchdog",     "agent-watchdog.sh",     "pid1-child"),
    ("doctor-watchdog",    "doctor-watchdog.sh",    "pid1-child"),
    # 28/07: il watchdog del cap di step. Qui c'e' solo la meta' facile della
    # domanda — il PROCESSO e' vivo. L'altra meta' (la FUNZIONE e' viva) non si
    # legge da /proc: si legge dalla freschezza di logs/stepcap.jsonl, ed e' un
    # check del Dottore (`stepcap-watchdog.py --health`). Il predecessore di
    # questo meccanismo aveva il processo vivo e la funzione morta da ~26h.
    ("stepcap-watchdog",   "stepcap-watchdog.py",   "pid1-child"),
    # 30/07: il motore dei throttle. Se muore, nessun agente in `IN_THROTTLE`
    # viene piu' svegliato — e senza questo canary la morte sarebbe invisibile
    # esattamente come quella del suo predecessore (il figlio detached di
    # `jht-throttle`, 2h15m di stallo il 2026-07-30). Meta' facile della
    # domanda: il PROCESSO e' vivo. L'altra meta' (la FUNZIONE e' viva) la dice
    # la freschezza di logs/throttle-engine.jsonl → `throttle_engine.py --health`.
    ("throttle-engine",    "throttle_engine.py",    "pid1-child"),
    ("auto-report-loop",   "auto-report-loop.sh",   "pid1-child"),
    ("cloud-daemon",       "cloud daemon",          "daemon"),
    # 2026-07-23: 'dashboard' RIMOSSA dalla lista — la web UI locale è stata
    # ritirata (pid1 non la avvia più). Lasciarla attesa faceva scattare il
    # flap-cap e una falsa escalation al Capitano al primo boot.
    ("pid1",               "jht.js pid1",           "core"),
]
TG_MARKER = "tg-bridge.py"
TG_EXPECTED = 3  # assistente / capitano / mentor
# Processi che pid1 avvia SOLO se ci sono bot Telegram configurati (come tg-bridge):
# senza Telegram pid1 li SKIPPA apposta (pid1.js `hasBots`, riga ~595-598) → su una
# VPS senza Telegram NON sono un "morto da rianimare", sono correttamente assenti.
# Senza questo gate il canary escalava al Capitano ~1×/h un falso allarme su betaD
# e VPS Telegram-less (deploy 2026-06-29). auto-report-loop = panoramica Telegram+PNG/2h.
TELEGRAM_GATED = {"auto-report-loop"}


def _telegram_bots_configured():
    """True se almeno un bot Telegram ha un `bot_token` non vuoto in jht.config.json.

    Stessa logica di pid1 (`hasTelegramBotsConfigured`, cli/src/commands/pid1.js):
    `channels.telegram.bots.*.bot_token`. Determina se i processi TELEGRAM_GATED
    (auto-report-loop) sono attesi: senza Telegram pid1 li skippa → assenti ≠ morti.
    """
    home = os.environ.get("JHT_HOME", "/jht_home")
    try:
        with open(os.path.join(home, "jht.config.json"), encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        return False
    try:
        bots = cfg["channels"]["telegram"]["bots"]
    except (KeyError, TypeError):
        return False
    if not isinstance(bots, dict):
        return False
    return any(isinstance(b, dict) and isinstance(b.get("bot_token"), str)
               and b["bot_token"].strip() for b in bots.values())


def _cloud_daemon_expected():
    """Il cloud-daemon va atteso SOLO se il cloud sync è configurato e abilitato.

    pid1 lo avvia con lo stesso predicato (cli/src/commands/pid1.js → cloud.json
    `enabled === true && typeof token === 'string'`); il cloud-daemon gira
    SOLO quando il pairing è attivo. Su istanze con
    cloud disabilitato (es. betaB, `enabled: false` dal 2026-05-22 per quota
    Vercel) pid1 NON lo avvia → marcarlo atteso lo fa vedere "morto" al
    watchdog, che scala a vuoto (falso positivo). Default prudente: False se
    cloud.json manca/illeggibile (= nessun pairing → nessun daemon atteso).
    """
    home = os.environ.get("JHT_HOME") or os.path.expanduser("~")
    try:
        with open(os.path.join(home, "cloud.json"), encoding="utf-8") as f:
            cfg = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return False
    return cfg.get("enabled") is True and isinstance(cfg.get("token"), str)


def _telegram_configured():
    """True se c'è almeno un bot Telegram con bot_token in jht.config.json.

    Stesso predicato di pid1 (`hasTelegramBotsConfigured`) e agent-watchdog.sh:
    `channels.telegram.bots.*.bot_token`. pid1 avvia `auto-report-loop` (e i
    `tg-bridge`) SOLO se Telegram è configurato → su istanze senza Telegram il
    loop NON parte e va trattato come opzionale, altrimenti il canary lo segna
    morto e il watchdog escala al Capitano ~1×/h a vuoto (falso positivo, stessa
    classe del cloud-daemon). Default prudente: False se config manca/illeggibile.
    """
    home = os.environ.get("JHT_HOME") or os.path.expanduser("~")
    try:
        with open(os.path.join(home, "jht.config.json"), encoding="utf-8") as f:
            cfg = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return False
    bots = (((cfg.get("channels") or {}).get("telegram") or {}).get("bots")) or {}
    return any((b or {}).get("bot_token", "").strip() for b in bots.values())


def _cmdlines():
    out = []
    for p in glob.glob("/proc/[0-9]*/cmdline"):
        try:
            with open(p, "rb") as f:
                out.append(f.read().replace(b"\x00", b" ").decode("utf-8", "replace"))
        except OSError:
            pass  # il processo può sparire tra glob e open: ignora
    return out


def scan():
    cmds = _cmdlines()

    def count(marker):
        return sum(1 for c in cmds if marker in c)

    cloud_expected = _cloud_daemon_expected()
    tg_configured = _telegram_configured()
    rows = []
    for name, marker, group in EXPECTED:
        n = count(marker)
        row = {"name": name, "group": group, "alive": n > 0, "count": n}
        # cloud-daemon: atteso solo a cloud sync abilitato (vedi pid1). A
        # pairing disabilitato è opzionale → non conta come 'dead' (no falso
        # positivo del watchdog).
        if name == "cloud-daemon" and not cloud_expected:
            row["optional"] = True
        # auto-report-loop: pid1 lo avvia solo con Telegram configurato (come
        # tg-bridge). Senza Telegram è opzionale → niente falso 'morto'.
        elif name == "auto-report-loop" and not tg_configured:
            row["optional"] = True
        rows.append(row)
    tg = count(TG_MARKER)
    rows.append({
        "name": "tg-bridge", "group": "tg-bridge", "alive": tg > 0,
        "count": tg, "expected": TG_EXPECTED, "optional": True,
    })

    # Gate Telegram: i processi TELEGRAM_GATED non sono attesi senza bot configurati
    # (pid1 li skippa). Su VPS Telegram-less diventano opzionali → fuori da `dead`.
    if not _telegram_bots_configured():
        for r in rows:
            if r["name"] in TELEGRAM_GATED:
                r["optional"] = True
                r["gated"] = "telegram-off"

    # "dead" = non vivo E non opzionale. Gruppo per guidare la riparazione.
    dead = [r for r in rows if not r["alive"] and not r.get("optional")]
    dead_bridge_suite = [r["name"] for r in dead if r["group"] == "bridge-suite"]
    dead_deep = [r["name"] for r in dead if r["group"] in ("pid1-child", "daemon", "core")]
    tg_row = next(r for r in rows if r["name"] == "tg-bridge")
    return {
        "rows": rows,
        "dead": [r["name"] for r in dead],
        "dead_bridge_suite": dead_bridge_suite,   # → start-agent.sh bridge
        "dead_deep": dead_deep,                    # → ESCALA al Capitano
        "tg": {"alive": tg_row["count"], "expected": TG_EXPECTED},
        "all_ok": not dead,
    }


def main():
    res = scan()
    if "--json" in sys.argv:
        print(json.dumps(res, indent=2))
    elif "--shell" in sys.argv:
        # Output eval-abile dall'agent-watchdog (bash). Niente self-match: questo
        # script legge /proc in Python e i marker sono nel file, NON in argv —
        # a differenza di `grep MARKER /proc/*/cmdline`, che trova sé stesso.
        print("PROC_DEAD_BRIDGE_SUITE='%s'" % " ".join(res["dead_bridge_suite"]))
        print("PROC_DEAD_DEEP='%s'" % " ".join(res["dead_deep"]))
        print("PROC_TG_ALIVE=%d" % res["tg"]["alive"])
        print("PROC_ALL_OK=%d" % (1 if res["all_ok"] else 0))
    else:
        for r in res["rows"]:
            mark = "OK  " if r["alive"] else "DEAD"
            cnt = f" x{r['count']}" if r.get("count", 0) > 1 else ""
            opt = "  [optional]" if r.get("optional") else ""
            exp = f" (expected {r['expected']})" if r.get("expected") and r["count"] != r["expected"] else ""
            print(f"  [{mark}] {r['name']:<20} {r['group']}{cnt}{exp}{opt}")
        if res["all_ok"]:
            print("\n  -> ALL ALIVE")
        else:
            print(f"\n  -> DEAD: {', '.join(res['dead'])}")
            if res["dead_bridge_suite"]:
                print(f"     repair (detached): bash /app/.launcher/start-agent.sh bridge   # {', '.join(res['dead_bridge_suite'])}")
            if res["dead_deep"]:
                print(f"     ESCALATE to the Captain (deep process): {', '.join(res['dead_deep'])}")
    sys.exit(0 if res["all_ok"] else 1)


if __name__ == "__main__":
    main()
