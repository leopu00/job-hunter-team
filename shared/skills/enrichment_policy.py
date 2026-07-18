"""Enrichment policy — freno di spesa per il lavoro AUTONOMO del team.

File: `$JHT_HOME/profile/enrichment-policy.json` (accanto a
`capitano-maintenance.json`; risolto come dirname(jobs.db)/profile/).
File ASSENTE = tutto abilitato (comportamento storico, zero migrazioni).

Governa SOLO l'enrichment autonomo/maintenance (spesa decisa dalla
macchina): coda logo, geocode-missing, recheck-weekly. Le richieste
ESPLICITE dell'utente (geocode_requested, recheck_requested,
salary_precise_requested, write_requested) NON passano di qui — se
l'utente chiede, si fa.

Formato:
  {
    "economy": false,                # master switch "risparmio": true =
                                     # spegne TUTTO l'enrichment autonomo,
                                     # qualunque cosa dicano i flag fini
    "logo":            {"enabled": true, "min_score": null},
    "geocode_missing": {"enabled": true},
    "recheck_weekly":  {"enabled": true}
  }

`logo.min_score` (es. 70): estrai il logo solo per aziende con ALMENO
una posizione viva con best score >= soglia. Il gate NON marca
`logo_fetched` → quando lo Scorer supera la soglia, l'azienda rientra
in coda da sola.

Enforcement A CODICE (filosofia maintenance-mode di C-18): le code in
`db_query.py` tornano vuote col motivo, e `logo_fetch.py` rifiuta con
POLICY_DISABLED / POLICY_SCORE_GATE. I prompt spiegano solo che una
coda vuota per policy è stato VOLUTO, non un bug.

Chi scrive il file: l'utente (in futuro dalla desktop app via docker
exec) o il Capitano SU ORDINE dell'utente («vai su risparmio» →
`enrichment_policy.py set economy true`). Mai di iniziativa propria.

Uso CLI:
  python3 enrichment_policy.py show
  python3 enrichment_policy.py set economy true|false
  python3 enrichment_policy.py set logo.enabled false
  python3 enrichment_policy.py set logo.min_score 70   # "" o null per togliere
  python3 enrichment_policy.py set geocode_missing.enabled false
  python3 enrichment_policy.py set recheck_weekly.enabled false

Output: una riga JSON su stdout (exit 0 ok / 1 errore).
"""

import argparse
import json
import os
import sys

from _db import DB_PATH

DEFAULT_POLICY = {
    "economy": False,
    "logo": {"enabled": True, "min_score": None},
    "geocode_missing": {"enabled": True},
    "recheck_weekly": {"enabled": True},
}

# Chiavi settabili dalla CLI → (sezione, campo, parser)
_SETTABLE = {
    "economy": (None, "economy", "bool"),
    "logo.enabled": ("logo", "enabled", "bool"),
    "logo.min_score": ("logo", "min_score", "int_or_null"),
    "geocode_missing.enabled": ("geocode_missing", "enabled", "bool"),
    "recheck_weekly.enabled": ("recheck_weekly", "enabled", "bool"),
}


def policy_path() -> str:
    return os.path.join(os.path.dirname(DB_PATH), "profile",
                        "enrichment-policy.json")


def load_policy() -> dict:
    """Policy corrente, con i default per chiavi/file mancanti.

    File corrotto → default completi (fail-open sul comportamento
    storico: un JSON rotto non deve spegnere il team né farlo crashare).
    """
    merged = json.loads(json.dumps(DEFAULT_POLICY))  # deep copy
    try:
        with open(policy_path(), encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return merged
    if not isinstance(data, dict):
        return merged
    if isinstance(data.get("economy"), bool):
        merged["economy"] = data["economy"]
    for section in ("logo", "geocode_missing", "recheck_weekly"):
        sec = data.get(section)
        if not isinstance(sec, dict):
            continue
        if isinstance(sec.get("enabled"), bool):
            merged[section]["enabled"] = sec["enabled"]
        if section == "logo":
            ms = sec.get("min_score")
            if ms is None or isinstance(ms, int):
                merged["logo"]["min_score"] = ms
    return merged


def is_enabled(kind: str, policy: dict | None = None) -> bool:
    """True se l'enrichment autonomo `kind` è consentito ORA.

    kind ∈ {"logo", "geocode_missing", "recheck_weekly"}.
    `economy` (risparmio) vince su tutto.
    """
    p = policy or load_policy()
    if p.get("economy"):
        return False
    return bool(p.get(kind, {}).get("enabled", True))


def logo_min_score(policy: dict | None = None):
    """Soglia score per il logo (None = nessun gate)."""
    p = policy or load_policy()
    return p.get("logo", {}).get("min_score")


def disabled_reason(kind: str, policy: dict | None = None) -> str:
    """Motivo leggibile per code/log ("" se abilitato)."""
    p = policy or load_policy()
    if p.get("economy"):
        return "policy RISPARMIO attiva (economy=true)"
    if not p.get(kind, {}).get("enabled", True):
        return f"disabilitato dalla policy ({kind}.enabled=false)"
    return ""


def _save(policy: dict) -> None:
    path = policy_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(policy, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def _parse_value(raw: str, how: str):
    if how == "bool":
        low = raw.strip().lower()
        if low in ("true", "1", "on", "yes"):
            return True
        if low in ("false", "0", "off", "no"):
            return False
        raise ValueError(f"valore booleano non valido: {raw!r}")
    # int_or_null
    low = raw.strip().lower()
    if low in ("", "null", "none", "off"):
        return None
    return int(raw)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Policy di risparmio per l'enrichment autonomo"
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    st = sub.add_parser("set")
    st.add_argument("key", choices=sorted(_SETTABLE))
    st.add_argument("value")
    args = p.parse_args()

    try:
        if args.cmd == "show":
            pol = load_policy()
            print(json.dumps(
                {"ok": True, "path": policy_path(),
                 "exists": os.path.exists(policy_path()), "policy": pol},
                ensure_ascii=False))
            return
        section, field, how = _SETTABLE[args.key]
        value = _parse_value(args.value, how)
        pol = load_policy()
        if section is None:
            pol[field] = value
        else:
            pol[section][field] = value
        _save(pol)
        print(json.dumps(
            {"ok": True, "set": args.key, "value": value, "policy": pol},
            ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
