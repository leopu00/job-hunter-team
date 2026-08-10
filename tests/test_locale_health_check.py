"""Il canary della locale: classifica giusto, e il MANTENITORE lo sa in 7 lingue.

Due blocchi, per le due metà del ticket O-38 (2026-08-10).

**1. `locale_health.py` distingue cosmetico da corrotto.** È l'unica distinzione
che conta: un pane che si vede con `_` al posto delle accentate può essere un
difetto di RENDERING (dati sani, si segnala) o dati DAVVERO corrotti (P1, si
escala), e trattare il primo come il secondo — o peggio il secondo come il
primo — è come si «ripara» il problema sbagliato. Il verdetto viaggia
sull'exit code: 0 ok, 1 cosmetic, 2 data_corruption.

C'è anche il test della trappola che ha quasi mangiato il check: CPython
converte da solo la locale legacy C/POSIX (PEP 538) e SCRIVE `LC_CTYPE=C.UTF-8`
dentro `os.environ`. Misurato il 10/08: in un container senza `LANG`,
`docker exec ... env` non stampa nulla ma un check Python su `os.environ`
legge `C.UTF-8` e dice «sano». Per questo la sorgente è `/proc/1/environ`,
l'ambiente che il compose dà al container.

**2. Il controllo esiste in tutte e sette le lingue.** Il prompt del Mantenitore
e la sua skill `maintainer-sweep` vivono in EN + 6 localizzazioni: toccarne una
sola vuol dire che per sei utenti su sette il controllo NON esiste (stessa
trappola di O-20). Qui non si verifica il valore in un file, si verifica la
COERENZA fra i sette.

Eseguire:
    pytest tests/test_locale_health_check.py -v
"""

import os
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
sys.path.insert(0, SKILLS_DIR)

import locale_health as lh  # noqa: E402

# EN (file senza suffisso) + le 6 localizzazioni affiancate, come in
# tests/test_agent_prompt_localization_sync.py.
LOCALES = ('it', 'es', 'fr', 'de', 'pt', 'hu')
PROMPTS = [os.path.join(REPO_ROOT, 'agents', 'mantenitore', name) for name in
           ['mantenitore.md'] + ['mantenitore.%s.md' % loc for loc in LOCALES]]
SKILL_FILES = [os.path.join(REPO_ROOT, 'agents', '_skills', 'maintainer-sweep', name)
               for name in ['SKILL.md'] + ['SKILL.%s.md' % loc for loc in LOCALES]]


def _read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


# ── 1. La classificazione ────────────────────────────────────────────────

class TestVerdetto:

    def _scan(self, monkeypatch, env, panes):
        """`scan()` con sessioni e catture finte: il resto è il vero codice."""
        monkeypatch.setattr(lh, 'sessions', lambda: list(panes))
        monkeypatch.setattr(lh, '_tmux', lambda args, text=True: panes[args[args.index('-t') + 1]])
        return lh.scan(env=env)

    def test_locale_utf8_e_pane_puliti_e_ok(self, monkeypatch):
        res = self._scan(monkeypatch, {'LANG': 'C.UTF-8'},
                         {'capitano': 'perché è così'.encode('utf-8')})
        assert res['verdict'] == 'ok'
        assert res['healthy'] is True
        assert lh.EXIT_CODES[res['verdict']] == 0

    def test_locale_assente_ma_byte_sani_e_solo_cosmetico(self, monkeypatch):
        """Il caso del 10/08: nessuna locale, 0 byte invalidi → si segnala, non si
        grida al dato corrotto."""
        res = self._scan(monkeypatch, {},
                         {'capitano': 'perché è così'.encode('utf-8')})
        assert res['verdict'] == 'cosmetic'
        assert res['corrupted_sessions'] == []
        assert res['non_ascii_chars'] == 3      # é, è, ì
        assert lh.EXIT_CODES[res['verdict']] == 1

    def test_byte_invalidi_sono_data_corruption_anche_con_locale_giusta(self, monkeypatch):
        """La locale a posto NON assolve i byte: qui l'agente legge davvero una
        parola per un'altra, ed è un P1 da escalare."""
        res = self._scan(monkeypatch, {'LANG': 'C.UTF-8'},
                         {'capitano': b'perch\xe8 latin-1'})
        assert res['verdict'] == 'data_corruption'
        assert res['corrupted_sessions'] == ['capitano']
        assert res['panes'][0]['invalid_byte'] == '0xE8'
        assert lh.EXIT_CODES[res['verdict']] == 2

    def test_la_corruzione_batte_il_cosmetico(self, monkeypatch):
        """Locale assente E byte invalidi: vince la diagnosi peggiore, altrimenti
        un P1 uscirebbe dal giro etichettato come difetto di visualizzazione."""
        res = self._scan(monkeypatch, {},
                         {'sana': 'è'.encode('utf-8'), 'rotta': b'\xe8'})
        assert res['verdict'] == 'data_corruption'
        assert res['corrupted_sessions'] == ['rotta']

    def test_decodifica_senza_accentate_e_una_prova_debole(self, monkeypatch):
        """Verde onesto: se nel campione non c'era una sola accentata, la
        decodifica è passata perché non c'era niente da sbagliare."""
        res = self._scan(monkeypatch, {'LANG': 'C.UTF-8'}, {'vuota': b'only ascii'})
        assert res['verdict'] == 'ok'
        assert res['decode_proof_weak'] is True


