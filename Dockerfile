# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Runtime container                                     ║
# ║  Immagine agenti + CLI (interazione via app desktop, no web locale).     ║
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
    # Le TUI degli agenti girano SEMPRE in classic mode (niente alternate
    # screen / fullscreen renderer): la chat legge le pane con `tmux
    # capture-pane` e l'alternate screen la romperebbe. Disabilitarlo evita
    # anche l'upsell "Try the new fullscreen renderer?" di Claude Code v2.1.x
    # a monte (belt; il dismissal robusto vive in jht-tmux-send). Leone 24/07.
    CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 \
    # Centralized Python user-base for ALL agent installs (RULE-T13).
    # Agents run `uv pip install --user <pkg>` which honours
    # PYTHONUSERBASE → packages land in $JHT_HOME/.local/lib/python3.X/
    # site-packages, shared across every Scout/Writer/Critic instance.
    # No more per-agent .venv duplication, no more `sudo pip install`
    # into the system site-packages (sudo on pip is now blocked, see
    # the sudoers whitelist further down).
    PYTHONUSERBASE=/jht_home/.local \
    # Don't write .pyc / __pycache__ at all. Without this, every import in
    # an agent shell creates bytecode side-by-side with the .py file —
    # /jht_home/.local accumulated 85 MB across 448 __pycache__ dirs in
    # under a week. Bytecode buys nothing for our long-running agent
    # processes (the import-time cost is paid once at startup, not per
    # request) and the cleanup is a recurring tax we'd rather not pay.
    PYTHONDONTWRITEBYTECODE=1 \
    # Pin Playwright browsers to /opt/playwright (baked into the image)
    # instead of the default $HOME/.cache/ms-playwright. With our setup
    # HOME=/jht_home in every agent shell, that path is bind-mounted to
    # the user's host ~/.jht/.cache/ — and Playwright's first-run
    # auto-install was depositing ~928M (full Chromium + headless shell
    # + ffmpeg) into the user's home on every fresh container.
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    # Agent CLIs (claude, codex, kimi) are NOT baked into the image: they
    # are installed lazily on first run. They used to land in
    # /jht_home/.npm-global, on the bind-mount — which on Windows is C:\
    # seen through WSL2, where writing costs ~158x more than the container
    # disk (measured on a T440s: 200 small files, 11,209 ms vs 71 ms). npm
    # and uv create tens of thousands of tiny files, so installing one CLI
    # went from half a minute on Linux to an endless wait on Windows.
    # /opt/jht-deps is the agents' writable prefix and is a Docker volume
    # in compose, so installs still survive container recreation.
    NPM_CONFIG_PREFIX=/opt/jht-deps/npm-global \
    NPM_CONFIG_CACHE=/opt/jht-deps/npm-cache \
    UV_TOOL_DIR=/opt/jht-deps/uv-tools \
    UV_TOOL_BIN_DIR=/opt/jht-deps/bin \
    UV_CACHE_DIR=/opt/jht-deps/uv-cache \
    # /opt/jht-deps — prefisso GLOBALE scrivibile dagli agenti per gli extra
    # che non rientrano nelle lane standard (apt→sistema, uv→python user,
    # npm→node): binari in bin/, librerie in lib/. Baked nell'immagine con
    # ownership jht così TUTTI gli agenti installano nello STESSO posto
    # (niente più deps sparpagliati per cartelle diverse). È la "freedom
    # standardizzata" del redesign Mantenitore: il wrapper `jht-install`
    # instrada qui ciò che non ha una lane dedicata. LD_LIBRARY_PATH copre
    # le .so installate qui senza toccare il sistema.
    JHT_DEPS_PREFIX=/opt/jht-deps \
    LD_LIBRARY_PATH=/opt/jht-deps/lib \
    # /app/agents/_tools contiene wrapper come `jht-send` che gli agenti
    # usano per scrivere in chat.jsonl. Va nel PATH del container (non solo
    # nel tmux pane) così anche i sub-shell spawnati da Codex/Kimi --yolo
    # lo trovano senza dipendere dall'export re-inviato via send-keys.
    # Display X dello schermo live (.launcher/live-screen.sh). Esportato per
    # tutta l'immagine, non solo per pid1: un browser headed del CLOSER può
    # partire dal pane tmux di un agente o da un `docker exec`, e in entrambi i
    # casi deve aprirsi sullo schermo che l'utente guarda. Ai browser headless
    # (linkedin_check.py & co.) DISPLAY è indifferente.
    DISPLAY=:99 \
    PATH=/app/agents/_tools:/opt/jht-deps/bin:/opt/jht-deps/npm-global/bin:/opt/jht-deps/python/bin:/jht_home/.npm-global/bin:/home/jht/.local/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip \
      tmux git bash curl ca-certificates \
      # build-essential + pkg-config servono SOLO a compilare le wheel che pip
      # non trova precompilate (lxml & co.) durante il `pip3 install` più sotto:
      # sono rimossi nello STESSO layer del pip install (~250MB in meno
      # nell'immagine finale). Non aggiungere qui roba che serve a runtime
      # aspettandosi che sopravviva.
      build-essential pkg-config \
      libsqlite3-0 \
      tini \
      # procps = ps/free/top/vmstat. Senza, `free(1)` manca: il Mantenitore lo
      # reinstallava a OGNI sweep e host_vitals.py perdeva il fallback RAM da
      # /proc. Baked qui = niente reinstall quotidiana.
      procps \
      # Toolbox "agent-friendly": gli agenti Codex/Kimi/Claude vedono
      # spesso PDF (CV, lettere), pagine web, JSON complessi. Senza questi
      # tool scrivevano parser PDF in Python puro impiegando minuti invece
      # di secondi. File/jq/unzip coprono il 90% dei casi. Sudo + passwordless
      # (più sotto) permette di installare il resto on-demand.
      poppler-utils ripgrep file jq unzip sudo \
      # Multimodal user input: l'utente puo' mandare voice notes (ogg/mp3)
      # e foto/scansioni di documenti (CV cartacei, certificati). ffmpeg per
      # decodificare audio in formato Whisper-compatibile, tesseract-ocr per
      # fallback OCR su scansioni a bassa qualita' (quando il LLM multimodal
      # non basta). Whisper STT NON pre-installato (~1GB modelli): l'Assistente
      # lo installa on-demand via `uv pip install faster-whisper` alla prima
      # voice note (vedi RULE-T15 self-extension principle).
      ffmpeg tesseract-ocr \
      # Librerie di sistema runtime di Chromium (headless shell). `playwright
      # install --with-deps` più sotto DOVREBBE installarle, ma sul runner CI
      # il browser risultava BROKEN (libatk-1.0/libnss3/libgbm/libasound
      # mancanti) → il build-time GATE (tool_health.py) andava rosso. Le
      # ancoriamo qui esplicitamente così sono garantite a prescindere da
      # --with-deps: il binario chromium-headless-shell le linka a runtime.
      libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
      libnss3 libnspr4 libcups2 libdrm2 libgbm1 libasound2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libpango-1.0-0 libcairo2 libdbus-1-3 \
      # Schermo live del CLOSER (.launcher/live-screen.sh): display X virtuale
      # su cui il browser gira headed, x11vnc che lo legge in sola visione e
      # websockify che lo porta all'app desktop. NON il pacchetto `novnc`: in
      # bookworm dipende da `nodejs` e `libnode` di Debian, un secondo Node
      # accanto a quello dell'immagine; il client VNC vive nell'app desktop.
      xvfb x11vnc python3-websockify \
      # CV impaginati dello SCRITTORE (skill cv-structure, shared/skills/pdf_gen.py):
      # `pandoc input.md -o out.pdf --pdf-engine=wkhtmltopdf`. L'immagine non li
      # aveva MAI installati: nel container lo SCRITTORE non produceva il PDF
      # del CV e ripiegava su testo o su fpdf2 a una pagina, che pdf_gen.py
      # rifiuta apposta per i CV. Nel layer finale ~+338 MB non compressi,
      # ~+87 MB compressi (51 pacchetti, misurati su arm64 sopra questo stesso
      # set: le librerie X/Qt gia' presenti per Chromium e Xvfb ne coprono una
      # parte). Gate di render vero piu' sotto.
      pandoc wkhtmltopdf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY cli/package.json cli/package-lock.json* ./cli/

