<!-- @translation: pt, ai-translated 2026-06-06 -->
# 🛡️ Protocolo Anti-Coliso

Quando mltiplos agentes do mesmo papel extraem da mesma fila, eles DEVEM evitar trabalhar no mesmo registro. O mecanismo  **especfico por papel** — cada fase usa a estratgia de bloqueio que melhor se adapta  sua forma de trabalho.

## 🎯 Mecanismos de bloqueio por papel

### 🕵️ Scout — dedup pr-INSERT

Os Scouts escrevem registros *novos*, portanto no podem bloquear algo que ainda no existe. O risco de coliso  dois scouts inserirem a mesma vaga de emprego de fontes diferentes. Mecanismo:

```bash
# Antes do INSERT, verificar se a URL j est no BD
python3 shared/skills/db_query.py check-url "<url>"
# Retorna "TROVATA" (pular) ou "NON TROVATA" (prosseguir com o INSERT).
```

Particionamento no boot: os scouts tambm negociam **crculos** e **fontes** via `scout_coord.py` para no se sobreporem na mesma fonte desde o incio. Veja `agents/scout/scout.md` para detalhes.

### 👨‍🔬 Analista  👨‍💻 Scorer — marca d'gua `last_checked`

Ambos extraem de uma fila (`status = new` para Analistas, `status = checked` para Scorers) e atualizam registros existentes. O risco de coliso  dois peers selecionarem o mesmo registro ao mesmo tempo. Mecanismo:

1. **Ler** `last_checked` para o registro candidato.
2. **Se recente** (um peer o carimbou nos ltimos minutos) → pular; pegar o prximo.
3. **Caso contrrio** carimbar `last_checked = now()` para reivindicar, depois trabalhar.

```bash
# Reivindicar
python3 shared/skills/db_update.py position <ID> --last-checked now
```

A marca d'gua  um bloqueio suave: apenas sinaliza "tocado recentemente", no "bloqueado permanentemente". O tratamento de reivindicaes obsoletas fica a critrio do agente (veja § Reivindicaes obsoletas abaixo).

### 👨‍🏫 Escritor — flip `status = writing`

Os Escritores extraem de `status = scored`. O risco de coliso  dois escritores pegarem a mesma posio de alta pontuao. Mecanismo:

```bash
# Reivindicao atmica por flip de status
python3 shared/skills/db_update.py position <ID> --status writing
```

Os peers que executam `next-for-scrittore` no vero registros j em `status = writing`, portanto o flip em si  o bloqueio. Regra anti-reescrita adicional: se `applications.critic_verdict` j estiver definido, **pular absolutamente** (o veredito  definitivo).

## 📡 Comunicao

Quando um agente precisa informar um peer (ex. "Estou pegando os IDs 42-44") ou notificar o downstream (ex. Scout → Analista com um lote fresco), use o wrapper atmico:

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [INFO] taking IDs 42-44"
```

⚠️ **No use `tmux send-keys` diretamente**: as TUIs do Codex/Kimi perdem o caractere Enter se ele chegar na mesma chamada `send-keys` que o corpo do texto. O wrapper trata texto + Enter atomicamente com uma pausa de renderizao. Skill: `agents/_skills/tmux-send/jht-tmux-send`.

## 👨‍⚕️ Reivindicaes obsoletas (raras em produo)

Os agentes em produo rodam por meses sem cair — reivindicaes obsoletas so principalmente um artefato do ambiente de teste. Quando acontecem:

- **No roube cegamente uma reivindicao obsoleta.** Um `last_checked` de 10 minutos atrs pode ser um peer que  simplesmente lento em um nico registro, no uma sesso morta.
- **Verifique primeiro a atividade do peer.** Verifique a sesso tmux do peer (`tmux has-session -t <peer>`); inspecione o painel (`tmux capture-pane -p`) para ver se ainda est trabalhando, bloqueado em um fetch, ou realmente morto.
- **Se o peer est vivo mas travado**, escale para o Capito em vez de arrancar o registro dele.
- **Se o peer est morto**, reivindique o registro voc mesmo e notifique o Capito.

A inteno: evitar o roubo silencioso de registros. Decises sobre recuperao devem ser deliberadas, no automticas.

## 📋 Regras comuns

- **Ler antes de reivindicar.** Sempre verifique o estado atual do registro antes de reivindic-lo.
- **A primeira escrita ganha.** Se dois agentes competem pelo mesmo registro, a primeira atualizao no BD ganha; o perdedor pula e pega o prximo.
- **Nunca DELETE.** Use `--status excluded` com notas quando um registro se mostrar invlido; nunca destrua dados.
- **Atualize o status final ao terminar.** Aps o trabalho: `checked` (Analista), `scored` / `excluded` (Scorer), `ready` / `excluded` (Escritor).

## 🛠️ Unificao futura (planejada)

Um par `positions.claimed_by + claimed_at` est no roadmap para habilitar **reivindicaes em lote** (um nico `UPDATE … LIMIT N` atmico em vez de N viagens de ida e volta por registro) e para alimentar uma visualizao em tempo real da atividade dos agentes no painel UI. Os mecanismos especficos por papel acima continuaro funcionando em paralelo. Veja ROADMAP § *Database schema optimization*.
