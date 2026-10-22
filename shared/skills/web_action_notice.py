#!/usr/bin/env python3
"""web_action_notice.py — tell the user, out of band, that the website changed something on the box.

An action taken on the website with the user's session (an application authorised, the team
stopped, a team order added or changed) reaches the box through the cloud. Whoever holds that
session can take it; the user learns of it here, on a channel the website does not hold: Telegram
when it is linked, and in any case a row in the app's panel, mirrored in the chat.

The notice is a CLOSED code with a fixed sentence in the user's language. No text from the website
or from the position goes in it: only the position's number. One notice per event: the key names
the event (the position and the instant of its authorisation), and the same key twice is one row.

    python3 web_action_notice.py apply_authorized_from_web apply:42:1757669400000 --position-id 42

Prints one JSON line, {"notified": bool, ...}, and exits 0 also when it could not tell: a notice
never stops the sync that calls it.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE_ACTION = "web_action_notice"
# Who speaks: the general interlocutor, whose bot is the default one.
AGENT = "assistente"
KEY = re.compile(r"^[A-Za-z0-9_.:-]{1,120}$")
LANGUAGES = ("en", "it", "de", "fr", "es", "pt", "hu")

TEXTS: dict[str, dict[str, str]] = {
    "apply_authorized_from_web": {
        "en": "An application was authorised from the website (position {position}). If it was not you, withdraw the authorisation in the app.",
        "it": "Dal sito è stata autorizzata una candidatura (posizione {position}). Se non sei stato tu, ritira l'autorizzazione dall'app.",
        "de": "Über die Website wurde eine Bewerbung freigegeben (Stelle {position}). Wenn du das nicht warst, nimm die Freigabe in der App zurück.",
        "fr": "Une candidature a été autorisée depuis le site (poste {position}). Si ce n'était pas toi, retire l'autorisation dans l'app.",
        "es": "Desde el sitio se autorizó una candidatura (puesto {position}). Si no fuiste tú, retira la autorización en la app.",
        "pt": "Foi autorizada uma candidatura a partir do site (vaga {position}). Se não foste tu, retira a autorização na app.",
        "hu": "A weboldalról engedélyeztek egy jelentkezést ({position}. állás). Ha nem te voltál, vond vissza az engedélyt az alkalmazásban.",
    },
    "team_stopped_from_web": {
        "en": "The team was stopped from the website. If it was not you, check who can access your account.",
        "it": "La squadra è stata fermata dal sito. Se non sei stato tu, controlla chi può entrare nel tuo account.",
        "de": "Das Team wurde über die Website gestoppt. Wenn du das nicht warst, prüfe, wer Zugriff auf dein Konto hat.",
        "fr": "L'équipe a été arrêtée depuis le site. Si ce n'était pas toi, vérifie qui peut accéder à ton compte.",
        "es": "El equipo se detuvo desde el sitio. Si no fuiste tú, revisa quién puede entrar en tu cuenta.",
        "pt": "A equipa foi parada a partir do site. Se não foste tu, verifica quem consegue entrar na tua conta.",
        "hu": "A csapatot a weboldalról leállították. Ha nem te voltál, ellenőrizd, ki fér hozzá a fiókodhoz.",
    },
    "team_started_from_web": {
        "en": "The team was started from the website. If it was not you, check who can access your account.",
        "it": "La squadra è stata avviata dal sito. Se non sei stato tu, controlla chi può entrare nel tuo account.",
        "de": "Das Team wurde über die Website gestartet. Wenn du das nicht warst, prüfe, wer Zugriff auf dein Konto hat.",
        "fr": "L'équipe a été démarrée depuis le site. Si ce n'était pas toi, vérifie qui peut accéder à ton compte.",
        "es": "El equipo se inició desde el sitio. Si no fuiste tú, revisa quién puede entrar en tu cuenta.",
        "pt": "A equipa foi iniciada a partir do site. Se não foste tu, verifica quem consegue entrar na tua conta.",
        "hu": "A csapatot a weboldalról indították el. Ha nem te voltál, ellenőrizd, ki fér hozzá a fiókodhoz.",
    },
    "team_restarted_from_web": {
        "en": "The team was restarted from the website. If it was not you, check who can access your account.",
        "it": "La squadra è stata riavviata dal sito. Se non sei stato tu, controlla chi può entrare nel tuo account.",
        "de": "Das Team wurde über die Website neu gestartet. Wenn du das nicht warst, prüfe, wer Zugriff auf dein Konto hat.",
        "fr": "L'équipe a été redémarrée depuis le site. Si ce n'était pas toi, vérifie qui peut accéder à ton compte.",
        "es": "El equipo se reinició desde el sitio. Si no fuiste tú, revisa quién puede entrar en tu cuenta.",
        "pt": "A equipa foi reiniciada a partir do site. Se não foste tu, verifica quem consegue entrar na tua conta.",
        "hu": "A csapatot a weboldalról újraindították. Ha nem te voltál, ellenőrizd, ki fér hozzá a fiókodhoz.",
    },
    "directive_changed_from_web": {
        "en": "A standing order for the team was added or changed from the website. If it was not you, check the board in the app.",
        "it": "Dal sito è stato aggiunto o cambiato un ordine permanente della squadra. Se non sei stato tu, controlla la bacheca nell'app.",
        "de": "Über die Website wurde eine dauerhafte Anweisung für das Team hinzugefügt oder geändert. Wenn du das nicht warst, prüfe die Pinnwand in der App.",
        "fr": "Une consigne permanente de l'équipe a été ajoutée ou modifiée depuis le site. Si ce n'était pas toi, vérifie le tableau dans l'app.",
        "es": "Desde el sitio se añadió o cambió una orden permanente del equipo. Si no fuiste tú, revisa el tablón en la app.",
        "pt": "Foi adicionada ou alterada uma ordem permanente da equipa a partir do site. Se não foste tu, verifica o quadro na app.",
        "hu": "A weboldalról hozzáadtak vagy módosítottak egy állandó csapatutasítást. Ha nem te voltál, nézd meg a táblát az alkalmazásban.",
    },
}
CODES = frozenset(TEXTS)


def user_language() -> str:
    """The user's language (shared/i18n.py, the same resolution as the rest of the box), or en."""
    sys.path.insert(0, str(HERE.parent))
    try:
        import i18n

        lang = i18n.current_lang()
    except Exception:
        lang = "en"
    finally:
        sys.path.pop(0)
    return lang if lang in LANGUAGES else "en"