class TestSorgenteDellaLocale:

    def test_precedenza_posix(self):
        assert lh.effective_locale({'LC_ALL': 'C.UTF-8', 'LANG': 'POSIX'})[0] == 'LC_ALL'
        assert lh.effective_locale({'LC_CTYPE': 'POSIX', 'LANG': 'C.UTF-8'}) == ('LC_CTYPE', 'POSIX')
        assert lh.effective_locale({}) == (None, '')

    def test_legge_pid1_e_non_l_ambiente_di_python(self, tmp_path, monkeypatch):
        """La regressione della trappola PEP 538.

        Container rotto (pid1 senza `LANG`) + processo Python con
        `LC_CTYPE=C.UTF-8` iniettata da CPython: leggere `os.environ` darebbe
        `ok`, cioè verde su un difetto vivo. Il verdetto atteso è `cosmetic`.
        """
        environ = tmp_path / 'environ'
        environ.write_bytes(b'HOME=/jht_home\x00JHT_LANG=it\x00')
        monkeypatch.setenv('LC_CTYPE', 'C.UTF-8')
        monkeypatch.setattr(lh, 'sessions', lambda: [])

        env, source = lh.container_env(str(environ))
        assert source == 'container-pid1'
        assert 'LC_CTYPE' not in env and env['JHT_LANG'] == 'it'

        res = lh.scan(environ_path=str(environ))
        assert res['env']['read_from'] == 'container-pid1'
        assert res['verdict'] == 'cosmetic'

    def test_fuori_dal_container_ripiega_sul_processo_e_lo_dichiara(self, tmp_path, monkeypatch):
        """Su macOS/host `/proc/1/environ` non esiste: si ripiega, ma il report
        dice sempre da dove ha letto (un verdetto non deve mentire sulla misura)."""
        monkeypatch.setenv('LANG', 'it_IT.UTF-8')
        monkeypatch.setattr(lh, 'sessions', lambda: [])
        res = lh.scan(environ_path=str(tmp_path / 'non-esiste'))
        assert res['env']['read_from'] == 'process'
        assert res['verdict'] == 'ok'


# ── 2. Le sette lingue, coerenti fra loro ────────────────────────────────

# Ogni segnale è ciò che rende il controllo ESEGUIBILE, non una parola tradotta:
# il nome dello script (che l'agente lancia), i due verdetti (che decidono se
# segnalare o escalare). Sono token tecnici: restano identici in ogni lingua,
# quindi si possono cercare senza sapere quale lingua si sta leggendo.
SEGNALI = ('locale_health.py', 'cosmetic', 'data_corruption')


@pytest.mark.parametrize('path', SKILL_FILES, ids=lambda p: os.path.basename(p))
def test_la_skill_porta_il_passo_7_in_ogni_lingua(path):
    text = _read(path)
    for segnale in SEGNALI:
        assert segnale in text, f"{os.path.basename(path)}: manca `{segnale}`"
    # Senza la voce in allowed-tools l'agente NON può lanciare lo script: il
    # passo esisterebbe scritto e non eseguibile.
    assert 'Bash(python3 /app/shared/skills/locale_health.py *)' in text, (
        f"{os.path.basename(path)}: locale_health.py fuori da allowed-tools"
    )
    assert '### 7. ' in text, f"{os.path.basename(path)}: manca il passo 7 nel giro"


@pytest.mark.parametrize('path', PROMPTS, ids=lambda p: os.path.basename(p))
def test_il_prompt_cita_il_controllo_in_ogni_lingua(path):
    text = _read(path)
    assert 'locale_health.py' in text, (
        f"{os.path.basename(path)}: il Mantenitore non sa di dover controllare la locale"
    )
    assert '7. ' in text, f"{os.path.basename(path)}: il passo 7 non è nella checklist dello sweep"


# Per il CONTEGGIO servono token che nessuna lingua possa diluire: `cosmetic`
# non va bene (l'italiano «cosmetico» lo contiene come sottostringa, e in prosa
# inglese ricorre da solo), questi due invece sono identificatori — o ci sono,
# o non ci sono, in qualunque lingua.
SEGNALI_CONTATI = ('locale_health.py', 'data_corruption')


@pytest.mark.parametrize('files,gruppo', [(SKILL_FILES, 'skill'), (PROMPTS, 'prompt')],
                         ids=['skill', 'prompt'])
def test_nessuna_localizzazione_resta_indietro(files, gruppo):
    """Il gate che O-20 avrebbe voluto: il conteggio dei segnali dev'essere lo
    STESSO in tutti e sette i file. Se qualcuno aggiunge un dettaglio solo in
    inglese, qui si vede — è la coerenza fra le versioni a essere verificata,
    non il valore in una sola."""
    segnali = SEGNALI_CONTATI if gruppo == 'skill' else ('locale_health.py',)
    conteggi = {os.path.basename(p): tuple(_read(p).count(s) for s in segnali)
                for p in files}
    assert len(set(conteggi.values())) == 1, f"{gruppo}: localizzazioni divergenti → {conteggi}"
