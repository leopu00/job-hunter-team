"""#198 — chi ha mandato davvero questo messaggio, e quanto ci possiamo credere.

L'identità di un agente, quando viaggia verso un altro, era **dichiarata e mai
controllata**: la busta `[@x -> @y]` è testo dentro il corpo, scritta da chi
compone il messaggio, e i consumatori se la riparsavano con una regex. Chiunque
avesse una shell nel container poteva firmarsi come chiunque.

La forma del difetto conta più del difetto: una **convenzione di
visualizzazione** era stata messa a fare il lavoro di un **meccanismo di
autenticazione**. Perciò qualunque rimedio che tenga l'identità nel corpo è
decorazione, e lo è anche uno che la prenda da una variabile d'ambiente.

⚠️ MISURATO, perché il rimedio che veniva naturale non regge: derivare il
mittente da `tmux display-message -p '#{session_name}'` sembra affidabile e non
lo è — con `TMUX_PANE=%99` davanti al comando, tmux risponde il nome di
un'ALTRA sessione. Sarebbe stato sostituire una variabile scegliibile
(`JHT_AGENT_DIR`) con un'altra variabile scegliibile, chiamandola
autenticazione.

Quello che regge è la **parentela dei processi**: tmux conosce il `pane_pid` di
ogni pane, e un processo non può mentire su chi lo ha generato. Si risale la
catena dei padri finché uno di quei pid è un antenato.

E si rompe nella direzione giusta: chi manomette l'ambiente al punto da rendere
tmux irraggiungibile non ottiene un'identità altrui, ottiene **nessuna
identità** — che qui resta dichiarata come tale invece di essere creduta o
usata per accusare, sul modello di `turn-pickup.js`.

🚫 LIMITE DICHIARATO: chi chiama `tmux send-keys` a mano scavalca tutto questo.
Dal repository non si chiude — è il sistema operativo — ed è la ragione per cui
la regola «mai send-keys diretto» è una regola e non un consiglio.

Le funzioni di decisione sono PURE e ricevono la sorgente iniettata: si
collaudano senza tmux, senza processi e senza container.
"""

from __future__ import annotations

import os
import re
import subprocess
import unicodedata


# La busta come la scrivono gli agenti. Serve a leggere ciò che il mittente
# DICHIARA — mai a stabilire chi sia: è esattamente la confusione che #198
# corregge.
ENVELOPE_RE = re.compile(
    r"^\s*\[@([A-Za-z0-9_-]+)\s*->\s*@([A-Za-z0-9_-]+)\]"
)

# Mittenti che non sono agenti: nessuna sessione può esibirli, e chi li usa sta
# inoltrando per conto d'altri (il bridge Telegram consegna come `@utente`, il
# launcher come `@system`). Non sono un'identità verificata e non devono
# esserlo: sono un RELAY, e come tale vanno marcati.
RELAY_SENDERS = frozenset({"utente", "user", "sistema", "system", "bridge", "pacing"})

# Le origini che possono legittimamente inoltrare per conto d'altri. È una
# proprietà di DOVE si è, non di come ci si firma: senza questo elenco «relay»
# sarebbe una categoria che si ottiene dichiarandola, cioè nessuna difesa.
RELAY_ORIGINS = frozenset({"bridge", "pacing", "sentinella", "sentinella-worker"})

# ⚠️ QUI NON C'È UNA SCORCIATOIA, ed è stata provata e scartata dopo averla
# attaccata. I daemon del launcher (`tg-bridge.py`, `pacing-bridge.py`, …)
# partono con `setsid`, staccati da ogni pane: la risalita non li trova, quindi
# ogni messaggio che l'utente manda da Telegram esce `unverified`.
#
# Il rimedio ovvio era riconoscerli dalla riga di comando di un antenato. NON
# REGGE, misurato: `ps` classificava come «bridge» la shell che stava
# semplicemente CERCANDO la stringa `tg-bridge.py`. La cmdline la sceglie chi
# lancia il processo — `sleep 1 /app/.launcher/tg-bridge.py` basterebbe a
# ottenere il timbro del relay. Sarebbe stato rifare il difetto di #198 in un
# altro posto: un'identità che si ottiene DICHIARANDOLA.
#
# Ciò che regge, per un pane, è che a registrare il `pane_pid` è tmux — un
# terzo che il processo non controlla. Per i daemon quel terzo oggi non
# esiste, e inventarne uno debole sarebbe peggio che non averlo: l'unica
# strada pulita è che i bridge nascano dentro un'origine verificabile, il che
# è un cambiamento del launcher e non di questo modulo.
#
# Conseguenza dichiarata, non nascosta: i messaggi inoltrati dai daemon
# arrivano marcati `unverified`. È vero — quel mittente NON è verificabile — ma
# se resta così a lungo il marchio diventa rumore e si impara a ignorarlo.

