"""
Il funnel degli esiti post-invio — `db_query.py applications` (#187).

Perché esiste: `applications.response` ha UN solo lettore in tutto il prodotto,
il Mentor (`agents/_skills/mentor-patterns/SKILL.md`, Pattern D), che ci calcola
sopra interview rate, rejection rate e ghost rate. Il comando che quella skill
documenta **non esisteva**: `db_query.py applications` rispondeva `invalid
choice: 'applications'`. Quindi il Pattern D non è mai girato — non per
mancanza di candidature (46 inviate in produzione, soglia del Mentor superata)
ma di query.

Cosa proteggono questi test:
  1. che il comando esista con la firma che la skill ha già scritto — il test
     la LEGGE dalla skill invece di ricopiarla, così se qualcuno rinomina un
     flag qui, il rosso arriva dal chiamante vero;
  2. che nessuna candidatura sparisca dal funnel: la somma dei secchielli deve
     fare esattamente le inviate. Un esito scritto con una parola che non
     conosciamo deve comparire col suo nome, non essere ignorato;
  3. che `ghosted` sia DERIVATO dalla soglia dei 30 giorni, verificato nei due
     versi (sopra soglia → ghosted, sotto → pending). È l'unica definizione che
     esiste, ed è il motivo per cui l'esito «nessuna risposta» non ha un
     pulsante nel web;
  4. che un `--order-by` sconosciuto venga RIFIUTATO invece di ripiegare in
     silenzio sul default: un ordinamento ignorato fa leggere le prime 30 righe
     sbagliate credendole le più recenti.

Eseguire con: pytest tests/test_mentor_outcome_funnel.py -v
"""

import json
import os
import re
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_QUERY = os.path.join(SKILLS_DIR, 'db_query.py')
MENTOR_SKILL = os.path.join(
    REPO_ROOT, 'agents', '_skills', 'mentor-patterns', 'SKILL.md'
)

# Lo schema si costruisce in un interprete SEPARATO (stessa ragione di
# test_db_query_json.py: `_db.DB_PATH` è risolto una volta sola all'import).
#
# Il campione: 6 candidature inviate — 1 interview, 2 rejected, 1 con un esito
# che NON è nel vocabolario, 1 senza risposta da 40 giorni (→ ghosted derivato),
# 1 senza risposta da 3 giorni (→ pending) — più 1 mai inviata, che nel funnel
# non deve entrare in nessun secchiello.
_SEED = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)

FIXTURE = [
    ('Backend Engineer',   'Acme SpA',    1, '-5 days',  'interview', '-1 days'),
    ('Data Engineer',      'Beta Srl',    1, '-12 days', 'rejected',  '-2 days'),
    ('Platform Engineer',  'Gamma GmbH',  1, '-20 days', 'rejected',  '-3 days'),
    ('SRE',                'Delta Ltd',   1, '-8 days',  'offerta_verbale', '-1 days'),
    ('Frontend Engineer',  'Epsilon BV',  1, '-40 days', None,        None),
    ('Mobile Engineer',    'Zeta AB',     1, '-3 days',  None,        None),
    ('QA Engineer',        'Eta Oy',      0, None,       None,        None),
]

for title, company, applied, applied_off, response, response_off in FIXTURE:
    cur = conn.execute(
        "INSERT INTO positions (title, company, status, source) VALUES (?,?,?,?)",
        (title, company, 'applied' if applied else 'ready', 'linkedin'))
    pid = cur.lastrowid
    conn.execute(
        "INSERT INTO applications (position_id, status, applied, applied_at, "
        "applied_via, response, response_at) VALUES (?,?,?,"
        + ("datetime('now', ?)" if applied_off else "?") + ",?,?,"
        + ("datetime('now', ?)" if response_off else "?") + ")",
        (pid,
         'response' if response else ('applied' if applied else 'draft'),
         applied,
         applied_off if applied_off else None,
         'linkedin' if applied else None,
         response,
         response_off if response_off else None))
