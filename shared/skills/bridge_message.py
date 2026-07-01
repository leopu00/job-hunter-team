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
        return f"+{pct}% sopra"
    if pct <= -3:
        return f"{pct}% sotto"
    return "in pari"


def _fmt_vel(v):
    return f"{v:.1f}" if isinstance(v, (int, float)) else "—"


def _vel_block(label_target, vel_now, vel_target):
    """Riga 'velocità  X %/h   ·   <label> Y %/h     [scarto]'."""
    gap = _gap(vel_now, vel_target)
    gap_s = f"     [{gap}]" if gap else ""
    return (f"   velocità  {_fmt_vel(vel_now)} %/h   ·   "
            f"{label_target}  {_fmt_vel(vel_target)} %/h{gap_s}")


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
        out.append(f"⚠ Tool giù: {', '.join(broken)} — fai sistemare prima di scalare.")

    if phase == "OFF":
        out.append("Fuori orario (regola 11): niente spawn, i worker finiscono e vanno idle.")
        return out

    status = fh.get("status")
    kind = wk.get("kind")
    debt = wk.get("debt")
    burn = wk.get("burn_mode")

    if status == "LOCKED":
        out.append("Budget settimanale esaurito: STOP spawn, attendi il reset.")
        return out

    if burn:
        out.append("BURN-MODE (sotto-pace + reset vicino): SATURA — scala worker, togli i throttle weekly.")
    elif kind == "SOPRA-PACE" or status in ("ATTENZIONE", "SOPRA-PACE-WEEKLY"):
        line = "Sopra-pace: throttle-to-pace + STOP nuovi spawn finché rientri."
        if isinstance(debt, (int, float)) and debt >= 8:
            line += f" Debito alto (+{debt:.0f}pp) → freno proporzionale, non leggero."
        else:
            line += " Non killare: basta allungare gli sleep."
        out.append(line)
    elif status == "SOTTOUTILIZZO" and kind in (None, "SOTTO-PACE", "ALLINEATO"):
        out.append("C'è margine: spawna sui colli di bottiglia (se hai coda).")

    mrem = extras.get("monthly_rem")
    if isinstance(mrem, (int, float)) and mrem < 15:
        out.append(f"Mensile Kimi rimane {mrem}% — a esaurimento CONGELA: tieni il ritmo basso.")
    return out


def render(v):
    """Dict di valori → testo del tick (3 sezioni + consiglio). Funzione pura."""
    ts = v.get("ts_now", "?")
    provider = v.get("provider", "?")
    phase = v.get("work_phase") or "?"
    lines = [f"── BRIDGE TICK · {ts} · {provider} · {phase} ──", ""]

    # ── ⏱ FINESTRA 5H ──
    fh = v.get("fivehh") or {}
    lines.append("⏱  FINESTRA 5H")
    u = fh.get("usage")
    t = fh.get("target")
    close = fh.get("reset_str") or "?"
    rin = fh.get("reset_in")
    rin_s = f" (tra {rin})" if rin else ""
    lines.append(f"   usage {u}%        target {t}%  →  chiusura {close}{rin_s}")
    lines.append(_vel_block("target", fh.get("vel_now"), fh.get("vel_target")))
    st = fh.get("status")
    proj = fh.get("proj")
    proj_s = f"   ·   proj {proj}%" if isinstance(proj, (int, float)) else ""
    lines.append(f"   → {st}{proj_s}")
    lines.append("")

    # ── 📅 OGGI ──
    dl = v.get("daily")
    if dl:
        lines.append("📅  OGGI  (budget giornaliero)")
        flag = "⛔ SFORO" if dl.get("over") else "✅"
        lines.append(f"   consumato {dl.get('consumed')}% / budget {dl.get('budget')}% "
                     f"(cap {dl.get('cap')}%)   {flag}")
        lines.append(_vel_block("target", dl.get("vel_now"), dl.get("vel_target")))
        lines.append("")

    # ── 📆 SETTIMANA ──
    wk = v.get("weekly")
    if wk:
        lines.append("📆  SETTIMANA")
        wclose = wk.get("reset_str") or "?"
        wrin = wk.get("reset_in")
        wrin_s = f" (tra {wrin})" if wrin else ""
        lines.append(f"   usato {wk.get('used')}%   ·   rimane {wk.get('remaining')}%   ·   "
                     f"reset {wclose}{wrin_s}")
        # Verdetto imperativo (Passo A): headline azionabile, non solo numeri.
        # Assente sul path skill→Capitano che non lo popola → si salta pulito.
        vd = wk.get("verdict")
        if vd:
            lines.append(f"   ➤ {vd}")
        ratio = wk.get("ratio")
        ratio_s = f"   ratio {ratio}×" if isinstance(ratio, (int, float)) else ""
        lines.append(_vel_block("sostenibile", wk.get("vel_now"), wk.get("sustainable")) + ratio_s)
        tail = []
        if wk.get("kind"):
            tail.append(str(wk["kind"]))
        if isinstance(wk.get("debt"), (int, float)):
            tail.append(f"debito {wk['debt']:+.0f}pp")
        if isinstance(wk.get("early_lockout"), (int, float)):
            tail.append(f"lockout ~{wk['early_lockout']:.0f}h")
        if tail:
            lines.append("   " + "   ·   ".join(tail))
        lines.append("")

    # ── 🧭 CONSIGLIO ──
    advice = derive_advice(v)
    if advice:
        lines.append("🧭  CONSIGLIO BRIDGE")
        for a in advice:
            lines.append(f"   {a}")
    return "\n".join(lines).rstrip() + "\nsrc=bridge."