# Gli esiti. `impersonation` è l'unico che blocca: dichiarare di essere un
# agente che esiste, non essendolo.
VERIFIED = "verified"
RELAYED = "relayed"
UNVERIFIED = "unverified"
IMPERSONATION = "impersonation"
UNSIGNED = "unsigned"


# Il gioco può anteporre alla busta un blocco di contesto che compone lui (le risposte
# dell'onboarding dichiarate dall'utente): `[CONTESTO ONBOARDING LOCALE …]\n…\n[FINE
# CONTESTO]\n\n[@utente -> @x] [CHAT] <testo>` (vps_backend.gd, `_do_send_chat`). Il
# blocco lo scrive il gioco, il testo dopo la busta lo scrive l'utente. La forma è
# STRETTA: comincia con quella riga, finisce al PRIMO `[FINE CONTESTO]` seguito da una
# busta `@utente`. Chi ci scrive dentro non sposta il confine verso il proprio testo:
# può solo farne finire di più dentro il recinto.
CONTEXT_FRAME_RE = re.compile(
    r"\A(\[CONTESTO ONBOARDING LOCALE[^\n]*\]\n.*?\n\[FINE CONTESTO\]\n\n)(?=\[@utente\s*->)",
    re.DOTALL,
)


def split_context_frame(message):
    """`(blocco di contesto, resto)`; il blocco è '' se il messaggio non comincia con uno."""
    found = CONTEXT_FRAME_RE.match(message or "")
    if not found:
        return "", message or ""
    return found.group(1), (message or "")[found.end():]


# ── JHT-T21-b (review) · il verdetto si calcola su ciò che si LEGGE, non sui byte ──
# `^\s*[@x -> @y]` lavora sul testo grezzo: uno ZWSP o un ESC davanti alla busta non sono
# spazio, quindi la busta non veniva riconosciuta (`claimed=None`) e un agente poteva
# firmarsi «capitano» senza che nessuno se ne accorgesse — l'LLM che legge il pane non
# vede lo ZWSP, e il terminale non mostra l'ESC. Si salta il RUMORE iniziale, deciso da
# `external_content.leading_noise_length` (la lista unica degli invisibili e le categorie
# dei controlli). Non cambia un byte del messaggio: serve a trovare dove comincia la busta.
_NOISE_FALLBACK = frozenset({"Cc", "Cf", "Zl", "Zp", "Zs"})


def _noise_length(text):
    try:
        import sys as _sys

        here = os.path.dirname(os.path.abspath(__file__))
        if here not in _sys.path:
            _sys.path.insert(0, here)
        from external_content import leading_noise_length

        return leading_noise_length(text)
    except Exception:
        # Se la funzione non si carica il verdetto non deve diventare piu' cieco: si salta
        # almeno ESC e le categorie dei controlli e degli invisibili.
        i = 0
        while i < len(text) and (text[i] == "\x1b" or unicodedata.category(text[i]) in _NOISE_FALLBACK):
            i += 1
        return i


def _reading_view(text):
    """Il testo come lo legge il destinatario (vedi `external_content.reading_view`)."""
    try:
        import sys as _sys

        here = os.path.dirname(os.path.abspath(__file__))
        if here not in _sys.path:
            _sys.path.insert(0, here)
        from external_content import reading_view

        return reading_view(text)
    except Exception:
        # Se la funzione non si carica il verdetto non deve diventare piu' cieco: via ESC, i
        # controlli e gli invisibili (categorie Cc/Cf) da tutto il testo.
        return "".join(
            ch for ch in text.replace("\x1b", "")
            if ch in "\n\r\t" or unicodedata.category(ch) not in ("Cc", "Cf")
        )