conn.commit()
conn.close()
"""


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / 'jobs.db')
    seed = subprocess.run(
        [sys.executable, '-c', _SEED.format(skills=SKILLS_DIR)],
        capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': path},
    )
    assert seed.returncode == 0, f"seed fallito:\n{seed.stderr}"
    return path


def run(db_path, *args):
    return subprocess.run(
        [sys.executable, DB_QUERY, *args],
        capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': db_path},
        cwd=REPO_ROOT,
    )


def funnel_of(payload):
    return {entry['outcome']: entry['count'] for entry in payload['funnel']}


def mentor_documented_args():
    """Gli argomenti del comando così come il MENTOR lo ha scritto in skill.

    Letti dalla skill, non ricopiati qui: il chiamante vero è quel file, e un
    flag rinominato nel codice deve far diventare rosso questo test — non
    passare inosservato fino al giorno in cui il Mentor prova a girare.
    """
    text = open(MENTOR_SKILL, encoding='utf-8').read()
    # Il comando è spezzato su due righe con il backslash di continuazione: la
    # cattura le segue tutte. Fermarsi al primo `\n` prenderebbe metà comando e
    # il test proverebbe MENO di quello che la sua docstring promette — che è
    # esattamente il difetto che stiamo chiudendo altrove.
    match = re.search(
        r'db_query\.py applications((?:[^\n]*\\\n)*[^\n]*)', text
    )
    assert match, "la skill del Mentor non documenta più `db_query.py applications`"
    raw = match.group(1)
    assert not raw.rstrip().endswith('\\'), (
        f"cattura interrotta a metà comando: {raw!r}"
    )
    args = raw.replace('\\\n', ' ').split()
    assert args, "comando del Mentor senza argomenti: la fixture non prova nulla"
    return args


def test_il_comando_esiste(db):
    """La regressione che questo ticket chiude: prima era `invalid choice`."""
    result = run(db, 'applications', '--json')
    assert result.returncode == 0, result.stderr
    assert 'invalid choice' not in result.stderr


def test_gira_esattamente_come_la_skill_del_mentor_lo_documenta(db):
    args = mentor_documented_args()
    result = run(db, 'applications', *args, '--json')
    assert result.returncode == 0, (
        f"il comando documentato dal Mentor non gira: {args}\n{result.stderr}"
    )
    payload = json.loads(result.stdout.strip())
    assert payload['sent'] == 6


def test_nessuna_candidatura_sparisce_dal_funnel(db):
    payload = json.loads(run(db, 'applications', '--json').stdout)
    counts = funnel_of(payload)
    assert sum(counts.values()) == payload['sent'] == 6, (
        f"il funnel non somma alle inviate: {counts}"
    )
    # La non-inviata resta fuori: il funnel descrive il post-invio.
    assert 'draft' not in counts


def test_un_esito_fuori_vocabolario_compare_col_suo_nome(db):
    """Il funnel CERCA i valori scritti, non li confronta con una lista.

    Se un giorno qualcuno scrive un esito con una parola nostra ma non prevista,
    deve vedersela comparire — altrimenti il conteggio resta giusto solo finché
    nessuno esce dal vocabolario, cioè finché nessuno sbaglia.
    """
    counts = funnel_of(json.loads(run(db, 'applications', '--json').stdout))
    assert counts['offerta_verbale'] == 1
    assert counts['interview'] == 1
    assert counts['rejected'] == 2


def test_ghosted_e_derivato_dalla_soglia_nei_due_versi(db):
    payload = json.loads(run(db, 'applications', '--json').stdout)
    counts = funnel_of(payload)
    assert payload['ghost_after_days'] == 30
    # 40 giorni senza risposta → ghosted.
    assert counts['ghosted'] == 1
    # 3 giorni senza risposta → NON ghosted, è ancora in attesa.
    assert counts['pending'] == 1

    # La clausola falsa: con la soglia più larga della candidatura vecchia,
    # `ghosted` deve sparire. Se restasse, non lo starebbe derivando davvero.
    payload_wide = json.loads(
        run(db, 'applications', '--days', '90', '--json').stdout
    )
    assert payload_wide['sent'] == 6
    assert funnel_of(payload_wide)['ghosted'] == 1, (
        "con finestra a 90 giorni la candidatura di 40 resta ghosted: "
        "la soglia del ghost è 30, indipendente dalla finestra"
    )


def test_la_finestra_si_misura_sull_invio(db):
    """Con 10 giorni di finestra restano solo le 3 inviate negli ultimi 10."""
    payload = json.loads(run(db, 'applications', '--days', '10', '--json').stdout)
    assert payload['sent'] == 3
    assert sum(funnel_of(payload).values()) == 3


def test_soglia_del_campione_dichiarata(db):
    payload = json.loads(run(db, 'applications', '--json').stdout)
    assert payload['sample_floor'] == 10
    # 6 inviate: il Pattern D non ha ancora diritto di parola, e lo dice.
    assert payload['enough_sample'] is False
    human = run(db, 'applications').stdout
    assert 'Sample too small' in human


def test_order_by_sconosciuto_viene_rifiutato(db):
    result = run(db, 'applications', '--order-by', 'total_score:desc', '--json')
    assert result.returncode == 2, result.stdout
    assert 'unknown --order-by column' in result.stderr
    assert result.stdout.strip() == '', (
        "ha stampato un risultato dopo aver rifiutato l'ordinamento"
    )


def test_ordinamento_ammesso_cambia_davvero_l_ordine(db):
    desc = json.loads(
        run(db, 'applications', '--order-by', 'applied_at:desc',
            '--applied', 'true', '--json').stdout
    )['applications']
    asc = json.loads(
        run(db, 'applications', '--order-by', 'applied_at:asc',
            '--applied', 'true', '--json').stdout
    )['applications']
    assert [r['position_id'] for r in desc] == [
        r['position_id'] for r in reversed(asc)
    ]


def test_applied_false_elenca_il_non_inviato_senza_toccare_il_funnel(db):
    payload = json.loads(
        run(db, 'applications', '--applied', 'false', '--json').stdout
    )
    assert [r['title'] for r in payload['applications']] == ['QA Engineer']
    # Il funnel resta quello delle inviate: `--applied` filtra l'elenco, non le
    # percentuali stampate sopra.
    assert payload['sent'] == 6
    assert sum(funnel_of(payload).values()) == 6


def test_segnala_la_conflazione_fra_scritto_e_derivato(db, tmp_path):
    """`ghosted` scritto a mano finirebbe nello stesso secchiello del derivato.

    Non lo separiamo — lo DICIAMO: sommare in silenzio un valore scritto e uno
    calcolato produce un tasso che nessuno può più spiegare.
    """
    inject = (
        "import sys; sys.path.insert(0, %r)\n"
        "from _db import get_db\n"
        "conn = get_db()\n"
        "conn.execute(\"UPDATE applications SET response = 'ghosted' "
        "WHERE position_id = 1\")\n"
        "conn.commit(); conn.close()\n" % SKILLS_DIR
    )
    patched = subprocess.run(
        [sys.executable, '-c', inject], capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': db},
    )
    assert patched.returncode == 0, patched.stderr

    payload = json.loads(run(db, 'applications', '--json').stdout)
    assert payload['response_written_as_derived'] == 1
    human = run(db, 'applications').stdout
    assert 'same bucket' in human
