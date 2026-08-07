#!/usr/bin/env python3
"""roll_worker_number — dado d6 per il NUMERO d'istanza di un worker, escludendo
i numeri gia' in uso (sessioni tmux esistenti per quel ruolo).

Idea utente (2026-06-13): oggi il lavoro si concentra sempre su -1 (fa tutto),
-2 (molto), -3 (poco), -4 (quasi niente). Per diversificare, il numero d'istanza
di un NUOVO worker e' CASUALE invece che sequenziale. Il Capitano (e il Dottore,
quando spawnano un worker NUOVO) chiamano questo prima di start-agent.sh:

    N=$(python3 /app/shared/skills/roll_worker_number.py scout) && \
        bash /app/.launcher/start-agent.sh scout "$N"

Regola: tira un d6 (1-6) ma ESCLUDE i numeri gia' attivi per quel ruolo. Es. se
SCOUT-1 e SCOUT-4 esistono, tira tra {2,3,5,6}. Cosi' non c'e' mai collisione e
il label e' randomizzato. Vale per scout / analista / scorer / scrittore.

NB: e' per gli SPAWN NUOVI, non per il RECREATE/refresh del Dottore (che
ricrea la STESSA sessione con lo stesso numero — li' non si tira).

Opzionale `--max N` per usare il tetto anti-runaway del ruolo come faccia del
dado invece del 6 fisso (default 6, come da ordine utente).
"""
import random
import re
import subprocess
import sys

DIE = 6  # "dato da 6" (ordine utente)
ROLES = {"scout", "analista", "scorer", "scrittore"}


def existing_numbers(role: str) -> set:
    """Numeri d'istanza gia' presenti come sessioni tmux ROLE-N."""
    try:
        out = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, text=True, timeout=10,
        ).stdout
    except Exception:
        out = ""
    pat = re.compile(rf"^{re.escape(role.upper())}-(\d+)$")
    nums = set()
    for line in out.splitlines():
        m = pat.match(line.strip())
        if m:
            nums.add(int(m.group(1)))
    return nums


def roll(role: str, die: int = DIE, used: set | None = None) -> int | None:
    """Numero libero casuale in [1..die], None se sono tutti occupati."""
    used = existing_numbers(role) if used is None else used
    free = [n for n in range(1, die + 1) if n not in used]
    if not free:
        return None
    return random.choice(free)


def main(argv):
    if not argv or argv[0].lower() not in ROLES:
        print("usage: roll_worker_number.py <scout|analista|scorer|scrittore> [--max N]",
              file=sys.stderr)
        return 2
    role = argv[0].lower()
    die = DIE
    if "--max" in argv:
        try:
            die = max(1, int(argv[argv.index("--max") + 1]))
        except (ValueError, IndexError):
            pass
    n = roll(role, die)
    if n is None:
        print(f"# all numbers 1-{die} for {role} are in use", file=sys.stderr)
        return 1
    print(n)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
