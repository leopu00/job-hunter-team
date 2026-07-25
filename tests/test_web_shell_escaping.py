"""Regressione BUG-02: escaping degli argomenti in web/lib/shell.ts.

Storia: `runScript()` costruiva il comando con double-quote wrapping
(`` `"${a}"` ``), che lascia passare un argomento contenente virgolette doppie →
command injection. Fix `43f1962`: escaping POSIX single-quote via `shellQuote()`.

Perché questo file esiste: i due test venivano da `tests/test_qa_audit_fs032.py`,
un audit QA del 2026-03-30 costruito attorno alla dashboard web locale (pagine
`/capitano`, `/assistente`, `/sentinella` e le loro route). Quella superficie è
stata ritirata il 2026-07-23/25 e l'audit è stato rimosso con essa; questi due
test però riguardano `shell.ts`, che è ancora vivo — serve alle route che
eseguono comandi nel container e a tutto il percorso di sviluppo `dev:host`.
Estratti qui per non perdere una guardia di sicurezza insieme al contesto morto.
"""

import pathlib

import pytest

SHELL_TS = (
    pathlib.Path(__file__).parent.parent / "web" / "lib" / "shell.ts"
)


@pytest.mark.skipif(not SHELL_TS.exists(), reason="web/lib/shell.ts non presente")
class TestShellEscaping:
    def test_uses_posix_single_quote_escaping(self):
        """Il comando va composto con shellQuote(), non concatenando a mano."""
        content = SHELL_TS.read_text(encoding="utf-8")
        assert "shellQuote" in content, (
            "BUG-02: shellQuote() mancante in shell.ts — gli argomenti "
            "tornerebbero a essere interpolati senza escaping"
        )
        # L'implementazione POSIX chiude la quote, inserisce una single-quote
        # escapata e riapre: '\'' → nel sorgente appare come replace su /'/g.
        assert ".replace(" in content and "'" in content, (
            "BUG-02: nessuna sostituzione delle single-quote in shellQuote()"
        )

    def test_no_double_quote_arg_wrapping(self):
        """Il vecchio pattern vulnerabile non deve tornare."""
        content = SHELL_TS.read_text(encoding="utf-8")
        assert '`"${a}"`' not in content, (
            "BUG-02: double-quote wrapping degli argomenti di nuovo presente "
            "in runScript() — un argomento con virgolette doppie evade la quote"
        )
