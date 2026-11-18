"""Enrichment policy — freno di spesa per il lavoro AUTONOMO del team.

File: `$JHT_HOME/profile/enrichment-policy.json` (accanto a
`capitano-maintenance.json`; risolto come dirname(jobs.db)/profile/).
File ASSENTE = tutto abilitato (comportamento storico, zero migrazioni).

Governa l'enrichment AUTONOMO, cioè la spesa decisa dalla macchina: le code
della MODALITÀ CURA (ex "maintenance", rinominata 2026-07-30: logo-missing,
geocode-missing, recheck-due) e i due passi economici della pipeline
dell'Analista (geocodifica dell'ufficio al passo 6, logo al passo 9b). Le richieste
ESPLICITE dell'utente (geocode_requested, recheck_requested,
salary_precise_requested, write_requested) NON passano di qui — se
l'utente chiede, si fa.

Formato:
  {
    "economy": false,                # master switch "risparmio": true =
                                     # spegne TUTTO l'enrichment autonomo,
                                     # qualunque cosa dicano i flag fini
    "logo":            {"enabled": true, "min_score": null},
    "geocode_pipeline": {"enabled": true},
    "geocode_missing": {"enabled": true, "min_score": null,
                         "non_remote_only": true},
    "recheck_weekly":  {"enabled": true, "min_score": 70,
                         "older_than_days": 14},
    "web_search":      {"analista": {"enabled": false},
                        "scout": {"enabled": true},
                        "mentor": {"enabled": true}}
  }

La ricerca web ospitata dal provider (T325) ha un interruttore per ruolo: il
launcher la dà al ruolo solo se `web-search <ruolo>` dice sì (economy e la
modalità risparmio la spengono come ogni arricchimento autonomo). Vale
dall'avvio dell'agente con Codex (`--search` è un argomento di avvio); su pi
l'estensione rilegge il file a ogni richiesta, quindi vale subito. Il costo di
ogni interruttore sta in `enrichment_costs.json`, e `show` lo riporta in
`costs` per l'avviso della CLI e del desktop.

NB: la sezione si chiama ancora `recheck_weekly` (contratto su disco, già
presente nei file delle installazioni — non rinominare senza migrarli), ma la
cadenza di DEFAULT è QUINDICINALE (14gg, 2026-07-30): si ricontrollano le
posizioni trovate/verificate 2 settimane prima.

Due interruttori per la geocodifica, perché sono due spese diverse:
`geocode_pipeline.enabled` è il passo 6 della pipeline (la posizione NUOVA
che l'Analista sta analizzando), `geocode_missing.enabled` è la coda di cura
(l'arretrato). Un file scritto prima del 18/11/2026, senza
`geocode_pipeline`, lo eredita da `geocode_missing.enabled`: chi aveva spento
la geocodifica la trova ancora spenta. `geocode_missing.non_remote_only` vale
per tutti e due.

Le soglie di score (`logo.min_score`, `geocode_missing.min_score`,
`recheck_weekly.min_score`) valgono SOLO per le code di cura: nella pipeline
la posizione nuova non ha ancora uno score, e una soglia lì direbbe sempre di
no. `logo.min_score` (es. 70): la coda logo-missing prende solo le aziende con
ALMENO una posizione viva con best score >= soglia; quando lo Scorer supera
la soglia, l'azienda rientra in coda da sola.

Enforcement A CODICE (filosofia modalità-cura di C-18): le code in
`db_query.py` tornano vuote col motivo, `geocode-check` risponde NO col
motivo, e `logo_fetch.py` rifiuta con POLICY_DISABLED. I prompt spiegano solo
che una coda vuota per policy è stato VOLUTO, non un bug.

MODALITÀ DI LAVORO (2026-08, enum chiuso in `capitano-maintenance.json`,
chiave `"mode"`): search | harvest | care | calibration | saving. La
chiave opzionale `"mode_until"` le dà una FINE: passata quella data la
modalità torna `search` da sola e la policy fine ricomincia a valere
(`mode_deadline.py` — nessuna modalità deve durare per inerzia).
Questo modulo NON duplica quel file — lo LEGGE (`current_mode()`), e la
modalità `saving` compone con la policy: `is_enabled()` risponde False
per ogni enrichment autonomo quando `mode == "saving"`, qualunque cosa
dicano `economy` e i flag fini. Una sola fonte di verità per la
modalità (il file mode), una sola per i flag fini (questo JSON): uscire
da `saving` ripristina da solo la policy che c'era prima, perché la
policy non è mai stata toccata.

Chi scrive il file: l'utente, con `jht enrichment set` o dal desktop
(Impostazioni › Arricchimenti, che passa da `apply`), oppure il Capitano SU
ORDINE dell'utente («vai su risparmio» → `enrichment_policy.py set economy
true`). Mai di iniziativa propria. Questo modulo è l'unico che lo scrive.

Uso CLI:
  python3 enrichment_policy.py show
  python3 enrichment_policy.py set economy true|false
  python3 enrichment_policy.py set logo.enabled false
  python3 enrichment_policy.py set logo.min_score 70   # "" o null per togliere
  python3 enrichment_policy.py set geocode_pipeline.enabled false
  python3 enrichment_policy.py set geocode_missing.enabled false
  python3 enrichment_policy.py set geocode_missing.min_score 65
  python3 enrichment_policy.py set geocode_missing.non_remote_only true
  python3 enrichment_policy.py set recheck_weekly.enabled false
  python3 enrichment_policy.py set recheck_weekly.min_score 65
  python3 enrichment_policy.py set recheck_weekly.older_than_days 21
  python3 enrichment_policy.py set web_search.analista.enabled true    # also scout, mentor
  python3 enrichment_policy.py web-search analista   # exit 0 = the role gets the web search, 1 = not (and why)
  echo '{"logo.enabled": false, "logo.min_score": 70}' | python3 enrichment_policy.py apply

`apply` legge da stdin UN oggetto JSON {chiave: valore} con le chiavi di
`set` e i valori già tipati (true/false, interi, null): o vale tutto o non si
scrive niente, e risponde con la policy riletta. Rifiuti chiusi in `code`:
request_invalid, key_unknown, value_invalid, write_failed.

Output: una riga JSON su stdout (exit 0 ok / 1 errore).
"""

