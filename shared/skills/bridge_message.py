#!/usr/bin/env python3
"""bridge_message — formato UNICO del tick budget (renderer condiviso).

Lo STESSO testo, identico, va a due destinatari:
  • bridge → SENTINELLA  (push, quando c'è un edge azionabile)
  • skill `rate-budget` → CAPITANO  (pull, on-demand: rilegge l'ultimo tick)

3 sezioni ariose + consiglio:
  ⏱  FINESTRA 5H   — il soffitto del provider (lock a 100% prima del reset)
  📅 OGGI          — il budget giornaliero
  📆 SETTIMANA     — il budget settimanale + debito

Modello di velocità (deciso 2026-06-30): UNA sola definizione, cumulativa.
  velocità ATTUALE  = usage consumato / tempo trascorso         (media dall'inizio)
  velocità TARGET   = (quanto manca al target) / tempo che resta (retta d'atterraggio)
Stessa unità (%/h), una sotto l'altra → lo scarto si legge al volo, senza calcoli.
Niente EMA tick-to-tick nel display: la Sentinella, se vuole il trend istantaneo,
legge lei la trend-line dal JSONL.

`render(v)` è una funzione PURA: prende un dict di valori già calcolati e
ritorna il testo. Chi chiama (bridge / skill) popola il dict.
"""
from __future__ import annotations


def cumulative_velocity(used_pct, elapsed_h):
    """Media cumulativa: usage consumato / tempo trascorso. None se non calcolabile."""
    if not isinstance(used_pct, (int, float)) or isinstance(used_pct, bool):
        return None
    if not isinstance(elapsed_h, (int, float)) or elapsed_h <= 0:
        return None
    return used_pct / elapsed_h


def target_velocity(remaining_to_target_pct, remaining_h):
    """Retta d'atterraggio: quanto manca al target / tempo che resta. >=0."""
    if not isinstance(remaining_to_target_pct, (int, float)):
        return None
    if not isinstance(remaining_h, (int, float)) or remaining_h <= 0:
        return None
    return max(0.0, remaining_to_target_pct) / remaining_h


def _gap(vel_now, vel_target):
    """Scarto attuale/target come stringa '+38% sopra' / '-12% sotto' / 'in pari'."""
    if not isinstance(vel_now, (int, float)) or not isinstance(vel_target, (int, float)):
        return ""
    if vel_target <= 0:
        return ""
    pct = round((vel_now / vel_target - 1.0) * 100)
    if pct >= 3:
        return f"+{pct}% above"
    if pct <= -3:
        return f"{pct}% below"
    return "on pace"


def _fmt_vel(v):
    return f"{v:.1f}" if isinstance(v, (int, float)) else "—"


def _vel_block(label_target, vel_now, vel_target):
    """Riga 'velocità  X %/h   ·   <label> Y %/h     [scarto]'."""
    gap = _gap(vel_now, vel_target)
    gap_s = f"     [{gap}]" if gap else ""
    return (f"   velocity  {_fmt_vel(vel_now)} %/h   ·   "
            f"{label_target}  {_fmt_vel(vel_target)} %/h{gap_s}")


def _display_status(value):
    """English rendering for stable internal pacing/status identifiers."""
    return {
        "ATTENZIONE": "WARNING",
        "SOTTOUTILIZZO": "UNDERUTILIZED",
        "SOPRA-PACE-WEEKLY": "ABOVE-PACE-WEEKLY",
        "SOPRA-PACE": "ABOVE-PACE",
        "SOTTO-PACE": "BELOW-PACE",
        "ALLINEATO": "ON-PACE",
    }.get(value, value)


def _display_duration(value):
    """Normalize the launcher's legacy Italian day suffix for display only."""
    if not isinstance(value, str):
        return value
    parts = value.split(" ", 1)
    if parts and parts[0].endswith("g") and parts[0][:-1].isdigit():
        parts[0] = f"{parts[0][:-1]}d"
    return " ".join(parts)


