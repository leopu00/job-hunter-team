#!/usr/bin/env python3
"""Censimento riproducibile della copy backend non in inglese (O-07).

È la forma eseguibile del contratto fissato il 2026-08-09: la traduzione
inglese del backend copre i SINK USER-VISIBLE — output di terminale,
help/errori CLI, campi messaggio restituiti ad agenti o al gioco. Commenti,
docstring di implementazione e identificatori restano fuori per scelta.

Le funzioni di scansione vivono QUI e il gate
(`tests/test_shared_backend_english.py`) le importa: un solo criterio,
una sola regex — se cambia il criterio cambiano insieme censimento e gate.

Uso:
  python3 scripts/analysis/backend_copy_census.py            # solo conteggi
  python3 scripts/analysis/backend_copy_census.py -v         # ogni occorrenza
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Prosa italiana ad alto segnale. Identificatori di ruolo (`capitano`,
# `analista`), valori di enum e parole presenti in dati internazionali sul
# lavoro restano fuori di proposito. Le parole a rischio collisione con
# l'inglese sono scritte solo nella forma italiana piena (`minuti`, non
# `minut\w*` che prenderebbe "minutes").
ITALIAN_COPY = re.compile(
    r"[àèìòùÀÈÌÒÙ]|"
    r"\b(?:nessun\w*|errore|attenzione|impossibile|sconosciut\w*|"
    r"non\s+trovat\w*|trovat\w*|già|aggiornat\w*|inserit\w*|completat\w*|"
    r"posizion\w*|aziend\w*|candidatur\w*|profilo|lavoro|pausa|"
    r"settimanal\w*|giorni?|righe?|soglia|durata|scrittura|"
    r"caricat\w*|salvat\w*|fallit\w*|uso|prima|dopo|fuori|dentro|"
    r"finestr\w*|velocità|agent[ei]|squadra|utente|messaggi?o?|"
    r"avvis\w*|gratuit\w*|mesi?|ore|selezion\w*|scegli\w*|"
    r"avvi\w*|ferm\w*|disattiv\w*|consum(?:o|i|at[oaie]|are)|"
    r"scadut\w*|rilevat\w*|legg(?:i|ere)|scriv(?:i|ere)|chius\w*|"
    r"rimos\w*|attiv(?:o|a|i|e)|disponibil\w*|tutti|mort[oi]|"
    r"ripar\w*|attes[oi]|opzional\w*|"
    # V-11 (2026-08-09): piani/prezzi e la prosa dei sink che il gate non
    # vedeva ('Adagio (gratuito)', '$/mese', i messaggi di export Drive).
    # Forme piene, mai radici che mordano l'inglese (`minuti`, non `minut`).
    r"pian[oi]|abbonament\w*|tett[oi]|prezz\w*|fogli[oi]?|cartell\w*|"
    r"credenzial\w*|autorizz\w*|esport\w*|riuscit[oaie]?|duplicat[oi]|"
    r"vuot[oaie]?|colonn\w*|tabell\w*|configurat[oaie]|configurazion[ei]|impostaz\w*|"
    r"partit\w*|mancant\w*|valid[oaie]|mostr\w*|visualizz\w*|"
    r"rispost\w*|richiest\w*|nuov[oaie]|vecchi[oaie]?|ogni|sempre|"
    r"quando|senza|sopra|sotto|ancora|tropp[oaie]?|molt[oaie]?|tutto|"
    r"niente|anche|stess\w*|altr\w*|mentre|finch\w*|entro|verso|"
    r"contro|oggi|ieri|domani|adesso|subito|presto|tardi|minuti|"
    r"secondi|riavviat\w*|manualmente|controllabile|"
    # 2026-08-10: il censimento dava TOTAL 0 mentre 'Provider non supportato'
    # era ancora nel manager. Nessuna di queste parole era coperta: un buco
    # nella regex si legge come lavoro finito, che è il modo peggiore di
    # sbagliare per un gate. Aggiunte dopo scansione a dizionario (i token
    # dei sink che /usr/share/dict/words non riconosce).
    r"supportat[oaie]|liberat[oaie]|schedulat[oaie]|modul[oi]|bacheca|"
    r"install[ao]|servit[oaie]|fresc[oaie]|cerchi|fonti)\b",
    re.IGNORECASE,
)

# ── Sink Python (stessa logica del gate storico) ────────────────────────
PY_VISIBLE_CALLS = {
    "print", "add_argument", "add_parser", "ArgumentParser",
    "ValueError", "RuntimeError", "SystemExit", "error", "warn",
    "warning", "_log",
}
PY_VISIBLE_FIELDS = {
    "message", "reason", "hint", "note", "error", "evidence",
    "detail", "suggest", "label",
}

# ── Sink shell: righe che parlano all'utente (commenti esclusi) ─────────
SH_VISIBLE = re.compile(r"\b(?:echo|printf|err|info|warn|die|log)\b")

# ── Sink JS: console + descrizioni commander + errori lanciati ──────────
JS_CALL_RE = re.compile(
    r"(?:console\.(?:log|error|warn)|(?:throw new (?:Error|TypeError))|"
    r"\.(?:description|usage))\s*\("
)


def _py_strings(node: ast.AST):
    """Letterali di testo, saltando le interpolazioni delle f-string.

    Dentro una f-string il pezzo `{r['cerchi']}` è CODICE: la sua chiave è un
    nome di colonna, non copy. Camminarci dentro faceva sembrare italiano un
    identificatore — stessa trappola già gestita per i template literal JS.
    """
    stack = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, ast.FormattedValue):
            # Il format_spec può contenere testo vero (`{x:>10}` no, ma
            # `{x:{fill}}` sì): resta fuori, non è mai copy.
            continue
        if isinstance(current, ast.Constant) and isinstance(current.value, str):
            yield current.lineno, current.value
        stack.extend(ast.iter_child_nodes(current))


def _call_name(node: ast.Call) -> str:
    return getattr(node.func, "id", None) or getattr(node.func, "attr", "")


def python_visible_literals(path: Path):
    """Letterali nei sink user-visible di un file Python."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    module_doc = ast.get_docstring(tree, clean=False)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _call_name(node) in PY_VISIBLE_CALLS:
            for arg in node.args:
                yield from _py_strings(arg)
            for kw in node.keywords:
                if kw.arg in {None, "help", "description", "message"}:
                    # `ArgumentParser(description=__doc__)` stampa il docstring
                    # del modulo in `--help`: lì il docstring NON è commento, è
                    # copy, e va giudicato come tale.
                    if module_doc and any(
                            isinstance(child, ast.Name) and child.id == "__doc__"
                            for child in ast.walk(kw.value)):
                        yield 1, module_doc
                    yield from _py_strings(kw.value)
        elif isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value in PY_VISIBLE_FIELDS:
                    yield from _py_strings(value)