# I residui che un ESC lascia davanti a una busta quando lo si toglie da solo: l'introduttore di una
# stringa (`]` `P` `X` `^` `_`) o di una CSI (`[`). `ESC P [@capitano…` arriva al CLI come «P[@capitano…»
# e si legge come una busta; senza un ESC nel messaggio originale quel prefisso non e' niente.
_ESC_RESIDUE = r"[\]PX^_\[]{1,2}"


def _claim(view, lenient):
    view = _reading_view(view)
    view = view[_noise_length(view):]
    found = ENVELOPE_RE.match(view)
    if not found and lenient:
        for size in (1, 2):
            if re.fullmatch(_ESC_RESIDUE, view[:size]):
                found = ENVELOPE_RE.match(view[size:])
                if found:
                    break
    return found.group(1).lower() if found else None


def claimed_sender(message: str, raw: str | None = None) -> str | None:
    """Il mittente che il messaggio DICHIARA, o None se non c'è busta.

    `raw` e' il messaggio prima di togliere i controlli (se diverso): si guarda anche quello, e se
    conteneva un ESC si perdonano i residui che l'ESC lascia davanti alla busta. Un verdetto che
    guarda piu' di un testo e' piu' severo, mai meno.

    Con un blocco di contesto davanti si guarda la busta che lo segue: altrimenti chi
    lo antepone a una firma falsa scavalcherebbe il controllo d'identità. E si guarda
    dopo il rumore iniziale (ZWSP, ESC, invisibili): la busta che si legge è quella che
    conta, non quella che i byte lasciano vedere a una regex.
    """
    lenient = raw is not None and "\x1b" in raw
    name = _claim(split_context_frame(message)[1], lenient)
    if name is None and raw is not None and raw != message:
        name = _claim(split_context_frame(raw)[1], lenient)
    return name


def session_from_ancestry(pid, parent_of, pane_owner):
    """La sessione del pane in cui questo processo gira DAVVERO.

    `parent_of(pid)` e `pane_owner(pid)` sono iniettate: la prima dà il padre,
    la seconda la sessione se quel pid è il processo di un pane. Nessuna delle
    due si legge dall'ambiente, che è il punto.

    Il giro è limitato: una catena di padri circolare o troppo lunga non deve
    trasformarsi in un ciclo infinito dentro il trasporto dei messaggi.
    """
    seen = set()
    for _ in range(64):
        if pid is None or pid <= 1 or pid in seen:
            return None
        seen.add(pid)
        owner = pane_owner(pid)
        if owner:
            return owner
        pid = parent_of(pid)
    return None


def classify_sender(claimed, origin, known_agents):
    """Quanto possiamo credere alla firma di questo messaggio.

    - `unsigned`      → nessuna busta: non c'è niente da credere né da negare;
    - `verified`      → chi dichiara di essere coincide con da dove arriva;
    - `relayed`       → si firma `utente`/`system`: sta inoltrando, non fingendo;
    - `impersonation` → dichiara un agente ESISTENTE che non è lui. È l'unico
                        caso che va fermato: è il difetto, in atto;
    - `unverified`    → l'origine non è derivabile. Non si accusa e non si
                        crede: si dichiara.

    ⚠️ Un mittente dichiarato che non corrisponde a nessuna sessione viva NON è
    un'impersonazione provata — potrebbe essere un agente spento, o un nome
    scritto male. Resta `unverified`: accusare su un'assenza è il modo di
    trasformare una difesa in un generatore di falsi allarmi.
    """
    known = {str(name).lower() for name in (known_agents or ())}
    origin = origin.lower() if origin else None
    if claimed is None:
        return VERIFIED if origin else UNSIGNED
    claimed = claimed.lower()
    if claimed in RELAY_SENDERS:
        # ⚠️ Firmarsi `utente` è il bersaglio PIÙ prezioso che esista, molto più
        # che impersonare un pari: un agente che crede di leggere un ordine
        # dell'operatore fa cose che a un collega non concederebbe. Se `relayed`
        # si ottenesse dichiarandolo, avremmo chiuso la porta dei pari e
        # lasciato aperta quella che vale di più.
        if origin is None:
            # Un daemon fuori da tmux (il bridge Telegram) non è verificabile:
            # non lo si blocca — spegnerebbe la corsia dell'utente — ma non
            # ottiene il timbro del relay. Resta non verificato, e chi legge lo
            # vede scritto addosso al messaggio.
            return UNVERIFIED
        if origin in RELAY_ORIGINS:
            return RELAYED
        # Un agente vivo che si firma «utente» sta impersonando l'operatore.
        # È il caso peggiore, e qui è anche il più facile da riconoscere:
        # sappiamo da dove arriva davvero.
        return IMPERSONATION
    if origin is None:
        return UNVERIFIED
    if claimed == origin:
        return VERIFIED
    return IMPERSONATION if claimed in known else UNVERIFIED


