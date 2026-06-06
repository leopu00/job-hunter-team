<!-- @translation: pt, ai-translated 2026-06-06 -->
# 🪟 Sessoes Tmux

A equipe JHT funciona como um conjunto de sessoes tmux dentro do container. Os nomes das sessoes sao **maiusculos, sem emoji, sem espacos**.

## 📛 Convencao de nomenclatura

| Pattern | Significado | Exemplos |
|---|---|---|
| `<ROLE>` | Singleton — apenas uma instancia | `CAPITANO` · `CRITICO` · `SENTINELLA` · `ASSISTENTE` |
| `<ROLE>-<N>` | Membro do pool — N e um inteiro positivo | `SCOUT-1` · `ANALISTA-2` · `SCRITTORE-3` |
| `<ROLE>-S<N>` | Criado dinamicamente por outro agente | `CRITICO-S1` (criado por `SCRITTORE-1`), `CRITICO-S2`, … |

## 📚 Sessoes conhecidas

### Sessoes pool (o Capitao decide a quantidade de instancias)

| Prefixo da sessao | Funcao | Notas |
|---|---|---|
| `SCOUT-<N>` | Descoberta | Multiplas instancias, coordenacao peer via `scout_coord.py` |
| `ANALISTA-<N>` | Verificacao | Extrai de `next-for-analista` |
| `SCORER-<N>` | Pontuacao | Extrai de `next-for-scorer` |
| `SCRITTORE-<N>` | Redacao | Extrai de `next-for-scrittore` (score DESC) |

### Singletons

| Sessao | Funcao | Notas |
|---|---|---|
| `CAPITANO` | Comandante da equipe | Instancia unica — coordena ordens, estado, escalacoes |
| `CRITICO` | Critico independente | Legacy — na V5 o Critico e criado dinamicamente pelos Escritores (ver abaixo) |
| `SENTINELLA` | Watchdog de consumo | Edge-triggered, comunica apenas com `CAPITANO` |
| `ASSISTENTE` | Copiloto do usuario | Traduz as solicitacoes do usuario em ordens |
| `MENTOR` | Agente career-coach | Planejado, atualmente um placeholder |

### Sessoes dinamicas

| Sessao | Criada por | Duracao |
|---|---|---|
| `CRITICO-S<N>` | `SCRITTORE-<N>` (um Critico novo por ciclo de revisao) | Uma solicitacao de revisao → uma sessao, encerrada pelo Escritor imediatamente apos |

O Escritor cria `CRITICO-S<N>` com o mesmo numero (`SCRITTORE-1` → `CRITICO-S1`), executa a revisao e entao `tmux kill-session`. Uma nova instancia do Critico e criada para **cada** um dos 3 ciclos de revisao — nunca reutilizada.

## 🔗 Relacionado

- 💬 [`communication-rules.md`](communication-rules.md) — envelope da mensagem, `jht-tmux-send`, quem deve enviar o que
- 🛡️ [`anti-collision.md`](anti-collision.md) — coordenacao peer entre os membros do pool
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — composicao completa da equipe e mapeamento de niveis
