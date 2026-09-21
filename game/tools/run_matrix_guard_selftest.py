#!/usr/bin/env python3
"""Il runner dei selftest deve accorgersi se legge la matrice a meta'.

Il 21/09 `run.sh test gate` eseguiva 4 test su 66 e stampava «TEST OK»: il
ciclo legge la matrice da stdin e godot si prendeva quel file descriptor,
quindi la lista finiva a meta' e il gate passava per il motivo sbagliato. Il
rimedio e' in due pezzi — `</dev/null` sulle chiamate, e il conto finale che
pretende di aver visto tutte le righe dichiarate — e questo test sorveglia il
secondo: rompe il conto APPOSTA e vuole il rosso.

Gira senza Godot: le righe della matrice finta sono di tipo `python`.
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile

TOOLS = Path(__file__).resolve().parent
RUN_SH = TOOLS / "run.sh"


def run_with(matrix: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "test-matrix.txt"
        path.write_text(matrix, encoding="utf-8")
        return subprocess.run(
            ["bash", str(RUN_SH), "test", "gate"],
            capture_output=True,
            text=True,
            env={"PATH": "/usr/bin:/bin:/usr/local/bin", "JHT_TEST_MATRIX": str(path)},
            check=False,
        )


# Una riga che si porta via lo stdin del ciclo, come faceva godot: `cat` legge
# il resto della matrice e le righe dopo non vengono mai viste.
GREEDY = TOOLS / "_matrix_guard_greedy.py"
HARMLESS = TOOLS / "_matrix_guard_harmless.py"
GREEDY_LINE = f"tools/{GREEDY.name}"
HARMLESS_LINE = f"tools/{HARMLESS.name}"


def main() -> int:
    failures: list[str] = []
    GREEDY.write_text("import sys\nsys.stdin.read()\n", encoding="utf-8")
    HARMLESS.write_text("print('ok')\n", encoding="utf-8")
    try:
        # 1. Giro completo: due righe dichiarate, due eseguite.
        whole = run_with(
            f"# finta\nuno|python|gate|any|-|{HARMLESS_LINE}|-\ndue|python|gate|any|-|{HARMLESS_LINE}|-\n"
        )
        if whole.returncode != 0:
            failures.append(f"matrice intera: atteso 0, ottenuto {whole.returncode}\n{whole.stderr}")

        # 2. Il difetto del 21/09: un test che LEGGE stdin. Con `</dev/null`
        #    sulle chiamate non porta via piu' niente, e le righe dopo di lui
        #    vengono eseguite come le altre.
        greedy = run_with(
            f"# finta\nuno|python|gate|any|-|{GREEDY_LINE}|-\ndue|python|gate|any|-|{HARMLESS_LINE}|-\n"
            f"tre|python|gate|any|-|{HARMLESS_LINE}|-\n"
        )
        if greedy.returncode != 0:
            failures.append(f"test che legge stdin: atteso 0, ottenuto {greedy.returncode}\n{greedy.stderr}")
        elif "3 test verdi" not in greedy.stderr:
            failures.append("un test che legge stdin si porta via le righe dopo\n" + greedy.stderr)

        # 3. La guardia: qui il conto si rompe APPOSTA. L'ultima riga non
        #    finisce con un a capo, e `while read` la perde: il ciclo ne vede
        #    due dove la matrice ne dichiara tre. E' il caso vero di un file
        #    scritto a mano, ed e' la stessa forma del difetto del 21/09 —
        #    la lista finisce prima della fine. Senza guardia questo giro
        #    stamperebbe "TEST OK", come il gate con 4 test su 66.
        halved = run_with(
            f"# finta\nuno|python|gate|any|-|{HARMLESS_LINE}|-\n"
            f"due|python|gate|any|-|{HARMLESS_LINE}|-\ntre|python|gate|any|-|{HARMLESS_LINE}|-"
        )
        if halved.returncode == 0:
            failures.append("matrice letta a meta': atteso rosso, ottenuto TEST OK\n" + halved.stderr)
        elif "MATRICE LETTA A META'" not in halved.stderr:
            failures.append("rosso senza spiegazione: manca 'MATRICE LETTA A META''\n" + halved.stderr)

        # 4. Anche col tier che scarta righe il conto deve tornare: le righe
        #    fuori tier sono viste, non perse.
        mixed = run_with(
            f"# finta\nuno|python|gate|any|-|{HARMLESS_LINE}|-\ndue|python|watch|any|-|{HARMLESS_LINE}|-\n"
        )
        if mixed.returncode != 0:
            failures.append(f"tier misto: atteso 0, ottenuto {mixed.returncode}\n{mixed.stderr}")
        elif "1 test verdi (tier=gate, 1 fuori tier)" not in mixed.stderr:
            failures.append("il conto non distingue eseguiti e fuori tier\n" + mixed.stderr)
    finally:
        GREEDY.unlink(missing_ok=True)
        HARMLESS.unlink(missing_ok=True)

    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("MATRIX-GUARD-TEST PASS: un giro incompleto e' rosso e lo dice")
    return 0


if __name__ == "__main__":
    sys.exit(main())
