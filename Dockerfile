# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Runtime container                                     ║
# ║  Immagine agenti + CLI + dashboard web.                                  ║
# ║  Stato persistente nei bind-mount /jht_home e /jht_user.                 ║
# ╚══════════════════════════════════════════════════════════════════════════╝
# Base image pinned by digest (multi-arch index). Update tracked by
# Renovate (.github/renovate.json). Changing the tag without the digest
# silently re-introduces unverified upstream content.
FROM node:22-bookworm-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    JHT_HOME=/jht_home \
    JHT_USER_DIR=/jht_user \
    IS_CONTAINER=1 \
    # Agent CLIs (claude, codex, kimi) are NOT baked into the image.
    # They are installed lazily on first run into /jht_home/.npm-global,
    # which lives on a bind-mount so installs persist across container
    # recreation. See ADR 0004 + the desktop provider-install step.
    NPM_CONFIG_PREFIX=/jht_home/.npm-global \
    # /app/agents/_tools contiene wrapper come `jht-send` che gli agenti
    # usano per scrivere in chat.jsonl. Va nel PATH del container (non solo
    # nel tmux pane) così anche i sub-shell spawnati da Codex/Kimi --yolo
    # lo trovano senza dipendere dall'export re-inviato via send-keys.
    PATH=/app/agents/_tools:/jht_home/.npm-global/bin:/home/jht/.local/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip \
      tmux git bash curl ca-certificates \
      build-essential pkg-config \
      libsqlite3-0 \
      tini \
      # Toolbox "agent-friendly": gli agenti Codex/Kimi/Claude vedono
      # spesso PDF (CV, lettere), pagine web, JSON complessi. Senza questi
      # tool scrivevano parser PDF in Python puro impiegando minuti invece
      # di secondi. File/jq/unzip coprono il 90% dei casi. Sudo + passwordless
      # (più sotto) permette di installare il resto on-demand.
      poppler-utils ripgrep file jq unzip sudo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY cli/package.json cli/package-lock.json* ./cli/
COPY web/package.json web/package-lock.json* ./web/
COPY tui/package.json tui/package-lock.json* ./tui/

RUN npm ci --prefix cli \
    && npm ci --prefix web \
    && npm ci --prefix tui \
    && npm cache clean --force

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .

RUN npm run build --prefix tui \
    && for pkg in shared/*/package.json; do \
         [ -f "$pkg" ] || continue; \
         dir=$(dirname "$pkg"); \
         has_deps=$(node -p "Object.keys(JSON.parse(require('fs').readFileSync('$pkg','utf8')).dependencies||{}).length > 0"); \
         if [ "$has_deps" = "true" ]; then \
           if [ -f "$dir/package-lock.json" ]; then \
             npm ci --prefix "$dir" --no-audit --no-fund; \
           else \
             npm install --prefix "$dir" --no-audit --no-fund --omit=dev; \
           fi; \
         fi; \
       done \
    && npm cache clean --force

RUN useradd --create-home --shell /bin/bash jht \
    && mkdir -p /jht_home /jht_user \
    && chown -R jht:jht /jht_home /jht_user /app \
    # Espone i tool degli agenti (es. jht-send) in /usr/local/bin così
    # sono trovati anche dalle sub-shell login che Codex/Kimi --yolo
    # spawnano con PATH ripulito da /etc/login.defs. Senza questo,
    # PATH del Dockerfile (/app/agents/_tools:...) viene ignorato dai
    # bash -l -c "..." figli.
    && for f in /app/agents/_tools/*; do \
         [ -x "$f" ] && ln -sf "$f" "/usr/local/bin/$(basename "$f")"; \
       done \
    # Skill discovery farm: l'Agent Skills standard (SKILL.md) è letto da
    # Claude Code in .claude/skills/, da Codex e Kimi in .agents/skills/.
    # Sorgente: agents/_skills/ (globali, viste da TUTTI gli agenti) +
    # agents/<role>/_skills/ (private a un singolo ruolo, distribuite
    # dal launcher per-cwd — vedi ROADMAP § Skill discovery).
    # Per ora il symlink farm globale resta unico in /app/.claude/skills/
    # + /app/.agents/skills/; il distributor per-agente è una follow-up
    # in start-agent.sh.
    && mkdir -p /app/.claude/skills /app/.agents/skills \
    && for skill in /app/agents/_skills/*/; do \
         [ -d "$skill" ] || continue; \
         name=$(basename "$skill"); \
         [ "$name" = "_lib" ] && continue; \
         ln -sfn "/app/agents/_skills/$name" "/app/.claude/skills/$name"; \
         ln -sfn "/app/agents/_skills/$name" "/app/.agents/skills/$name"; \
       done \
    # Passwordless sudo per l'user jht: gli agenti girano con --yolo in un
    # container disposable — se servono tool extra (pdftohtml, tesseract,
    # pacchetti pip ecc.) possono `sudo apt install` / `sudo pip install`
    # al volo senza bloccare il flusso. Il container è isolato dal host.
    && echo 'jht ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/jht \
    && chmod 0440 /etc/sudoers.d/jht \
    # Pre-crea /app/web/.next vuota ma con ownership jht. Serve per il
    # compose dev dove mascheriamo .next con anonymous volume: Docker
    # copia le perms della dir "sorgente" nel volume, quindi se qui fosse
    # mancante o root-owned il volume nascerebbe non-scrivibile da jht
    # e Next.js crasha con "EACCES: mkdir '/app/web/.next/dev'".
    && mkdir -p /app/web/.next \
    && chown jht:jht /app/web/.next

USER jht

EXPOSE 3000

VOLUME ["/jht_home", "/jht_user"]

ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/cli/bin/jht.js"]
CMD ["--help"]
