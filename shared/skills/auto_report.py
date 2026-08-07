#!/usr/bin/env python3
"""auto_report — periodic graphical overview through Telegram (F-1.D).

The Captain sends a graphical overview every N hours without requiring a user
prompt. A deterministic script in `auto-report-loop.sh` produces it without
using an LLM turn for routine content.

It creates two artifacts:

  1. A pipeline_overview PNG with position-status bars and an application
     summary.

  2. Markdown-friendly text with KPIs and emoji:
       📊 Pipeline @ 21:30 CEST
       📥 Found        118
       🔬 In analysis   11 scored / 6 writing
       ✅ CV ready      16 ⭐
       📤 Sent           0
       🩺 Team          5/5 live sessions
       ⏱️ Budget        49% (projection 79% — Phase 1 UNDERUTILIZED)

The final output sends the caption and PNG through `jht-telegram-send --from capitano
--keyboard capitano --photo <path>`.

The timestamp of the latest notification is stored in
`$JHT_HOME/state/auto_report_last.json`. The script sends only when
MIN_INTERVAL_MIN has elapsed; otherwise it exits successfully.

CLI:
    python3 /app/shared/skills/auto_report.py send       # honor the interval
    python3 /app/shared/skills/auto_report.py send --force
    python3 /app/shared/skills/auto_report.py status
    python3 /app/shared/skills/auto_report.py dry-run    # print only
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# i18n: shared/i18n.py sits one dir up from skills/. Import with fallback
# so legacy installs (no catalog) still emit IT-ish strings inline.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
try:
    from i18n import t as _i18n_t, tf as _i18n_tf  # type: ignore
except ImportError:
    # Fallback: identity (returns the key) — render paths stay readable in dev.
    def _i18n_t(key: str) -> str:  # type: ignore
        return key
    def _i18n_tf(key: str, *args) -> str:  # type: ignore
        return key

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
DB_PATH = JHT_HOME / "jobs.db"
STATE_PATH = JHT_HOME / "state" / "auto_report_last.json"
PNG_OUT = JHT_HOME / "logs" / "pipeline_overview.png"
TELEGRAM_SEND = "/app/agents/_tools/jht-telegram-send"

MIN_INTERVAL_MIN = int(os.environ.get("JHT_AUTO_REPORT_INTERVAL_MIN", "120"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _load_last() -> dict:
    if not STATE_PATH.exists():
        return {}
    try:
        with STATE_PATH.open() as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_last(d: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    tmp.replace(STATE_PATH)


def _fmt_local_time() -> str:
    """Usa format_time (bug #15) se disponibile, altrimenti UTC."""
    try:
        from format_time import fmt_user_with_utc  # type: ignore
        return fmt_user_with_utc(_now(), "%H:%M")
    except Exception:
        return _now().strftime("%H:%M UTC")


def _fmt_reset_user(unix_ts, fallback: str | None = None) -> str:
    """Reset → 'YYYY-MM-DD HH:MM TZ' (DATA completa) nel fuso utente.

    Ancorato all'epoch (reset_at_unix), MAI ora-nuda: un reset mostrato
    come solo orario è ambiguo a cavallo di mezzanotte e non distingue lo
    slittamento di giorno. fallback = stringa reset_at grezza se l'epoch
    manca (già data-completa dal choke point del bridge).
    """
    try:
        from format_time import fmt_reset  # type: ignore
        out = fmt_reset(unix_ts)
        if out:
            return out
    except Exception:
        pass
    if isinstance(unix_ts, (int, float)) and not isinstance(unix_ts, bool):
        try:
            return datetime.fromtimestamp(
                float(unix_ts), timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        except (OverflowError, OSError, ValueError):
            pass
    return fallback or "?"


def _read_pipeline() -> dict:
    if not DB_PATH.exists():
        return {"positions": {}, "applications": {}, "transitions_24h": 0,
                "last_ready_apps": [], "top_ready": []}
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    out: dict = {"positions": {}, "applications": {}}
    for r in c.execute("SELECT status, COUNT(*) AS n FROM positions GROUP BY status"):
        out["positions"][r["status"]] = r["n"]
    for r in c.execute("SELECT status, COUNT(*) AS n FROM applications GROUP BY status"):
        out["applications"][r["status"]] = r["n"]
    try:
        out["transitions_24h"] = c.execute(
            "SELECT COUNT(*) FROM position_state_transitions WHERE ts >= datetime('now','-1 day')"
        ).fetchone()[0]
    except sqlite3.OperationalError:
        out["transitions_24h"] = 0
    # Top 5 ready per critic_score
    try:
        rows = c.execute("""
            SELECT p.company, p.title, a.critic_score
              FROM applications a
              JOIN positions p ON p.id = a.position_id
             WHERE a.status = 'ready'
          ORDER BY a.critic_score DESC NULLS LAST
             LIMIT 5
        """).fetchall()
        out["top_ready"] = [dict(r) for r in rows]
    except sqlite3.OperationalError:
        out["top_ready"] = []
    c.close()
    return out


def _read_bridge_state() -> dict:
    """Ultimo tick (phase, projection, usage, weekly_reset_at)."""
    data_jsonl = JHT_HOME / "logs" / "sentinel-data.jsonl"
    if not data_jsonl.exists():
        return {}
    try:
        last_line = ""
        with data_jsonl.open("rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 4096))
            tail = f.read().decode("utf-8", errors="ignore")
            last_line = tail.strip().splitlines()[-1] if tail.strip() else ""
        return json.loads(last_line) if last_line else {}
    except (OSError, json.JSONDecodeError, IndexError):
        return {}


def _count_tmux_sessions() -> tuple[int, list[str]]:
    try:
        r = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}"],
                           capture_output=True, text=True, timeout=5)
        if r.returncode != 0:
            return 0, []
        sessions = [s.strip() for s in r.stdout.splitlines() if s.strip()]
        return len(sessions), sessions
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return 0, []


def _emoji_status(name: str) -> str:
    e = {"excluded": "🚫", "ready": "✅", "scored": "🎯", "writing": "✍️",
         "checked": "🔬", "new": "🆕", "applied": "📤", "response": "📨",
         "review": "⚖️", "draft": "📝"}
    return e.get(name, "·")


def _display_status(value):
    """English label for stable bridge status identifiers."""
    return {
        "ATTENZIONE": "WARNING",
        "SOTTOUTILIZZO": "UNDERUTILIZED",
        "SOPRA-PACE-WEEKLY": "ABOVE-PACE-WEEKLY",
        "SOPRA-PACE": "ABOVE-PACE",
        "SOTTO-PACE": "BELOW-PACE",
        "ALLINEATO": "ON-PACE",
    }.get(value, value)


def _html_escape(s: str) -> str:
    """Telegram HTML mode supporta solo &lt; &gt; &amp; — niente altro escape.
    Parentesi e tutto il resto passano puliti."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_panorama_text(pipeline: dict, bridge: dict, tmux_n: int,
                        sessions: list[str]) -> str:
    """Output in HTML-safe Telegram (parse_mode=HTML).

    Bug 2026-05-17 21:18: MarkdownV2 richiede escape su `()[]_*~`. Il
    nostro testo ha sempre parentesi (es. '(11 ready)') → HTTP 400.
    Passiamo a HTML che escapa solo 3 caratteri.
    """
    pos = pipeline.get("positions", {})
    apps = pipeline.get("applications", {})
    total_pos = sum(pos.values())
    ready = apps.get("ready", 0)
    applied = apps.get("applied", 0)

    when = _html_escape(_fmt_local_time())
    usage = bridge.get("usage")
    proj = bridge.get("projection")
    phase = bridge.get("phase")
    status = bridge.get("status", "?")
    reset_at = bridge.get("reset_at", "?")
    reset_at_unix = bridge.get("reset_at_unix")
    weekly = bridge.get("weekly_usage")
    weekly_reset = bridge.get("weekly_reset_at")
    weekly_reset_unix = bridge.get("weekly_reset_at_unix")

    lines = [
        f"📊 <b>Pipeline panorama</b> — {when}",
        "",
        f"📥 {_i18n_t('auto_report.found')}    {total_pos}   ({pos.get('checked',0)+pos.get('new',0)} 🆕 {_i18n_t('auto_report.new_to_analyze')})",
        f"🎯 {_i18n_t('auto_report.scored')}      {pos.get('scored', 0)}",
        f"✍️ {_i18n_t('auto_report.writing')} {pos.get('writing', 0)}",
        f"✅ {_i18n_t('auto_report.ready_cv')}    {ready} ⭐",
        f"📤 {_i18n_t('auto_report.applied')}     {applied}",
        f"🚫 {_i18n_t('auto_report.excluded')}   {pos.get('excluded', 0)}",
        "",
        f"🩺 {_i18n_t('auto_report.team')}        {tmux_n} {_i18n_t('auto_report.sessions')}: {_html_escape(', '.join(sessions) if sessions else '—')}",
    ]

    if usage is not None:
        proj_s = f"{proj:.0f}%" if isinstance(proj, (int, float)) else "?"
        phase_label = _i18n_t("auto_report.phase_label")
        phase_s = f"{phase_label.title()} {phase}" if phase else "?"
        budget_label = _i18n_t("auto_report.budget_label")
        proj_label = _i18n_t("auto_report.proj_label")
        lines.append(f"⏱️ {budget_label}     {usage}% ({proj_label} {proj_s} · {phase_s} · {_html_escape(str(_display_status(status)))})")
        # Reset con DATA completa nel fuso utente (mai ora-nuda), epoch-ancorato.
        reset_user = _html_escape(_fmt_reset_user(reset_at_unix, reset_at))
        lines.append(f"📅 {_i18n_t('auto_report.reset_window')} {reset_user}")
        if weekly is not None:
            wr_user = (_fmt_reset_user(weekly_reset_unix, weekly_reset)
                       if (weekly_reset or weekly_reset_unix is not None) else "")
            wr = f" · reset {wr_user}" if wr_user else ""
            lines.append(f"📆 {_i18n_t('auto_report.week_label')}  {weekly}%{_html_escape(wr)}")

    transitions = pipeline.get("transitions_24h", 0)
    if transitions:
        lines.append(f"🔄 {_i18n_t('auto_report.transitions_24h')} {transitions}")

    top = pipeline.get("top_ready", [])
    if top:
        lines.append("")
        lines.append(f"⭐ <b>{_i18n_t('auto_report.top_cv_ready')}</b>")
        for r in top:
            score = r.get("critic_score")
            sc = f"{score:.1f}/10" if isinstance(score, (int, float)) else "—"
            comp = _html_escape((r.get("company") or "")[:30])
            title = _html_escape((r.get("title") or "")[:50])
            lines.append(f"  • {comp} — {title}  ({sc})")

    lines.append("")
    lines.append(f"<i>{_i18n_tf('auto_report.footer', MIN_INTERVAL_MIN)}</i>")
    return "\n".join(lines)


# ── PNG generation ─────────────────────────────────────────────────────
def build_png(pipeline: dict, bridge: dict, out_path: Path) -> bool:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return False

    pos = pipeline.get("positions", {})
    apps = pipeline.get("applications", {})

    pos_order = ["new", "checked", "scored", "writing", "ready", "applied", "response", "excluded"]
    pos_vals = [pos.get(s, 0) for s in pos_order]
    pos_colors = ["#9aa", "#5af", "#fc0", "#f80", "#3c3", "#36c", "#69f", "#a55"]

    apps_order = ["draft", "review", "ready", "applied", "response"]
    apps_vals = [apps.get(s, 0) for s in apps_order]
    apps_colors = ["#aaa", "#5af", "#3c3", "#36c", "#69f"]

    fig, axes = plt.subplots(2, 1, figsize=(10, 6.5),
                             gridspec_kw={"height_ratios": [3, 2], "hspace": 0.6})
    fig.patch.set_facecolor("#0e1117")
    title = _fmt_local_time()
    # Niente emoji nel suptitle del PNG: DejaVu Sans (default matplotlib
    # in container slim) non ha glyph per 📊/⏱️ → UserWarning + box vuoti.
    # Le emoji restano nel testo Telegram (caption) dove i font del
    # client le rendono native.
    fig.suptitle(f"JHT pipeline panorama — {title}", fontsize=15,
                 fontweight="bold", color="#eee")

    # Pannello 1: positions
    ax = axes[0]
    ax.set_facecolor("#0e1117")
    bars = ax.barh(pos_order, pos_vals, color=pos_colors, edgecolor="#222")
    for b, v in zip(bars, pos_vals):
        if v > 0:
            ax.text(v + max(pos_vals) * 0.01, b.get_y() + b.get_height() / 2,
                    str(v), color="#eee", va="center", fontweight="bold")
    ax.set_title(f"positions ({sum(pos_vals)} total)", color="#bbb", loc="left")
    ax.tick_params(colors="#ccc")
    for s in ax.spines.values():
        s.set_color("#333")

    # Pannello 2: applications
    ax2 = axes[1]
    ax2.set_facecolor("#0e1117")
    bars2 = ax2.barh(apps_order, apps_vals, color=apps_colors, edgecolor="#222")
    for b, v in zip(bars2, apps_vals):
        if v > 0:
            ax2.text(v + max(apps_vals + [1]) * 0.01, b.get_y() + b.get_height() / 2,
                     str(v), color="#eee", va="center", fontweight="bold")
    ax2.set_title(f"applications ({sum(apps_vals)} total)", color="#bbb", loc="left")
    ax2.tick_params(colors="#ccc")
    for s in ax2.spines.values():
        s.set_color("#333")

    # Footer: budget info
    usage = bridge.get("usage")
    proj = bridge.get("projection")
    if usage is not None:
        proj_s = f"{proj:.0f}%" if isinstance(proj, (int, float)) else "?"
        phase_s = f"Phase {bridge.get('phase', '?')}"
        fig.text(0.5, 0.02,
                 f"Budget {usage}% · proj {proj_s} · {phase_s} · {_display_status(bridge.get('status', '?'))}",
                 ha="center", color="#aaa", fontsize=10)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path, dpi=110, bbox_inches="tight",
                facecolor=fig.get_facecolor())
    plt.close(fig)
    return True


# ── Telegram send ──────────────────────────────────────────────────────
def send_to_telegram(text: str, photo: Path | None, dry_run: bool = False) -> bool:
    if dry_run:
        print(text)
        if photo and photo.exists():
            print(f"[dry-run] PNG ready: {photo} ({photo.stat().st_size} B)")
        return True
    args = [TELEGRAM_SEND, "--from", "capitano",
            "--keyboard", "capitano", "--html"]
    if photo and photo.exists():
        args.extend(["--photo", str(photo)])
    args.append(text)
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=45)
        if r.returncode != 0:
            print(f"jht-telegram-send rc={r.returncode}: {r.stderr.strip()}", file=sys.stderr)
            return False
        return True
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"send error: {e}", file=sys.stderr)
        return False


def send(force: bool = False, dry_run: bool = False) -> int:
    last = _load_last()
    last_ts = last.get("ts", 0)
    now_ts = time.time()
    if not force and (now_ts - last_ts) < MIN_INTERVAL_MIN * 60:
        mins_left = int((MIN_INTERVAL_MIN * 60 - (now_ts - last_ts)) / 60)
        print(f"skip: last notification {int((now_ts - last_ts)/60)}m ago, next in {mins_left}m")
        return 0

    pipeline = _read_pipeline()
    bridge = _read_bridge_state()
    tmux_n, sessions = _count_tmux_sessions()

    text = build_panorama_text(pipeline, bridge, tmux_n, sessions)
    png_ok = build_png(pipeline, bridge, PNG_OUT)
    photo = PNG_OUT if png_ok else None

    sent = send_to_telegram(text, photo, dry_run=dry_run)
    if sent and not dry_run:
        _save_last({"ts": now_ts, "text_chars": len(text),
                    "png_path": str(PNG_OUT) if png_ok else "",
                    "iso": _now().isoformat()})
        print(f"auto-report sent (text {len(text)} chars + photo={'yes' if photo else 'no'})")
    return 0 if sent else 4


def status() -> int:
    last = _load_last()
    print(json.dumps({
        "interval_min": MIN_INTERVAL_MIN,
        "last": last,
        "state_path": str(STATE_PATH),
        "png_out": str(PNG_OUT),
    }, indent=2))
    return 0


def main(argv):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("send")
    s.add_argument("--force", action="store_true")
    s.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    sub.add_parser("dry-run").set_defaults(cmd="send", dry_run=True, force=True)

    args = p.parse_args(argv)
    if args.cmd == "send":
        return send(force=getattr(args, "force", False),
                    dry_run=getattr(args, "dry_run", False))
    if args.cmd == "status":
        return status()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