def _display_weekly_verdict(value):
    """Translate the launcher's stable legacy verdict text without mutating it."""
    if not isinstance(value, str):
        return value
    replacements = (
        ("WEEKLY-PACE→RIPRESA-CONTROLLATA", "WEEKLY-PACE→CONTROLLED-RECOVERY"),
        ("picco in uscita, NON frenare duro", "spike fading, DO NOT brake hard"),
        ("WEEKLY-PACE→RALLENTA", "WEEKLY-PACE→SLOW-DOWN"),
        (": vai a ~", ": target ~"),
        (" (ora ", " (now "),
        ("(resta ", "(remaining "),
        ("h-lavoro)", " active-h)"),
        (" → altrimenti ESAURISCI ~", " → otherwise EXHAUST ~"),
        ("h-lavoro PRIMA del reset", " active-h BEFORE reset"),
        ("WEEKLY-PACE→ACCELERA-SATURA", "WEEKLY-PACE→ACCELERATE-SATURATE"),
        ("a ritmo attuale chiudi ~", "at the current pace you finish at ~"),
        ("spreco ~", "wasting ~"),
        ("del weekly prima del reset", "of the weekly budget before reset"),
        ("budget a rischio spreco", "budget at risk of waste"),
        ("WEEKLY-PACE→MANTIENI", "WEEKLY-PACE→HOLD"),
    )
    rendered = value
    for source, target in replacements:
        rendered = rendered.replace(source, target)
    return rendered


def derive_advice(v):
    """Consiglio del bridge derivato dai segnali già calcolati (tabella, non AI).
    Ritorna lista di righe (può essere vuota = team calmo → nessun consiglio)."""
    out = []
    fh = v.get("fivehh") or {}
    wk = v.get("weekly") or {}
    extras = v.get("extras") or {}
    phase = v.get("work_phase")

    # Tool rotto = azionabile SUBITO, in cima.
    broken = extras.get("tools_broken") or []
    if broken:
        out.append(f"⚠ Tool down: {', '.join(broken)} — fix it before scaling up.")

    if phase == "OFF":
        out.append("Outside working hours (rule 11): do not spawn; workers finish and go idle.")
        return out

    status = fh.get("status")
    kind = wk.get("kind")
    debt = wk.get("debt")
    burn = wk.get("burn_mode")

    if status == "LOCKED":
        out.append("Weekly budget exhausted: STOP spawning and wait for the reset.")
        return out

    if burn:
        # [BURN-MODE-ADVISES-THE-WRONG-LEVER] — l'allarme aveva ragione e il
        # consiglio no. Su P05 (2026-08-02) ha suonato per ore annunciando
        # ~40% di weekly sprecato, ripetendo «scala worker»: il team aveva 460
        # posizioni e ZERO candidature, cioè il sourcing era già saturo (è
        # work-capped, non budget-capped) e la leva ferma era scrivere CV.
        # Con un raccolto pronto si propone la MODALITÀ — decisione
        # dell'utente, mai un cambio automatico.
        backlog = extras.get("harvest_backlog")
        if isinstance(backlog, int) and backlog > 0:
            out.append(
                f"BURN MODE (below pace + reset near): the lever is NOT more "
                f"scouting — {backlog} positions already found are waiting for "
                f"a CV. PROPOSE `harvest` mode to the user and let them decide; "
                f"do not switch it yourself.")
        else:
            out.append("BURN MODE (below pace + reset near): SATURATE — scale workers and remove weekly throttles.")
    elif kind == "SOPRA-PACE" or status in ("ATTENZIONE", "SOPRA-PACE-WEEKLY"):
        line = "Above pace: throttle to pace and STOP new spawns until back on target."
        if isinstance(debt, (int, float)) and debt >= 8:
            line += f" High debt (+{debt:.0f}pp) → use proportional braking, not a light touch."
        else:
            line += " Do not kill workers: longer sleeps are enough."
        out.append(line)
    elif status == "SOTTOUTILIZZO" and kind in (None, "SOTTO-PACE", "ALLINEATO"):
        out.append("There is headroom: spawn on bottlenecks if work is queued.")

    mrem = extras.get("monthly_rem")
    if isinstance(mrem, (int, float)) and mrem < 15:
        out.append(f"Kimi monthly remaining: {mrem}% — FREEZE at exhaustion and keep the pace low.")
    return out


