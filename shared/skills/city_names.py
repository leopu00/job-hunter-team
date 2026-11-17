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
