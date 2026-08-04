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
     locale su 7 l'agente ereditava una regola che il suo file non conteneva);
  6. le numerazioni di ruolo `C-xx` (Capitano) e `S-xx` (Sentinella) hanno buchi
     non dichiarati: i numeri ritirati vanno messi in `RETIRED_ROLE_RULES`, cosi'
     un buco resta leggibile come scelta e non come riferimento perso;
  7. lo stesso numero `C-xx`/`S-xx` e' DEFINITO due volte nello stesso file
     (2026-07-30: `capitano.md` aveva due C-21 — i gate su `set` non lo vedono);
  8. un divieto del baseline EN non si ritrova nella traduzione, o vi si ritrova
     senza i token su cui verte (co-occorrenza: marcatore E oggetto del divieto);
  9. la traduzione ORDINA in un blocco eseguibile cio' che il baseline vieta —
     e' il caso 2026-07-30 dell'Analista, che citava `recheck-liveness` e in un
     blocco bash ordinava il `curl` che l'inglese vieta: il punto 4 lo dava per
     buono perche' guarda solo se il nome della skill compare da qualche parte.

Fix quando fallisce: aggiornare il range/la citazione nel file segnalato. La frase
attorno al range e' localizzata: si tocca SOLO il range (`T01..Txx`), non la prosa.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = REPO_ROOT / 'agents'
SKILLS_DIR = AGENTS_DIR / '_skills'
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

# Le numerazioni LOCALI di ruolo: nel prompt una regola si DEFINISCE aprendo la
# riga in grassetto (`**C-07 — ...**`, `**S-04 — ...**`); ovunque altro e' una
# citazione. Le varianti `bis`/`ter`/`b`/`c` non aprono un numero nuovo.
ROLE_RULE_PREFIXES = {'capitano': 'C', 'sentinella': 'S'}

# La parola con cui un prompt apre un DIVIETO, lingua per lingua. E' vocabolario,
# non policy: la traduzione di "FORBIDDEN" nei sette prompt. Serve perche' il
# divieto e' l'unica parte del testo che va ritrovata nella localizzazione per
# sapere DOVE guardare.
FORBIDDEN_MARKERS = {
    'en': 'FORBIDDEN', 'it': 'VIETATO', 'es': 'PROHIBIDO', 'fr': 'INTERDIT',
    'de': 'VERBOTEN', 'pt': 'PROIBIDO', 'hu': 'TILOS',
}
# Un token tecnico fra backtick: `curl`, `is_open`, `recheck-liveness`.
BACKTICK_RE = re.compile(r'`([^`\n]+)`')
# Un blocco recintato ```...```: nel prompt e' un ORDINE DI ESEGUIRE.
FENCE_RE = re.compile(r'^```.*?^```', re.MULTILINE | re.DOTALL)

# COMANDI che il baseline EN vieta di eseguire, per ruolo. Tabella a mano, e
# piccola apposta: il Markdown porta i token del divieto ma NON la loro polarita'.
# Nel paragrafo `FORBIDDEN` dell'Analista convivono il comando proibito (`curl`),
# l'alternativa prescritta (`recheck-liveness`), l'oggetto da proteggere
# (`is_open`) e semplici esempi di URL (`jobs.`/`apply.`): niente nel testo dice
# quale sia quale, quindi derivarli tutti come "proibiti" produrrebbe falsi
# positivi. Chi aggiunge una voce qui la ancora al baseline — il test fallisce se
# il token non compare (piu') in un divieto EN, cosi' la tabella non invecchia.
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

# Numeri RITIRATI: buchi deliberati nelle numerazioni di ruolo, non riferimenti
# persi. Servono perche' le regole si citano fra loro per numero: riusare un
# numero libero collide con le citazioni storiche. Ogni voce va anche NOMINATA
# nel prompt (test_retired_role_rules_are_declared_in_every_prompt), in tutte e
# 7 le lingue. Chi ritira una regola aggiunge qui il numero; chi ne aggiunge una
# nuova prende il numero DOPO il piu' alto, mai uno di questi.
RETIRED_ROLE_RULES = {
    # C-06: mai assegnato — la sezione fu rinumerata e il numero resto' libero.
    'capitano': {6},
    # S-01..S-03, S-08: mai assegnati — la numerazione della Sentinella nasce da
    # S-04 e salta S-08 (verificato 2026-07-30: zero riferimenti in tutta la repo).
    'sentinella': {1, 2, 3, 8},
}

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


