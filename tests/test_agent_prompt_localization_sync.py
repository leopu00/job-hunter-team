"""Localized prompt assets and declared security guards.

Keep inheritance of every team rule (including injection defenses), translated
prohibitions and the ban on forbidden commands in executable examples. The
numbering check anchors inheritance; resource checks cover missing translations.
Ordinary wording, citations and local role numbering checks are retired.
"""


import re
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent


AGENTS_DIR = REPO_ROOT / 'agents'


SKILLS_DIR = AGENTS_DIR / '_skills'


TEAM_RULES = AGENTS_DIR / '_team' / 'team-rules.md'


LOCALES = ('it', 'es', 'fr', 'de', 'pt', 'hu')


RANGE_RE = re.compile(r'\bT(\d{2})\.\.T(\d{2})\b')


RULE_HEADING_RE = re.compile(r'^#+\s.*\bRULE-T(\d{2})\b', re.MULTILINE)


FORBIDDEN_MARKERS = {
    'en': 'FORBIDDEN', 'it': 'VIETATO', 'es': 'PROHIBIDO', 'fr': 'INTERDIT',
    'de': 'VERBOTEN', 'pt': 'PROIBIDO', 'hu': 'TILOS',
}


BACKTICK_RE = re.compile(r'`([^`\n]+)`')


FENCE_RE = re.compile(r'^```.*?^```', re.MULTILINE | re.DOTALL)


FORBIDDEN_IN_CODE_BLOCKS = {
    # Il curl nudo che l'Analista non deve piu' fare a mano: RULE-03 impone
    # `recheck-liveness`. Le sei traduzioni lo ORDINAVANO in un blocco bash fino
    # al 2026-07-30, pur citando la skill — di qui il check.
    # `grep` sta nello STESSO divieto ma NON e' qui: la RULE-03 lo vieta sulla
    # JD, non in assoluto, e l'header dell'Analista lo usa lecitamente per
    # ricavare il proprio numero di sessione. Ennesima prova che la polarita'
    # non si deriva: due token nella stessa riga, uno proibito e uno no.
    ('analista', 'curl'),
}


RETIRED_ROLE_RULES = {
    # C-06: mai assegnato — la sezione fu rinumerata e il numero resto' libero.
    'capitano': {6},
    # S-01..S-03, S-08: mai assegnati — la numerazione della Sentinella nasce da
    # S-04 e salta S-08 (verificato 2026-07-30: zero riferimenti in tutta la repo).
    'sentinella': {1, 2, 3, 8},
}


KNOWN_SKILL_LOCALIZATION_GAPS = set()


def _roles():
    """Ruoli = sottodir di agents/ con un prompt baseline `<role>/<role>.md`."""
    out = []
    for d in sorted(AGENTS_DIR.iterdir()):
        if not d.is_dir() or d.name.startswith('_'):
            continue
        if (d / f'{d.name}.md').exists():
            out.append(d.name)
    return out


def _prompt_files(role):
    """[(lang, Path)] per il ruolo: EN baseline + le localizzazioni presenti."""
    base = AGENTS_DIR / role
    files = [('en', base / f'{role}.md')]
    for loc in LOCALES:
        p = base / f'{role}.{loc}.md'
        if p.exists():
            files.append((loc, p))
    return files


def _read(path):
    return path.read_text(encoding='utf-8')


def _last_team_rule():
    """Numero dell'ultima RULE-Txx definita in team-rules.md (es. 17)."""
    nums = [int(n) for n in RULE_HEADING_RE.findall(_read(TEAM_RULES))]
    assert nums, f'nessuna intestazione RULE-Txx trovata in {TEAM_RULES}'
    return max(nums)


def _skills_list(role):
    """Skill dichiarate in agents/<role>/skills.list (righe non commento)."""
    sl = AGENTS_DIR / role / 'skills.list'
    if not sl.exists():
        return []
    return [ln.strip() for ln in _read(sl).splitlines()
            if ln.strip() and not ln.strip().startswith('#')]


def _team_rules_files():
    """[(lang, Path)] per team-rules: EN baseline + le 6 localizzazioni."""
    files = [('en', TEAM_RULES)]
    for loc in LOCALES:
        files.append((loc, TEAM_RULES.parent / f'team-rules.{loc}.md'))
    return files


def _team_rule_headings(path):
    """Numeri delle RULE-Txx DEFINITE (intestazione) nel file."""
    return {int(n) for n in RULE_HEADING_RE.findall(_read(path))}


