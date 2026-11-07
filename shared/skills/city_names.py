"""Shared city spelling normalization; names never imply a country or travel radius."""
import unicodedata

CITY_SYNONYMS = {
    'milano': 'milan', 'milan': 'milan', 'roma': 'rome', 'rome': 'rome',
    'torino': 'turin', 'turin': 'turin', 'firenze': 'florence', 'florence': 'florence',
    'venezia': 'venice', 'venice': 'venice', 'napoli': 'naples', 'naples': 'naples',
    'genova': 'genoa', 'genoa': 'genoa', 'monaco di baviera': 'munich', 'munchen': 'munich',
    'munich': 'munich', 'koln': 'cologne', 'cologne': 'cologne', 'wien': 'vienna',
    'vienna': 'vienna', 'praha': 'prague', 'prague': 'prague',
}


def normalize_city(location):
    if not location:
        return ''
    first = location.split(',')[0].strip().lower()
    nfd = unicodedata.normalize('NFD', first)
    return ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')


def canonical_city(location):
    raw = normalize_city(location)
    return CITY_SYNONYMS.get(raw, raw)