def shell_visible_lines(path: Path):
    """Righe di output utente (echo/printf/err/…) in uno script shell."""
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if SH_VISIBLE.search(stripped):
            yield i, line


def _balanced_slice(src: str, start: int) -> str:
    """Dal '(' di start alla chiusura bilanciata — naive ma sufficiente per
    le call di output di questo repo (niente annidamenti patologici)."""
    depth = 0
    for i in range(start, len(src)):
        c = src[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return src[start:i]
    return src[start:]


_JS_STRING_RE = re.compile(r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|`(?:[^`\\]|\\.)*`")
_JS_EXPR_RE = re.compile(r"\$\{[^{}]*\}")


def js_visible_literals(path: Path):
    """Stringhe dentro console.* / throw new Error / .description() in JS.

    Dentro i template literal le interpolazioni ${...} sono CODICE (nomi di
    variabili, espressioni): si tolgono prima del match — il gate giudica la
    copy, non gli identificatori."""
    src = path.read_text(encoding="utf-8")
    for m in JS_CALL_RE.finditer(src):
        body = _balanced_slice(src, m.end() - 1)
        line = src.count("\n", 0, m.start()) + 1
        for sm in _JS_STRING_RE.finditer(body):
            value = sm.group(0)[1:-1]
            if sm.group(0).startswith("`"):
                value = _JS_EXPR_RE.sub("", value)
            yield line, value


# ── Sink GDScript: ciò che finisce a schermo nel gioco ──────────────────
#
# Il gioco ha già il suo dizionario (UIStrings) e un gate di parità fra le 7
# lingue. Quello che nessuno dei due vede è la frase scritta a mano nel
# sorgente: non ha chiave, quindi non può mancare da nessun catalogo, e resta
# identica in tutte e sette le lingue. È il perimetro Godot di O-07.
#
# `UIStrings.t(...)` NON è un sink: è la soluzione, non il problema. Le righe
# che ci passano attraverso sono già tradotte per costruzione.
_GD_STRING_RE = re.compile(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'')
## `%s`, `%d`, `{greeting}`: segnaposto, non copy.
_GD_PLACEHOLDER_RE = re.compile(r"\{[^{}]*\}|%[0-9.]*[a-zA-Z]")
## Identificatori travestiti da stringa: chiavi di dizionario, slug di ruolo,
## nomi di segnale, chiavi i18n. Nessuno di questi arriva a schermo così
## com'è, e trattarli come copy sommergerebbe il censimento di rumore.
_GD_IDENTIFIER_RE = re.compile(r"^[a-z0-9_.\-/]+$")
## Chiamate di log: `Log.info("scene", "…")`, `push_warning("…")`.
_GD_LOG_RE = re.compile(r"\bLog\.(?:info|warn|error|debug)\s*\(|"
                        r"\bLog\.call_deferred\s*\(|"
                        r"\bpush_(?:warning|error)\s*\(|\bprint(?:err)?\s*\(")
