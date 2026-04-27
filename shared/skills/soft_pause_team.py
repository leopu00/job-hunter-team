#!/usr/bin/env python3
"""
soft_pause_team — pausa graceful del team via messaggio testuale tmux.

Usata dalla Sentinella quando dichiara FATAL (L1+L2+L3 di check usage tutti
falliti). A differenza di freeze_team.py (che manda Esc x2 e abortisce
qualsiasi cosa l'agente stesse facendo), qui mandiamo un MESSAGGIO che
chiede di chiudere il task corrente e poi attendere — niente operazioni
interrotte a metà, niente file scritti parzialmente, niente git checkout
incompleti.

Due forme di messaggio:
  • OPERATIVI (SCOUT, ANALISTA, SCORER, SCRITTORE, CRITICO, ecc.)
    → corto, secco: "fermati quando finisci, attendi RIPRENDI"
  • CAPITANO
    → lungo, esplicativo: cosa è successo, perché si ferma, cosa
      aspettarsi, come riparte

Esclusi: SENTINELLA, ASSISTENTE, SENTINELLA-WORKER (non operativi /
infrastruttura).

Exit 0 sempre.
"""
import subprocess
import sys

CAPITANO = "CAPITANO"
EXCLUDE = {"SENTINELLA", "ASSISTENTE", "SENTINELLA-WORKER"}

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


def main():
    sessions = list_sessions()
    if not sessions:
        print("nessuna sessione tmux trovata")
        sys.exit(0)

    paused_op = []
    paused_capitano = False
    skipped = []

    for s in sessions:
        if s in EXCLUDE:
            skipped.append(s)
            continue
        if s == CAPITANO:
            if send_message(s, MSG_CAPITANO):
                paused_capitano = True
            continue
        if send_message(s, MSG_OPERATIVO):
            paused_op.append(s)

    print(f"paused_operativi={len(paused_op)} sessions={','.join(paused_op) if paused_op else 'none'}")
    print(f"paused_capitano={'yes' if paused_capitano else 'no'}")
    if skipped:
        print(f"skipped={','.join(skipped)}")


if __name__ == "__main__":
    main()
