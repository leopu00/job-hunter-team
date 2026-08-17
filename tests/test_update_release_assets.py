"""#156 — l'updater non deve pretendere file che nessuno pubblica.

`game/scripts/support/update_check.gd` decide se un aggiornamento si puo'
installare cercando asset con NOMI FISSI dentro la release. Il workflow di
release pubblica asset con nomi fissi. Sono due liste che devono combaciare, e
finora niente le confrontava: su Windows l'updater ne pretende due che nessun
workflow ha mai prodotto (`WINDOWS-UPDATE-MANIFEST.json` e il suo `.sig`).

Oggi quel disallineamento non rompe niente — il percorso Windows e' dormiente
da tre lati insieme (asset assenti, `can_self_install()` macOS-only,
`windows_forward_allowed()` senza chiamanti nel prodotto) — ed e' proprio
questo che lo rende pericoloso: **e' invisibile finche' non conta**. Il giorno
in cui qualcuno accende meta' percorso, l'altra meta' manca in silenzio.

Il rischio VIVO pero' non e' Windows: e' macOS, che si installa davvero e che
dipende dal nome `job-hunter-team.zip`. Se il workflow lo rinomina, l'unico
aggiornamento in-app che esiste smette di funzionare senza che un solo test
diventi rosso — e il sintomo sarebbe «gli utenti macOS non aggiornano piu'»,
scoperto settimane dopo.

Si leggono i FILE VERI, non una lista scritta a mano: una lista a mano si
disallinea da cio' che gira, e a quel punto il test sorveglia se stesso. Il
workflow dichiara i nomi in due punti — `--expected-asset` (il verificatore) e
il blocco `files:` (cio' che viene caricato) — e li si controlla entrambi,
perche' un nome verificato ma non caricato e' assente esattamente quanto uno
che non esiste.
"""

from __future__ import annotations

import re
from fnmatch import fnmatch
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
UPDATER = ROOT / "game/scripts/support/update_check.gd"
WORKFLOW = ROOT / ".github/workflows/release.yml"

CONST = re.compile(r'^const (\w+) := "([^"]*)"', re.M)
EXPECTED_ASSET = re.compile(r"--expected-asset\s+(\S+)")
FILES_BLOCK = re.compile(r"^\s*files:\s*\|\n((?:[ \t]+\S+\n)+)", re.M)
SELF_INSTALL_BODY = re.compile(
    r"static func can_self_install\([^)]*\)[^\n]*\n((?:\t.*\n)+)"
)
# `required.append_array([...])` dentro asset_bundle: i nomi delle costanti che
# la funzione pretende in piu' per Windows.
WINDOWS_EXTRA = re.compile(r"required\.append_array\(\[([^\]]+)\]\)")

# Quali costanti l'updater pretende, per sistema. Non e' dedotta dal codice —
# un parser GDScript sarebbe piu' fragile di cio' che sorveglia — ma il test
# `test_la_mappa_riflette_ancora_il_codice` la tiene ancorata alla funzione.
REQUIRED_BY_OS = {
    "macOS": ["MACOS_ASSET"],
    "Windows": ["WINDOWS_ASSET", "WINDOWS_MANIFEST_ASSET", "WINDOWS_SIGNATURE_ASSET"],
}
# La coppia che il contratto dormiente pretende e che nessuno pubblica.
DORMANT = ["WINDOWS_MANIFEST_ASSET", "WINDOWS_SIGNATURE_ASSET"]


def _updater() -> str:
    return UPDATER.read_text(encoding="utf-8")


def _consts() -> dict[str, str]:
    return dict(CONST.findall(_updater()))


def _self_install_os() -> set[str]:
    """I sistemi su cui l'applicazione dichiara di sapersi installare da sola."""
    body = SELF_INSTALL_BODY.search(_updater())
    assert body, "can_self_install non trovata: il test non puo' giudicare"
    return set(re.findall(r'"([^"]+)"', body.group(1)))


def _upload_globs() -> list[str]:
    block = FILES_BLOCK.search(WORKFLOW.read_text(encoding="utf-8"))
    assert block, "blocco `files:` non trovato in release.yml"
    return [line.strip().split("/")[-1] for line in block.group(1).split("\n") if line.strip()]


def _verified_assets() -> set[str]:
    return set(EXPECTED_ASSET.findall(WORKFLOW.read_text(encoding="utf-8")))


CONSTS = _consts()
SELF_INSTALL = _self_install_os()
VERIFIED = _verified_assets()
GLOBS = _upload_globs()


