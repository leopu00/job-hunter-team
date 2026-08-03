<!-- @translation: pt, ai-translated 2026-08-03 -->
---
name: resilience
description: "Quando uma ferramenta crítica para a missão falha, NUNCA degrades em silêncio nem reportes \"fila esgotada\"/new=0. Classifica avariada-vs-vazia e depois sobe a escada de fallbacks — reparação automática via jht-install, nova tentativa, método alternativo, marcar OPEN_UNVERIFIED, escalar ao Capitano com a correção exata. Usa-a sempre que uma ferramenta de que dependes (browser, linkedin_check, um fetch, uma CLI) dê erro ou falte uma dependência."
---

# resilience — nunca desistir em silêncio perante uma ferramenta avariada

## Porque existe

Uma ferramenta crítica para a missão (a verificação do LinkedIn via Playwright) morreu porque faltava
uma biblioteca de sistema. Os agentes reportaram "não consigo verificar" e recuaram em silêncio para
"fila vazia" — a falha só foi descoberta a jusante ao fim de horas de `new=0`. Esta skill torna a
falha de uma ferramenta **ruidosa e recuperável** em vez de silenciosa e fatal.

## A regra fundamental

**Uma ferramenta avariada NÃO é um resultado vazio.** Antes de escreveres "fila esgotada", `new=0` ou
"nada a fazer", TENS de auto-verificar a ferramenta de que dependes. Se a ferramenta está avariada,
não tens "nenhum trabalho" — tens **uma reparação a fazer** ou **uma escalada a abrir**.

## A escada de fallbacks — sobe-a por ordem, para no primeiro degrau que resulte

1. **Deteta e classifica.** Ferramenta que sai com código diferente de zero / dependência em falta /
   erro de carregamento (`exitCode 127`, `cannot open shared object file`, `command not found`,
   `error while loading shared libraries`) → **BROKEN**. Ferramenta que correu limpa e devolveu zero
   itens → **EMPTY** (genuíno). Só EMPTY justifica um "nenhum trabalho".
2. **Reparação automática.** Repõe a dependência em falta com **`jht-install`** (o wrapper canónico —
   encaminha corretamente system/python/node/browser e usa o `sudo apt` que já tens). Depois **volta
   a tentar a ferramenta original**.
   *Exemplo:* o browser falha com `cannot load libatk-1.0.so.0` → `jht-install` das dependências de
   sistema do browser (`playwright install-deps` / `sudo apt-get install` da biblioteca) → relança.
3. **Método alternativo.** Se a ferramenta principal não for reparável dentro do ciclo, muda de
   método mantendo o mesmo objetivo:
   - LinkedIn: usa o fetch HTTP como convidado, ou confirma que a vaga está viva na **página
     canónica de careers/ATS da empresa** (Greenhouse / Lever / Ashby / Workable). **Nunca** confies
     num HTTP 200 do LinkedIn — a authwall devolve 200 também para vagas fechadas.
4. **Marca, não descartes.** Se continuar inconclusivo, deixa o estado do dado **INALTERADO** e
   marca-o com `OPEN_UNVERIFIED` + um `NOTE_MISMATCH`. Nunca sobrescrevas em silêncio com um palpite.
5. **Escala (dentro do teto de 2-3 tentativas, ver abaixo).** Ferramenta avariada e não reparável em
   ≤2-3 tentativas → envia mensagem ao **Capitano** com a correção EXATA: o comando que falha, a
   dependência em falta e a linha `jht-install` / Dockerfile que a resolve. Depois **continua a
   trabalhar pelo método alternativo** (ou passa a outra fonte) — não fiques parado, mas **também não
   ultrapasses o teto**.

## O que isto proíbe

- ❌ Escrever "fila esgotada" / `new=0` / "nada a verificar" quando a causa real é um erro de
  ferramenta.
- ❌ Recorrer a um sinal reconhecidamente pouco fiável (p. ex. LinkedIn `200` = "aberta") e dá-lo
  como verificado.
- ❌ Reportar um bloqueio e depois ficar inativo. Reporta **e** continua a trabalhar pela
  alternativa.

## Classifica antes de declarar "vazio"

Classificador canónico — o smoke-test partilhado `tool_health` verifica todo o conjunto crítico de
uma só vez (`status` OK|BROKEN|UNKNOWN por ferramenta, exit 1 se alguma estiver avariada). Corre-o
antes de reportar "nenhum trabalho":

```sh
# Se uma ferramenta crítica está BROKEN, NÃO tens uma fila vazia — tens uma reparação/escalada.
if ! python3 /app/shared/skills/tool_health.py >/tmp/tools_health.json 2>&1; then
  echo "Uma ferramenta crítica está BROKEN -> jht-install + nova tentativa -> alternativa -> escalada. NÃO 'vazio'."
fi
```

Verificação inline por ferramenta (quando no ciclo dependes só de uma):

```sh
out=$(JHT_HOME=/jht_home python3 /app/shared/skills/linkedin_check.py "$JOB_ID" 2>&1); rc=$?
if [ "$rc" -ne 0 ] || printf '%s' "$out" | grep -qiE 'libatk|shared librar|exitCode 127|cannot open'; then
  echo "BROKEN -> reparar + repetir + alternativa; NÃO é um EMPTY genuíno."
else
  echo "ferramenta OK -> um zero aqui é um EMPTY genuíno."
fi
```

## ⛔ Teto de teimosia — máximo 2-3 tentativas, depois ESCALAR (2026-06-26)

A teimosia tem **orçamento**, NÃO é infinita. Para uma fonte/ferramenta que continua a falhar faz
**no máximo 2-3 tentativas reais** (p. ex. `reparar+repetir` e depois **UMA** alternativa) — **não**
construas wrapper sobre wrapper nem entres em ciclos de dezenas de iterações. *Foi exatamente isso a
maratona do scout-6: 54 scrapes do LinkedIn + 42 pesquisas web + uma execução de playwright feita à
medida para **3** vagas, ~308 kT queimados.* A *escada da resiliência* precisa de um teto, caso
contrário torna-se um poço de tokens.

Gastas as 2-3 tentativas:
1. **Para nessa fonte** — não insistas mais.
2. Deixa o dado em `OPEN_UNVERIFIED` (nunca o sobrescrevas com um palpite) **ou** passa a outra
   fonte/círculo (round-robin, não esgotes sempre o mesmo).
3. **Escala ao Capitano** com o diagnóstico exato (o comando que falha, a dependência em falta, a
   linha `jht-install`/Dockerfile que a resolve). **É ele que decide** se vale a pena insistir,
   reparar a montante ou abandonar esse círculo.

Crítico para a missão (browser / LinkedIn) = insiste **até ao teto**, não para sempre; e apenas a
partir de fontes oficiais. Uma ferramenta avariada continua a ser uma **reparação/escalada**, não uma
"fila vazia" — mas a reparação custa no máximo 2-3 tentativas, e depois disso quem decide é o
Capitano.
