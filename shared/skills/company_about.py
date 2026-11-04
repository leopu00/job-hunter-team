#!/usr/bin/env python3
"""company_about.py — the two sentences on who a company is (`companies.about`), cleaned and capped before they are stored.

The Analista writes them from the company's own website: a page that is not the company's friend can try to make it write a
huge text, or one with control characters, bidirectional marks or instructions hidden in invisible characters, and the
text reaches the database, the cloud and the output of `db_query.py company` that the other agents read. So every write
passes here: `clean_note` (NFC, no controls, no commanding invisibles, single spaces) and a cap of ABOUT_MAX characters
(a text that long is no longer «two sentences»; it is cut, not refused, the same way the page cuts what it shows).
"""
from feedback_reasons import clean_note

ABOUT_MAX = 600


def clean_about(value):
    """The text to store, or None when nothing is left after cleaning."""
    text = clean_note(value)
    if len(text) > ABOUT_MAX:
        text = text[:ABOUT_MAX].rstrip()
    return text or None
