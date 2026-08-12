"""Test del census fail-closed — [BRANCH-LIFECYCLE-CLEANUP].

Il census non cancella niente, ma quello che dichiara guida una cancellazione
fatta a mano: se sbaglia categoria, qualcuno rimuove il ramo sbagliato. Quindi
i test tengono ferme le due confusioni che costano:

  * un ref integrato la cui worktree è VIVA non è un candidato (`origin/dev2`);
  * un ref con commit unici sta fra i protetti o fra i «da decidere», mai fra
    le scorie, anche se è vecchio (`origin/game`, 30 commit, T-018).

E il fail-closed: quando una sonda non risponde o due sonde si contraddicono,
l'elemento finisce fra i DA GUARDARE e l'uscita è 1. Non tace e non indovina.

Eseguire con:
    pytest tests/test_branch_census.py -v
"""

import importlib.util
import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CENSUS_PY = os.path.join(REPO_ROOT, 'scripts', 'branch_census.py')


def _load():
    spec = importlib.util.spec_from_file_location('branch_census', CENSUS_PY)
    module = importlib.util.module_from_spec(spec)
    # Registrare il modulo PRIMA di eseguirlo: `@dataclass` risale a
    # `sys.modules[cls.__module__]` per risolvere le annotazioni, e su un modulo
    # non registrato trova `None` e muore in collection.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


bc = _load()


def ref(name, ancestor, unique, error=None, tracking_sha='aaaa111'):
    return bc.RefFacts(name, ancestor, unique, '2026-08-10', error, tracking_sha)


def live_on_origin(*names, sha='aaaa111'):
    """Mappa branch→sha come la ritorna `git ls-remote --heads`."""
    return {n: sha for n in names}


def wt(path, branch, is_main=False, prunable=None):
    return bc.WorktreeFacts(path, branch, is_main, prunable)


# ── classify_ref ──────────────────────────────────────────────────────────


def test_ref_integrato_e_quello_con_commit_unici_non_si_confondono():
    integrated, _ = bc.classify_ref(ref('origin/docs', True, 0))
    unique, reason = bc.classify_ref(ref('origin/backend', False, 1))
    assert integrated == bc.INTEGRATED
    assert unique == bc.UNIQUE
    assert 'decisione' in reason


def test_game_e_protetta_e_i_suoi_30_commit_restano_nel_verdetto():
    """Il caso che dimostra che «è vecchia» non è un criterio (T-018)."""
    category, reason = bc.classify_ref(ref('origin/game', False, 30))
    assert category == bc.PROTECTED
    assert '30 commit unici' in reason
    assert 'non è una branch morta' in reason


def test_un_ramo_a_vita_lunga_integrato_non_e_una_scoria():
    category, reason = bc.classify_ref(ref('origin/production', True, 0))
    assert category == bc.PROTECTED
    assert 'vita lunga' in reason


@pytest.mark.parametrize('ancestor,unique', [(False, 0), (True, 3)])
def test_sonde_che_si_contraddicono_finiscono_da_guardare(ancestor, unique):
    """0 commit unici implica antenato, e viceversa: se non torna, non indovino."""
    category, reason = bc.classify_ref(ref('origin/x', ancestor, unique))
    assert category == bc.UNKNOWN
    assert 'incoerenti' in reason


@pytest.mark.parametrize('facts', [
    ref('origin/x', None, 0),
    ref('origin/x', True, None),
    ref('origin/x', True, 0, error='git è morto'),
])
def test_un_ref_su_cui_git_non_risponde_finisce_da_guardare(facts):
    category, _ = bc.classify_ref(facts)
    assert category == bc.UNKNOWN


def test_anche_un_protetto_su_cui_git_non_risponde_finisce_da_guardare():
    """Fail-closed prima di tutto: «protetta» non è una scusa per non sapere."""
    category, _ = bc.classify_ref(ref('origin/game', None, None))
    assert category == bc.UNKNOWN


# ── ref_is_candidate ──────────────────────────────────────────────────────