import argparse
import json
import os
import sys

import mode_deadline
from _db import DB_PATH

DEFAULT_POLICY = {
    "economy": False,
    "logo": {"enabled": True, "min_score": None},
    # Il passo 6 della pipeline dell'Analista (la posizione nuova); la coda di cura è geocode_missing.
    "geocode_pipeline": {"enabled": True},
    "geocode_missing": {
        "enabled": True, "min_score": None, "non_remote_only": True,
    },
    "recheck_weekly": {
        # Cadenza QUINDICINALE di default (14gg, 2026-07-30; era 7).
        "enabled": True, "min_score": 70, "older_than_days": 14,
    },
    # The hosted web search of each role that has one (T325). The Analista's is off: on Haiku it cost ~0.26 $ more per
    # position (T323 bis) and brought no logo nor office; the Scout and the Mentor keep it, with their cap per turn.
    "web_search": {role: {"enabled": role != "analista"} for role in ("analista", "scout", "mentor")},
}

# The roles whose web search has a switch: the same three as JHT_CODEX_WEB_SEARCH_ROLES (.launcher/spawn-lib.sh).
WEB_SEARCH_ROLES = ("analista", "scout", "mentor")

# Chiavi settabili dalla CLI → (sezione, campo, parser)
_SETTABLE = {
    "economy": (None, "economy", "bool"),
    "logo.enabled": ("logo", "enabled", "bool"),
    "logo.min_score": ("logo", "min_score", "score_or_null"),
    "geocode_pipeline.enabled": ("geocode_pipeline", "enabled", "bool"),
    "geocode_missing.enabled": ("geocode_missing", "enabled", "bool"),
    "geocode_missing.min_score": ("geocode_missing", "min_score", "score_or_null"),
    "geocode_missing.non_remote_only": ("geocode_missing", "non_remote_only", "bool"),
    "recheck_weekly.enabled": ("recheck_weekly", "enabled", "bool"),
    "recheck_weekly.min_score": ("recheck_weekly", "min_score", "score"),
    "recheck_weekly.older_than_days": ("recheck_weekly", "older_than_days", "days"),
    "web_search.analista.enabled": (("web_search", "analista"), "enabled", "bool"),
    "web_search.scout.enabled": (("web_search", "scout"), "enabled", "bool"),
    "web_search.mentor.enabled": (("web_search", "mentor"), "enabled", "bool"),
}