## Messaggi verso un agente del PRODOTTO. Due forme, entrambe necessarie:
## la busta `[@utente -> @capitano]`, e la consegna diretta in chat
## `_do_send_chat("coordinatore", "…")`. La seconda è stata la sorpresa: 11
## stringhe di vps_backend.gd sono istruzioni operative al Capitano
## (manutenzione, bacheca, deroga di spesa) e NON portano nessuna busta.
## Tradurle avrebbe cambiato il comportamento del team, non la lingua.
_GD_AGENT_ORDER_RE = re.compile(
    r"\[@[a-z0-9_-]+\s*->|\b_do_send_chat\s*\(")
## Percorsi e URI: `res://…`, `user://…`, `https://…`.
_GD_PATH_RE = re.compile(r"^[a-z]+://|^/|\.(?:gd|tscn|png|svg|json|cfg|log)$")


def _gd_strip(value: str) -> str:
    return _GD_PLACEHOLDER_RE.sub("", value).strip()


def _gd_is_copy(value: str) -> bool:
    """La stringa è testo per l'utente, o un identificatore?

    Il criterio è invertito rispetto agli altri linguaggi, e per una ragione
    misurata: elencare i sink (`.text =`, le label del tema, le chiavi note
    dei dizionari) vedeva 2 stringhe su 386. Nel gioco la copy viaggia dentro
    strutture dati — battute del simulatore, righe di stato, partiture del
    tour — e non passa quasi mai da un'assegnazione riconoscibile. Quindi si
    guarda ogni letterale e si tolgono gli identificatori, che sono
    riconoscibili davvero.
    """
    if len(value) < 4:
        return False
    if _GD_PATH_RE.search(value):
        return False
    if _GD_IDENTIFIER_RE.match(value):
        return False
    return True


def gdscript_visible_literals(path: Path):
    """Frasi per l'utente in un file GDScript (identificatori esclusi)."""
    src = path.read_text(encoding="utf-8")
    skipping = False
    depth = 0
    for i, line in enumerate(src.splitlines(), 1):
        stripped = line.strip()
        # Marcatore esplicito: copre l'istruzione (anche multi-riga) che
        # segue. Serve perché la busta `[@x -> @y]` sta solo sulla PRIMA
        # riga di un ordine, mentre le continuazioni sono testo che l'agente
        # legge allo stesso modo. Marcarlo nel codice rende l'esclusione
        # leggibile da chi passa di lì, non solo dal censimento.
        if stripped.startswith("#") and "NON TRADURRE" in stripped:
            skipping = True
            continue
        if skipping:
            if stripped.startswith("#"):
                continue
            if not stripped:
                skipping = False
                continue
            depth += stripped.count("(") - stripped.count(")")
            # L'istruzione finisce quando le parentesi si richiudono e la
            # riga non continua con `\`. Contano entrambe: una chiamata
            # multi-riga continua fra parentesi, una concatenazione con `\`.
            if depth <= 0 and not stripped.endswith("\\"):
                skipping = False
                depth = 0
            continue
        if stripped.startswith("#"):
            continue
        # Una riga che passa dal dizionario è già tradotta per costruzione.
        if "UIStrings.t(" in stripped:
            continue
        # Log di diagnostica: finiscono in jht-game.log, non a schermo. Il
        # perimetro O-07 è ciò che l'utente LEGGE. Restano una superficie
        # nota (~110 righe al 2026-08-10) e un follow-up dichiarato: l'utente
        # li incontra solo dentro il bundle che allega a una segnalazione.
        if _GD_LOG_RE.search(stripped):
            continue
        # Esito di un selftest interno (`failures.append("…")`): è la stessa
        # diagnostica dei log, scritta in un file di prodotto.
        if "failures.append(" in stripped or "checks.append(" in stripped:
            continue
        # Ordini verso gli agenti del PRODOTTO, riconoscibili dalla busta
        # `[@mittente -> @destinatario]`. Non sono interfaccia: sono il
        # prompt che il Capitano legge, e gli agenti nel container parlano
        # italiano. Tradurli cambierebbe il comportamento del prodotto, non
        # la sua lingua — ed è anche il testo su cui asserisce
        # tests/test_shutdown_timeout_contract.py.
        if _GD_AGENT_ORDER_RE.search(stripped):
            continue
        code = stripped.split("#")[0] if '"' not in stripped.split("#")[0] \
            else stripped
        for sm in _GD_STRING_RE.finditer(code):
            value = _gd_strip(sm.group(0)[1:-1])
            if _gd_is_copy(value):
                yield i, value


