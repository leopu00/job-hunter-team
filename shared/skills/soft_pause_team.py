#!/usr/bin/env python3
"""
soft_pause_team — pausa graceful del team via messaggio testuale tmux.

Usata dalla Sentinella quando dichiara FATAL (L1+L2+L3 di check usage tutti
falliti). A differenza di freeze_team.py (che manda Esc x2 e abortisce
qualsiasi cosa l'agente stesse facendo), qui mandiamo un MESSAGGIO che
chiede di chiudere il task corrente e poi attendere — niente operazioni
interrotte a metà, niente file scritti parzialmente, niente git checkout
incompleti.

Due modalità:

  • DEFAULT (FATAL usage) — comportamento storico, invariato: messaggio corto
    agli OPERATIVI, lungo al CAPITANO; esclusi SENTINELLA, ASSISTENTE,
    SENTINELLA-WORKER (non operativi / infrastruttura).
  • --include-core ([TEAM-STANDBY-ZERO-SPEND]) — standby a spesa zero: la
    pausa raggiunge ANCHE i core (CAPITANO, ASSISTENTE, SENTINELLA), perché
    sono loro (coi bridge) la spesa residua a pipeline ferma. Testi dedicati:
    spiegano che i bridge continuano a campionare e faranno da sveglia.
    Restano fuori SOLO le sessioni che non sono agenti LLM in chat
    (NEVER_MESSAGE): scrivergli è un turno sprecato o, peggio, un comando
    eseguito in shell.

## Rispetto alla deroga di spesa dell'utente (`burn_intent.py`): NON cede

Questa pausa è una **rete di sicurezza**, non un automatismo di spesa: il
modulo non legge `.burn-intent.flag` e non deve farlo. Il motivo sta nella
condizione che la fa scattare. La deroga è una decisione **economica** presa
*sui numeri* — «spendi in fretta soldi che sono miei» — mentre qui i numeri
non esistono: L1 (fetch HTTP), L2 (skill multi-provider) e L3 (worker TUI)
sono falliti **tutti e tre**. Derogare qui non significherebbe accettare di
spendere di più, ma spendere **senza misurare**: una deroga alla cecità, non
al freno. È la stessa direzione del fail-closed di `burn_intent` (errore di
lettura → freno attivo).

L'errore costa in modo asimmetrico. Sbagliare per eccesso di prudenza costa
una pausa: il messaggio chiede di chiudere pulito e attendere, e il
`[RIPRENDI]` parte da solo appena la sorgente torna leggibile. Sbagliare per
eccesso di fiducia costa una notte di spesa non misurata, che si scopre a
lockout avvenuto — cioè esattamente ciò che la deroga NON compra.

Anche `--include-core` resta fuori: lo standby a spesa zero è un'azione
deliberata (`standby.py`, dietro flag), non un automatismo che reagisce a un
numero, quindi non c'è niente da derogare.

Non compare in `NEVER_YIELDS` perché quella tupla è una lista di **nomi**
copiata testualmente nell'avviso del gioco e nei prompt in 7 lingue:
aggiungerci una voce è un cambio di contratto, non una classificazione.

Exit 0 sempre (dal main storico); `pause_all()` è importabile dalle skill
(standby.py la usa DOPO aver scritto il flag: prima si zittiscono bridge e
watchdog, poi si fermano gli agenti).
"""
import argparse
import subprocess
import sys

CAPITANO = "CAPITANO"
SENTINELLA = "SENTINELLA"
EXCLUDE = {"SENTINELLA", "ASSISTENTE", "SENTINELLA-WORKER"}
# Sessioni a cui non si scrive MAI, in nessuna modalità con --include-core:
#   SENTINELLA-WORKER — TUI usata come SENSORE (parse del pane /usage): un
#     messaggio la farebbe rispondere = un turno di modello per niente.
#   DOCTOR-WATCHDOG   — loop bash in tmux: un testo + Enter verrebbe ESEGUITO
#     dalla shell come comando.
# Tenuta in sync con standby.NEVER_MESSAGE (test dedicato).
NEVER_MESSAGE = {"SENTINELLA-WORKER", "DOCTOR-WATCHDOG"}

MSG_OPERATIVO = (
    "[SENTINELLA] [PAUSA] Monitoraggio usage rotto (fallback L1+L2+L3 tutti ko). "
    "Termina il task corrente in modo pulito, NON iniziarne nuovi, NON fare nuovi "
    "tool calls. Resta in attesa silenziosa. Riprendi a lavorare SOLO quando ricevi "
    "un messaggio '[RIPRENDI]' da SENTINELLA o CAPITANO. Conferma di aver letto."
)

MSG_CAPITANO = (
    "[SENTINELLA] [PAUSA TEAM] Sistema di monitoraggio usage in failure totale: "
    "fetch HTTP (L1) + skill multi-provider (L2) + worker TUI manuale (L3) tutti "
    "falliti. Non ho dati freschi sul consumo del provider AI, quindi NON posso "
    "garantire che il team stia operando dentro il budget rate-limit.\n\n"
    "AZIONE PRESA: ho mandato un messaggio di [PAUSA] a tutti gli agenti operativi "
    "del team chiedendogli di terminare il task corrente in modo pulito e poi "
    "restare in attesa.\n\n"
    "COSA DEVI FARE TU:\n"
    "1. NON spawnare nuovi agenti.\n"
    "2. NON inviare nuovi ordini operativi agli agenti già attivi.\n"
    "3. Chiudi il tuo turno corrente in modo pulito e resta in attesa.\n"
    "4. NON forzare un /usage manuale: la sorgente è rotta, hai già il quadro.\n\n"
    "RIPARTENZA: io continuo ad ascoltare i [BRIDGE TICK]. Appena la sorgente "
    "torna leggibile (BRIDGE TICK valido o BRIDGE INFO), ti mando un "
    "'[SENTINELLA] [RIPRENDI] usage=X% ...' con i numeri freschi. A quel punto "
    "tu ridistribuisci '[RIPRENDI]' a tutti gli agenti operativi via "
    "jht-tmux-send e il team riparte.\n\n"
    "Se il problema persiste per 2 cicli consecutivi escalo a HARD freeze "
    "(Esc x2 a tutti gli agenti via freeze_team.py)."
)

