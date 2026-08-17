"""#181 — un gate di formattazione non deve promettere piu' di quanto controlla.

Il passo che si chiamava «shared/» controllava `shared/**/*.ts`, e in `shared/`
il codice condiviso e' quasi tutto `.js`: 11 file su 14 non erano mai stati
guardati. Non erano fuori formato per trascuratezza — nessuno gliel'aveva mai
chiesto. La forma del difetto e' ricorrente: una difesa esiste, ha un nome che
promette copertura, e la maggior parte del codice non ci passa.

Riformattare e allargare il glob chiude il caso di oggi; questo test chiude la
CLASSE, perche' il caso di domani nasce da solo — basta il primo `.cjs` in
`shared/`, o una cartella nuova sotto `web/`. La regola sorvegliata e' una
sola: **ogni glob copre tutte le estensioni di sorgente che esistono davvero
sotto la cartella che nomina**.

Si legge il workflow e non una lista scritta a mano: una lista a mano si
disallinea dal comando che gira, e allora il test comincia a sorvegliare
qualcosa che nessuno esegue.

Il perimetro dei file e' quello di `git ls-files`, cioe' esattamente cio' che
il checkout della CI porta: contare i file su disco includerebbe artefatti
generati (`web/next-env.d.ts`, `node_modules/`) che in CI non ci sono, e il
test direbbe rosso per una cosa che il gate non vede.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/lint.yml"

# Le estensioni che Prettier sa formattare e che nel repo contano come
# sorgente JS/TS. `.json`/`.md`/`.css` restano fuori di proposito: non sono
# mai stati nel perimetro di questo gate, e includerli qui trasformerebbe un
# guard in una richiesta di lavoro che nessuno ha deciso.
SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"}

# `npx prettier --check "<root>/**/*.{a,b}"` oppure `"<root>/**/*.ts"`.
CHECK = re.compile(r'npx prettier --check "([^"]+)"')
GLOB = re.compile(r"^(?P<root>[^*]+?)/\*\*/\*\.(?:\{(?P<many>[^}]+)\}|(?P<one>\w+))$")


def _perimeters() -> list[tuple[str, set[str]]]:
    """(cartella, estensioni coperte) per ogni comando del workflow."""
    found = []
    for glob in CHECK.findall(WORKFLOW.read_text(encoding="utf-8")):
        match = GLOB.match(glob)
        assert match, f"glob non riconosciuto, il test non puo' giudicarlo: {glob}"
        raw = match.group("many") or match.group("one")
        found.append(
            (match.group("root"), {"." + ext.strip() for ext in raw.split(",")})
        )
    return found


def _tracked_sources(root: str) -> list[str]:
    out = subprocess.check_output(
        ["git", "-C", str(ROOT), "ls-files", f"{root}/"], text=True
    )
    return [
        line
        for line in out.splitlines()
        if Path(line).suffix in SOURCE_SUFFIXES
        # `.d.ts` e' un file di dichiarazioni: oggi non ne esiste nessuno
        # tracciato sotto i perimetri, e se ne comparisse uno generato il gate
        # lo prenderebbe comunque — non e' questo test a doverlo decidere.
        and not line.endswith(".d.ts")
    ]


PERIMETERS = _perimeters()


def test_il_workflow_dichiara_almeno_i_due_perimetri_noti():
    """Senza questa, un refactor del workflow renderebbe il resto verde a vuoto."""
    roots = {root for root, _ in PERIMETERS}
    assert {"web", "shared"} <= roots, roots


@pytest.mark.parametrize("root,covered", PERIMETERS, ids=lambda v: str(v))
def test_il_glob_copre_ogni_estensione_che_esiste_sotto_la_cartella(root, covered):
    files = _tracked_sources(root)
    assert files, f"nessun sorgente tracciato sotto {root}/: il glob non prova niente"

    scoperti = sorted({Path(f).suffix for f in files} - covered)
    esempi = {
        suffix: [f for f in files if Path(f).suffix == suffix][:3] for suffix in scoperti
    }
    assert not scoperti, (
        f"il passo Prettier dice «{root}/» ma non guarda {scoperti}. "
        f"Esempi: {esempi}. O si allarga il glob, o il passo cambia nome: "
        f"un gate che promette la cartella e ne controlla una fetta e' peggio "
        f"di un gate assente, perche' sembra copertura."
    )