def _forbidden_blocks(path, marker):
    'Testo dei blocchi che APRONO un divieto con `marker`.'
    lines = _read(path).split('\n')
    blocks = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if marker in ln and (ln.startswith('#') or '**' in ln):
            buf = [ln]
            j = i + 1
            while j < len(lines):
                nxt = lines[j]
                if nxt.strip():
                    buf.append(nxt)
                    j += 1
                    continue
                # riga vuota: si prosegue solo se sotto c'e' ancora un elenco
                k = j
                while k < len(lines) and not lines[k].strip():
                    k += 1
                # `- voce`, non `**RULE-04**`: il grassetto apre con `*` anche lui
                if k < len(lines) and re.match(r'\s*[-+*]\s', lines[k]):
                    buf.extend(lines[j:k + 1])
                    j = k + 1
                    continue
                break
            blocks.append('\n'.join(buf))
            i = j
            continue
        i += 1
    return blocks


def _forbidden_tokens(path, marker):
    """Token tecnici (fra backtick) nominati dai divieti del file."""
    out = set()
    for block in _forbidden_blocks(path, marker):
        out.update(BACKTICK_RE.findall(block))
    return out


def _code_fences(path):
    """Corpo dei blocchi recintato ```...``` del file: cio' che l'agente ESEGUE."""
    return FENCE_RE.findall(_read(path))


def test_team_rules_numbering_is_contiguous():
    """Le regole in team-rules.md sono T01..TNN senza buchi (ancora del gate)."""
    nums = sorted(int(n) for n in RULE_HEADING_RE.findall(_read(TEAM_RULES)))
    assert nums, f'nessuna regola trovata in {TEAM_RULES}'
    expected = list(range(1, nums[-1] + 1))
    assert nums == expected, (
        f'numerazione non contigua in {TEAM_RULES}: trovate {nums}, attese {expected}'
    )


def test_every_role_has_all_localizations():
    """Ogni ruolo ha il prompt EN + tutte e 6 le localizzazioni."""
    missing = []
    for role in _roles():
        for loc in LOCALES:
            p = AGENTS_DIR / role / f'{role}.{loc}.md'
            if not p.exists():
                missing.append(str(p.relative_to(REPO_ROOT)))
    assert not missing, 'localizzazioni mancanti:\n  ' + '\n  '.join(missing)


def test_declared_skills_have_all_localizations():
    'Ogni skill dichiarata in uno `skills.list` esiste in tutte e 7 le lingue.'
    declared = set()
    for role in _roles():
        declared.update(_skills_list(role))
    missing = []
    stale = []
    for skill in sorted(declared):
        d = SKILLS_DIR / skill
        if not (d / 'SKILL.md').exists():
            missing.append(f'{skill}: manca del tutto (dichiarata in uno skills.list)')
            continue
        for loc in LOCALES:
            key = (skill, loc)
            present = (d / f'SKILL.{loc}.md').exists()
            if not present and key not in KNOWN_SKILL_LOCALIZATION_GAPS:
                missing.append(f'agents/_skills/{skill}/SKILL.{loc}.md')
            elif present and key in KNOWN_SKILL_LOCALIZATION_GAPS:
                stale.append(f'{key} — ora esiste')
    assert not missing, (
        'localizzazioni mancanti per skill DICHIARATE nei manifest (l\'agente '
        'riceve il baseline EN in silenzio):\n  ' + '\n  '.join(missing)
    )
    assert not stale, (
        'voci obsolete in KNOWN_SKILL_LOCALIZATION_GAPS (buco sanato, '
        'togliere dalla lista):\n  ' + '\n  '.join(stale)
    )


def test_inherited_rule_range_reaches_last_team_rule():
    "Ogni prompt dichiara di ereditare fino all'ULTIMA regola di team-rules.md."
    last = _last_team_rule()
    problems = []
    for role in _roles():
        for lang, path in _prompt_files(role):
            ranges = RANGE_RE.findall(_read(path))
            rel = path.relative_to(REPO_ROOT)
            if not ranges:
                problems.append(f'{rel}: nessuna dichiarazione "T01..Txx" trovata')
                continue
            for lo, hi in ranges:
                if int(lo) != 1 or int(hi) != last:
                    problems.append(
                        f'{rel}: dichiara T{lo}..T{hi}, atteso T01..T{last:02d} '
                        f'({lang})'
                    )
    assert not problems, (
        'range di eredita disallineato con {} (ultima regola: T{:02d}):\n  '.format(
            TEAM_RULES.relative_to(REPO_ROOT), last)
        + '\n  '.join(problems)
    )


