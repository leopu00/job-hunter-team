#!/usr/bin/env python3
"""profile_gate.py — gate "minimum viable profile" per le scritture derivate dal profilo.

Origin: incident 2026-07 — uno score (total 45, skill_match/location_fit NULL)
è stato persistito per un utente con TUTTE le tabelle profilo vuote su cloud e
candidate_profile.yml assente/vuoto in locale. Il divieto era applicato solo a
monte (UI/onboarding via isProfileComplete); il motore a valle (agente Scorer +
INSERT in scores) non lo replicava, e l'agente davanti al caso non previsto
degradava in modo permissivo assegnando comunque un numero.

Questo modulo è la precondizione DETERMINISTICA a valle: prima di persistere
uno score, verifica che esista "abbastanza segnale sul candidato perché uno
score abbia senso".

⚠️ NON è un check di completezza. Un profilo parziale è normale e voluto:
sopra questa soglia minima la decisione se scorare resta all'agente (giudizio
qualitativo). NON usare validate_profile.py / isProfileComplete come gate qui:
richiedono TUTTI i campi L1 e bloccherebbero profili parziali legittimi.

Soglia (bassa e conservativa — blocca solo i casi degeneri):
  1. candidate_profile.yml esiste, è YAML parsabile, ed è un dict non vuoto;
  2. `target_role` valorizzato (root, candidate.target_role o target_roles[0])
     — caso limite dichiarato dallo stakeholder: uno score senza nemmeno il
     titolo/target professionale dell'utente non ha senso;
  3. il template non è intatto (name != placeholder "Nome Cognome");
  4. almeno UN secondo segnale tra: name, skills, experience_years,
     location, languages, experience — un file con la SOLA riga target_role
     è degenere quanto un file vuoto (ogni sub-score sarebbe incalcolabile),
     mentre qualsiasi profilo reale anche solo iniziato ha almeno il nome.

Uso da skill (import):
    from profile_gate import check_minimum_viable_profile
    ok, reason = check_minimum_viable_profile()

Uso da CLI (exit 0 = profilo utilizzabile, exit 1 = assente):
    python3 profile_gate.py [path/candidate_profile.yml]
"""

import os
import sys

# Placeholder del template docs/examples/candidate_profile.yml.example —
# stesso criterio di web/lib/profile-reader.ts (readWorkspaceProfile).
_PLACEHOLDER_NAME = "nome cognome"


def _default_profile_path() -> str:
    """$JHT_HOME/profile/candidate_profile.yml, fallback ~/.jht (come il web)."""
    jht_home = os.environ.get('JHT_HOME') or os.path.expanduser(
        os.path.join('~', '.jht'))
    return os.path.join(jht_home, 'profile', 'candidate_profile.yml')


def _first_str(*values):
    """Prima stringa non vuota tra i candidati, else None."""
    for v in values:
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _has_items(value) -> bool:
    """True se lista/dict con almeno un elemento significativo."""
    if isinstance(value, dict):
        return any(_has_items(v) or _first_str(v) for v in value.values())
    if isinstance(value, list):
        return len(value) > 0
    return False


def check_minimum_viable_profile(path=None):
    """Ritorna (ok: bool, reason: str). reason è vuota quando ok=True.

    Fail-closed: qualsiasi stato in cui il profilo non è leggibile o è
    sostanzialmente assente ritorna False — meglio uno scoring sospeso che
    uno score inventato (RULE-T10: if a field your role needs is missing,
    escalate — do not invent).
    """
    if path is None:
        path = _default_profile_path()

    if not os.path.isfile(path):
        return False, f"candidate profile is missing: file not found ({path})"

    try:
        import yaml
    except ImportError:
        return False, ("pyyaml is not available: the profile cannot be checked "
                       "(uv pip install --user pyyaml)")

    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
    except yaml.YAMLError as e:
        return False, f"candidate profile could not be parsed (invalid YAML): {e}"
    except OSError as e:
        return False, f"candidate profile could not be read: {e}"

    if not isinstance(data, dict) or not data:
        return False, "candidate profile is empty (no fields completed)"

    candidate = data.get('candidate') if isinstance(data.get('candidate'), dict) else {}
    personal = data.get('personal') if isinstance(data.get('personal'), dict) else {}
    target_roles = data.get('target_roles') if isinstance(data.get('target_roles'), list) else []

    target_role = _first_str(
        data.get('target_role'),
        candidate.get('target_role'),
        target_roles[0] if target_roles else None,
    )
    if not target_role:
        return False, ("candidate profile has no job title or professional target "
                       "(target_role): a score without a target is not meaningful")

    name = _first_str(data.get('name'), candidate.get('name'), personal.get('name'))
    if name and name.lower() == _PLACEHOLDER_NAME:
        return False, ("candidate profile is an unedited template "
                       "(name placeholder 'Nome Cognome')")

    # Secondo segnale minimo: senza NIENTE oltre al target_role ogni
    # sub-score (stack, seniority, location, salary) resta incalcolabile.
    has_second_signal = any((
        name is not None,
        _has_items(data.get('skills')) or _has_items(candidate.get('skills')),
        isinstance(data.get('experience_years'), int) and not isinstance(data.get('experience_years'), bool),
        _first_str(data.get('location'), personal.get('location')) is not None,
        _has_items(data.get('languages')) or _has_items(candidate.get('languages')),
        _has_items(data.get('experience')) or _has_items(candidate.get('experience')),
    ))
    if not has_second_signal:
        return False, ("candidate profile contains only target_role: no other "
                       "signal (name, skills, experience, location, or languages)")

    return True, ""


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    path = args[0] if args else None
    ok, reason = check_minimum_viable_profile(path)
    if ok:
        print("PROFILE_VIABLE")
        return 0
    print(f"PROFILE_MISSING: {reason}", file=sys.stderr)
    print("PROFILE_MISSING")
    return 1


if __name__ == '__main__':
    sys.exit(main())
