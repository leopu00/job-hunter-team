"""I dati dell'utente si cancellano solo se l'utente lo chiede — e mai in silenzio.

[WIN-USERDIR-SURVIVES-REINSTALL] Il difetto non era che la cartella dati
sopravviva alla disinstallazione: quella è una DIRETTIVA. Era che ripartire
puliti non fosse possibile nemmeno volendolo. La cura è un componente
opzionale della disinstallazione, deselezionato per default.

Questo test guarda il SORGENTE dell'installer (`game/installer/windows.nsi`),
perché è l'unica verifica possibile senza buildare ed eseguire l'installer —
e soprattutto perché il difetto che deve prevenire è una MODIFICA FUTURA:
qualcuno che, per far «ripartire pulito» tutti, toglie il `/o` o sposta il
`RMDir /r` nella sezione sempre eseguita. A quel punto ogni disinstallazione
porterebbe via profilo, lingua e configurazione di un utente reale, e non
esiste undo. Un installer che cancella i dati da solo è il danno peggiore che
questo prodotto possa fare.

Che il comportamento sia quello anche a runtime lo verifica la smoke di CI
(`scripts/build-windows-installer.ps1 -Smoke`, sentinella nel userdir attorno
alla disinstallazione silenziosa): qui si sorveglia l'intenzione scritta nello
script, là il fatto.
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
NSI = REPO / "game" / "installer" / "windows.nsi"
SMOKE = REPO / "scripts" / "build-windows-installer.ps1"

# I percorsi che contengono roba dell'utente. Il primo è `user://` di Godot
# (il gioco non imposta use_custom_user_dir), il secondo l'app Electron di
# prima.
USERDATA_TOKENS = ("app_userdata", "JHT Desktop")


def nsi() -> str:
    return NSI.read_text(encoding="utf-8")


def defines() -> dict[str, str]:
    return dict(re.findall(r'^!define\s+(\w+)\s+"([^"]*)"', nsi(), re.MULTILINE))


def expand(text: str) -> str:
    """Sostituisce i `${NOME}` col valore del loro `!define`.

    Serve perché lo script nomina i percorsi tramite define, e un controllo
    che cercasse solo le stringhe letterali sarebbe cieco proprio alla
    regressione da prevenire: `RMDir /r "${USERDATA_DIR}"` spostato nella
    sezione sempre eseguita non contiene né `app_userdata` né `JHT Desktop`.
    Questo test è già stato falsamente verde una volta, per questa ragione.
    """
    for name, value in defines().items():
        text = text.replace("${" + name + "}", value)
    return text


def sections() -> dict[str, str]:
    """nome della sezione -> suo corpo, con i define già espansi."""
    found: dict[str, str] = {}
    for match in re.finditer(
        r"^Section\s+(?P<head>.*?)$(?P<body>.*?)^SectionEnd",
        nsi(),
        re.MULTILINE | re.DOTALL,
    ):
        found[match.group("head").strip()] = expand(match.group("body"))
    return found


def test_il_parser_trova_le_sezioni():
    # Senza questa soglia un rename o un refactor dello script renderebbe ogni
    # asserzione qui sotto un verde su un dizionario vuoto.
    heads = sections()
    assert len(heads) >= 3, heads
    assert any(h.startswith('"Install"') for h in heads), heads


def test_i_define_dei_percorsi_esistono_e_dicono_dove():
    # Se i define sparissero, `expand` non espanderebbe niente e i controlli
    # sui percorsi tornerebbero ciechi in silenzio.
    d = defines()
    assert "app_userdata\\Job Hunter Team" in d.get("USERDATA_DIR", ""), d
    assert "JHT Desktop" in d.get("USERDATA_DIR_LEGACY", ""), d


def userdata_section() -> tuple[str, str]:
    for head, body in sections().items():
        if "SEC_UN_USERDATA" in head:
            return head, body
    raise AssertionError(
        "sezione dei dati utente assente: la scelta di ripartire puliti è "
        "sparita dallo script"
    )


def test_la_rimozione_dei_dati_e_opt_in():
    head, _ = userdata_section()
    # `/o` = deselezionata all'apertura. È l'intero punto del ticket: senza,
    # la spunta sarebbe già messa e chi clicca avanti perde i suoi dati.
    assert re.match(r"^/o\s", head), (
        f"la sezione dei dati utente NON è /o (deselezionata): {head!r}"
    )


def test_nessuna_cancellazione_dei_dati_fuori_dalla_sezione_opt_in():
    """Il controllo che vale: nessun altro punto dello script li tocca."""
    offenders: list[str] = []
    for head, body in sections().items():
        if "SEC_UN_USERDATA" in head:
            continue
        for lineno, line in enumerate(body.splitlines(), 1):
            if any(token in line for token in USERDATA_TOKENS):
                offenders.append(f"{head} → {line.strip()}")
    assert offenders == [], (
        "i dati utente sono toccati fuori dalla sezione opzionale "
        f"(rimozione incondizionata = direttiva violata): {offenders}"
    )


def test_la_sezione_opt_in_cancella_entrambe_le_cartelle_e_solo_quelle():
    _, body = userdata_section()
    removals = re.findall(r'RMDir\s+/r\s+"([^"]+)"', body)
    assert len(removals) == 2, removals
    joined = " ".join(removals)
    assert "app_userdata\\Job Hunter Team" in joined, removals
    assert "JHT Desktop" in joined, removals
    # Il genitore NON si tocca: lì vivono i dati di altri giochi Godot, che
    # non sono nostri da cancellare.
    for path in removals:
        assert not path.rstrip("\\").endswith("app_userdata"), path
    # Ogni rimozione è preceduta da una guardia di esistenza: un RMDir su una
    # cartella che non c'è non è un danno, ma il log direbbe una cosa falsa.
    assert body.count("IfFileExists") == 2, body


def test_la_pagina_componenti_esiste_e_sta_dopo_la_conferma():
    src = nsi()
    confirm = src.index("MUI_UNPAGE_CONFIRM")
    components = src.index("MUI_UNPAGE_COMPONENTS")
    instfiles = src.index("MUI_UNPAGE_INSTFILES")
    # Prima si conferma la disinstallazione, poi si scelgono i componenti, e
    # solo dopo si tocca il disco.
    assert confirm < components < instfiles


def test_il_programma_non_si_puo_deselezionare():
    for head, body in sections().items():
        if "SEC_UN_APP" in head:
            assert "SectionIn RO" in body, body
            return
    raise AssertionError("sezione del programma assente")


def test_installare_sopra_dati_esistenti_non_cambia():
    """Nessuna pagina nuova nel percorso di INSTALLAZIONE, nessun reset."""
    src = nsi()
    install_pages = re.findall(r"!insertmacro\s+(MUI_PAGE_[A-Z_]+)", src)
    assert install_pages == [
        "MUI_PAGE_WELCOME",
        "MUI_PAGE_DIRECTORY",
        "MUI_PAGE_INSTFILES",
        "MUI_PAGE_FINISH",
    ], install_pages
    install_body = next(
        body for head, body in sections().items() if head.startswith('"Install"')
    )
    for token in USERDATA_TOKENS:
        assert token not in install_body, (
            f"l'installazione tocca i dati utente ({token}): reinstallare "
            "sopra dati esistenti deve restare invariato"
        )


def test_la_smoke_di_ci_pretende_che_i_dati_sopravvivano():
    """La direttiva non resta affidata alla memoria di chi rilegge lo script."""
    src = SMOKE.read_text(encoding="utf-8")
    assert "app_userdata" in src
    assert "userDataSentinel" in src
    # L'asserzione deve essere sul SOPRAVVIVERE, cioè un throw quando il file
    # NON c'è più dopo la disinstallazione silenziosa.
    assert re.search(
        r"if\s*\(-not\s*\(Test-Path\s+-LiteralPath\s+\$userDataSentinel\)\)\s*\{\s*\n\s*throw",
        src,
    ), "manca l'asserzione che i dati sopravvivono alla disinstallazione /S"