def test_un_ref_integrato_senza_worktree_e_candidato():
    assert bc.ref_is_candidate(bc.INTEGRATED, None) is True
    assert bc.ref_is_candidate(bc.INTEGRATED, bc.SESSION_ABSENT) is True


@pytest.mark.parametrize('session', [
    bc.SESSION_LIVE,      # ci sta lavorando una sessione: giù le mani
    bc.SESSION_UNKNOWN,   # probe fallito: il dubbio non autorizza niente
    bc.SESSION_SKIPPED,   # sezione saltata: idem
])
def test_un_ref_integrato_con_worktree_non_libera_non_e_candidato(session):
    assert bc.ref_is_candidate(bc.INTEGRATED, session) is False


@pytest.mark.parametrize('category', [bc.UNIQUE, bc.PROTECTED, bc.UNKNOWN])
def test_solo_gli_integrati_diventano_candidati(category):
    assert bc.ref_is_candidate(category, bc.SESSION_ABSENT) is False


# ── classify_worktree ─────────────────────────────────────────────────────


def test_la_sessione_si_riconosce_dal_nome_della_cartella_o_del_branch():
    by_dir = bc.classify_worktree(wt('C:/repos/jht/dev2', 'dev2'), frozenset({'dev2'}))
    by_branch = bc.classify_worktree(wt('C:/repos/jht/wt-a', 'dev3'), frozenset({'dev3'}))
    assert by_dir.session == bc.SESSION_LIVE
    assert by_branch.session == bc.SESSION_LIVE


def test_una_worktree_senza_sessione_omonima_e_senza_sessione():
    verdict = bc.classify_worktree(wt('C:/repos/jht/vecchia', 'vecchia'),
                                   frozenset({'dev1', 'pwsh'}))
    assert verdict.session == bc.SESSION_ABSENT


def test_la_worktree_principale_e_marcata_e_non_si_rimuove():
    verdict = bc.classify_worktree(wt('C:/repos/jht/master', 'master', is_main=True),
                                   frozenset({'dev1'}))
    assert verdict.session == bc.SESSION_ABSENT
    assert verdict.is_main is True
    assert 'non si rimuove' in verdict.reason


def test_probe_fallito_non_dichiara_nessuna_worktree_abbandonata():
    verdict = bc.classify_worktree(wt('C:/repos/jht/dev2', 'dev2'), None)
    assert verdict.session == bc.SESSION_UNKNOWN
    assert 'non affermo' in verdict.reason


def test_sezione_saltata_non_e_un_guasto():
    verdict = bc.classify_worktree(wt('C:/repos/jht/dev2', 'dev2'), None,
                                   unknown_label=bc.SESSION_SKIPPED)
    assert verdict.session == bc.SESSION_SKIPPED


def test_prunable_di_git_vale_anche_senza_tmux():
    """Segnale nativo di git: la cartella non c'è più. Non dipende dal probe."""
    verdict = bc.classify_worktree(
        wt('C:/repos/jht/sparita', 'sparita', prunable='gitdir file points to non-existent location'),
        None,
    )
    assert verdict.session == bc.SESSION_ABSENT
    assert 'prunable' in verdict.reason


# ── parser ────────────────────────────────────────────────────────────────


def test_parse_worktree_porcelain_legge_principale_detached_e_prunable():
    facts = bc.parse_worktree_porcelain(
        'worktree C:/repos/jht/master\n'
        'HEAD f439df22139b58a6359747714732c3696ccc1bc0\n'
        'branch refs/heads/master\n'
        '\n'
        'worktree C:/repos/jht/dev2\n'
        'HEAD f439df22139b58a6359747714732c3696ccc1bc0\n'
        'branch refs/heads/dev2\n'
        '\n'
        'worktree C:/repos/jht/stacca\n'
        'HEAD abc1234\n'
        'detached\n'
        '\n'
        'worktree C:/repos/jht/sparita\n'
        'HEAD abc1234\n'
        'branch refs/heads/sparita\n'
        'prunable gitdir file points to non-existent location\n'
    )
    assert [f.branch for f in facts] == ['master', 'dev2', None, 'sparita']
    assert [f.is_main for f in facts] == [True, False, False, False]
    assert facts[3].prunable.startswith('gitdir file')


