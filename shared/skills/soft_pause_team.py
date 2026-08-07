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
    "[SENTINELLA] [PAUSA] Usage monitoring failed (L1+L2+L3 fallbacks all "
    "failed). Finish your current task cleanly, DO NOT start new ones, and DO "
    "NOT make new tool calls. Wait silently. Resume work ONLY when you receive "
    "a '[RIPRENDI]' message from SENTINELLA or CAPITANO. Confirm that you have "
    "read this."
)

MSG_CAPITANO = (
    "[SENTINELLA] [PAUSA TEAM] Usage monitoring has failed completely: HTTP "
    "fetch (L1), multi-provider skill (L2), and manual TUI worker (L3) all "
    "failed. I have no fresh AI-provider usage data, so I CANNOT guarantee "
    "that the team is operating within the rate-limit budget.\n\n"
    "ACTION TAKEN: I sent a [PAUSA] message to every operational agent, asking "
    "them to finish their current task cleanly and then wait.\n\n"
    "WHAT YOU MUST DO:\n"
    "1. DO NOT spawn new agents.\n"
    "2. DO NOT send new operational orders to active agents.\n"
    "3. Finish your current turn cleanly and wait.\n"
    "4. DO NOT force a manual /usage check: the source is broken and you "
    "already have the full picture.\n\n"
    "RESUMING: I will keep listening for [BRIDGE TICK] messages. As soon as "
    "the source is readable again (valid BRIDGE TICK or BRIDGE INFO), I will "
    "send '[SENTINELLA] [RIPRENDI] usage=X% ...' with fresh figures. Then "
    "redistribute '[RIPRENDI]' to every operational agent through "
    "jht-tmux-send and the team will resume.\n\n"
    "If the problem persists for 2 consecutive cycles, I will escalate to a "
    "HARD freeze (Esc x2 to every agent through freeze_team.py)."
)

# ── Testi della modalità STANDBY (--include-core) ────────────────────────
# La differenza che conta rispetto al FATAL: qui il sistema di monitoraggio
# FUNZIONA — i bridge continuano a leggere la quota (non costa un turno di
# modello) e sono LORO la sveglia. Nessun agente deve controllare niente.

MSG_STANDBY_OPERATIVO = (
    "[STANDBY] [PAUSA] Team entering zero-spend standby{reason}. Finish your "
    "current task cleanly, DO NOT start new ones, DO NOT make new tool calls, "
    "and DO NOT message other agents. Wait SILENTLY. Resume ONLY when you "
    "receive a '[RIPRENDI]' message."
)

MSG_STANDBY_CAPITANO = (
    "[STANDBY] [PAUSA TEAM] The team is entering ZERO-SPEND standby{reason}. "
    "This is not a failure: it is a deliberate suspension. With the pipeline "
    "idle, coordination ticks alone consume about 2 weekly points per hour; "
    "standby eliminates those too.\n\n"
    "WHAT YOU MUST DO:\n"
    "1. DO NOT spawn new agents or issue new orders.\n"
    "2. Finish your current turn cleanly and wait SILENTLY.\n"
    "3. DO NOT expect [BRIDGE PACING]/[HEARTBEAT]: they are suspended, not "
    "broken.\n"
    "4. DO NOT check usage: the bridges continue sampling by themselves.\n\n"
    "RESUMING: sentinel-bridge evaluates the exit condition on every tick and, "
    "when it is met, sends '[RIPRENDI]' to EVERY role (including you). Until "
    "then, maintain complete silence."
)

MSG_STANDBY_SENTINELLA = (
    "[STANDBY] [PAUSA] Team entering zero-spend standby{reason}. You will not "
    "receive [BRIDGE TICK] or [BRIDGE PACING] while it lasts: this is NOT a "
    "source failure, so DO NOT use fallbacks or run manual usage checks. The "
    "bridge keeps sampling (sentinel-data.jsonl grows) and acts as the alarm. "
    "Finish your turn cleanly and wait SILENTLY until '[RIPRENDI]'."
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
        description="Gracefully pause the team through tmux messages (never Esc)")
    ap.add_argument("--include-core", action="store_true",
                    help="zero-spend standby: ALSO pause Capitano/Assistente/"
                         "Sentinella with dedicated messages")
    ap.add_argument("--reason", default="",
                    help="reason shown in agent notifications")
    args = ap.parse_args(argv)

    sessions = list_sessions()
    if not sessions:
        print("no tmux sessions found")
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
