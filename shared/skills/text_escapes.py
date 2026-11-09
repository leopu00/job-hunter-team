"""Escapes the agents write literally in free-text fields, turned into the characters they mean."""

import re


def interpret_escapes(text):
    """Converte le escape LETTERALI \\n \\t \\r in caratteri veri.

    Gli agenti (LLM) scrivono `\\n\\n` come separatori di paragrafo dentro una
    stringa singola passata come arg CLI. Senza questa conversione finirebbero
    LETTERALI in DB e quindi in dashboard (i `\\n` resterebbero visibili come
    testo). Coerente con jht-telegram-send / jht-notify-user. Applicato ai soli
    campi free-text leggibili dall'utente (notes, jd_summary), non ai campi
    scraped (jd_text/requirements).
    """
    if text is None:
        return None
    text = text.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")

    # Alcuni LLM scrivono le emoji come escape Python (\U0001F916 / ✨)
    # invece che come caratteri: senza conversione arrivano LETTERALI in
    # dashboard. Surrogates (D800-DFFF) e code point fuori range restano
    # com'erano.
    def _chr(m):
        cp = int(m.group(1), 16)
        if 0xD800 <= cp <= 0xDFFF or cp > 0x10FFFF:
            return m.group(0)
        return chr(cp)

    text = re.sub(r"\\U([0-9A-Fa-f]{8})", _chr, text)
    text = re.sub(r"\\u([0-9A-Fa-f]{4})", _chr, text)
    return text
