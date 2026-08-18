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


def claimed_sender(message: str) -> str | None:
    """Il mittente che il messaggio DICHIARA, o None se non c'è busta."""
    found = ENVELOPE_RE.match(message or "")
    return found.group(1).lower() if found else None


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

# Marchio riconosciuto in ingresso per essere TOLTO: nessuno deve potersi
# timbrare da solo, né apporre un timbro a un altro.
_ANY_MARK_RE = re.compile(r"\s*\[!(?:UNVERIFIED SENDER|RELAYED)\]")


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
    found = ENVELOPE_RE.match(text)
    head, body = (text[: found.end()], text[found.end() :]) if found else ("", text)
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


def inspect_message(pid, message):
    """`(trust, claimed, origin)` con una sola interrogazione a tmux.

    Le sessioni vive escono dalla stessa lettura dei pane: chiederle due volte
    aprirebbe una finestra in cui l'elenco cambia fra un controllo e l'altro.
    """
    panes = tmux_pane_owners()
    origin = session_from_ancestry(pid, parent_of, panes.get) if panes else None
    claimed = claimed_sender(message)
    return classify_sender(claimed, origin, set(panes.values())), claimed, origin


def main(argv):
    """Uso dal trasporto: verdetto sulla prima riga, messaggio marcato sotto.

    Esce sempre 0: a decidere se fermare l'invio è il chiamante, che è l'unico
    a sapere cosa sta consegnando. Un helper che esce non-zero verrebbe
    inghiottito da un `|| true` e la difesa sparirebbe senza rumore.
    """
    message = argv[1] if len(argv) > 1 else ""
    trust, claimed, origin = inspect_message(os.getpid(), message)
    # Prima riga il verdetto, dal resto il messaggio come va consegnato. Un
    # solo giro: chiedere due volte aprirebbe una finestra in cui l'elenco dei
    # pane cambia fra il controllo e la marcatura.
    print(f"{trust}\t{claimed or ''}\t{origin or ''}")
    print(mark_message(message, trust), end="")
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv))