# Skill DICHIARATE in almeno un `skills.list` (quindi spedite agli agenti) che a
# oggi non hanno tutte e 6 le localizzazioni. `start-agent.sh:788-796` ricade in
# SILENZIO sul baseline EN, quindi a runtime il buco non si vede: questa lista e'
# l'unico posto in cui resta VISIBILE. Chi traduce una skill DEVE togliere le sue
# voci (il test fallisce anche sulle voci obsolete).
# Ordine di smaltimento: le skill di EMERGENZA per prime — e' li' che l'agente ha
# meno margine per improvvisare. Quelle sono gia' state fatte (2026-07-30:
# agent-emergency, agent-unblock, graceful-shutdown); qui resta il resto.
# Formato: (skill, locale).
KNOWN_SKILL_LOCALIZATION_GAPS = set()
# Vuota dal 2026-08-03: le sette skill che vivevano qui sono tradotte in tutte
# e sei le lingue. L'ultima a rientrare e poi uscire e' stata `team-modes` (il
# manuale delle modalita' operative): nata su un ramo in inglese mentre un
# altro ramo chiudeva il debito di traduzione, tradotta in tutte e sei le
# lingue il 2026-08-03. Da adesso una skill DICHIARATA in un manifest senza le
# sue localizzazioni fa cadere il gate subito, invece di essere ammessa qui e
# poi dimenticata. Se una voce torna, deve portare la ragione e una data.


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


def _role_rule_definitions(path, prefix):
    """[(numero, n_riga)] delle regole di ruolo DEFINITE, IN ORDINE e CON i duplicati.

    Serve dove l'insieme non basta: un numero definito due volte sopravvive a
    qualunque confronto fra `set`, perche' i set deduplicano.

    Le varianti `bis`/`ter` (e i suffissi `b`/`c`, gia' esclusi dal `\\b`) NON
    aprono un numero nuovo: sono estensioni della regola omonima, quindi non
    contano come definizioni e non sono collisioni.
    """
    rx = re.compile(
        r'^\*\*' + prefix + r'-(\d{2})(?!\s*(?:bis|ter|quater)\b)\b',
        re.MULTILINE,
    )
    text = _read(path)
    return [(int(m.group(1)), text.count('\n', 0, m.start()) + 1)
            for m in rx.finditer(text)]


def _role_rule_numbers(path, prefix):
    """Numeri di regola di ruolo DEFINITI nel file (non le citazioni).

    Regex PERMISSIVA apposta — `C-22 bis` vale come C-22. Non e' un dettaglio:
    nelle sei localizzazioni del Capitano la C-22 "prima run" non c'e', c'e'
    solo la sua `bis`, ed e' un drift a se' (gia' tracciato in KNOWN_SKILL_GAPS
    come `first-run-burst`). Stringere qui lo trasformerebbe in un fallimento di
    contiguita', che non e' quello che questo test misura.
    """
    rx = re.compile(r'^\*\*' + prefix + r'-(\d{2})\b', re.MULTILINE)
    return {int(n) for n in rx.findall(_read(path))}


def _forbidden_blocks(path, marker):
    """Testo dei blocchi che APRONO un divieto con `marker`.

    Un blocco e' la riga del marcatore (in grassetto o in intestazione: nella
    prosa la stessa parola e' solo enfasi) piu' cio' che le sta sotto fino alla
    fine del paragrafo, elenco puntato incluso — nell'Analista il divieto sta
    tutto sulla riga, nella Sentinella e' un'intestazione seguita da bullet.
    """
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
    """Ogni skill dichiarata in uno `skills.list` esiste in tutte e 7 le lingue.

    Origin: 2026-07-30 — 9 skill dichiarate nei manifest (fra cui le tre di
    EMERGENZA: `agent-emergency`, `agent-unblock`, `graceful-shutdown`) erano
    monolingue. `start-agent.sh` fa fallback silenzioso sul baseline EN: nessun
    warning, e il Dottore ungherese legge la procedura di sblocco in inglese,
    mentre RULE-T14 impone comunque l'output nella lingua dell'utente.

    I buchi ancora aperti stanno in `KNOWN_SKILL_LOCALIZATION_GAPS`, esplicita
    apposta: cio' che non e' tradotto resta VISIBILE invece di sparire.
    """
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