def render(v):
    """Dict di valori → testo del tick (3 sezioni + consiglio). Funzione pura."""
    ts = v.get("ts_now", "?")
    provider = v.get("provider", "?")
    phase = v.get("work_phase") or "?"
    lines = [f"── BRIDGE TICK · {ts} · {provider} · {phase} ──", ""]

    # ── ⏱ FINESTRA 5H ──
    fh = v.get("fivehh") or {}
    lines.append("⏱  5H WINDOW")
    u = fh.get("usage")
    t = fh.get("target")
    close = fh.get("reset_str") or "?"
    rin = fh.get("reset_in")
    rin_s = f" (in {_display_duration(rin)})" if rin else ""
    lines.append(f"   usage {u}%        target {t}%  →  closes {close}{rin_s}")
    lines.append(_vel_block("target", fh.get("vel_now"), fh.get("vel_target")))
    st = fh.get("status")
    proj = fh.get("proj")
    proj_s = f"   ·   proj {proj}%" if isinstance(proj, (int, float)) else ""
    lines.append(f"   → {_display_status(st)}{proj_s}")
    lines.append("")

    # ── 📅 OGGI ──
    dl = v.get("daily")
    if dl:
        lines.append("📅  TODAY  (daily budget)")
        flag = "⛔ OVER BUDGET" if dl.get("over") else "✅"
        lines.append(f"   consumed {dl.get('consumed')}% / budget {dl.get('budget')}% "
                     f"(cap {dl.get('cap')}%)   {flag}")
        lines.append(_vel_block("target", dl.get("vel_now"), dl.get("vel_target")))
        lines.append("")

    # ── 📆 SETTIMANA ──
    wk = v.get("weekly")
    if wk:
        lines.append("📆  WEEK")
        wclose = wk.get("reset_str") or "?"
        wrin = wk.get("reset_in")
        wrin_s = f" (in {_display_duration(wrin)})" if wrin else ""
        lines.append(f"   used {wk.get('used')}%   ·   remaining {wk.get('remaining')}%   ·   "
                     f"reset {wclose}{wrin_s}")
        # Verdetto imperativo (Passo A): headline azionabile, non solo numeri.
        # Assente sul path skill→Capitano che non lo popola → si salta pulito.
        vd = wk.get("verdict")
        if vd:
            lines.append(f"   ➤ {_display_weekly_verdict(vd)}")
        ratio = wk.get("ratio")
        ratio_s = f"   ratio {ratio}×" if isinstance(ratio, (int, float)) else ""
        lines.append(_vel_block("sustainable", wk.get("vel_now"), wk.get("sustainable")) + ratio_s)
        tail = []
        if wk.get("kind"):
            tail.append(str(_display_status(wk["kind"])))
        if isinstance(wk.get("debt"), (int, float)):
            tail.append(f"debt {wk['debt']:+.0f}pp")
        if isinstance(wk.get("early_lockout"), (int, float)):
            tail.append(f"lockout ~{wk['early_lockout']:.0f}h")
        if tail:
            lines.append("   " + "   ·   ".join(tail))
        lines.append("")

    # ── 🧭 CONSIGLIO ──
    advice = derive_advice(v)
    if advice:
        lines.append("🧭  BRIDGE ADVICE")
        for a in advice:
            lines.append(f"   {a}")
    return "\n".join(lines).rstrip() + "\nsrc=bridge."
