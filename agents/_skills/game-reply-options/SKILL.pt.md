<!-- @translation: pt, ai-translated 2026-08-03 -->
---
name: game-reply-options
description: "Oferece 2 a 5 botões de resposta clicáveis, específicos do contexto, no chat do jogo JHT quando facilitarem mesmo a próxima decisão do utilizador. Usa-os apenas para uma escolha pequena e delimitada; nos restantes casos responde normalmente com jht-send. Nunca os uses como uma árvore de onboarding fixa."
allowed-tools: Bash(jht-reply-options *)
---

# Opções de resposta geradas no jogo

Quando a mensagem do utilizador abre para poucas jogadas claras, fecha o teu turno
com uma pergunta e 2 a 5 respostas geradas para esse contexto exato:

```bash
jht-reply-options --prompt 'Por onde queres começar?' \
  'Vamos rever os meus cargos-alvo' 'Vamos ver as lacunas do meu perfil' 'Mostra-me as melhores posições'
```

O jogo apresenta essas opções como botões, mantendo sempre disponível a escrita
livre. Clicar num botão envia o respetivo texto como uma mensagem normal do utilizador.

Regras:

- As opções são facultativas, específicas da conversa em curso e nunca copiadas do
  onboarding escrito offline.
- Usa 2 a 5 opções concisas e úteis entre si. Não ofereças uma escolha falsa cujo
  resultado não consegues concretizar.
- `jht-reply-options` é a resposta final desse turno. Não o faças seguir de
  `jht-send`, senão os botões desapareceriam — e bem — por baixo da resposta mais recente.
- Para perguntas abertas ou uma resposta direta, usa `jht-send` como de costume.
