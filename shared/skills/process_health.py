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
Vedi docs/internal/2026-06-27-betaC-sentinel-bridge-crash.md.

READ-ONLY: scansiona /proc/*/cmdline e riporta alive/dead per ogni processo
atteso. La RIPARAZIONE (respawn) la guida la skill (start-agent.sh bridge|tg-bridge
per la suite detached; escalation al Capitano per i process più profondi).

Uso:
  process_health.py summary [--json]
Exit code: 0 se tutti i processi NON-opzionali sono vivi, 1 se ne manca uno.
"""
import glob
import json
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
    ("capitano-bridge",    "capitano-bridge.py",    "bridge-suite"),
    ("window-ratio-meter", "window_ratio_meter.py", "bridge-suite"),
    ("codex-auth-healer",  "codex-auth-healer.sh",  "bridge-suite"),
    ("agent-watchdog",     "agent-watchdog.sh",     "pid1-child"),
    ("doctor-watchdog",    "doctor-watchdog.sh",    "pid1-child"),
    ("auto-report-loop",   "auto-report-loop.sh",   "pid1-child"),
    ("cloud-daemon",       "cloud daemon",          "daemon"),
    ("pid1",               "jht.js pid1",           "core"),
]
TG_MARKER = "tg-bridge.py"
TG_EXPECTED = 3  # assistente / capitano / mentor


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

    rows = []
    for name, marker, group in EXPECTED:
        n = count(marker)
        rows.append({"name": name, "group": group, "alive": n > 0, "count": n})
    tg = count(TG_MARKER)
    rows.append({
        "name": "tg-bridge", "group": "tg-bridge", "alive": tg > 0,
        "count": tg, "expected": TG_EXPECTED, "optional": True,
    })

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
            opt = "  [opzionale]" if r.get("optional") else ""
            exp = f" (attesi {r['expected']})" if r.get("expected") and r["count"] != r["expected"] else ""
            print(f"  [{mark}] {r['name']:<20} {r['group']}{cnt}{exp}{opt}")
        if res["all_ok"]:
            print("\n  -> TUTTI VIVI")
        else:
            print(f"\n  -> MORTI: {', '.join(res['dead'])}")
            if res["dead_bridge_suite"]:
                print(f"     ripara (detached): bash /app/.launcher/start-agent.sh bridge   # {', '.join(res['dead_bridge_suite'])}")
            if res["dead_deep"]:
                print(f"     ESCALA al Capitano (process profondo): {', '.join(res['dead_deep'])}")
    sys.exit(0 if res["all_ok"] else 1)


if __name__ == "__main__":
    main()