def test_skill_en_baseline_is_not_a_copy_of_italian():
    """`SKILL.md` (baseline EN) non e' mai IDENTICO a `SKILL.it.md`.

    Origin: 2026-07-30 — `graceful-shutdown/SKILL.md` e `SKILL.it.md` erano
    byte-identici: il "baseline EN" era la traduzione italiana copiata. Il
    baseline e' la lingua di fallback (`start-agent.sh` ci ricade per ogni
    locale privo di variante), quindi un utente `en` riceveva la skill in
    italiano. Controllo GREZZO apposta: due file identici sono la prova che la
    traduzione non e' mai avvenuta, e questo l'avrebbe intercettato al primo
    commit. Non pretende di riconoscere la lingua — quello lo fa la review.
    """
    same = []
    for d in sorted(SKILLS_DIR.iterdir()):
        if not d.is_dir():
            continue
        base = d / 'SKILL.md'
        it = d / 'SKILL.it.md'
        if not (base.exists() and it.exists()):
            continue
        if _read(base) == _read(it):
            same.append(d.name)
    assert not same, (
        'baseline EN identico alla traduzione IT (il baseline e\' il fallback '
        'per ogni locale: va scritto in inglese):\n  ' + '\n  '.join(same)
    )


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


def test_en_prohibitions_survive_translation():
    """Se il baseline EN VIETA qualcosa, la traduzione vieta le STESSE cose.

    Meta' del check di co-occorrenza, e la meta' interamente DERIVATA: i token
    proibiti si leggono dal baseline (i backtick dentro il paragrafo che apre
    con `FORBIDDEN`) e vanno ritrovati dentro il paragrafo che apre col
    marcatore della lingua. Nessuna lista scritta a mano: cambia il divieto in
    EN, cambia da solo cio' che le sei traduzioni devono contenere.

    Origin: 2026-07-30 — il gate delle skill guarda solo se il NOME della skill
    compare da qualche parte, e le sei traduzioni dell'Analista citavano
    `recheck-liveness` mentre ordinavano il `curl` che l'inglese vieta: skill
    presente, divieto sparito, gate verde.
    """
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
    """Cio' che il baseline VIETA non compare in un blocco eseguibile, in nessuna lingua.

    L'altra meta' della co-occorrenza, e quella che nessun test puo' derivare:
    il marcatore dice CHE c'e' un divieto, i backtick dicono su COSA verte, ma
    il Markdown non dice quale token sia la cosa proibita e quale l'alternativa
    prescritta. Quella polarita' sta in `FORBIDDEN_IN_CODE_BLOCKS` — tabella, per
    onesta', con ogni voce ancorata al baseline qui sotto.

    Il perimetro e' il blocco recintato, non tutto il file, e non e' una
    scorciatoia: nominare `curl` nella prosa e' LEGITTIMO (il baseline stesso
    spiega perche' un curl nudo sbaglia, e le traduzioni traducono quella prosa),
    metterlo in un blocco ```bash``` e' un ORDINE DI ESEGUIRLO. E' esattamente la
    forma che aveva il bug: un blocco `curl -s -L ... | grep` nei sei file.
    """
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


def test_role_rule_numbers_are_defined_once_per_file():
    """Uno stesso numero `C-xx`/`S-xx` non e' DEFINITO due volte nello stesso file.

    Origin: 2026-07-30 — `capitano.md` definiva **C-21 due volte**: «Scout as a
    SQUAD» e «Passing the baton: the daily diary». Le sei localizzazioni ne
    avevano una sola (lo squad), quindi la regola del diario — citata dalla
    tabella di routing come `captain-diary` → C-21 — non esisteva in 6 lingue su
    7, e il Capitano non inglese non ereditava mai l'handoff giornaliero.

    Ne' il gate di contiguita' ne' quello di allineamento fra localizzazioni
    potevano vederlo: entrambi lavorano su `set` di numeri, e un set deduplica.
    Serve contare le DEFINIZIONI, non i numeri distinti. Una collisione e'
    sempre un difetto: due regole diverse sotto lo stesso numero rendono
    ambigua ogni citazione (`vedi C-21`) e ne nascondono una alla traduzione.
    """
    problems = []
    for role, prefix in ROLE_RULE_PREFIXES.items():
        for _lang, path in _prompt_files(role):
            seen = {}
            for n, line in _role_rule_definitions(path, prefix):
                seen.setdefault(n, []).append(line)
            for n, lines in sorted(seen.items()):
                if len(lines) > 1:
                    problems.append(
                        f'{path.relative_to(REPO_ROOT)}: {prefix}-{n:02d} definita '
                        f'{len(lines)} volte (righe {", ".join(map(str, lines))}) — '
                        f'due regole sotto lo stesso numero: rinumerane una '
                        f'(il numero DOPO il piu\' alto) e aggiorna le citazioni'
                    )
    assert not problems, 'numeri di regola definiti piu\' di una volta:\n  ' + '\n  '.join(problems)