# I marchi che il TRASPORTO appone: il verdetto deve arrivare a chi decide, e
# chi decide è l'agente che legge il pane, non un file di log. Un classificatore
# corretto il cui verdetto non raggiunge nessuno è una difesa che gira e non
# copre.
#
# Sono in inglese perché finiscono a schermo e questo perimetro è English-only
# (`tests/test_shared_backend_english.py`, che è Python e sorveglia anche il
# JavaScript di `cli/` e `shared/`).
MARKS = {
    UNVERIFIED: "[!UNVERIFIED SENDER]",
    RELAYED: "[!RELAYED]",
}

UNFENCED_MARK = "[!UNFENCED]"

# Marchio riconosciuto in ingresso per essere TOLTO: nessuno deve potersi
# timbrare da solo, né apporre un timbro a un altro.
_ANY_MARK_RE = re.compile(r"\s*\[!(?:UNVERIFIED SENDER|RELAYED|UNFENCED)\]")

# ── JHT-T21 · il testo dell'utente non entra nel pane com'è ─────────────────
# Il turno che il daemon della chat (o il gioco) consegna ha la forma
# `[@utente -> @agente] [CHAT] <testo>` oppure `... [TG] <testo>`. La busta e il
# tag li compone il codice, il testo è dell'utente — o di chi gli ha scritto, o
# di una pagina che ha incollato. Il trasporto digita tutto con `send-keys -l`,
# quindi un a capo, un ESC o un ritorno carrello del testo arrivano alla TUI
# come tasti, e una riga che comincia con `[@x -> @y]` si legge come un collega.
# Il testo viene recintato qui, dove la provenienza della busta si decide già:
# stessa funzione, un solo punto. Non tocca le altre buste (`[TG-DOC]`, i marker
# di sistema, i messaggi fra agenti): la loro parte non-trusted è già trattata
# da chi le compone.
# `[TG-EDITED]` is what the Telegram bridge puts in front of a message the user EDITED
# (tg-bridge.py `dispatch_update`): a new turn, with the user's text after it. The bridge
# also puts it in front of an attachment envelope (`[TG-EDITED] [TG-DOC] path=…`), whose
# fields it composed itself: that one is left as it is, like every other `[TG-*]` envelope.
# A user's own text can never start with `[TG-`: the bridge marks it `[USER TEXT]`.
USER_TURN_RE = re.compile(
    r"^(\s*\[@utente\s*->\s*@[A-Za-z0-9_-]+\]\s*\[(?:CHAT|TG|TG-EDITED)\])(?:\s+(.*))?\Z",
    re.DOTALL,
)
_EDITED_TAG_RE = re.compile(r"\[TG-EDITED\]\Z")


_FRAME_END = "\n[FINE CONTESTO]\n\n"
_ANY_LINE_BREAK = re.compile(r"\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]")
USER_TEXT_MARK = "[USER TEXT]"


def clean_context_frame(frame):
    """Il blocco di contesto del gioco, ripulito riga per riga; '' se non si sa ripulire.

    Lo compone il gioco, ma il CONTENUTO è testo dichiarato dall'utente (profilo, preferenze,
    risposte dell'onboarding) e il profilo può venire da un CV: entrava nel pane grezzo, con a
    capo, ESC, override bidi e righe che imitano una busta. Restano fissi la prima riga e il
    terminatore; ogni riga del corpo passa per `sanitize_user_text` (una riga, invisibili tolti
    con la lista unica, marcatori finti disinnescati) e una che comincia con `[` — dove una
    busta finta sarebbe credibile — porta davanti `[USER TEXT]`, come fa il bridge. Un blocco
    legittimo (righe di testo e di elenco) esce identico.
    """
    if not frame:
        return frame
    try:
        import sys as _sys

        here = os.path.dirname(os.path.abspath(__file__))
        if here not in _sys.path:
            _sys.path.insert(0, here)
        from external_content import sanitize_user_text

        first, _, rest = frame.partition("\n")
        body = rest[: len(rest) - len(_FRAME_END)]
        lines = []
        for line in _ANY_LINE_BREAK.split(body):
            clean = sanitize_user_text(line)
            lines.append(f"{USER_TEXT_MARK} {clean}" if clean.startswith("[") else clean)
        return sanitize_user_text(first) + "\n" + "\n".join(lines) + _FRAME_END
    except Exception:
        return ""