def test_parse_tmux_sessions_prende_solo_i_nomi():
    names = bc.parse_tmux_sessions(
        'dev1: 1 windows (created Tue Aug 11 13:32:13 2026) (attached)\n'
        'dev2: 1 windows (created Tue Aug 11 13:32:14 2026) (attached)\n'
        'pwsh: 1 windows (created Tue Aug 11 13:11:23 2026)\n'
        'riga senza due punti\n'
        '\n'
    )
    assert names == frozenset({'dev1', 'dev2', 'pwsh'})


# ── build_census: lo scenario vero del ticket ─────────────────────────────


def _scenario(sessions):
    refs = [
        ref('origin/docs', True, 0),              # scoria di merge
        ref('origin/e2e-windows', True, 0),       # scoria di merge
        ref('origin/dev2', True, 0),              # integrato MA worktree viva
        ref('origin/dev1', False, 1),             # commit unico
        ref('origin/backend', False, 1),          # commit unico
        ref('origin/game', False, 30),            # protetta, T-018
        ref('origin/production', True, 0),        # protetta, ramo di rilascio
    ]
    worktrees = [
        wt('C:/repos/jht/master', 'master', is_main=True),
        wt('C:/repos/jht/dev1', 'dev1'),
        wt('C:/repos/jht/dev2', 'dev2'),
        wt('C:/repos/jht/ritirata', 'ritirata'),
    ]
    # Tutti e sette esistono davvero su origin: qui si misura il ciclo di vita,
    # non la freschezza della copia locale. Quella ha i suoi test più sotto.
    return bc.build_census(
        'origin/master', 'f439df2213', '2026-08-11', refs, worktrees, sessions,
        remote_refs=live_on_origin(
            'docs', 'e2e-windows', 'dev2', 'dev1', 'backend', 'game', 'production',
        ),
        remote_probe='ok',
    )


def test_il_census_tiene_separate_le_tre_categorie():
    census = _scenario(frozenset({'dev1', 'dev2', 'pwsh'}))
    assert [r.name for r in census.integrated] == [
        'origin/dev2', 'origin/docs', 'origin/e2e-windows',
    ]
    assert [r.name for r in census.with_unique] == ['origin/backend', 'origin/dev1']
    assert [w.name for w in census.worktrees_without_session] == ['master', 'ritirata']
    assert [r.name for r in census.protected] == ['origin/game', 'origin/production']
    assert census.needs_a_look == 0


def test_un_ref_integrato_con_worktree_viva_e_hold_non_candidato():
    """La confusione che il ticket chiede di non fare, tenuta ferma."""
    census = _scenario(frozenset({'dev1', 'dev2'}))
    candidates = [r.name for r in census.candidates]
    assert 'origin/dev2' not in candidates
    assert candidates == ['origin/docs', 'origin/e2e-windows']
    dev2 = next(r for r in census.refs if r.name == 'origin/dev2')
    assert dev2.worktree_session == bc.SESSION_LIVE
    assert 'hold' in dev2.reason


def test_nessun_ref_con_commit_unici_e_mai_candidato():
    census = _scenario(frozenset({'dev1', 'dev2'}))
    for name in ('origin/dev1', 'origin/backend', 'origin/game'):
        assert not next(r for r in census.refs if r.name == name).candidate


def test_col_probe_fallito_niente_e_candidato_se_ha_una_worktree():
    """Fail-closed end-to-end: il dubbio blocca, non libera."""
    census = _scenario(None)
    assert census.needs_a_look == 4          # le 4 worktree, tutte ignote
    assert 'origin/dev2' not in [r.name for r in census.candidates]
    # `docs` non ha worktree: resta candidato anche col probe rotto, perché
    # su di lui il probe non dice niente.
    assert 'origin/docs' in [r.name for r in census.candidates]


