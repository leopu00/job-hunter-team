"""L'indice docs/internal/README.md deve conoscere tutte le note archiviate.

Origine: audit 2026-07-25 — l'indice era stato riallineato a mano e il buco si e'
riaperto in cinque giorni (11 file su 115 non indicizzati al 30/07, sei dei quali
erano le spec degli ultimi tre giorni, cioe' proprio quelle che il BACKLOG cita
come "Spec: ..."). Aggiornare l'indice non fa parte del gesto di creare un ticket,
quindi non succede: serve un test.

## L'esenzione, e perche' e' stretta

Il Protocollo note interne (in fondo a docs/internal/README.md) dice di scrivere
la nota nuova **in root**, al volo, senza scegliere subito la categoria: la root
e' una zona di scarico deliberata, e pretendere l'indicizzazione immediata
renderebbe il test un fastidio da silenziare. Quindi:

  * i file in `docs/internal/` (root) sono esenti dall'indicizzazione — ma non
    illimitati: oltre ROOT_DROPZONE_MAX il test fallisce comunque, che e' la
    regola 2 del protocollo ("~10 note in root → smistale") scritta in codice;
  * i `README.md` (indice stesso e indici di sotto-cartella) sono esenti;
  * tutto il resto — cioe' ogni file gia' smistato in una sotto-cartella — deve
    comparire come link nell'indice.

Nessun'altra allow-list. Se un file in sotto-cartella e' davvero di passaggio, la
via giusta e' cancellarlo o archiviarlo, non aggiungere un'eccezione qui: e' cosi'
che i test di consistenza smettono di dire qualcosa.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
INTERNAL_DIR = REPO_ROOT / 'docs' / 'internal'
INDEX = INTERNAL_DIR / 'README.md'

# Quante note non smistate tollerare in docs/internal/ (root) prima di
# considerare scaduto lo smistamento periodico (protocollo, regola 2).
ROOT_DROPZONE_MAX = 12

_LINK_RE = re.compile(r'\]\(([^)]+?\.md)(?:#[^)]*)?\)')


def _indexed_targets() -> set:
    """Path (relativi a docs/internal/) linkati dall'indice.

    I link fuori dall'albero (`../REVIEW-LOG.md`, `../../../game/...`) vengono
    scartati: qui interessa solo cosa dell'albero interno e' raggiungibile.
    """
    text = INDEX.read_text(encoding='utf-8')
    targets = set()
    for raw in _LINK_RE.findall(text):
        if raw.startswith(('http://', 'https://')):
            continue
        resolved = (INTERNAL_DIR / raw).resolve()
        try:
            targets.add(resolved.relative_to(INTERNAL_DIR.resolve()).as_posix())
        except ValueError:
            continue  # punta fuori da docs/internal/
    return targets


def _present_notes() -> list:
    """`.md` sotto docs/internal/, esclusi README e la dropzone di root."""
    notes = []
    for path in sorted(INTERNAL_DIR.rglob('*.md')):
        rel = path.relative_to(INTERNAL_DIR).as_posix()
        if path.name == 'README.md':
            continue
        if '/' not in rel:
            continue  # root = dropzone, coperta dal test dedicato
        notes.append(rel)
    return notes


def test_every_sorted_note_is_indexed():
    missing = sorted(set(_present_notes()) - _indexed_targets())
    assert not missing, (
        'Note smistate ma assenti da docs/internal/README.md '
        f'({len(missing)}):\n  - ' + '\n  - '.join(missing) +
        '\n\nAggiungi una riga nella tabella della categoria corrispondente '
        '(link + una frase su cosa ci si trova). Se la nota non merita '
        "l'indice, non merita nemmeno la sotto-cartella: archiviala in "
        '_archive/ o cancellala.'
    )


def test_index_has_no_dangling_links():
    """Il contrario: nessuna riga dell'indice punta a un file sparito."""
    dangling = sorted(
        rel for rel in _indexed_targets()
        if not (INTERNAL_DIR / rel).exists()
    )
    assert not dangling, (
        'Link morti in docs/internal/README.md:\n  - ' + '\n  - '.join(dangling)
    )


def test_root_dropzone_is_periodically_sorted():
    """La root e' una zona di scarico, non un archivio parallelo."""
    root_notes = sorted(
        p.name for p in INTERNAL_DIR.glob('*.md') if p.name != 'README.md'
    )
    assert len(root_notes) <= ROOT_DROPZONE_MAX, (
        f'{len(root_notes)} note non smistate in docs/internal/ '
        f'(max {ROOT_DROPZONE_MAX}):\n  - ' + '\n  - '.join(root_notes) +
        '\n\nProtocollo, regola 2: spostale nelle sotto-cartelle con `git mv` '
        "e aggiorna l'indice."
    )
