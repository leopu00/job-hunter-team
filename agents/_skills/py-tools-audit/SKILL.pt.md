<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: py-tools-audit
description: "Limpeza coordenada a nível de equipa dos pacotes Python instalados sob `$JHT_HOME/.local` via `uv pip install --user` (T13 magazzino). Gerida pelo Dottore. A auditoria NÃO é unilateral — apenas os agentes Writer / Critic sabem se uma biblioteca importada dinamicamente ainda lhes é útil, por isso o fluxo é broadcast → janela de consentimento de 1h → desinstalar o conjunto silencioso → re-auditoria. Como o Dottore é one-shot (~10 min por ronda, ~30 min de intervalo), a janela de consentimento de 1h abrange 2 rondas do Dottore: a ronda N inicia a auditoria + broadcast, a ronda N+1 recolhe respostas + desinstala."
allowed-tools: Bash(python3 /app/shared/skills/py_tools_audit.py *), Bash(uv pip uninstall *), Bash(jht-tmux-send *), Bash(tmux *), Bash(du *), Bash(xargs *)
---

# py-tools-audit — limpar o magazzino Python partilhado

`$JHT_HOME/.local/lib/python3.x/site-packages/` é a **única user-base partilhada** de onde todos os agentes leem (T13). Qualquer agente pode fazer `uv pip install --user <pkg>` quando precisa de uma biblioteca, mas os agentes *não* desinstalam quando mudam de abordagem — os pacotes acumulam-se. Aproximadamente a cada semana, o magazzino ultrapassa 800 MB e precisa de uma auditoria coordenada.

A auditoria é coordenada porque um `import` grep estático pode não detetar bibliotecas carregadas dinamicamente em tempo de execução (por exemplo, um script em `tools/` que o Writer chama apenas quando uma JD exige um formato específico). Portanto: perguntar antes de remover.

## Gatilho

- ⏰ ~semanal (a cada 7 dias de execução contínua), no início de um dia operacional tranquilo
- 📈 sob demanda quando `du -sh /jht_home/.local` > 800 MB
- 🚀 antes de um release importante / entrega ao utilizador

## Fluxo de duas rondas (porque o Dottore é one-shot)

```
Round N:    audit → broadcast dos candidatos → guardar ficheiro de estado
…30 min…
Round N+1:  recolher respostas → calcular keep_set → desinstalar → re-audit → relatório
```

Cada ronda regista a sua fase em `$JHT_HOME/logs/py-audit-state.json`:

```json
{"phase": "broadcast_sent", "round_id": "...", "ts": "ISO-UTC",
 "candidates": ["pymupdf", "pdfminer.six", "reportlab", "..."],
 "broadcast_at": "ISO-UTC"}
```

Quando acordares, **verifica este ficheiro primeiro**:
- ficheiro ausente ou `phase=done` → ronda nova, vai a "Round N" abaixo
- `phase=broadcast_sent` e `now - broadcast_at >= 1h` → "Round N+1" abaixo
- `phase=broadcast_sent` e `now - broadcast_at < 1h` → a janela de consentimento ainda não fechou, salta a auditoria nesta ronda

## Round N — iniciar a auditoria

### 1. Verificação do limiar

```bash
python3 /app/shared/skills/py_tools_audit.py --threshold-mb 800
```

- Exit `0` → nada urgente. Para aqui, não faças broadcast.
- Exit `2` → vale a pena limpar. O script também imprime a *tabela de candidatos* — pacotes sem import ativo, excluindo a whitelist (dependências transitivas + CLIs binários fixados).

### 2. Broadcast a cada agente

Envia uma mensagem `[PY-AUDIT]` a cada sessão de agente ativa via `jht-tmux-send`:

```
[@dottore -> @<role>] [PY-AUDIT] candidates uninstall: pymupdf,
pdfminer_six, reportlab, weasyprint, pypdf, ...
If you USE one of these, reply within 1h with [KEEP <pkg>].
Silence = consent to uninstall.
```