def test_role_rule_numbering_is_contiguous_modulo_retired():
    """`C-xx`/`S-xx` sono contigue una volta aggiunti i numeri di RETIRED_ROLE_RULES.

    Un buco non dichiarato e' ambiguo — regola ritirata o riferimento perso? — e
    il prossimo che aggiunge una regola rischia di riusare il numero libero,
    collidendo con le citazioni storiche. Chi ritira una regola la dichiara in
    `RETIRED_ROLE_RULES`; chi ne aggiunge una prende il numero dopo il piu' alto.
    """
    problems = []
    for role, prefix in ROLE_RULE_PREFIXES.items():
        retired = RETIRED_ROLE_RULES.get(role, set())
        for _lang, path in _prompt_files(role):
            found = _role_rule_numbers(path, prefix)
            rel = path.relative_to(REPO_ROOT)
            if not found:
                problems.append(f'{rel}: nessuna definizione {prefix}-xx trovata')
                continue
            reused = sorted(found & retired)
            if reused:
                problems.append(
                    f'{rel}: definisce {", ".join(f"{prefix}-{n:02d}" for n in reused)}, '
                    f'ma e\' in RETIRED_ROLE_RULES[{role!r}] — riusare un numero '
                    f'ritirato collide con le citazioni storiche; scegli il numero '
                    f'dopo il piu\' alto, oppure togli la voce dall\'allowlist'
                )
            gaps = sorted(set(range(1, max(found) + 1)) - found - retired)
            if gaps:
                problems.append(
                    f'{rel}: buchi non dichiarati '
                    f'{", ".join(f"{prefix}-{n:02d}" for n in gaps)} — se sono '
                    f'ritirati aggiungili a RETIRED_ROLE_RULES[{role!r}], '
                    f'altrimenti la regola e\' andata persa'
                )
    assert not problems, 'numerazioni di ruolo bucate:\n  ' + '\n  '.join(problems)


def test_role_rule_numbering_identical_across_localizations():
    """EN e le 6 localizzazioni dello stesso ruolo definiscono gli STESSI `C-xx`/`S-xx`."""
    problems = []
    for role, prefix in ROLE_RULE_PREFIXES.items():
        seen = {lang: _role_rule_numbers(path, prefix)
                for lang, path in _prompt_files(role)}
        baseline = seen.get('en', set())
        for lang, found in seen.items():
            if lang == 'en' or found == baseline:
                continue
            missing = sorted(baseline - found)
            extra = sorted(found - baseline)
            problems.append(
                f'{role}.{lang}: manca {[f"{prefix}-{n:02d}" for n in missing] or "-"}, '
                f'in piu\' {[f"{prefix}-{n:02d}" for n in extra] or "-"}'
            )
    assert not problems, (
        'numerazioni di ruolo divergenti fra localizzazioni:\n  ' + '\n  '.join(problems)
    )


def test_retired_role_rules_are_declared_in_every_prompt():
    """Ogni numero ritirato e' NOMINATO nel prompt, in tutte e 7 le lingue.

    L'allowlist da sola vive nel test: chi legge il prompt vedrebbe solo un salto.
    La nota nel prompt e' la meta' leggibile della dichiarazione, e questo test la
    tiene agganciata all'allowlist perche' non possa divergere.
    """
    problems = []
    for role, prefix in ROLE_RULE_PREFIXES.items():
        for n in sorted(RETIRED_ROLE_RULES.get(role, set())):
            token = f'{prefix}-{n:02d}'
            for _lang, path in _prompt_files(role):
                if token not in _read(path):
                    problems.append(
                        f'{path.relative_to(REPO_ROOT)}: {token} e\' in '
                        f'RETIRED_ROLE_RULES ma il prompt non lo nomina'
                    )
    assert not problems, (
        'numeri ritirati non dichiarati nel prompt:\n  ' + '\n  '.join(problems)
    )