def policy_path() -> str:
    return os.path.join(os.path.dirname(DB_PATH), "profile",
                        "enrichment-policy.json")


# ── Modalità di lavoro (contratto 2026-08) ──────────────────────────────
#
# Valore alla chiave "mode" di `profile/capitano-maintenance.json` (il
# FILENAME è storico: vive su VPS in produzione, non rinominarlo — vedi il
# commento in game/scripts/backend/vps_backend.gd). File assente = search.
MODES = ("search", "harvest", "care", "calibration", "saving")
MODE_UNKNOWN = "unknown"


def mode_path() -> str:
    return os.path.join(os.path.dirname(DB_PATH), "profile",
                        "capitano-maintenance.json")


def current_mode() -> str:
    """La modalità di lavoro corrente, letta da disco a OGNI chiamata.

    Ritorna un valore di MODES, oppure MODE_UNKNOWN. Normalizzazioni:
      · file assente → "search" (il default del contratto);
      · "maintenance" (valore storico pre-rinomina) → "care";
      · `mode_until` passata → "search" (la modalità è finita da sola,
        vedi mode_deadline.py: nessuna modalità dura per inerzia);
      · file presente ma illeggibile, o valore fuori enum → MODE_UNKNOWN.
    MODE_UNKNOWN NON diventa "search": per un freno di spesa la direzione
    sicura è trattare l'ignoto come un ordine attivo (stessa scelta di
    mode_banner.py) — quindi niente enrichment autonomo finché un umano
    non guarda il file.
    """
    try:
        with open(mode_path(), encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return "search"
    except (json.JSONDecodeError, OSError):
        return MODE_UNKNOWN
    if not isinstance(data, dict):
        return MODE_UNKNOWN
    mode = data.get("mode")
    if not isinstance(mode, str) or not mode.strip():
        return MODE_UNKNOWN
    mode = mode.strip()
    if mode == "maintenance":   # valore storico (file scritti pre-2026-07-30)
        mode = "care"
    if mode not in MODES:
        return MODE_UNKNOWN
    # La scadenza si valuta in LETTURA: la policy e il banner arrivano alla
    # stessa conclusione nello stesso istante, senza un processo che riscriva
    # il file. Un `mode_until` illeggibile non scade (ordine ancora attivo).
    mode, _expired = mode_deadline.effective_mode(
        mode, mode_deadline.parse_deadline(data.get(mode_deadline.DEADLINE_KEY)))
    return mode


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
        if section in ("logo", "geocode_missing"):
            ms = sec.get("min_score")
            # bool è un int in Python: `true` non è uno score
            if ms is None or (isinstance(ms, int) and not isinstance(ms, bool) and 0 <= ms <= 100):
                merged[section]["min_score"] = ms
        if section == "geocode_missing" and isinstance(sec.get("non_remote_only"), bool):
            merged[section]["non_remote_only"] = sec["non_remote_only"]
        if section == "recheck_weekly":
            score = sec.get("min_score")
            days = sec.get("older_than_days")
            if isinstance(score, int) and not isinstance(score, bool) and 0 <= score <= 100:
                merged[section]["min_score"] = score
            if isinstance(days, int) and not isinstance(days, bool) and 1 <= days <= 365:
                merged[section]["older_than_days"] = days
    searches = data.get("web_search")
    if isinstance(searches, dict):
        for role in WEB_SEARCH_ROLES:
            sec = searches.get(role)
            if isinstance(sec, dict) and isinstance(sec.get("enabled"), bool):
                merged["web_search"][role]["enabled"] = sec["enabled"]
    pipeline = data.get("geocode_pipeline")
    if isinstance(pipeline, dict) and isinstance(pipeline.get("enabled"), bool):
        merged["geocode_pipeline"]["enabled"] = pipeline["enabled"]
    elif "geocode_pipeline" not in data:
        # Un file di prima dei due interruttori: chi aveva spento la geocodifica la ritrova spenta.
        merged["geocode_pipeline"]["enabled"] = merged["geocode_missing"]["enabled"]
    return merged


def is_enabled(kind: str, policy: dict | None = None) -> bool:
    """True se l'enrichment autonomo `kind` è consentito ORA.

    kind ∈ {"logo", "geocode_pipeline", "geocode_missing", "recheck_weekly"}.
    Precedenza: modalità `saving` (o mode illeggibile) > `economy` > flag
    fine. La modalità NON riscrive la policy: la sovrasta finché dura, e
    quando l'utente esce da `saving` i flag fini tornano a valere da soli.
    """
    mode = current_mode()
    if mode == "saving" or mode == MODE_UNKNOWN:
        return False
    p = policy or load_policy()
    if p.get("economy"):
        return False
    return bool(p.get(kind, {}).get("enabled", True))


def logo_min_score(policy: dict | None = None):
    """Soglia score per il logo (None = nessun gate)."""
    p = policy or load_policy()
    return p.get("logo", {}).get("min_score")


def geocode_options(policy: dict | None = None) -> dict:
    """Gate dell'arricchimento geografico autonomo."""
    p = policy or load_policy()
    section = p.get("geocode_missing", {})
    return {
        "min_score": section.get("min_score"),
        "non_remote_only": bool(section.get("non_remote_only", True)),
    }


def recheck_options(policy: dict | None = None) -> dict:
    """Soglia e anzianità della coda di ricontrollo autonomo."""
    p = policy or load_policy()
    section = p.get("recheck_weekly", {})
    return {
        "min_score": int(section.get("min_score", 70)),
        "older_than_days": int(section.get("older_than_days", 14)),
    }


def disabled_reason(kind: str, policy: dict | None = None) -> str:
    """Motivo leggibile per code/log ("" se abilitato)."""
    mode = current_mode()
    if mode == "saving":
        return "SAVING mode is active (mode=saving)"
    if mode == MODE_UNKNOWN:
        return ("capitano-maintenance.json exists but cannot be interpreted: "
                "autonomous enrichment is suspended until a person reviews it")
    p = policy or load_policy()
    if p.get("economy"):
        return "SAVING policy is active (economy=true)"
    if not p.get(kind, {}).get("enabled", True):
        return f"disabled by policy ({kind}.enabled=false)"
    return ""


def _place(policy: dict, section) -> dict:
    """The mapping a settable key writes into: the top level, a section, or a nested one (web_search.<role>)."""
    if section is None:
        return policy
    if isinstance(section, tuple):
        place = policy
        for part in section:
            place = place[part]
        return place
    return policy[section]


def web_search_enabled(role: str, policy: dict | None = None) -> tuple[bool, str]:
    """(on, reason) for the hosted web search of `role`: what the launcher asks before it gives the role the search.

    The role's own switch, under the same brakes as every autonomous enrichment: the SAVING mode (or a mode file that
    cannot be read) and `economy` turn it off. A role without a switch has no search.
    """
    if role not in WEB_SEARCH_ROLES:
        return False, f"the {role or 'unknown'} role has no web search"
    mode = current_mode()
    if mode == "saving":
        return False, "SAVING mode is active (mode=saving)"
    if mode == MODE_UNKNOWN:
        return False, ("capitano-maintenance.json exists but cannot be interpreted: "
                       "autonomous enrichment is suspended until a person reviews it")
    p = policy or load_policy()
    if p.get("economy"):
        return False, "SAVING policy is active (economy=true)"
    if not p["web_search"][role]["enabled"]:
        return False, f"disabled by policy (web_search.{role}.enabled=false)"
    return True, "on"


COSTS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "enrichment_costs.json")
COSTS_MAX_BYTES = 64 * 1024