def test_una_worktree_ritirata_libera_il_suo_ref():
    census = bc.build_census(
        'origin/master', 'abc', '2026-08-11',
        [ref('origin/ritirata', True, 0)],
        [wt('C:/repos/jht/ritirata', 'ritirata')],
        frozenset({'dev1'}),
        remote_refs=live_on_origin('ritirata'),
        remote_probe='ok',
    )
    assert [r.name for r in census.candidates] == ['origin/ritirata']
    assert [w.name for w in census.worktrees_without_session] == ['ritirata']


# ── il gate sull'esistenza su origin ──────────────────────────────────────


def test_parse_ls_remote_prende_solo_i_branch():
    heads = bc.parse_ls_remote(
        'aaa111\trefs/heads/master\n'
        'bbb222\trefs/heads/preview/o31-cloud\n'
        'ccc333\trefs/tags/v0.3.6\n'
        'ddd444\tHEAD\n'
        '\n'
    )
    assert heads == {'master': 'aaa111', 'preview/o31-cloud': 'bbb222'}


def test_un_ref_confermato_su_origin_allo_stesso_sha():
    status, note = bc.remote_status('aaaa111', {'docs': 'aaaa111'}, 'docs')
    assert status == bc.REMOTE_CONFIRMED
    assert note == ''


def test_un_ref_gia_cancellato_su_origin_e_stale():
    """Il caso vero: 7 dependabot già rimosse dall'auto-delete di GitHub."""
    status, note = bc.remote_status('aaaa111', {'master': 'bbb222'}, 'dependabot/x')
    assert status == bc.REMOTE_STALE
    assert 'fetch --prune' in note


def test_un_ref_che_su_origin_e_andato_avanti_e_drifted():
    status, note = bc.remote_status('aaaa111', {'dev3': 'ffff999'}, 'dev3')
    assert status == bc.REMOTE_DRIFTED
    assert 'sha superato' in note


def test_lo_sha_abbreviato_combacia_con_quello_lungo():
    """Il tracking è risolto per intero, ls-remote pure: ma non diamo per
    scontata la lunghezza, un prefisso valido non deve sembrare una deriva."""
    status, _ = bc.remote_status('aaaa111', {'docs': 'aaaa111bbbccc'}, 'docs')
    assert status == bc.REMOTE_CONFIRMED


def test_senza_risposta_da_origin_niente_e_confermato():
    status, note = bc.remote_status('aaaa111', None, 'docs')
    assert status == bc.REMOTE_UNVERIFIED
    assert 'non verificata' in note


@pytest.mark.parametrize('status', [
    bc.REMOTE_STALE, bc.REMOTE_DRIFTED, bc.REMOTE_UNVERIFIED,
])
def test_solo_un_ref_confermato_su_origin_e_candidato(status):
    assert bc.ref_is_candidate(bc.INTEGRATED, None, status) is False
    assert bc.ref_is_candidate(bc.INTEGRATED, None, bc.REMOTE_CONFIRMED) is True


def test_la_deroga_esplicita_riapre_la_candidatura():
    """`--no-remote-check`: l'operatore accetta i propri ref di tracking."""
    assert bc.ref_is_candidate(
        bc.INTEGRATED, None, bc.REMOTE_UNVERIFIED, trust_tracking=True
    ) is True
    # Ma la deroga vale solo sul remote: gli altri due gate restano.
    assert bc.ref_is_candidate(
        bc.UNIQUE, None, bc.REMOTE_CONFIRMED, trust_tracking=True
    ) is False
    assert bc.ref_is_candidate(
        bc.INTEGRATED, bc.SESSION_LIVE, bc.REMOTE_CONFIRMED, trust_tracking=True
    ) is False