# ── Testi della modalità STANDBY (--include-core) ────────────────────────
# La differenza che conta rispetto al FATAL: qui il sistema di monitoraggio
# FUNZIONA — i bridge continuano a leggere la quota (non costa un turno di
# modello) e sono LORO la sveglia. Nessun agente deve controllare niente.

MSG_STANDBY_OPERATIVO = (
    "[STANDBY] [PAUSA] Team in standby a spesa zero{reason}. Termina il task "
    "corrente in modo pulito, NON iniziarne nuovi, NON fare nuove tool call, "
    "NON scrivere ad altri agenti. Resta in attesa SILENZIOSA. Riprendi SOLO "
    "quando ricevi un messaggio '[RIPRENDI]'."
)

MSG_STANDBY_CAPITANO = (
    "[STANDBY] [PAUSA TEAM] Il team entra in standby a SPESA ZERO{reason}. "
    "Non è un guasto: è una sospensione deliberata — a pipeline ferma i soli "
    "tick di coordinamento bruciano ~2 punti di weekly all'ora, e lo standby "
    "azzera anche quelli.\n\n"
    "COSA DEVI FARE TU:\n"
    "1. NON spawnare nuovi agenti, NON dare nuovi ordini.\n"
    "2. Chiudi il tuo turno corrente in modo pulito e resta in attesa SILENZIOSA.\n"
    "3. NON aspettarti [BRIDGE PACING]/[HEARTBEAT]: sono sospesi, non rotti.\n"
    "4. NON fare check di usage: i bridge continuano a campionare da soli.\n\n"
    "RIPARTENZA: il sentinel-bridge valuta la condizione di uscita a ogni tick "
    "e, quando è soddisfatta, manda '[RIPRENDI]' a TUTTI i ruoli (te incluso). "
    "Fino ad allora, silenzio totale."
)

MSG_STANDBY_SENTINELLA = (
    "[STANDBY] [PAUSA] Team in standby a spesa zero{reason}. Non riceverai "
    "[BRIDGE TICK] né [BRIDGE PACING] finché dura: NON è un guasto della "
    "sorgente, NON fare fallback né check usage manuali. Il bridge continua a "
    "campionare (sentinel-data.jsonl cresce) e fa lui da sveglia. Chiudi il "
    "turno in modo pulito e resta in attesa SILENZIOSA fino al '[RIPRENDI]'."
)


def list_sessions():
    try:
        r = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, timeout=5,
        )
        if r.returncode != 0:
            return []
        return [s.strip() for s in r.stdout.decode("utf-8", errors="replace").splitlines() if s.strip()]
    except (subprocess.TimeoutExpired, OSError):
        return []


def send_message(session, message):
    """Manda un messaggio testuale via jht-tmux-send (gestisce send-keys robusto)."""
    try:
        r = subprocess.run(
            ["jht-tmux-send", session, message],
            capture_output=True, timeout=15,
        )
        return r.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def pause_all(include_core=False, reason=""):
    """Mette in pausa il team. Ritorna (paused, skipped): liste di sessioni.

    include_core=False → comportamento storico (FATAL usage): operativi +
    Capitano, esclusi SENTINELLA/ASSISTENTE/SENTINELLA-WORKER.
    include_core=True  → standby a spesa zero: ANCHE i core, testi dedicati;
    esclusi solo i NEVER_MESSAGE (non sono agenti LLM in chat).
    """
    reason_sfx = f" ({reason.strip()})" if (reason or "").strip() else ""
    exclude = NEVER_MESSAGE if include_core else EXCLUDE
    paused, skipped = [], []
    for s in list_sessions():
        if s in exclude:
            skipped.append(s)
            continue
        if include_core:
            if s == CAPITANO:
                msg = MSG_STANDBY_CAPITANO.format(reason=reason_sfx)
            elif s == SENTINELLA:
                msg = MSG_STANDBY_SENTINELLA.format(reason=reason_sfx)
            else:
                msg = MSG_STANDBY_OPERATIVO.format(reason=reason_sfx)
        else:
            msg = MSG_CAPITANO if s == CAPITANO else MSG_OPERATIVO
        if send_message(s, msg):
            paused.append(s)
    return paused, skipped


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="soft_pause_team",
        description="Pausa graceful del team via messaggio tmux (mai Esc)")
    ap.add_argument("--include-core", action="store_true",
                    help="standby a spesa zero: pausa ANCHE Capitano/Assistente/"
                         "Sentinella, con testi dedicati")
    ap.add_argument("--reason", default="",
                    help="motivo, mostrato negli avvisi agli agenti")
    args = ap.parse_args(argv)

    sessions = list_sessions()
    if not sessions:
        print("nessuna sessione tmux trovata")
        sys.exit(0)

    paused, skipped = pause_all(include_core=args.include_core,
                                reason=args.reason)
    op = [s for s in paused if s != CAPITANO]
    print(f"paused_operativi={len(op)} sessions={','.join(op) if op else 'none'}")
    print(f"paused_capitano={'yes' if CAPITANO in paused else 'no'}")
    if skipped:
        print(f"skipped={','.join(skipped)}")


if __name__ == "__main__":
    main()
