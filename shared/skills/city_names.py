"""Shared city spelling normalization; names never imply a country or travel radius."""
import re
import unicodedata

CITY_SYNONYMS = {
    'milano': 'milan', 'milan': 'milan', 'roma': 'rome', 'rome': 'rome',
    'torino': 'turin', 'turin': 'turin', 'firenze': 'florence', 'florence': 'florence',
    'venezia': 'venice', 'venice': 'venice', 'napoli': 'naples', 'naples': 'naples',
    'genova': 'genoa', 'genoa': 'genoa', 'monaco di baviera': 'munich', 'munchen': 'munich',
    'munich': 'munich', 'koln': 'cologne', 'cologne': 'cologne', 'wien': 'vienna',
    'vienna': 'vienna', 'praha': 'prague', 'prague': 'prague',
}


_PARENTHETICAL = re.compile(r'\s*\([^)]*\)')


def normalize_city(location):
    """First place of a location, lowercase, no accents, no province in brackets:
    «Gioia del Colle (BA)» and «Gioia del Colle, Bari» are both «gioia del colle».
    A text made only of brackets («(Remote)») is kept as it is, not emptied."""
    if not location:
        return ''
    first = location.split(',')[0].strip().lower()
    bare = _PARENTHETICAL.sub('', first).strip()
    nfd = unicodedata.normalize('NFD', bare or first)
    return ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')


def canonical_city(location):
    raw = normalize_city(location)
    return CITY_SYNONYMS.get(raw, raw)


def same_place(a, b):
    """Two locations name the same place for duplicate detection: same canonical
    city, or one of them is empty (an ad with no place is not a different place)."""
    ca, cb = canonical_city(a), canonical_city(b)
    return ca == cb or not ca or not cb


_WORDS = re.compile(r'[^\W_]+', re.UNICODE)


def _folded_words(text):
    """The words of a text, lowercase, without accents."""
    nfd = unicodedata.normalize('NFD', str(text or '').lower())
    return _WORDS.findall(''.join(c for c in nfd if unicodedata.category(c) != 'Mn'))


def place_names(location):
    """The names a location gives for its place, as word tuples: the first place and what its brackets say when it is a name
    («Coriano (Rimini), Emilia-Romagna» gives coriano and rimini). What follows the first comma is region and country, not the
    place; a province code («Muscoline (BS)») is not a name."""
    if not location:
        return []
    first = str(location).split(',')[0]
    names = []
    outside = _PARENTHETICAL.sub(' ', first)
    for chunk in [outside] + re.findall(r'\(([^)]*)\)', first):
        words = tuple(_folded_words(chunk))
        if 1 <= len(words) <= 4 and len(' '.join(words)) >= 3 and words not in names:
            names.append(words)
    return names


def _contains(words, name):
    size = len(name)
    return any(tuple(words[i:i + size]) == name for i in range(len(words) - size + 1))


def share_a_place(a, b):
    """Two locations that are written differently and still name one place: a name of the one stands whole inside the first
    part of the other («Torino» in «Rivalta di Torino», «Rimini» in «Coriano (Rimini)», «Coriano» in «Rimini (sede di lavoro…;
    Coriano nel titolo della fonte)»). Another city is not shared («Rimini» and «Bellaria»), and a location with no place says
    nothing here: for that, same_place."""
    for mine, theirs in ((a, b), (b, a)):
        if not mine or not theirs:
            continue
        words = _folded_words(str(theirs).split(',')[0])
        words += [CITY_SYNONYMS[w] for w in words if w in CITY_SYNONYMS]
        for name in place_names(mine):
            canonical = tuple(CITY_SYNONYMS.get(w, w) for w in name) if len(name) == 1 else name
            if _contains(words, name) or _contains(words, canonical):
                return True
    return False