def test_en_prohibitions_survive_translation():
    'Se il baseline EN VIETA qualcosa, la traduzione vieta le STESSE cose.'
    problems = []
    for role in _roles():
        en_path = AGENTS_DIR / role / f'{role}.md'
        expected = _forbidden_tokens(en_path, FORBIDDEN_MARKERS['en'])
        if not expected:
            continue
        for lang, path in _prompt_files(role):
            if lang == 'en':
                continue
            found = _forbidden_tokens(path, FORBIDDEN_MARKERS[lang])
            rel = path.relative_to(REPO_ROOT)
            if not found:
                problems.append(
                    f'{rel}: il baseline EN ha un divieto su '
                    f'{sorted(expected)}, qui non c\'e\' nessun blocco '
                    f'"{FORBIDDEN_MARKERS[lang]}"'
                )
                continue
            for tok in sorted(expected - found):
                problems.append(f'{rel}: il divieto EN nomina `{tok}`, qui no')
    assert not problems, (
        'divieti del baseline EN non riprodotti nelle localizzazioni:\n  '
        + '\n  '.join(problems)
    )


def test_translations_never_prescribe_what_en_forbids():
    "Cio' che il baseline VIETA non compare in un blocco eseguibile, in nessuna lingua."
    stale = []
    problems = []
    for role, token in sorted(FORBIDDEN_IN_CODE_BLOCKS):
        en_path = AGENTS_DIR / role / f'{role}.md'
        if token not in _forbidden_tokens(en_path, FORBIDDEN_MARKERS['en']):
            stale.append(
                f'({role!r}, {token!r}): {en_path.relative_to(REPO_ROOT)} non lo '
                f'vieta (piu\'?) — togli la voce o rimetti il divieto in EN'
            )
            continue
        for lang, path in _prompt_files(role):
            for fence in _code_fences(path):
                if re.search(r'(?<![\w-])' + re.escape(token) + r'(?![\w-])', fence):
                    problems.append(
                        f'{path.relative_to(REPO_ROOT)} ({lang}): blocco eseguibile '
                        f'con `{token}`, che il baseline EN vieta'
                    )
                    break
    assert not stale, (
        'voci di FORBIDDEN_IN_CODE_BLOCKS non piu\' ancorate al baseline:\n  '
        + '\n  '.join(stale)
    )
    assert not problems, (
        'il prompt ORDINA cio\' che il baseline VIETA:\n  ' + '\n  '.join(problems)
    )


def test_team_rules_localizations_exist():
    """Le 6 `team-rules.<locale>.md` esistono accanto al baseline EN."""
    missing = [str(p.relative_to(REPO_ROOT))
               for _lang, p in _team_rules_files() if not p.exists()]
    assert not missing, 'team-rules localizzate mancanti:\n  ' + '\n  '.join(missing)


def test_team_rules_localizations_define_the_same_rules():
    'Ogni `team-rules.<locale>.md` definisce ESATTAMENTE le RULE-Txx del file EN.'
    baseline = _team_rule_headings(TEAM_RULES)
    problems = []
    for lang, path in _team_rules_files():
        if lang == 'en':
            continue
        if not path.exists():
            continue  # gia' segnalato da test_team_rules_localizations_exist
        found = _team_rule_headings(path)
        rel = path.relative_to(REPO_ROOT)
        for n in sorted(baseline - found):
            problems.append(f'{rel}: manca RULE-T{n:02d} (definita in EN)')
        for n in sorted(found - baseline):
            problems.append(f'{rel}: definisce RULE-T{n:02d}, assente in EN')
    assert not problems, (
        'regole team-wide disallineate fra EN e localizzazioni:\n  '
        + '\n  '.join(problems)
    )


@pytest.mark.parametrize("guard,change", [
    (test_inherited_rule_range_reaches_last_team_rule, "range"),
    (test_en_prohibitions_survive_translation, "prohibition"),
    (test_translations_never_prescribe_what_en_forbids, "command"),
], ids=["range", "prohibition", "command"])
def test_security_guards_reject_a_mutated_localization(tmp_path, monkeypatch, guard, change):
    """Each guard accepts a clean corpus and rejects its own historical failure."""
    import sys

    agents = tmp_path / "agents"
    role = agents / "analista"
    role.mkdir(parents=True)
    rules = agents / "_team" / "team-rules.md"
    rules.parent.mkdir()
    rules.write_text("## RULE-T01\n## RULE-T02\n", encoding="utf-8")
    baseline = "T01..T02\n\n**FORBIDDEN** `curl`\n"
    translated = "T01..T02\n\n**VIETATO** `curl`\n"
    (role / "analista.md").write_text(baseline, encoding="utf-8")
    path = role / "analista.it.md"
    path.write_text(translated, encoding="utf-8")
    module = sys.modules[__name__]
    monkeypatch.setattr(module, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(module, "AGENTS_DIR", agents)
    monkeypatch.setattr(module, "TEAM_RULES", rules)
    guard()
    mutations = {
        "range": translated.replace("T01..T02", "T01..T01"),
        "prohibition": translated.replace("`curl`", "`other`"),
        "command": translated + "\n```bash\ncurl https://example.invalid\n```\n",
    }
    path.write_text(mutations[change], encoding="utf-8")
    with pytest.raises(AssertionError):
        guard()
