#!/usr/bin/env python3
"""locale_health.py — canary della LOCALE del container: i pane sono leggibili
da fuori, e — soprattutto — i byte dentro i pane sono ancora UTF-8 validi?

Nasce dal caso del 2026-08-10 (O-38): chi si attaccava a un pane del Capitano
(`docker exec -it jht tmux attach`) vedeva `_` al posto di ogni lettera
accentata. Il timore era il peggiore possibile — che gli agenti si stessero
scambiando parole troncate — e invece la misura ha detto un'altra cosa: nel
buffer la «e» accentata era 0xC3 0xA8, la decodifica STRETTA di 4000 righe
passava senza un byte invalido, e le accentate integre erano 392. Difetto di
RENDERING del client (LANG vuota → LC_CTYPE=POSIX → tmux non si sa in UTF-8),
non di dati.

È esattamente questa la distinzione che lo script tiene in piedi, perché è
quella che decide cosa fare:

  * `cosmetic`        → i dati sono sani, è illeggibile solo per chi guarda da
                        fuori. Si riporta al Capitano, non si sveglia nessuno.
  * `data_corruption` → nel buffer ci sono byte che UTF-8 non ammette: qui sì
                        che gli agenti possono leggere fischi per fiaschi, ed
                        è un P1 da escalare.

Un check che guardasse solo `echo $LANG` saprebbe dire «cosmetico» quando la
variabile c'è, ma non saprebbe MAI dire «corrotto»: la decodifica stretta di un
`capture-pane` è l'unica delle due misure che distingue i due mondi. Per questo
ci sono entrambe, e per questo la seconda è quella che comanda il verdetto.

READ-ONLY: legge l'ambiente e cattura i pane (`capture-pane -p` non modifica
niente). Nessuna riparazione: la locale si imposta nel `docker-compose.yml`
(`LANG=C.UTF-8`) e vale dalla ricreazione del container in poi — fuori dalla
portata di un agente che gira DENTRO quel container.

Uso:
  locale_health.py summary [--json] [--lines N]

Exit code — porta lui la distinzione che conta:
  0 = ok            (locale UTF-8 e nessun byte invalido)
  1 = cosmetic      (locale non-UTF-8, dati sani → riporta al Capitano)
  2 = data_corruption (byte invalidi nei pane → ESCALA)
"""
import json
import os
import subprocess
import sys

# Quante righe di storico catturare per pane. 4000 è la profondità su cui è
# stata fatta la misura del 10/08: abbastanza da incrociare parecchie accentate
# senza far pesare lo sweep (la cattura è un dump di buffer, non un comando).
DEFAULT_LINES = 4000

# I nomi che glibc accetta per la locale neutra UTF-8. `C.UTF-8` e `C.utf8`
# sono lo stesso alias scritto in due modi: `locale -a` stampa il secondo,
# l'ambiente di solito porta il primo.
UTF8_MARKERS = ("utf-8", "utf8")


PID1_ENVIRON = "/proc/1/environ"


def container_env(path=PID1_ENVIRON):
    """L'ambiente del CONTAINER (pid 1), non quello di questo processo.

    Trappola misurata il 2026-08-10, e costerebbe l'intero check: CPython
    "coerce" la locale legacy C/POSIX (PEP 538) e **scrive `LC_CTYPE=C.UTF-8`
    dentro `os.environ`**. In un container senza `LANG` — quello rotto, dove
    chi si attacca vede `_` — `docker exec ... env` non stampa nulla, ma un
    check Python che guardasse `os.environ` leggerebbe `LC_CTYPE=C.UTF-8` e
    direbbe «sano». Verde su un difetto vivo: il caso peggiore.

    `/proc/1/environ` invece è l'ambiente che il compose ha dato al container,
    quello che eredita ogni `docker exec` — cioè esattamente la cosa che il fix
    di `docker-compose.yml` cambia. Fallback su `os.environ` (host, macOS, test)
    dove /proc non esiste: la sorgente usata finisce nel report, così il
    verdetto dice sempre su cosa è stato misurato.
    """
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError:
        return dict(os.environ), "process"
    env = {}
    for entry in raw.split(b"\0"):
        if b"=" in entry:
            k, _, v = entry.partition(b"=")
            env[k.decode("utf-8", "replace")] = v.decode("utf-8", "replace")
    return env, "container-pid1"


def effective_locale(env):
    """La locale che decide davvero il set di caratteri, con la precedenza POSIX.

    LC_ALL vince su LC_CTYPE, che vince su LANG. Guardare solo LANG (l'errore
    facile) darebbe per rotto un container in cui LC_ALL è impostata, e per
    sano uno in cui LANG è UTF-8 ma LC_CTYPE la sovrascrive con POSIX.
    """
    for name in ("LC_ALL", "LC_CTYPE", "LANG"):
        value = (env.get(name) or "").strip()
        if value:
            return name, value
    return None, ""


def is_utf8(value):
    return any(m in (value or "").lower() for m in UTF8_MARKERS)


