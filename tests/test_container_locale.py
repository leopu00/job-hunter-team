"""La locale di SISTEMA del container è dichiarata, e nello stesso modo ovunque.

Origine: 2026-08-10 (O-38). Nel container `LANG` era vuota, glibc derivava
`LC_CTYPE=POSIX` e chi si attaccava a un pane da fuori
(`docker exec -it jht tmux attach`) vedeva `_` al posto di ogni lettera
accentata. I dati erano sani — nel buffer la «è» era 0xC3 0xA8 — ma un pane
illeggibile è un pane che nessuno legge.

Perché un test e non solo la riga nel compose:

1. **Il nome inganna.** Nel compose esisteva già `JHT_LANG`, che è la lingua del
   PRODOTTO (en|it) scelta al wizard. Chi legge di fretta trova «LANG» dentro
   «JHT_LANG» e conclude che la locale c'è. Qui le due variabili sono asserite
   separatamente: cancellare `LANG` lasciando `JHT_LANG` fa fallire il test.

2. **Il compose è quello del repo**, scaricato da `install.sh` e riscaricato
   da `jht upgrade`: vale per la flotta VPS e per le installazioni CLI. Fino
   all'08/10 il test teneva allineato anche il payload che il gioco Godot
   scriveva sul disco dell'utente desktop
   (`game/scripts/backend/payloads/runtime_compose.yml`); Godot è abbandonato,
   e il confronto fra i due è stato tolto con lui.

Eseguire:
    pytest tests/test_container_locale.py -v
"""

import os

import yaml

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# Il compose base: ogni servizio che ha un environment dichiara la locale. Da
# quando c'e' il broker dei segreti i servizi sono due, e il conteggio va fatto
# per servizio, non sul file intero.
BASE = os.path.join(REPO_ROOT, 'docker-compose.yml')
# Gli override si sommano al base: non devono ridichiarare LANG due volte nello
# stesso servizio, ne' metterci una locale non UTF-8.
OVERRIDES = [
    os.path.join(REPO_ROOT, name)
    for name in ('docker-compose.podman.yml', 'docker-compose.dev.yml')
    if os.path.exists(os.path.join(REPO_ROOT, name))
]


def _environment(service):
    """Le chiavi e i valori dell'environment, nella forma lista o mappa. La
    chiave e' confrontata intera: `JHT_LANG` non passa mai per `LANG`."""
    env = (service or {}).get('environment')
    if env is None:
        return None
    if isinstance(env, dict):
        return [(str(k), '' if v is None else str(v)) for k, v in env.items()]
    pairs = []
    for item in env:
        key, _, value = str(item).partition('=')
        pairs.append((key.strip(), value.strip()))
    return pairs


class _ComposeLoader(yaml.SafeLoader):
    """I tag di merge di compose (`!reset`, `!override`) letti come il loro
    contenuto: qui conta che cosa dichiarano, non come si fondono."""


def _compose_tag(loader, node):
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node)
    return loader.construct_scalar(node)


for _tag in ('!reset', '!override'):
    _ComposeLoader.add_constructor(_tag, _compose_tag)


def _services(path):
    with open(path, encoding='utf-8') as f:
        return (yaml.load(f, Loader=_ComposeLoader) or {}).get('services') or {}


def _langs(pairs):
    return [value for key, value in pairs if key == 'LANG']


def _utf8(value):
    return 'utf-8' in value.lower() or 'utf8' in value.lower()


def test_ogni_compose_dichiara_una_locale_utf8():
    services = _services(BASE)
    assert services, "docker-compose.yml: nessun servizio"
    for name, service in services.items():
        pairs = _environment(service)
        if pairs is None:
            continue
        found = _langs(pairs)
        assert found, (
            f"docker-compose.yml, servizio {name}: manca `LANG=...` nell'environment. Senza, "
            "LC_CTYPE resta POSIX e i pane si vedono con `_` al posto delle accentate."
        )
        assert len(found) == 1, f"docker-compose.yml, servizio {name}: LANG dichiarata {len(found)} volte"
        assert _utf8(found[0]), f"docker-compose.yml, servizio {name}: LANG={found[0]} non e' una locale UTF-8"
    for path in OVERRIDES:
        for name, service in _services(path).items():
            found = _langs(_environment(service) or [])
            assert len(found) <= 1, f"{os.path.basename(path)}, servizio {name}: LANG dichiarata {len(found)} volte"
            assert all(_utf8(v) for v in found), f"{os.path.basename(path)}, servizio {name}: LANG non UTF-8"


def test_lang_e_jht_lang_restano_due_variabili_distinte():
    """`JHT_LANG` (lingua del prodotto) non sostituisce `LANG` (locale di sistema).

    La trappola del ticket: chi «vede LANG» dentro `JHT_LANG` potrebbe rinominare
    l'una nell'altra credendo di semplificare. Sono due cose diverse — una la
    sceglie l'utente al wizard fra en|it, l'altra è neutra e vale per tutte e 7
    le lingue del prodotto. Vale per il servizio del team, quello che ha la
    lingua del prodotto.
    """
    pairs = _environment(_services(BASE)['jht'])
    keys = [key for key, _ in pairs]
    assert 'JHT_LANG' in keys, "docker-compose.yml: sparita JHT_LANG (lingua del prodotto)"
    assert 'LANG' in keys, "docker-compose.yml: sparita LANG (locale di sistema)"
