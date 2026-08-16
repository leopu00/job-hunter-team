"""Cosa finisce DAVVERO dentro l'immagine, letto dal layer e non dalla ricetta.

`.dockerignore` e' la ricetta; l'immagine e' il risultato. Il difetto di #177 —
`desktop/app-payload` distribuito agli utenti, con dentro il codice di
autorizzazione precedente a #158 — e' stato trovato guardando i nomi dentro il
layer del `COPY . .` dell'artefatto pubblicato, e la prova che sia chiuso ha la
stessa forma: **nessuna voce sotto `desktop/`**. Un test che leggesse il
`.dockerignore` proverebbe che abbiamo scritto una riga, non che l'immagine e'
pulita — e non e' la stessa cosa, perche' una riga senza `**` vale solo alla
radice e sembra giusta.

Il layer si ottiene costruendo un'immagine il cui unico contenuto e' il
contesto (`FROM scratch` + `COPY`), con il repo come contesto: cosi' vale il
`.dockerignore` vero e i file sono quelli che `COPY . .` copierebbe, senza
pagare il build completo (pip, playwright, il gate del browser).
"""

import gzip
import io
import json
import shutil
import subprocess
import tarfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
IMAGE_TAG = "jht-context-under-test"
CONTEXT_ONLY_DOCKERFILE = "FROM scratch\nCOPY . /app\n"

# Cartelle che nel container servono davvero, benche' il loro NOME sia fra
# quelli esclusi. Stanno qui perche' un'esclusione in profondita' scritta un
# po' piu' larga le porterebbe via in silenzio: `shared/release/version.js` lo
# importa `cli/src/lib/release-check.js`, che gira dentro il container, e le
# altre due sono una route e degli asset dell'albero `web/`.
KEPT_ON_PURPOSE = (
    "app/shared/release/version.js",
    "app/web/app/docs",
    "app/web/public/tutorials/game",
)


def layer_entries(tmp_path):
    """I nomi dentro i layer dell'immagine costruita dal contesto."""
    dockerfile = tmp_path / "context.Dockerfile"
    dockerfile.write_text(CONTEXT_ONLY_DOCKERFILE, encoding="utf-8")
    build = subprocess.run(
        ["docker", "build", "-q", "-f", str(dockerfile), "-t", IMAGE_TAG, str(ROOT)],
        capture_output=True,
        text=True,
    )
    if build.returncode != 0:
        pytest.skip(f"build del contesto non riuscito: {build.stderr.strip()[:200]}")
    archive = tmp_path / "image.tar"
    subprocess.run(
        ["docker", "save", IMAGE_TAG, "-o", str(archive)],
        capture_output=True,
        check=True,
    )
    names = []
    with tarfile.open(archive) as image:
        manifest = json.load(image.extractfile("manifest.json"))[0]
        for layer in manifest["Layers"]:
            raw = image.extractfile(layer).read()
            if raw[:2] == b"\x1f\x8b":  # OCI comprime i blob, il docker save no
                raw = gzip.decompress(raw)
            with tarfile.open(fileobj=io.BytesIO(raw)) as blob:
                names += blob.getnames()
    subprocess.run(["docker", "rmi", "-f", IMAGE_TAG], capture_output=True)
    return names


@pytest.fixture(scope="module")
def entries(tmp_path_factory):
    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    return layer_entries(tmp_path_factory.mktemp("image-context"))


def test_the_desktop_payload_is_not_in_the_image(entries):
    """1249 voci, e fra queste una copia del codice di autorizzazione pre-#158.

    Non serve un job di build per finire in un'immagine: basta stare nel
    contesto, e `COPY . .` lo copia. `release.md` diceva il vero — quell'albero
    non viene buildato — e l'immagine lo conteneva lo stesso.
    """
    assert [name for name in entries if name.startswith("app/desktop")] == []


def test_the_oci_pin_does_not_re_enter_the_build(entries):
    """`release/runtime-image.v1.json` nasce DOPO il build attestato.

    Rimetterlo nel contesto rompe il ciclo digest->commit->digest: aggiornare
    il manifest non ricostruisce byte runtime diversi da quelli che il
    manifest identifica. `tests/test_runtime_image_pin.py` guarda che la riga
    ci sia; qui si guarda che l'effetto ci sia.
    """
    assert [name for name in entries if name.startswith("app/release")] == []


def test_an_exclusion_that_holds_at_the_root_holds_in_depth(entries):
    """Il file era scritto per un albero solo, e il repo ne ha due.

    Senza `**` una riga vale SOLO alla radice: `docs/`, `tests/` e
    `shared/data/*.txt` erano esclusi in cima e rientravano tutti dentro
    `desktop/app-payload/`. Il test guarda i nomi nel layer, dove la differenza
    fra le due scritture si vede; nel `.dockerignore` sembrano la stessa cosa.
    """
    deep = [
        name
        for name in entries
        if any(
            f"/{directory}/" in name.removeprefix("app/")
            for directory in ("tests", "e2e", "__pycache__", "node_modules")
        )
    ]

    assert deep == []


def test_what_the_container_needs_survives_the_deep_exclusions(entries):
    """Il costo di una regola larga e' quello che porta via senza dirlo.

    `shared/release/` ha il nome di una cartella esclusa ed e' codice che gira
    nel container: se un giorno l'esclusione in profondita' se lo mangia,
    l'immagine si rompe all'avvio e non qui — a meno che qui non ci sia questo.
    """
    for path in KEPT_ON_PURPOSE:
        assert any(
            name == path or name.startswith(f"{path}/") for name in entries
        ), path
