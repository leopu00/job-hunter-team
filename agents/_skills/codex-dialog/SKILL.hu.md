---
name: codex-dialog
description: Helyreállítás vagy csere előtt különböztesd meg a kezelt Codex CLI párbeszédablakát egy leállt workertől.
---
<!-- @translation: hu, ai-translated 2026-11-07 -->

Ezt a skillt kizárólag a **Codex terminálos CLI-jében** futó ügynökökhöz használd, az API-futtatókörnyezethez ne.
A `[CODEX-DIALOG]` értesítés külön állapotot jelez, nem bizonyítja a worker leállását.
A watchdog felismeri a látható modellemlékeztetőt, megtartja az aktuális modellt,
és jelzi, sikerült-e a helyreállítás. Nem cseréli le a munkamenetet, nem fogad el
bizalmi kérést, nem vált modellt, nem frissíti a CLI-t és nem ad hozzáférést.

A legutóbb rögzített megfigyelést bemenet küldése nélkül olvasd ki:

```bash
python3 /app/shared/skills/codex_dialog.py status SCORER-1
```

A `last_observation` és az `at` az utolsó ellenőrzést írja le, nem garantálja az
ügynök jelenlegi működését. A `codex_dialog_recovered` szerint ugyanaz a panel
visszatért a beviteli mezőhöz vagy a munkához. A `codex_dialog_ready` későbbi egészséges
megfigyelést rögzít, automatikus helyreállítás állítása nélkül. A `pending`, `timeout`,
`changed`, `unrecognized` és `io_error` állapotok vizsgálatot igényelnek. A teljes
kódok `codex_dialog_` előtaggal kezdődnek.

Kézi helyreállítás vagy csere előtt tájékoztasd a felhasználót erről az állapotról.
Ne klónozd, állítsd le vagy cseréld le a workert csendben. Megoldatlan párbeszédnél
kérj diagnózist a Dottorétól, és magyarázd el a javasolt műveletet. Soha ne küldj
vakon Entert, és ne válassz javasolt modellt. A rendes üzenetek továbbra is a
`tmux-send` eszközt és annak készenléti ellenőrzéseit használják. A ténylegesen
kimerült keret, a bejelentkezés vagy a bizalmi kérés nem sikeres helyreállítás.