def fence_user_turn_message(message):
    """Il messaggio con il testo dell'utente recintato; gli altri, identici."""
    frame, rest = split_context_frame(message)
    found = USER_TURN_RE.match((rest or "")[_noise_length(rest or ""):])
    if not found:
        return message
    head, text = found.group(1), found.group(2) or ""
    if _EDITED_TAG_RE.search(head) and text.lstrip().startswith("[TG-"):
        return message           # an edited attachment: the bridge composed it
    head = clean_context_frame(frame) + head
    try:
        import sys as _sys

        here = os.path.dirname(os.path.abspath(__file__))
        if here not in _sys.path:
            _sys.path.insert(0, here)
        from external_content import fence_user_turn

        return f"{head} {fence_user_turn(text)}"
    except Exception:
        # Una difesa che non sa decidere deve dirlo, non tacere. Il testo non
        # arriva comunque com'era: su una riga e senza comandi non si può
        # garantire, quindi lo si segnala e basta.
        return f"{head} {UNFENCED_MARK} {text}"


# ── JHT-T21-b · la console scrive testo libero, senza busta ─────────────────────
# `jht team send` / `jht team chat` e il pannello locale (`/api/team/send`) mandano al
# pane il testo di chi li usa, così com'è, senza busta: nessuno dice di chi sia, e il
# destinatario lo legge come se fosse stato digitato nel pane. Il difetto tecnico è lo
# stesso della chat (ESC e CR arrivano alla TUI come tasti, gli invisibili e i tag
# nascondono istruzioni, una riga può imitare una busta), l'ATTRIBUZIONE è diversa: non
# c'è niente di verificabile da affermare. Quindi qui si PULISCE senza etichettare:
# `external_content.sanitize_user_text`, la stessa funzione del recinto, senza il
# confine. Il chiamante lo CHIEDE con `JHT_TMUX_SEND_FROM=user-console`; chiederlo non
# conferisce niente (aggiunge pulizia, non fiducia), quindi non serve che sia autentico.
CONSOLE_SOURCE = "user-console"


def sanitize_console_message(message, source):
    """Il messaggio della console ripulito; qualunque altro, identico."""
    if source != CONSOLE_SOURCE:
        return message
    try:
        import sys as _sys

        here = os.path.dirname(os.path.abspath(__file__))
        if here not in _sys.path:
            _sys.path.insert(0, here)
        from external_content import sanitize_user_text

        return sanitize_user_text(message)
    except Exception:
        return f"{UNFENCED_MARK} {message}"


def mark_message(message, trust):
    r"""Il testo come dev'essere consegnato, col verdetto addosso.

    Il marchio compare **solo** quando c'è qualcosa da dire: un messaggio
    verificato resta identico a com'era, altrimenti ogni riga porterebbe rumore
    e si smetterebbe di leggerlo. Perché l'ASSENZA sia un segnale affidabile,
    ciò che arriva viene prima ripulito: un mittente che si scrive il timbro da
    solo non lo ottiene, e non può nemmeno toglierselo.

    Sta subito DOPO la busta, non prima: `^\s*\[@x -> @y\]` continua a
    matchare, quindi i lettori che riconoscono la forma — `agent_unblock`, che
    con quella distingue un draft d'agente da testo dell'utente — non si
    accorgono di niente e non vanno toccati.
    """
    text = message or ""
    skip = _noise_length(text)
    found = ENVELOPE_RE.match(text[skip:])
    head, body = (text[: skip + found.end()], text[skip + found.end() :]) if found else ("", text)
    # Ripetuto: due timbri finti di fila non devono lasciarne uno in piedi.
    while True:
        cleaned = _ANY_MARK_RE.sub("", body, count=1)
        if cleaned == body:
            break
        body = cleaned
    mark = MARKS.get(trust)
    if not mark:
        return f"{head}{body}" if found else body
    if found:
        return f"{head} {mark}{body}"
    return f"{mark} {body.lstrip()}"


