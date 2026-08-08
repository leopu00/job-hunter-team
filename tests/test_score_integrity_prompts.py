"""
Priorità di ricerca lecita, filtro di esclusione vietato — in tutte e 7 le lingue.

Perché esiste ([SCORE-INTEGRITY-NO-UPSTREAM-FILTER], 2026-07-27): al Capitano
è stato chiesto di far «imparare dai punteggi» gli Scout, e lui ha emesso due
istruzioni — *dai priorità a ciò che punteggia bene* e *evita ciò che
punteggia male*. Uno Scout ha **rifiutato la seconda e ha chiesto conferma
scritta**; il Capitano l'ha ritirata. Il ragionamento di quello Scout è la
regola che qui viene codificata: se gli Scout filtrano a monte, lo Scorer
valuta alla cieca, l'utente legge lo score come misura oggettiva e **i
punteggi si gonfiano da soli**. Il guasto è silenzioso e il suo sintomo —
punteggi più alti — si legge come una buona notizia. Un danno era già
iniziato: un senior auditor scartato sul solo titolo (recuperato).

Prima di questo commit né `agents/scout/` né `agents/scorer/` dicevano niente
in proposito: la garanzia era il giudizio di un singolo agente.

Eseguire con: pytest tests/test_score_integrity_prompts.py -v
"""

import os

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
AGENTS_DIR = os.path.join(REPO_ROOT, 'agents')
LANGS = ('', '.it', '.es', '.fr', '.de', '.pt', '.hu')


def _prompt(role, lang):
    path = os.path.join(AGENTS_DIR, role, f'{role}{lang}.md')
    with open(path, encoding='utf-8') as f:
        return path, f.read()


def _rule_block(text, marker):
    """Il testo della regola che APRE con `marker`, fino alla regola dopo.

    Nei prompt una regola sta a volte su una riga sola (SC-04) e a volte su
    un titolo seguito da paragrafi (RULE-10): il confine affidabile è l'inizio
    della regola successiva o della sezione successiva, non la riga vuota.
    """
    out, taking = [], False
    for line in text.split('\n'):
        starts_rule = line.startswith('**RULE-') or line.startswith('**SC-')
        if marker in line and '**' in line:
            taking = True
        elif taking and (line.startswith('## ') or line.startswith('---')
                         or starts_rule):
            break
        if taking:
            out.append(line)
    return '\n'.join(out)


# ── Scout: cosa può decidere e cosa no ──────────────────────────────────

@pytest.mark.parametrize('lang', LANGS)
def test_sc04_lists_only_mechanical_rejects(lang):
    path, text = _prompt('scout', lang)
    block = _rule_block(text, 'SC-04')
    assert block, f'{path}: SC-04 non trovata'
    # I quattro reject meccanici, ognuno verificabile senza giudizio. I token
    # sono tecnici apposta: la prosa è localizzata, questi no.
    assert 'work-auth' in block.lower() or 'work auth' in block.lower(), path
    assert 'real_years + 3' in block, path
    assert 'SC-05' in block, path            # duplicato
    # …e il perno: il punteggio atteso non è un criterio di ingresso.
    assert 'total_score' in block, path
    assert '`excluded`' in block, path
    assert '`checked`' in block, path


@pytest.mark.parametrize('lang', LANGS)
def test_sc04_no_longer_skips_on_the_title_alone(lang):
    """Il danno già avvenuto: un senior auditor scartato sul solo titolo.
    La seniority è un reject solo quando l'annuncio la chiede come requisito
    hard, non quando compare nel titolo."""
    path, text = _prompt('scout', lang)
    block = _rule_block(text, 'SC-04')
    assert 'senior+/lead+/principal+' not in block, path


@pytest.mark.parametrize('lang', LANGS)
def test_sc04_tells_the_scout_to_refuse_a_filtering_order(lang):
    """La difesa che ha funzionato il 2026-07-27 era un agente che ha chiesto
    conferma scritta: qui smette di dipendere dal singolo."""
    path, text = _prompt('scout', lang)
    block = _rule_block(text, 'SC-04')
    assert '2026-07-27' in block, path
    assert 'Capitano' in block or 'Capitanó' in block, path


# ── Scorer: misura una popolazione che non sceglie ──────────────────────

@pytest.mark.parametrize('lang', LANGS)
def test_the_scorer_knows_it_measures_and_does_not_select(lang):
    path, text = _prompt('scorer', lang)
    block = _rule_block(text, 'RULE-10')
    assert block, f'{path}: RULE-10 non trovata'
    # Rimanda alla regola dello Scout: le due metà devono restare agganciate.
    assert 'SC-04' in block, path
    # E sa cosa fare quando i punteggi bassi spariscono dalla coda.
    assert '[ESC]' in block, path
    assert 'RULE-09' in block, path


@pytest.mark.parametrize('lang', LANGS)
def test_the_scorer_rule_is_numbered_after_the_last_one(lang):
    """RULE-10 viene DOPO la 09: un numero riusato collide con le citazioni."""
    _, text = _prompt('scorer', lang)
    assert '**RULE-09' in text and '**RULE-10' in text
    assert text.index('**RULE-09') < text.index('**RULE-10')