def _scenario_stantio(**kwargs):
    """Un ref integrato che su origin non esiste più: il difetto del 2026-08-12."""
    return bc.build_census(
        'origin/master', 'abc', '2026-08-12',
        [ref('origin/docs', True, 0), ref('origin/fantasma', True, 0)],
        [],
        frozenset(),
        remote_refs=live_on_origin('docs'),
        remote_probe='ok',
        **kwargs,
    )


def test_un_ref_fantasma_non_e_un_candidato_ma_un_da_guardare():
    census = _scenario_stantio()
    assert [r.name for r in census.candidates] == ['origin/docs']
    assert [r.name for r in census.suspect_refs] == ['origin/fantasma']
    assert census.needs_a_look == 1
    assert bc.exit_code(census, strict=False) == 1


def test_il_fantasma_resta_nella_sua_categoria_di_ciclo_di_vita():
    """`stale` è un dubbio sui DATI, non una categoria di ciclo di vita: il ref
    resta fra gli integrati, con l'`hold` che ne spiega il motivo."""
    census = _scenario_stantio()
    fantasma = next(r for r in census.refs if r.name == 'origin/fantasma')
    assert fantasma.category == bc.INTEGRATED
    assert fantasma.remote_status == bc.REMOTE_STALE
    assert 'hold' in fantasma.reason and 'prune' in fantasma.reason


def test_col_probe_di_origin_rotto_nessun_ref_e_candidato():
    census = bc.build_census(
        'origin/master', 'abc', '2026-08-12',
        [ref('origin/docs', True, 0), ref('origin/e2e-windows', True, 0)],
        [], frozenset(),
        remote_refs=None, remote_probe=bc.REMOTE_UNVERIFIED,
    )
    assert census.candidates == []
    assert len(census.suspect_refs) == 2
    assert bc.exit_code(census, strict=False) == 1


def test_con_la_deroga_il_dubbio_sui_dati_non_e_piu_un_da_guardare():
    census = bc.build_census(
        'origin/master', 'abc', '2026-08-12',
        [ref('origin/docs', True, 0)], [], frozenset(),
        remote_refs=None, remote_probe=bc.REMOTE_UNVERIFIED, trust_tracking=True,
    )
    assert [r.name for r in census.candidates] == ['origin/docs']
    assert census.suspect_refs == []
    assert bc.exit_code(census, strict=False) == 0


def test_un_ref_gia_ignoto_non_viene_contato_due_volte():
    """Un ref non classificabile è già DA GUARDARE: non deve sommarsi a sé."""
    census = bc.build_census(
        'origin/master', 'abc', '2026-08-12',
        [ref('origin/rotta', None, None)], [], frozenset(),
        remote_refs=live_on_origin('altra'), remote_probe='ok',
    )
    assert len(census.unknown_refs) == 1
    assert census.suspect_refs == []
    assert census.needs_a_look == 1


# ── codici di uscita ──────────────────────────────────────────────────────


def test_uscita_zero_quando_tutto_e_classificato():
    census = _scenario(frozenset({'dev1', 'dev2'}))
    assert bc.exit_code(census, strict=False) == 0


def test_uscita_uno_quando_qualcosa_non_e_classificato():
    assert bc.exit_code(_scenario(None), strict=False) == 1


def test_strict_esce_tre_solo_se_non_c_e_niente_da_guardare():
    pulito = _scenario(frozenset({'dev1', 'dev2'}))
    assert bc.exit_code(pulito, strict=True) == 3
    # Un ignoto vince sullo strict: il fail-closed non si maschera.
    assert bc.exit_code(_scenario(None), strict=True) == 1


# ── raccolta: su un repo git vero ─────────────────────────────────────────


def _git(args, cwd):
    return subprocess.run(
        ['git', '-c', 'user.email=t@t', '-c', 'user.name=t', *args],
        cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace',
    )


