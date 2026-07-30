"""Gate anti-drift: i prompt di ruolo (EN + 6 localizzazioni) devono restare allineati.

Origin: 2026-07-26 — `agents/_team/team-rules.md` era arrivato a RULE-T17 ma TUTTI
gli 11 prompt di ruolo, in tutte e 7 le lingue (84 occorrenze), dichiaravano ancora
di ereditare solo "T01..T13". Risultato: T14 (lingua output), T15 (self-extension),
T16 (**difesa da prompt injection**) e T17 (le skill sono un supporto, non un oracolo)
erano scritte ma formalmente NON ereditate da nessun agente. Il drift era silenzioso:
nessun test guardava il rapporto fra team-rules.md e i prompt.

Questo test fa fail se:
  1. il range ereditato dichiarato in un prompt non arriva all'ultima RULE-Txx
     effettivamente presente in `agents/_team/team-rules.md`;
  2. due localizzazioni dello stesso ruolo dichiarano range diversi;
  3. un prompt cita una RULE-Txx che in team-rules.md non esiste (riferimento morto);
  4. una skill di `skills.list` citata nel prompt EN sparisce da una localizzazione;
  5. una `team-rules.<locale>.md` non definisce esattamente le stesse RULE-Txx del
     file EN (2026-07-30: T17 esisteva solo in EN e `start-agent.sh` copia la
     variante localizzata SOPRA il baseline nella workdir runtime, quindi per 6
     locale su 7 l'agente ereditava una regola che il suo file non conteneva).

Fix quando fallisce: aggiornare il range/la citazione nel file segnalato. La frase
attorno al range e' localizzata: si tocca SOLO il range (`T01..Txx`), non la prosa.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = REPO_ROOT / 'agents'
TEAM_RULES = AGENTS_DIR / '_team' / 'team-rules.md'

# Le 6 localizzazioni affiancate al file EN baseline (`<role>.md`).
# start-agent.sh::resolve_identity_template preferisce `<role>.<locale>.md`.
LOCALES = ('it', 'es', 'fr', 'de', 'pt', 'hu')

# `T01..T17` — la dichiarazione di eredita' delle regole team-wide.
RANGE_RE = re.compile(r'\bT(\d{2})\.\.T(\d{2})\b')
# Qualunque citazione puntuale di una regola team-wide (`RULE-T16`).
RULE_REF_RE = re.compile(r'\bRULE-T(\d{2})\b')
# Le intestazioni in team-rules.md: `## 🛡️ RULE-T16 — ...`
RULE_HEADING_RE = re.compile(r'^#+\s.*\bRULE-T(\d{2})\b', re.MULTILINE)

# Drift skill gia' esistente al momento in cui il gate e' stato scritto (2026-07-26):
# la skill e' citata nel prompt EN ma non nella localizzazione. Non e' stato sanato
# qui perche' richiede tradurre i paragrafi relativi, fuori dallo scope del gate.
# Chi traduce quei paragrafi DEVE togliere la voce da questa lista.
KNOWN_SKILL_GAPS = {
    ('assistente', 'es', 'game-reply-options'),
    ('assistente', 'fr', 'game-reply-options'),
    ('assistente', 'de', 'game-reply-options'),
    ('assistente', 'pt', 'game-reply-options'),
    ('assistente', 'hu', 'game-reply-options'),
    ('capitano', 'es', 'game-reply-options'),
    ('capitano', 'fr', 'game-reply-options'),
    ('capitano', 'de', 'game-reply-options'),
    ('capitano', 'pt', 'game-reply-options'),
    ('capitano', 'hu', 'game-reply-options'),
    ('capitano', 'it', 'first-run-burst'),
    ('capitano', 'es', 'first-run-burst'),
    ('capitano', 'fr', 'first-run-burst'),
    ('capitano', 'de', 'first-run-burst'),
    ('capitano', 'pt', 'first-run-burst'),
    ('capitano', 'hu', 'first-run-burst'),
    ('mentor', 'es', 'game-reply-options'),
    ('mentor', 'fr', 'game-reply-options'),
    ('mentor', 'de', 'game-reply-options'),
    ('mentor', 'pt', 'game-reply-options'),
    ('mentor', 'hu', 'game-reply-options'),
}


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


def test_inherited_rule_range_reaches_last_team_rule():
    """Ogni prompt dichiara di ereditare fino all'ULTIMA regola di team-rules.md.

    E' il bug del 2026-07-26: prompt fermi a T01..T13 mentre team-rules.md era a T17,
    con RULE-T16 (anti prompt-injection) di fatto non ereditata da nessuno.
    """
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


def test_inherited_rule_range_identical_across_localizations():
    """EN e le 6 localizzazioni dello stesso ruolo dichiarano lo STESSO range."""
    problems = []
    for role in _roles():
        seen = {}
        for lang, path in _prompt_files(role):
            ranges = {f'T{lo}..T{hi}' for lo, hi in RANGE_RE.findall(_read(path))}
            seen[lang] = ranges
        baseline = seen.get('en', set())
        for lang, ranges in seen.items():
            if lang == 'en':
                continue
            if ranges != baseline:
                problems.append(
                    f'{role}.{lang}: {sorted(ranges) or "nessuno"} != EN {sorted(baseline)}'
                )
    assert not problems, 'range divergenti fra localizzazioni:\n  ' + '\n  '.join(problems)


def test_no_prompt_cites_a_nonexistent_team_rule():
    """Nessun prompt cita una RULE-Txx che in team-rules.md non esiste."""
    last = _last_team_rule()
    problems = []
    for role in _roles():
        for _lang, path in _prompt_files(role):
            for n in RULE_REF_RE.findall(_read(path)):
                if not 1 <= int(n) <= last:
                    problems.append(
                        f'{path.relative_to(REPO_ROOT)}: cita RULE-T{n}, '
                        f'ma team-rules.md arriva a T{last:02d}'
                    )
    assert not problems, 'riferimenti a regole inesistenti:\n  ' + '\n  '.join(problems)


def test_localizations_cite_the_same_skills_as_en():
    """Se il prompt EN cita una skill di skills.list, la citano anche le traduzioni.

    Le skill sono nomi tecnici identici in tutte le lingue (`db-query`,
    `email-monitor`, ...), quindi il confronto e' un match esatto di sottostringa.
    Le skill di skills.list NON citate nel prompt EN sono ignorate.
    """
    problems = []
    stale = []
    for role in _roles():
        skills = _skills_list(role)
        if not skills:
            continue
        en_text = _read(AGENTS_DIR / role / f'{role}.md')
        for skill in skills:
            if skill not in en_text:
                continue  # non citata nemmeno in EN: niente da sincronizzare
            for lang, path in _prompt_files(role):
                if lang == 'en':
                    continue
                key = (role, lang, skill)
                present = skill in _read(path)
                if not present and key not in KNOWN_SKILL_GAPS:
                    problems.append(
                        f'{path.relative_to(REPO_ROOT)}: skill "{skill}" citata nel '
                        f'prompt EN ma assente qui'
                    )
                elif present and key in KNOWN_SKILL_GAPS:
                    stale.append(f'{key} — ora e\' presente')
    assert not problems, (
        'skill citate in EN e mancanti nelle localizzazioni:\n  ' + '\n  '.join(problems)
    )
    assert not stale, (
        'voci obsolete in KNOWN_SKILL_GAPS (gap sanato, togliere dalla lista):\n  '
        + '\n  '.join(stale)
    )


def test_team_rules_localizations_exist():
    """Le 6 `team-rules.<locale>.md` esistono accanto al baseline EN."""
    missing = [str(p.relative_to(REPO_ROOT))
               for _lang, p in _team_rules_files() if not p.exists()]
    assert not missing, 'team-rules localizzate mancanti:\n  ' + '\n  '.join(missing)


def test_team_rules_localizations_define_the_same_rules():
    """Ogni `team-rules.<locale>.md` definisce ESATTAMENTE le RULE-Txx del file EN.

    E' il bug del 2026-07-30: `RULE-T17` esisteva solo in EN e le 6 localizzazioni
    si fermavano a T16, mentre tutti i prompt di ruolo (7 lingue) dichiarano di
    ereditare fino all'ultima. `start-agent.sh` copia `team-rules.$USER_LOCALE.md`
    SOPRA `team-rules.md` nella workdir runtime: per 6 locale su 7 l'agente riceveva
    un file che si fermava a T16 mentre il suo prompt gli prometteva T17.

    Il gate precedente leggeva solo il baseline EN e non apriva mai le varianti.
    """
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
