"""Dentro il container, `jht` è un comando: le skill degli agenti lo chiamano.

Origine: 2026-09-27. Le skill del team chiamano la CLI per nome —
`jht cloud quarantine list`, `jht cloud status`, `jht team start <ruolo>` —
ma l'immagine non l'aveva mai messa nel PATH: l'entrypoint la lancia per
percorso (`node /app/cli/bin/jht.js`). Su una VPS funzionava solo perché era
stata aggiunta a mano nel container; ricreato il container con un'immagine
nuova, `jht` è sparito, e con lui ogni comando `jht …` delle skill.

Il test guarda le tre cose che servono perché `jht` risponda:
1. il Dockerfile collega la CLI in /usr/local/bin/jht (lo stesso posto dei
   tool degli agenti, che le sub-shell login di Codex/Kimi trovano), e lo fa
   prima di `USER jht`, quando /usr/local/bin è ancora scrivibile;
2. il bersaglio è eseguibile nel repo (modo 100755) con uno shebang node;
3. lanciata ATTRAVERSO un collegamento con quel nome, da un'altra cartella,
   la CLI parte davvero: un import risolto rispetto al percorso del
   collegamento invece che al file vero morirebbe qui.

Eseguire:
    pytest tests/test_container_jht_on_path.py -v
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = ROOT / "Dockerfile"
CLI = ROOT / "cli" / "bin" / "jht.js"
LINK = "ln -sf /app/cli/bin/jht.js /usr/local/bin/jht"


def test_the_image_links_the_cli_into_the_path_as_root():
    text = DOCKERFILE.read_text(encoding="utf-8")
    assert LINK in text, "il Dockerfile non espone più la CLI come `jht`"
    user = re.search(r"^USER jht\s*$", text, re.MULTILINE)
    assert user, "il Dockerfile non passa più a USER jht: rivedere dove va il collegamento"
    assert text.index(LINK) < user.start(), \
        "il collegamento va creato come root, prima di `USER jht`"
    # La cartella del collegamento deve essere nel PATH dell'immagine anche per
    # le shell login, che ripuliscono il PATH del Dockerfile: /usr/local/bin lo è.
    assert "/usr/local/bin/jht" in LINK


def test_the_cli_is_an_executable_node_script():
    mode = subprocess.run(
        ["git", "ls-files", "-s", "cli/bin/jht.js"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout.split()[0]
    assert mode == "100755", f"cli/bin/jht.js nel repo ha modo {mode}: il collegamento non sarebbe eseguibile"
    assert CLI.read_text(encoding="utf-8").startswith("#!/usr/bin/env node\n")


@pytest.mark.skipif(shutil.which("node") is None, reason="serve node")
def test_the_cli_runs_through_a_link_named_jht_from_another_folder(tmp_path):
    if not (ROOT / "cli" / "node_modules").is_dir():
        pytest.skip("dipendenze della CLI non installate (npm ci in cli/)")
    link = tmp_path / "bin" / "jht"
    link.parent.mkdir()
    link.symlink_to(CLI)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    env = {**os.environ, "PATH": f"{link.parent}{os.pathsep}{os.environ['PATH']}",
           "JHT_HOME": str(tmp_path / "home")}
    r = subprocess.run(["jht", "cloud", "--help"], cwd=elsewhere, env=env,
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, (r.stdout, r.stderr)
    # I sottocomandi che le skill degli agenti chiamano per nome.
    assert "quarantine" in r.stdout, r.stdout
    assert "status" in r.stdout, r.stdout