@pytest.fixture()
def repo_con_remote(tmp_path):
    """Un remote vero con `origin/HEAD` simbolico, un ref integrato e uno no."""
    upstream = tmp_path / 'upstream.git'
    work = tmp_path / 'work'
    _git(['init', '--bare', '-b', 'master', str(upstream)], str(tmp_path))
    _git(['clone', str(upstream), str(work)], str(tmp_path))
    (work / 'a.txt').write_text('a', encoding='utf-8')
    _git(['add', '.'], str(work))
    _git(['commit', '-m', 'primo'], str(work))
    _git(['push', '-u', 'origin', 'master'], str(work))
    # Un branch integrato: nasce da master e viene pushato senza aggiungere nulla.
    _git(['branch', 'integrata'], str(work))
    _git(['push', 'origin', 'integrata'], str(work))
    # Un branch con un commit unico.
    _git(['checkout', '-b', 'viva'], str(work))
    (work / 'b.txt').write_text('b', encoding='utf-8')
    _git(['add', '.'], str(work))
    _git(['commit', '-m', 'unico'], str(work))
    _git(['push', 'origin', 'viva'], str(work))
    _git(['checkout', 'master'], str(work))
    _git(['remote', 'set-head', 'origin', 'master'], str(work))
    _git(['fetch', 'origin'], str(work))
    return work


def _run_census(repo, *extra):
    env = dict(os.environ, PYTHONIOENCODING='utf-8')
    return subprocess.run(
        [sys.executable, CENSUS_PY, '--repo', str(repo), '--json',
         '--sessions', 'viva', *extra],
        capture_output=True, text=True, encoding='utf-8', errors='replace', env=env,
    )


def test_il_puntatore_simbolico_origin_head_non_e_un_branch(repo_con_remote):
    """`refname:short` accorcia `refs/remotes/origin/HEAD` a `origin`.

    Filtrando per nome ci passava, e il census proponeva di cancellare
    `origin`. Il filtro giusto è `%(symref)` non vuoto.
    """
    import json
    done = _run_census(repo_con_remote)
    assert done.returncode == 0, done.stderr
    payload = json.loads(done.stdout)
    tutti = [r['name'] for group in ('integrated', 'unique', 'protected', 'unknown_refs')
             for r in payload[group]]
    assert 'origin' not in tutti
    assert 'origin' not in payload['candidates']
    assert 'origin/HEAD' not in tutti


def test_la_raccolta_classifica_come_il_nucleo(repo_con_remote):
    import json
    done = _run_census(repo_con_remote)
    payload = json.loads(done.stdout)
    assert [r['name'] for r in payload['integrated']] == ['origin/integrata']
    assert [r['name'] for r in payload['unique']] == ['origin/viva']
    assert payload['unique'][0]['unique_commits'] == 1
    assert payload['candidates'] == ['origin/integrata']


def test_una_base_che_non_esiste_esce_due(repo_con_remote):
    done = _run_census(repo_con_remote, '--base', 'origin/inesistente')
    assert done.returncode == 2
    assert 'non esiste' in done.stderr


def test_un_branch_cancellato_su_origin_non_e_piu_un_candidato(repo_con_remote):
    """Il difetto del 2026-08-12, riprodotto contro git vero.

    `integrata` viene rimossa dal remote (come fa l'auto-delete di GitHub al
    merge del PR) senza `git fetch --prune` in locale: il ref di tracking resta
    e il census, prima del gate, la annunciava come lavoro da fare.
    """
    import json
    upstream = repo_con_remote.parent / 'upstream.git'
    _git(['branch', '-D', 'integrata'], str(upstream))

    done = _run_census(repo_con_remote)
    payload = json.loads(done.stdout)
    assert payload['candidates'] == []
    assert [r['name'] for r in payload['suspect_refs']] == ['origin/integrata']
    assert payload['suspect_refs'][0]['remote_status'] == bc.REMOTE_STALE
    assert done.returncode == 1

    # Con la deroga esplicita torna candidato: è l'operatore a dichiarare che
    # si fida del proprio tracking, e il report glielo scrive in testa.
    con_deroga = _run_census(repo_con_remote, '--no-remote-check')
    assert json.loads(con_deroga.stdout)['candidates'] == ['origin/integrata']
    assert con_deroga.returncode == 0