# ── sorgenti reali: sottili per costruzione, così la decisione resta pura ────

def _run(argv):
    return subprocess.run(
        argv, text=True, capture_output=True, timeout=5, check=False
    )


def tmux_pane_owners():
    """`{pane_pid: sessione}` di ogni pane vivo, in minuscolo.

    Un fallimento di tmux non è un'identità: restituisce vuoto, e da lì la
    classificazione scende a `unverified`.
    """
    done = _run(["tmux", "list-panes", "-a", "-F", "#{pane_pid} #{session_name}"])
    owners = {}
    if done.returncode != 0:
        return owners
    for line in done.stdout.splitlines():
        pid, _, session = line.partition(" ")
        if pid.isdigit() and session.strip():
            owners[int(pid)] = session.strip().lower()
    return owners


def parent_of(pid):
    done = _run(["ps", "-o", "ppid=", "-p", str(pid)])
    value = done.stdout.strip()
    return int(value) if value.isdigit() else None


def verified_origin(pid):
    """L'origine da cui il messaggio parte davvero, o None."""
    owners = tmux_pane_owners()
    if not owners:
        return None
    return session_from_ancestry(pid, parent_of, owners.get)


def inspect_message(pid, message, raw=None):
    """`(trust, claimed, origin)` con una sola interrogazione a tmux.

    Le sessioni vive escono dalla stessa lettura dei pane: chiederle due volte
    aprirebbe una finestra in cui l'elenco cambia fra un controllo e l'altro.
    """
    panes = tmux_pane_owners()
    origin = session_from_ancestry(pid, parent_of, panes.get) if panes else None
    claimed = claimed_sender(message, raw)
    return classify_sender(claimed, origin, set(panes.values())), claimed, origin


def strip_controls(message):
    """Il messaggio senza ESC, sequenze complete e controlli: quello che il CLI ricevera' davvero."""
    try:
        import sys as _sys

        here = os.path.dirname(os.path.abspath(__file__))
        if here not in _sys.path:
            _sys.path.insert(0, here)
        from external_content import strip_terminal_controls

        return strip_terminal_controls(message)
    except Exception:
        # Senza la funzione si tolgono almeno ESC e controlli: meglio un testo piu' povero che grezzo.
        return "".join(
            ch for ch in str(message or "")
            if ch in "\n\t" or not (ord(ch) < 0x20 or ord(ch) == 0x7F or 0x80 <= ord(ch) <= 0x9F)
        )


def prepare_message(message, source=""):
    """Il messaggio come verra' consegnato, prima di ogni verdetto: senza controlli del terminale
    (fra agenti un ESC non ha nessun uso legittimo, un log colorato resta leggibile), poi recintato
    o ripulito."""
    cleaned = strip_controls(message)
    delivered = fence_user_turn_message(cleaned)
    if delivered == cleaned:     # not a chat envelope: the console may ask for it to be cleaned
        delivered = sanitize_console_message(cleaned, source)
    return delivered


def main(argv):
    """Uso dal trasporto: verdetto sulla prima riga, messaggio marcato sotto.

    Esce sempre 0: a decidere se fermare l'invio è il chiamante, che è l'unico
    a sapere cosa sta consegnando. Un helper che esce non-zero verrebbe
    inghiottito da un `|| true` e la difesa sparirebbe senza rumore.
    """
    message = argv[1] if len(argv) > 1 else ""
    # Si ripulisce PRIMA di giudicare: la pulizia può far comparire una busta che il
    # controllo, sul testo grezzo, non vedeva (uno ZWSP davanti), e il verdetto deve
    # valere per ciò che verrà davvero consegnato.
    delivered = prepare_message(message, os.environ.get("JHT_TMUX_SEND_FROM", ""))
    trust, claimed, origin = inspect_message(os.getpid(), delivered, message)
    # Prima riga il verdetto, dal resto il messaggio come va consegnato. Un
    # solo giro: chiedere due volte aprirebbe una finestra in cui l'elenco dei
    # pane cambia fra il controllo e la marcatura.
    print(f"{trust}\t{claimed or ''}\t{origin or ''}")
    print(mark_message(delivered, trust), end="")
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv))