A janela de 1h é imposta pelo **início da ronda seguinte**, não por um `sleep` nesta ronda (o Dottore é one-shot). Persiste a hora do broadcast em `py-audit-state.json`.

### 3. Persistir estado e sair da ronda

```json
{"phase": "broadcast_sent", "round_id": "...",
 "candidates": ["..."], "broadcast_at": "ISO-UTC"}
```

Fim do Round N. Auto-destruição como habitual; o próximo Dottore (~30 min depois) continuará a partir daqui.

## Round N+1 — recolher, desinstalar, reportar

Acionado quando `py-audit-state.json` mostra `phase=broadcast_sent` e ≥1h passou.

### 1. Recolher respostas

Para cada agente que recebeu o broadcast, executa `tmux capture-pane -t <SESSION> -p -S -200 | grep '\[KEEP '` para encontrar respostas `[KEEP <pkg>]`. Constrói o `keep_set`:

```
keep_set = (whitelist predefinida) ∪ (cada <pkg> em qualquer resposta [KEEP])
```

Silêncio sobre um candidato = consentimento para desinstalar.

### 2. Desinstalar o conjunto silencioso

```bash
python3 /app/shared/skills/py_tools_audit.py --candidates-only --keep <keep_set...> \
  | xargs -r uv pip uninstall --user -y
```

`xargs -r` salta a chamada quando não há nada para desinstalar (stdin vazio).

### 3. Re-auditoria + relatório

```bash
python3 /app/shared/skills/py_tools_audit.py
du -sh /jht_home/.local
```

Calcula `freed_mb = before - after` e notifica o utilizador através do Capitano:

```bash
jht-tmux-send CAPITANO "[@dottore -> @capitano] [REPORT] py-audit done: <N> packages removed, <freed_mb> MB freed. Magazzino now <after_mb> MB."
```

### 4. Repor estado

```json
{"phase": "done", "round_id": "...", "completed_at": "ISO-UTC",
 "removed": ["..."], "freed_mb": 142}
```

Um `py-audit-state.json` limpo com `phase=done` permite que a próxima ronda recomece do zero.

## Regras rígidas

- **Nunca desinstalar sem o broadcast + janela de 1h.** Alguns pacotes são carregados dinamicamente e não aparecerão num grep estático — o broadcast é a única forma de os detetar.
- **Nunca tocar em `ALWAYS_KEEP`.** As notas transitivas (numpy, pillow, packaging, etc.) estão lá por boas razões; o script de auditoria já as exclui.
- **Se um Writer protestar após uma desinstalação**, reinstala imediatamente e adiciona o pacote a `ALWAYS_KEEP`. Trata isto como um bug de processo (o broadcast falhou em alcançar o agente), não como culpa do Writer.
- **Nunca sudo-uninstall.** Mantém-te dentro de `uv pip uninstall --user`. T13 proíbe `sudo pip` pela mesma razão que proíbe `sudo pip install`.

## Anti-padrões

- ❌ Executar ambas as rondas num único despertar do Dottore com `sleep 3600` — excede o orçamento de 10 min por ronda e quebra a cadência do watchdog.
- ❌ Inferir o keep set do próprio `import` grep sem fazer broadcast — falhas silenciosas em carregamentos dinâmicos.
- ❌ Desinstalar > 100 pacotes numa única ronda — demasiado ruidoso, difícil de reverter. Limita ao lote natural da auditoria (o que o script de limiar retornar).
- ❌ Executar esta skill em reação a um `[ORDINE]` do Sentinel — ordens exigem pacing/scaling, não manutenção. py-audit espera por uma janela de inatividade.

## Ver também

- `cache-prune` — skill de manutenção irmã (uv wheel cache, ~24h de cadência). Executa-a primeiro; por vezes reduz o tamanho do magazzino abaixo de 800 MB e torna a auditoria desnecessária.
- `agents/_team/team-rules.md` T13 — regra de instalação (`uv pip install --user`) que justifica esta auditoria.
- `agents/dottore/dottore.md` — ciclo de vida do Dottore; esta skill abrange 2 rondas do ciclo de vida através do ficheiro de estado.
