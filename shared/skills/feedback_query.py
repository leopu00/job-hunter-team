#!/usr/bin/env python3
"""Query position_feedback (loop user→agenti).

Reads recent like/dislike/hide/star feedback from the cloud per position.
Used by the Scorer to apply a score multiplier (boost like/star, malus
dislike, exclude hide). Optionally consulted by the Scout for source
prioritization.

Reads cloud config from $JHT_HOME/cloud.json (same place as the daemon
and pollers). If cloud is disabled OR the endpoint is unreachable,
returns a neutral "no signal" payload (ok=true, latest_action=null)
so the caller can continue without feedback — agents must never
hard-fail on missing cloud signal.

Output (single JSON line on stdout, exit 0 on ok=true, exit 1 on
ok=false / unexpected error):

  {"ok": true, "legacy_id": "42", "latest_action": "dislike",
   "count": 2, "actions": [{"action": "dislike", "created_at": "...",
   "reason": "..."}, {"action": "like", "created_at": "..."}]}
  {"ok": true, "legacy_id": "99", "latest_action": null,
   "count": 0, "actions": []}
  {"ok": true, "legacy_id": "...", "latest_action": null,
   "note": "no-signal (cloud-disabled)"}
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def _jht_home() -> Path:
    raw = os.environ.get("JHT_HOME")
    if raw:
        return Path(raw)
    return Path.home() / ".jht"


def _load_cloud_config():
    cf = _jht_home() / "cloud.json"
    try:
        return json.loads(cf.read_text())
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        return None


def _api_get(path: str, timeout: float = 10.0):
    """GET su /api con bearer token da cloud.json.

    Ritorna (ok, payload). payload è dict (parsed JSON) o stringa errore.
    """
    cfg = _load_cloud_config()
    if not cfg or not cfg.get("enabled"):
        return False, "cloud-disabled"
    base_url = (cfg.get("base_url") or "").rstrip("/")
    token = cfg.get("token")
    if not base_url or not token:
        return False, "missing-credentials"

    req = urllib.request.Request(
        f"{base_url}{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return True, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")[:200]
        except Exception:
            pass
        return False, f"http-{e.code}: {body}"
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return False, f"network: {e}"


def check_position(legacy_id: str) -> dict:
    safe_id = urllib.parse.quote(str(legacy_id), safe="")
    ok, payload = _api_get(f"/api/positions/{safe_id}/feedback")
    if not ok:
        # Neutral: caller continues senza signal. Logghiamo la ragione
        # come diagnostica ma ok=True per non bloccare lo Scorer.
        return {
            "ok": True,
            "legacy_id": str(legacy_id),
            "latest_action": None,
            "count": 0,
            "actions": [],
            "note": f"no-signal ({payload})",
        }
    feedback = payload.get("feedback") or []
    # La route GET ordina created_at DESC: feedback[0] è l'ultimo.
    actions = [
        {
            "action": f["action"],
            "created_at": f.get("created_at"),
            "reason": f.get("reason"),
        }
        for f in feedback
    ]
    return {
        "ok": True,
        "legacy_id": str(legacy_id),
        "latest_action": actions[0]["action"] if actions else None,
        "count": len(actions),
        "actions": actions,
    }


def main() -> None:
    p = argparse.ArgumentParser(
        description="Query position_feedback dal cloud (Scout/Scorer signal).",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    chk = sub.add_parser(
        "check",
        help="Ritorna l'azione più recente per una posizione (None se assente).",
    )
    chk.add_argument("legacy_id", help="positions.legacy_id (TEXT)")

    args = p.parse_args()

    try:
        if args.cmd == "check":
            result = check_position(args.legacy_id)
        else:
            result = {"ok": False, "error": f"unknown command: {args.cmd}"}
    except Exception as e:
        result = {"ok": False, "error": str(e)}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