def costs() -> dict | None:
    """What each switch costs, from enrichment_costs.json (the one place the CLI and the desktop read it from).

    Only the switches of this policy, each `{costly, usd_per_position}` with a number or null and, where it applies,
    `usd_per_search`; anything else in the file is dropped. A file missing, too big or out of shape gives None, and the
    warning about the cost is then shown without a figure: a made-up number is worse than none.
    """
    try:
        with open(COSTS_PATH, "rb") as f:
            raw = f.read(COSTS_MAX_BYTES + 1)
        if len(raw) > COSTS_MAX_BYTES:
            return None
        data = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("switches"), dict):
        return None
    per_day = data.get("positions_per_day")
    if isinstance(per_day, bool) or not isinstance(per_day, int) or not 1 <= per_day <= 10000:
        return None

    def usd(value):
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
            raise ValueError
        return value

    switches = {}
    for key, entry in data["switches"].items():
        if key not in _SETTABLE or _SETTABLE[key][2] != "bool":
            continue
        if not isinstance(entry, dict) or not isinstance(entry.get("costly"), bool):
            return None
        try:
            item = {"costly": entry["costly"], "usd_per_position": usd(entry.get("usd_per_position"))}
            if "usd_per_search" in entry:
                item["usd_per_search"] = usd(entry["usd_per_search"])
        except ValueError:
            return None
        switches[key] = item
    return {"version": 1, "positions_per_day": per_day, "switches": switches}


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
        raise ValueError(f"invalid boolean value: {raw!r}")
    # int_or_null / interi con range applicativo
    low = raw.strip().lower()
    if how == "score_or_null" and low in ("", "null", "none", "off"):
        return None
    value = int(raw)
    if how in ("score", "score_or_null") and not 0 <= value <= 100:
        raise ValueError("score must be between 0 and 100")
    if how == "days" and not 1 <= value <= 365:
        raise ValueError("days must be between 1 and 365")
    return value