def _is_uploaded(name: str) -> bool:
    return any(fnmatch(name, glob) for glob in GLOBS)


def _published(name: str) -> bool:
    """Pubblicato = verificato dal verificatore E caricato sulla release."""
    return name in VERIFIED and _is_uploaded(name)


def test_le_due_liste_sono_state_lette_davvero():
    """Liste vuote renderebbero verde qualunque cosa."""
    assert len(CONSTS) >= 4, CONSTS
    assert VERIFIED, "nessun --expected-asset letto dal workflow"
    assert GLOBS, "nessun file caricato letto dal workflow"
    assert SELF_INSTALL, "can_self_install non nomina alcun sistema"


def test_la_mappa_riflette_ancora_il_codice():
    """Se `asset_bundle` cambia i suoi requisiti, la mappa qui sopra mente."""
    source = _updater()
    extra = WINDOWS_EXTRA.search(source)
    assert extra, "asset_bundle non aggiunge piu' requisiti per Windows"
    nominati = {name.strip() for name in extra.group(1).split(",")}
    assert nominati == set(DORMANT), nominati
    # Il pacchetto per sistema: `MACOS_ASSET if os_name == "macOS" else WINDOWS_ASSET`.
    assert "MACOS_ASSET if os_name ==" in source
    assert 'else WINDOWS_ASSET' in source


@pytest.mark.parametrize("const_name", ["MACOS_ASSET", "WINDOWS_ASSET"])
def test_il_pacchetto_che_l_updater_cerca_esiste_nella_release(const_name):
    """Il binario per sistema deve esistere anche dove l'installazione e' spenta.

    Su Windows l'app non installa, ma il nome resta quello che l'utente scarica
    dalla pagina: se il workflow lo rinomina e qui non se ne accorge nessuno,
    l'updater cerca un file che non c'e' piu'.
    """
    name = CONSTS[const_name]
    assert _published(name), (
        f"`{const_name}` vale «{name}», che la release non pubblica. "
        f"Verificati: {sorted(VERIFIED)}. Caricati: {GLOBS}. "
        f"O si allinea il nome nel workflow, o si allinea la costante."
    )


@pytest.mark.parametrize("os_name", sorted(REQUIRED_BY_OS))
def test_dove_l_installazione_e_accesa_tutti_i_file_richiesti_sono_pubblicati(os_name):
    """La regola vera: se ci si installa da soli, i file devono esserci TUTTI.

    Questo test e' verde su Windows soltanto perche' Windows non si installa da
    solo. Il giorno in cui `can_self_install` lo nomina, questa riga pretende
    anche il manifest e la firma — che e' esattamente la domanda che #156 ha
    trovato senza risposta.
    """
    if os_name not in SELF_INSTALL:
        pytest.skip(f"{os_name}: installazione automatica spenta, niente da pretendere")
    mancanti = [
        CONSTS[c] for c in REQUIRED_BY_OS[os_name] if not _published(CONSTS[c])
    ]
    assert not mancanti, (
        f"{os_name} si installa da solo ma la release non pubblica {mancanti}. "
        f"Un aggiornamento in-app che cerca un file inesistente non parte, e "
        f"non lo dice: o li si pubblica dal workflow, o si spegne {os_name} in "
        f"`can_self_install`."
    )


def test_il_contratto_windows_e_dormiente_da_entrambi_i_lati():
    """Le due meta' devono muoversi insieme, o non muoversi affatto.

    Accenderne una sola e' il modo in cui #156 e' nato: il codice pretendeva
    asset che nessuno pubblicava, e siccome l'altra meta' era spenta nessuno
    poteva accorgersene.
    """
    pubblicati = [CONSTS[c] for c in DORMANT if _published(CONSTS[c])]
    windows_acceso = "Windows" in SELF_INSTALL
    if pubblicati and not windows_acceso:
        pytest.fail(
            f"la release pubblica {pubblicati} ma `can_self_install` non nomina "
            f"Windows: gli asset esistono e nessuno li usa. Manca l'ultimo "
            f"passo (helper + trust root distribuiti, poi Windows in "
            f"`can_self_install`), oppure vanno tolti dal workflow."
        )
    if windows_acceso and not pubblicati:
        pytest.fail(
            "`can_self_install` nomina Windows ma la release non pubblica "
            f"{[CONSTS[c] for c in DORMANT]}: l'aggiornamento in-app Windows "
            "non partira' mai, in silenzio. E' il difetto di #156, riaperto."
        )
