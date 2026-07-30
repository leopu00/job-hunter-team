<!-- @translation: es, ai-translated 2026-07-30 -->
---
name: throttle-set
description: La UNICA forma en que se escriben los ritmos del equipo. Solo el Capitan. `throttle-set <agente> <segundos>` edita la config de throttle por agente; el motor la vuelve a leer cuando arma cada temporizador, asi que el cambio muerde en el SIGUIENTE ciclo de ese agente por si solo - ningun mensaje tmux, ningun agente tiene que releer nada, y el ciclo ya en curso no se altera. Usalo en lugar de mandar numeros a los workers. Tambien `throttle-set a=N b=M ...` para una escritura multiple atomica, `--dump` para los valores efectivos, `--get <agente>`, `--reset`.
allowed-tools: Bash(throttle-set *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle-set — gobierna los ritmos sin tocar a los agentes

```bash
throttle-set <agente> <segundos>            # un agente
throttle-set scout-1=660 analista-1=300     # varios, una escritura atomica
throttle-set --dump                         # los valores EFECTIVOS ahora
throttle-set --get <agente>                 # el valor efectivo de uno
throttle-set --reset                        # borra todos los overrides
```

## Por que nunca mandas un numero por tmux

El motor de throttle lee la config **en el momento en que arma cada
temporizador**. Por lo tanto:

- un valor que cambies aqui muerde en el ciclo **siguiente** de ese agente, solo;
- el ciclo **en curso** no se toca — su vencimiento ya estaba calculado, y moverlo
  seria una sorpresa que nadie pidio;
- los workers nunca ven un numero y no saben cuanto esperan. Llaman
  `throttle <su-nombre>` y se detienen. La duracion es solo tuya.

Es toda la razon por la que esto existe: cinco mensajes tmux con un numero son
cinco ocasiones de competir con un agente a mitad de pausa. Una escritura atomica
es ninguna.

## Lo que te devuelve es el EFECTIVO, no lo que pediste

Dos correcciones automaticas se aplican en lectura, asi que el numero que el
agente sufre puede diferir del que escribiste:

- **Worker floor, 5 min.** Los workers (Scout/Analista/Scorer/Escritor/Critico)
  nunca bajan de 300s, `0` incluido. Nace de un incidente medido — un Scout sin
  pausas quemo ~308kT por 3 posiciones de datos sucios. El core interactivo
  (Capitan/Centinela/Asistente/Mentor) **no** tiene floor: debe seguir reactivo
  para el chat del usuario, asi que alli `0` sigue siendo `0`.
- **Escalera coprima.** Todo valor > 0 se engancha a un escalon en minutos primos
  (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60). Los escalones multiplos de 5
  resincronizaban a los workers *por construccion*: 5+10 coincidian cada 10
  minutos. Los escalones coprimos hacen las colisiones raras en vez de periodicas.

Asi que `throttle-set scout-1 120` se relee como `300`. No es la herramienta
ignorandote — es el valor que el agente sufrira, y es lo que `--dump` muestra.

Ambas ceden mientras esta viva la derogacion temporal del usuario, y vuelven
solas al expirar. No tienes que acordarte de restaurarlas.

## Para CONSUMIR mas la palanca es el paralelismo, no un throttle menor

Los workers no bajan de 5 min, asi que «pon el throttle a 0» para ellos no
existe. Si el equipo esta por debajo del ritmo objetivo, agrega workers **por
etapas**; no intentes recuperar limando la pausa. Un throttle saturado es una
senal, no un destino: cuando un agente ya esta alto en la escalera y sigue
excediendose, la palanca pasa a ser matarlo, no otro empujon.

## Exit codes

- `0` — escrito / leido
- `1` — argumentos invalidos, valor fuera de rango (0..3600), o config ausente

## Ejemplo

```bash
throttle-set --dump
# default = 0s
# scout-1        = 660s
# analista-1     = 300s

throttle-set scout-1 1380
# scout-1=1380s

# scout-1 esta a mitad de pausa: mantiene los 660s que tenia, y sufrira 1380s en
# el proximo ciclo. Nadie le dijo nada.
```