def body_for(code: str, position_id: int | None, lang: str) -> str:
    text = TEXTS[code][lang if lang in LANGUAGES else "en"]
    return text.format(position=position_id if position_id is not None else "")


def notify_tool() -> Path | None:
    for candidate in (Path("/app/agents/_tools/jht-notify-user"), HERE.parent.parent / "agents" / "_tools" / "jht-notify-user"):
        if candidate.is_file():
            return candidate
    return None


def notify(code: str, key: str, position_id: int | None = None, *, lang: str | None = None, run=subprocess.run) -> dict:
    """Tell the user once about `code`; the same `key` twice is the same row, delivered once."""
    if code not in CODES:
        return {"notified": False, "reason": "code_unknown"}
    if not isinstance(key, str) or not KEY.match(key):
        return {"notified": False, "reason": "key_invalid"}
    if position_id is not None and (isinstance(position_id, bool) or not isinstance(position_id, int) or position_id <= 0):
        return {"notified": False, "reason": "position_invalid"}
    if code == "apply_authorized_from_web" and position_id is None:
        return {"notified": False, "reason": "position_missing"}
    tool = notify_tool()
    if tool is None:
        return {"notified": False, "reason": "notify_tool_missing"}
    payload = {"code": code}
    if position_id is not None:
        payload["position_id"] = position_id
    cmd = [sys.executable, str(tool), "--agent", AGENT, "--kind", "alert",
           "--source-id", f"web-action:{code}:{key}", "--source-action", SOURCE_ACTION,
           "--source-payload", json.dumps(payload, separators=(",", ":"))]
    if position_id is not None:
        cmd += ["--position-id", str(position_id)]
    cmd.append(body_for(code, position_id, lang or user_language()))
    try:
        result = run(cmd, capture_output=True, text=True, timeout=60, env=os.environ.copy())
    except (OSError, subprocess.TimeoutExpired) as err:
        return {"notified": False, "reason": "notify_failed", "detail": type(err).__name__}
    if result.returncode != 0:
        return {"notified": False, "reason": "notify_failed", "detail": (result.stderr or "").strip()[-200:]}
    words = (result.stdout or "").split()
    row = int(words[-1]) if words and words[-1].isdigit() else None
    return {"notified": True, "code": code, "row_id": row}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="web_action_notice", description="Out-of-band notice of an action taken from the website.")
    parser.add_argument("code", help="one of: " + ", ".join(sorted(CODES)))
    parser.add_argument("key", help="what makes this event one: [A-Za-z0-9_.:-], up to 120")
    parser.add_argument("--position-id", type=int, default=None)
    args = parser.parse_args(argv)
    print(json.dumps(notify(args.code, args.key, args.position_id), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
