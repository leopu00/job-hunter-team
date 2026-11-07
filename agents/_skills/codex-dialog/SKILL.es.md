---
name: codex-dialog
description: Distingue un diálogo de la CLI Codex administrada de un worker muerto antes de recuperarlo o sustituirlo.
---
<!-- @translation: es, ai-translated 2026-11-07 -->

Usa esta habilidad solo con agentes de la **CLI de terminal Codex**, no del runtime API.
Una notificación `[CODEX-DIALOG]` representa un estado distinto, no demuestra que
el worker haya muerto. El watchdog reconoce el recordatorio visible del modelo,
conserva el modelo actual e informa si la recuperación tuvo éxito. No sustituye
la sesión, acepta solicitudes de confianza, cambia modelos, actualiza la CLI ni concede acceso.

Lee la última observación registrada sin enviar entrada:

```bash
python3 /app/shared/skills/codex_dialog.py status SCORER-1
```

`last_observation` y `at` describen la última comprobación, no garantizan que el
agente siga vivo. `codex_dialog_recovered` significa que el mismo panel volvió
al editor de entrada o al trabajo; `codex_dialog_ready` registra una observación
posterior correcta sin atribuirla a recuperación automática. `pending`, `timeout`,
`changed`, `unrecognized` e `io_error` requieren inspección. Los códigos completos
empiezan por `codex_dialog_`.

Informa al usuario de este estado antes de decidir una recuperación manual o sustitución.
No clones, cierres ni sustituyas al worker en silencio. Si el diálogo sigue sin
resolverse, pide un diagnóstico al Dottore y explica la acción propuesta. Nunca
envíes Enter a ciegas ni selecciones un modelo sugerido. Los mensajes normales
siguen usando `tmux-send` y sus comprobaciones de disponibilidad. Una cuota
realmente agotada, un inicio de sesión o una solicitud de confianza no son una recuperación exitosa.