def _tmux(args, text=True):
    """Esegue tmux. `text=False` per i byte GREZZI: la cattura non va decodificata
    da subprocess, altrimenti Python "aggiusta" in silenzio proprio i byte che
    stiamo misurando."""
    try:
        res = subprocess.run(["tmux"] + args, capture_output=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    if res.returncode != 0:
        return None
    return res.stdout if not text else res.stdout.decode("utf-8", "replace")


def sessions():
    out = _tmux(["ls", "-F", "#{session_name}"])
    if not out:
        return []  # tmux assente o nessun server vivo: non è un errore qui
    return [s.strip() for s in out.splitlines() if s.strip()]


def scan_pane(session, lines=DEFAULT_LINES):
    """Decodifica STRETTA del buffer di un pane. Ritorna cosa ha trovato, non un
    giudizio: chi legge decide."""
    raw = _tmux(["capture-pane", "-p", "-t", session, "-S", "-%d" % lines], text=False)
    if raw is None:
        return {"session": session, "captured": False}
    row = {"session": session, "captured": True, "bytes": len(raw)}
    try:
        decoded = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        row["decode_ok"] = False
        row["invalid_at"] = e.start
        row["invalid_byte"] = "0x%02X" % raw[e.start]
        row["non_ascii_chars"] = 0
        return row
    row["decode_ok"] = True
    # Le accentate integre: senza almeno una, la decodifica è passata perché
    # non c'era niente da sbagliare — il verde vale meno e va detto.
    row["non_ascii_chars"] = sum(1 for ch in decoded if ord(ch) > 127)
    return row


def scan(lines=DEFAULT_LINES, env=None, environ_path=PID1_ENVIRON):
    if env is None:
        env, env_from = container_env(environ_path)
    else:
        env_from = "explicit"
    source, value = effective_locale(env)
    env_utf8 = is_utf8(value)
    panes = [scan_pane(s, lines) for s in sessions()]
    captured = [p for p in panes if p.get("captured")]
    corrupted = [p["session"] for p in captured if not p["decode_ok"]]
    non_ascii = sum(p.get("non_ascii_chars", 0) for p in captured)

    if corrupted:
        verdict = "data_corruption"
    elif not env_utf8:
        verdict = "cosmetic"
    else:
        verdict = "ok"

    return {
        "env": {"source": source, "value": value, "utf8": env_utf8,
                "read_from": env_from},
        "panes": panes,
        "panes_scanned": len(captured),
        "corrupted_sessions": corrupted,
        "non_ascii_chars": non_ascii,
        # Verde debole: nessuna accentata nel campione → la decodifica non ha
        # dimostrato granché. Non cambia il verdetto, lo qualifica.
        "decode_proof_weak": bool(captured) and non_ascii == 0 and not corrupted,
        "verdict": verdict,
        "healthy": verdict == "ok",
    }


EXIT_CODES = {"ok": 0, "cosmetic": 1, "data_corruption": 2}

# Output all'utente/agente: inglese come tutto il perimetro backend condiviso
# (gate `tests/test_shared_backend_english.py`). I commenti e il docstring
# restano in italiano: sono per chi legge il codice, non per chi lo esegue.
ADVICE = {
    "ok": "UTF-8 locale and no invalid byte in the panes.",
    "cosmetic": (
        "THE DATA ARE INTACT (no invalid byte): what is broken is the RENDERING "
        "for whoever attaches from outside. Report to the Captain — fix: "
        "LANG=C.UTF-8 in docker-compose.yml, effective when the container is "
        "recreated; immediate mitigation: "
        "docker exec -it -e LC_ALL=C.UTF-8 jht tmux -u attach -r -t <session>."
    ),
    "data_corruption": (
        "P1 — bytes that UTF-8 cannot decode inside the panes: here the agents "
        "can read truncated text. ESCALATE to the Captain with the listed "
        "sessions, this is not a cosmetic problem."
    ),
}


def main():
    lines = DEFAULT_LINES
    if "--lines" in sys.argv:
        try:
            lines = int(sys.argv[sys.argv.index("--lines") + 1])
        except (IndexError, ValueError):
            print("--lines expects a number", file=sys.stderr)
            sys.exit(64)
    res = scan(lines)
    if "--json" in sys.argv:
        print(json.dumps(res, indent=2))
    else:
        env = res["env"]
        origin = env["source"] or "none"
        print("  locale: %s=%s  %s  [read from %s]"
              % (origin, env["value"] or "(empty)",
                 "UTF-8" if env["utf8"] else "NOT-UTF-8", env["read_from"]))
        for p in res["panes"]:
            if not p.get("captured"):
                print("  [SKIP] %-24s pane not capturable" % p["session"])
            elif p["decode_ok"]:
                print("  [OK  ] %-24s %d bytes, %d intact accented chars"
                      % (p["session"], p["bytes"], p["non_ascii_chars"]))
            else:
                print("  [BAD ] %-24s invalid byte %s at offset %d"
                      % (p["session"], p["invalid_byte"], p["invalid_at"]))
        if not res["panes"]:
            print("  (no tmux session: verdict on the locale alone)")
        if res["decode_proof_weak"]:
            print("  NB: no accented char in the sample — the decode proves little.")
        print("\n  -> %s: %s" % (res["verdict"].upper(), ADVICE[res["verdict"]]))
    sys.exit(EXIT_CODES[res["verdict"]])


if __name__ == "__main__":
    main()