# web/ NON è installato nel container: la dashboard web locale è stata
# ritirata (2026-07-23) e niente qui dentro avvia Next.js — le sue dipendenze
# (Next/React/eslint/tailwind, ~centinaia di MB) erano peso morto. Il web gira
# solo in cloud, buildato altrove. /app/web/.next viene comunque creata più
# sotto per il fix-ownership del vecchio compose dev (Leone 24/07).
#
# tui/ non compare più: smesso di compilarla qui il 2026-07-25, rimossa dal
# repo lo stesso giorno. Nessun `bin`, nessun `main`, zero invocatori — era
# install + build TypeScript a ogni immagine per una schermata che nessuno
# poteva aprire. Il cockpit del team è l'ufficio Godot; il resto è questo CLI.
RUN npm ci --prefix cli \
    && npm cache clean --force

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt \
    # Pre-install the headless shell (used by linkedin_check.py with
    # headless=True). The full Chromium build was removed as 602M of dead
    # weight and is installed again right below for the headed CLOSER browser.
    # --with-deps is MANDATORY: the shell binary links libatk-1.0.so.0,
    # libnss3, libcups, etc. Without the OS deps the binary exists but
    # exits 127 on launch → linkedin_check.py dies → LinkedIn open-checks
    # (~68% of sources) silently report new=0 / "queue exhausted" fleet-wide.
    # install-deps runs its own apt-get update, so the apt lists cleaned
    # above are repopulated here; we clean them again to keep the layer slim.
    && playwright install --with-deps --only-shell chromium \
    # The full Chromium build is back, for ONE caller: apply_flow.py --headful,
    # the CLOSER browser the user watches on the live screen. The headless
    # shell cannot draw to a display, and Playwright launches the full build
    # whenever headless=False. linkedin_check.py keeps using the shell.
    && playwright install chromium \
    # Drop the C toolchain: it only existed to compile the wheels installed
    # above (nothing in the runtime image compiles anything), and it is ~250MB.
    # The purge MUST live in this same RUN: in a separate one the files would
    # stay in the previous layer and the image would not shrink by a byte.
    # autoremove sweeps the transitive dev packages (gcc, libc6-dev, …) that
    # nothing else pulls in — packages installed explicitly above are flagged
    # manual and survive it.
    && apt-get purge -y build-essential pkg-config \
    && apt-get autoremove -y --purge \
    && rm -rf /var/lib/apt/lists/*

COPY . .

# Normalizza i line-ending degli script ESEGUIBILI degli agenti — quelli SENZA
# estensione (jht-send, jht-tmux-send, wrapper in _tools/): su un checkout
# Windows git li materializza CRLF e il container Linux fallisce l'exec con
# `/usr/bin/env: 'bash\r': No such file or directory` → chat rotta, tool morti.
# I file .sh sono già LF via .gitattributes; questi no-extension sfuggono a
# quelle regole. sed idempotente e host-agnostico (no-op su un checkout LF).
RUN find /app/agents/_tools -type f -exec sed -i 's/\r$//' {} + \
    && find /app/agents/_skills -type f -name 'jht-*' -exec sed -i 's/\r$//' {} +

# Build-time GATE (redesign tool-health 2026-06-13). The libatk regression
# shipped a browser that exists but exits 127 on launch, and stayed invisible
# in prod for hours (surfaced only as analyst "new=0" reports). This step
# launches chromium headless FOR REAL via the exact path linkedin_check.py
# uses (Python playwright, headless, --only-shell baked above): if a system
# .so is missing, the BUILD goes red here instead of prod. tool_health.py
# exits 1 on any BROKEN tool. "Never again a silent libatk."
RUN python3 shared/skills/tool_health.py --only playwright_browser \
    || { echo "BUILD GATE FAILED: chromium headless cannot launch — missing system libs (libatk/nss/gbm/asound)? See shared/skills/tool_health.py" >&2; exit 1; }

# Same gate for the live screen: the headed build (apply_flow.py --headful)
# must open a window on a real X display. A missing full Chromium or a broken
# Xvfb fails the BUILD, not the first application the user wanted to watch.
# Xvfb is started directly: xvfb-run waits for a signal that never reaches it
# when the shell is PID 1 of a build step, and hangs.
# Under QEMU the check proves nothing about the product: the multi-arch build
# emulates linux/arm64 on an amd64 runner, where Chromium cannot ptrace and its
# GPU process never starts — the gate went red on every build from 17ed183cb
# while the amd64 layer printed HEADED_LAUNCH_OK. So it runs where the build
# architecture IS the target (amd64, the VPS image) and says so when it skips.
# A native arm64 build (Colima on Apple Silicon) still runs it.
ARG TARGETARCH
ARG BUILDARCH
RUN Xvfb :98 -screen 0 1280x1024x24 -nolisten tcp & xvfb_pid=$!; \
    for _ in $(seq 1 100); do [ -S /tmp/.X11-unix/X98 ] && break; sleep 0.1; done; \
    if [ -n "$TARGETARCH" ] && [ -n "$BUILDARCH" ] && [ "$TARGETARCH" != "$BUILDARCH" ]; then \
      echo "HEADED_LAUNCH_SKIPPED: emulated $TARGETARCH build on $BUILDARCH (QEMU cannot run headed Chromium)"; rc=0; \
    else \
      DISPLAY=:98 python3 -c "from playwright.sync_api import sync_playwright as s; p = s().start(); b = p.chromium.launch(headless=False, args=['--no-sandbox', '--disable-dev-shm-usage']); b.new_page().set_content('<p>live screen</p>'); b.close(); p.stop(); print('HEADED_LAUNCH_OK')"; \
      rc=$?; \
    fi; \
    kill "$xvfb_pid"; rm -f /tmp/.X98-lock /tmp/.X11-unix/X98; \
    [ "$rc" -eq 0 ] || { echo "BUILD GATE FAILED: headed chromium cannot open on Xvfb — see .launcher/live-screen.sh" >&2; exit 1; }

# Build-time GATE for the Writer's CVs: a REAL `pandoc ... --pdf-engine=
# wkhtmltopdf` render through tool_health.py (the same check the Maintainer's
# sweep runs), failing the build if no non-empty PDF comes out. Two facts
# measured on node:22-bookworm-slim, pandoc 2.17 + wkhtmltopdf 0.12.6:
#   - no display is needed: the Debian wkhtmltopdf renders headless, also with
#     the image-wide DISPLAY=:99 pointing at an X server that is not running,
#     so no QT_QPA_PLATFORM override;
#   - pandoc writes its intermediate HTML in the CURRENT directory: from a cwd
#     the user cannot write (`/` for uid jht) it fails with "openTempFile:
#     permission denied". tool_health.py renders inside a temp dir for that.
# Under QEMU pandoc does not run at all: the GHC runtime is SIGKILLed (137)
# even on `pandoc --version`, while wkhtmltopdf renders fine. So, as for the
# headed gate above, the full chain runs where the build architecture IS the
# target (amd64, the VPS image; a native arm64 build too); the emulated layer
# still proves wkhtmltopdf renders a PDF and that the pandoc binary is there,
# and says so.
RUN if [ -n "$TARGETARCH" ] && [ -n "$BUILDARCH" ] && [ "$TARGETARCH" != "$BUILDARCH" ]; then \
      gate_dir="$(mktemp -d)" \
      && printf '<h1>JHT CV build gate</h1><p>àèìòù €</p>' > "$gate_dir/gate.html" \
      && wkhtmltopdf --quiet "$gate_dir/gate.html" "$gate_dir/gate.pdf" \
      && [ -s "$gate_dir/gate.pdf" ] && [ "$(head -c 4 "$gate_dir/gate.pdf")" = "%PDF" ] \
      && [ -x "$(command -v pandoc)" ] \
      && echo "CV_PDF_RENDER_EMULATED: wkhtmltopdf rendered and pandoc is installed; pandoc cannot run under QEMU ($TARGETARCH on $BUILDARCH)" \
      && rm -rf "$gate_dir"; \
    else \
      python3 shared/skills/tool_health.py --only cv_pdf_render; \
    fi \
    || { echo "BUILD GATE FAILED: pandoc + wkhtmltopdf cannot render a CV PDF — see shared/skills/tool_health.py (cv_pdf_render)" >&2; exit 1; }

RUN for pkg in shared/*/package.json; do \
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
    # /opt/jht-deps (bin+lib): prefisso globale scrivibile per gli extra,
    # ownership jht così gli agenti ci installano senza root (vedi ENV).
    && mkdir -p /opt/jht-deps/bin /opt/jht-deps/lib \
    # NIENTE /app nel chown -R: cambiare owner ricorsivamente a /app (codice +
    # node_modules, >1GB) DUPLICAVA l'intero albero in un layer nuovo (~1.7GB
    # di spreco, copy-on-write). /app è read-only per gli agenti — girano come
    # jht e LEGGONO il codice, scrivono solo in /jht_home, /opt/jht-deps e
    # /jht_home/.npm-global (mai in /app). L'unica eccezione scrivibile,
    # /app/web/.next, è chownata separatamente più sotto (Leone 24/07).
    # Le sottocartelle del prefisso vanno CREATE qui: quando compose ci
    # monta sopra il volume vuoto, Docker ne copia contenuto e ownership —
    # e senza queste il volume nascerebbe di root, con npm in EACCES.
    && mkdir -p /opt/jht-deps/bin /opt/jht-deps/lib /opt/jht-deps/npm-global \
         /opt/jht-deps/npm-cache /opt/jht-deps/uv-tools /opt/jht-deps/uv-cache \
         /opt/jht-deps/python \
    && chown -R jht:jht /jht_home /jht_user /opt/jht-deps \
    # /opt/playwright: ricorsivo su tutto TRANNE il Chromium completo del
    # CLOSER (chromium-<rev>). Un chown -R copia ogni file toccato in questo
    # layer (copy-on-write, lo stesso motivo per cui /app è escluso sopra):
    # sui 624M del Chromium completo erano +656M di immagine per un solo
    # cambio di proprietario. Il browser si lancia da jht anche se resta di
    # root, perché serve leggerlo ed eseguirlo, non scriverlo.
    && chown jht:jht /opt/playwright \
    && find /opt/playwright -mindepth 1 -maxdepth 1 ! -name 'chromium-[0-9]*' \
         -exec chown -R jht:jht {} + \
    # Espone i tool degli agenti (es. jht-send) in /usr/local/bin così
    # sono trovati anche dalle sub-shell login che Codex/Kimi --yolo
    # spawnano con PATH ripulito da /etc/login.defs. Senza questo,
    # PATH del Dockerfile (/app/agents/_tools:...) viene ignorato dai
    # bash -l -c "..." figli.
    && for f in /app/agents/_tools/*; do \
         [ -x "$f" ] && ln -sf "$f" "/usr/local/bin/$(basename "$f")"; \
       done \
    # Stessa logica per gli script colocated dentro le skill
    # (agents/_skills/<skill>/jht-*): permettono di tenere SKILL.md + binario
    # nello stesso folder (es. tmux-send/jht-tmux-send) senza perdere
    # l'esposizione su PATH.
    && for f in /app/agents/_skills/*/jht-*; do \
	     if [ -x "$f" ]; then \
	       name="$(basename "$f")"; name="${name%.py}"; \
	       ln -sf "$f" "/usr/local/bin/$name"; \
	     fi; \
       done \
    # Skill discovery: per-agente, popolato dal launcher.
    # `agents/_skills/` è la library (single source of truth). Il manifest
    # `agents/<role>/skills.list` dichiara quali skill l'agente consuma;
    # `start-agent.sh` legge il manifest e copia le skill richieste in
    # `~/.claude/skills/` (Claude Code) e `~/.agents/skills/` (Codex/Kimi)
    # del workspace runtime. Le skill private restano sotto
    # `agents/<role>/_skills/` e vengono copiate sempre, senza manifest.
    # Niente farm globale qui: ogni agente vede solo ciò che gli serve.
    # Passwordless sudo ristretto (RULE-T13): gli agenti girano con
    # --yolo in container disposable e fino al 2026-05-02 avevano sudo
    # ALL. Conseguenza: ogni Scrittore/Critico installava pacchetti
    # python via `sudo pip install` direttamente nel system site-packages
    # (e ognuno dove gli pareva), accumulando 5 librerie PDF doppie e
    # ~400M di drift in $JHT_HOME/.local. Whitelist stretta: apt-get/apt
    # per system tools (pdftohtml, tesseract...) restano permessi; pip e
    # venv NO via sudo. Le install Python passano per `uv pip install
    # --user` che scrive in $PYTHONUSERBASE = $JHT_HOME/.local — un
    # solo magazzino, cache wheel condivisa via $JHT_HOME/.cache/uv,
    # niente duplicati cross-agente.
    && echo 'jht ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/bin/apt-cache, /bin/mkdir, /bin/chown, /bin/ln' > /etc/sudoers.d/jht \
    && chmod 0440 /etc/sudoers.d/jht \
    # Pre-crea /app/web/.next vuota ma con ownership jht. Serve per il
    # compose dev dove mascheriamo .next con anonymous volume: Docker
    # copia le perms della dir "sorgente" nel volume, quindi se qui fosse
    # mancante o root-owned il volume nascerebbe non-scrivibile da jht
    # e Next.js crasha con "EACCES: mkdir '/app/web/.next/dev'".
    && mkdir -p /app/web/.next \
    && chown jht:jht /app/web/.next

USER jht

# Nessuna porta esposta: la dashboard web locale e' stata ritirata
# (2026-07-23) — l'interazione passa dall'app desktop via docker exec.

VOLUME ["/jht_home", "/jht_user"]

# Il wrapper (sempre utente jht) ripara l'ownership dei bind-mount quando il
# host non la mappa (Docker Desktop su Windows/WSL2) e poi exec-a la CLI.
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/.launcher/entrypoint.sh"]
CMD ["--help"]