def _typed_value(value, how: str):
    """Il valore di `apply`, già tipato nel JSON: lo stesso dominio di `_parse_value`, senza conversioni."""
    if how == "bool":
        if isinstance(value, bool):
            return value
        raise ValueError("value_invalid")
    if how == "score_or_null" and value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("value_invalid")
    if how in ("score", "score_or_null") and not 0 <= value <= 100:
        raise ValueError("value_invalid")
    if how == "days" and not 1 <= value <= 365:
        raise ValueError("value_invalid")
    return value


REQUEST_MAX_BYTES = 4096


def apply_request(raw: str) -> tuple[int, dict]:
    """`apply`: tutto o niente. (exit, risposta JSON)."""
    if len(raw.encode("utf-8")) > REQUEST_MAX_BYTES:
        return 1, {"ok": False, "code": "request_invalid"}
    try:
        request = json.loads(raw)
    except json.JSONDecodeError:
        return 1, {"ok": False, "code": "request_invalid"}
    if not isinstance(request, dict) or not request:
        return 1, {"ok": False, "code": "request_invalid"}
    pol = load_policy()
    for key, value in request.items():
        if key not in _SETTABLE:
            return 1, {"ok": False, "code": "key_unknown"}
        section, field, how = _SETTABLE[key]
        try:
            typed = _typed_value(value, how)
        except ValueError:
            return 1, {"ok": False, "code": "value_invalid"}
        _place(pol, section)[field] = typed
    try:
        _save(pol)
    except OSError:
        return 1, {"ok": False, "code": "write_failed"}
    return 0, show_payload()


def show_payload() -> dict:
    return {"ok": True, "path": policy_path(), "exists": os.path.exists(policy_path()),
            "policy": load_policy(),
            # La modalità NON vive in questo file (fonte: mode_path()) ma decide se la policy si applica:
            # mostrarla qui evita il "perché la coda è OFF se enabled=true?".
            "mode": current_mode(),
            # What each switch costs, for the warning of the CLI and the desktop when a costlier value is chosen.
            "costs": costs()}


def main() -> None:
    p = argparse.ArgumentParser(
        description="Savings policy for autonomous enrichment"
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    sub.add_parser("apply")
    ws = sub.add_parser("web-search")
    ws.add_argument("role")
    st = sub.add_parser("set")
    st.add_argument("key", choices=sorted(_SETTABLE))
    st.add_argument("value")
    args = p.parse_args()

    try:
        if args.cmd == "show":
            print(json.dumps(show_payload(), ensure_ascii=False))
            return
        if args.cmd == "web-search":
            on, reason = web_search_enabled(args.role)
            print(json.dumps({"role": args.role, "web_search": on, "reason": reason}, ensure_ascii=False))
            if not on:
                sys.exit(1)
            return
        if args.cmd == "apply":
            code, out = apply_request(sys.stdin.read().strip())
            print(json.dumps(out, ensure_ascii=False))
            if code:
                sys.exit(code)
            return
        section, field, how = _SETTABLE[args.key]
        value = _parse_value(args.value, how)
        pol = load_policy()
        _place(pol, section)[field] = value
        _save(pol)
        print(json.dumps(
            {"ok": True, "set": args.key, "value": value, "policy": pol},
            ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