# ── Il censimento ───────────────────────────────────────────────────────
# Perimetro del contratto O-07 (metà backend): cli/src, cli/wizard, cli/bin,
# .launcher, shared. NOTA: scripts/jht-wrapper.{sh,ps1} resta FUORI al
# 2026-08-09 — superficie nota (~50 stringhe), proposta come follow-up.
AREAS = {
    "cli": ("cli/src", "cli/wizard", "cli/bin"),
    "launcher": (".launcher",),
    "shared": ("shared",),
    # Fronte Godot di O-07. I cataloghi restano fuori: lì l'italiano è il
    # catalogo strutturale (S) e le altre sei lingue gli stanno accanto —
    # tradurlo sarebbe cancellare una lingua, non aggiungerne una.
    # `game/tools` resta fuori a sua volta: sono strumenti di sviluppo
    # (audit, runner dei test), non superfici che l'utente vede.
    "game": ("game/scripts",),
}

## File esclusi dal censimento con la ragione accanto: un'esclusione senza
## motivo scritto diventa un buco che nessuno sa più giustificare.
CENSUS_EXCLUDED = {
    "game/scripts/ui_strings.gd": "catalogo italiano strutturale (S)",
    "game/scripts/i18n": "cataloghi delle altre 6 lingue",
    # Template con segnaposto `%s`/`%d` a livello di sintassi: non sono
    # Python valido e ast.parse ci si rompe. Non sono nemmeno copy — sono
    # query che il container esegue.
    "game/scripts/backend/payloads": "template SQL con %s, non Python valido",
    "game/scripts/office/office_selftests.gd": "selftest, non copy utente",
}


def _is_selftest(path: Path) -> bool:
    return path.name.endswith("_selftest.gd") or path.name.endswith("_selftest.py")


def _excluded(path: Path) -> bool:
    rel = str(path.relative_to(ROOT))
    return any(rel == key or rel.startswith(key + "/")
               for key in CENSUS_EXCLUDED)


def _iter_files(dirs, suffixes):
    for d in dirs:
        base = ROOT / d
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix in suffixes and "node_modules" not in path.parts \
                    and "__pycache__" not in path.parts \
                    and not _excluded(path) and not _is_selftest(path):
                yield path


def scan(dirs) -> list[str]:
    """Occorrenze di copy italiana nei sink di `dirs`, come `path:riga: testo`.

    UNICO punto in cui si decide cosa viene scandito e con quale regola: il
    gate (`tests/test_shared_backend_english.py`) chiama questa, non una
    propria copia. Le due implementazioni erano già divergite una volta, e la
    seconda volta è stata anche peggio — il gate diceva 0 mentre il censimento
    ne contava 167, perché la sua copia non guardava i `.gd`.
    """
    hits: list[str] = []

    def record(path: Path, line: int, text: str) -> None:
        if ITALIAN_COPY.search(text):
            hits.append(f"{path.relative_to(ROOT)}:{line}: "
                        f"{' '.join(text.split())[:160]}")

    for path in _iter_files(dirs, {".py"}):
        for line, value in python_visible_literals(path):
            record(path, line, value)
    for path in _iter_files(dirs, {".sh"}):
        for line, text in shell_visible_lines(path):
            record(path, line, text)
    for path in _iter_files(dirs, {".js", ".mjs", ".ts"}):
        if path.name.endswith(".test.ts"):
            continue
        for line, value in js_visible_literals(path):
            record(path, line, value)
    for path in _iter_files(dirs, {".gd"}):
        for line, value in gdscript_visible_literals(path):
            record(path, line, value)
    return hits


def census(verbose: bool = False) -> int:
    """Stampa i conteggi per area; ritorna il totale delle occorrenze."""
    total = 0
    for area, dirs in AREAS.items():
        area_hits = scan(dirs)
        print(f"{area}: {len(area_hits)}")
        if verbose:
            for hit in area_hits:
                print(f"  {hit}")
        total += len(area_hits)
    print(f"TOTAL: {total}")
    return total


if __name__ == "__main__":
    sys.exit(0 if census(verbose="-v" in sys.argv) == 0 else 1)
