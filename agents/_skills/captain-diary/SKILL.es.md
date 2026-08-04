<!-- @translation: es, ai-translated 2026-08-03 -->
---
name: captain-diary
description: "Diario de traspaso diario para el Capitano. El Capitano se reinicia a menudo (context-refresh, nueva ventana de trabajo, reboot) y de lo contrario pierde las lecciones de pacing que tanto costó aprender durante el día — repitiendo los mismos errores (p. ej. 3 Scout a la vez → un pico imposible de frenar → 5 h a ralentí para pagar la deuda). Al arrancar, lee las notas del día ANTERIOR (handoff) y AÑADE una nota de una línea cada vez que ocurra algo significativo durante el día (una decisión de escalado, un pico, un kill, una lección). Un archivo append-only por día."
allowed-tools: Bash(python3 /app/shared/skills/captain_diary.py *)
---

# captain-diary — el traspaso entre Capitanos

Un archivo por día en `$JHT_HOME/logs/captain-diary-YYYY-MM-DD.md`, append-only.
Su función es evitar que **empieces de cero en cada reinicio**: las lecciones de
pacing de hoy se le entregan al Capitano de mañana.

## Al despertar (SIEMPRE, antes de trabajar)

Lee las notas que dejó el Capitano del día anterior:

```bash
python3 /app/shared/skills/captain_diary.py handoff
```

Imprime las notas de **ayer** (o las del último día trabajado) más lo que ya se
haya registrado **hoy**. Heredas las lecciones → **no repitas los mismos
errores**. Si no hay nada, eres el primero: empieza a registrar.

## Durante el día — registra los eventos SIGNIFICATIVOS

Una línea, cada vez que ocurra algo que deje una lección. NO un diario de todo:
solo lo que el Capitano de mañana necesitaría.

```bash
python3 /app/shared/skills/captain_diary.py add "20:05 — 3 Scout a la vez: pico imposible \
de frenar en 15 min, 5 h a ralentí para pagar la deuda. Lección: máx. 1 Scout y luego \
30 min de observación (C-02)."
```

Qué merece la pena registrar:
- decisiones de escalado que salieron mal (o bien) — cuántos workers, qué throttle, qué pasó;
- un pico que no pudiste frenar y cómo te recuperaste;
- un kill y por qué;
- un patrón que apareció (p. ej. "el Scout del sitio X consume el doble");
- cualquier cosa que, de saberla mañana, evitaría un error.

## Revisar solo hoy

```bash
python3 /app/shared/skills/captain_diary.py today
```

## Regla

- El diario es el **testigo de la carrera de relevos**: léelo al arrancar, aliméntalo durante el día.
- Las notas deben ser **breves y accionables** (un hecho + la lección), no un log verboso.
- La marca de tiempo la añade la herramienta: tú escribes solo el hecho y la lección.
