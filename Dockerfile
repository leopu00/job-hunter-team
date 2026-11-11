# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Runtime container                                     ║
# ║  Immagine agenti + CLI (interazione via app desktop, no web locale).     ║
# ║  Stato persistente nei bind-mount /jht_home e /jht_user.                 ║
# ╚══════════════════════════════════════════════════════════════════════════╝
# ONE Dockerfile, TWO images (JHT-T307 A): `core` has what the Assistente, the broker and Pi
# need in the first minutes, `full` is `core` plus the tools that arrive later (browsers,
# CV PDF, X). Plain `docker build .` builds `full`: exactly the image of before.
#
#   prefix-core -> prefix-full          the stable prefix: heavy layers that change with a
#   prefix-core -> prefix-extras        pin, not with a release. Each sets JHT_IMAGE_TIER.
#   runtime (FROM ${BASE})              code, Pi, users, gates: built once on each prefix.
#
#   docker build --target runtime --build-arg BASE=prefix-core .    -> core
#   docker build --target runtime --build-arg BASE=prefix-extras .   -> extras
#   docker build --target runtime .                                  -> full
#
# The tier is NOT a build argument of the runtime stage: it is the ENV the prefix carries,
# so an image cannot say `core` over the tools of `full` (or the other way round) and hide a
# real fault. BASE may also be an image by digest (`ghcr.io/...@sha256:...`), never a tag.
ARG BASE=prefix-full

# Base image pinned by digest (multi-arch index). Update tracked by
# Renovate (.github/renovate.json). Changing the tag without the digest
# silently re-introduces unverified upstream content.
FROM node:22-bookworm-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c AS prefix-core

ENV JHT_IMAGE_TIER=core \
    DEBIAN_FRONTEND=noninteractive \
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
    # No more per-agent .venv duplication, and no `sudo pip install`
    # into the system site-packages: the image has no sudo at all
    # (see further down).
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
    # Agent CLIs (claude, codex, kimi; pi is the exception, see /opt/jht-pi below)
    # are NOT baked into the image: they
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

# ── prefix-core: what the Assistente, the broker and Pi need ──────────────────────
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
      # di secondi. File/jq/unzip coprono il 90% dei casi. Niente sudo: un
      # pacchetto di sistema che serve agli agenti si aggiunge QUI (RULE-T13).
      # fd-find (the `fdfind` binary) and ripgrep are what pi looks for on the PATH:
      # without them pi downloads fd and rg from GitHub at its first start.
      poppler-utils ripgrep fd-find file jq unzip \
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

# ── prefix-full: the tools that arrive after the onboarding ───────────────────────
# Heavy layers (browsers, CV PDF, X) that change with a pin, not with a release: they sit
# BELOW the code, so an update never downloads them again.
FROM prefix-core AS prefix-full
ENV JHT_IMAGE_TIER=full

RUN apt-get update && apt-get install -y --no-install-recommends \
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
      # LinkedIn sign-in BY HAND (linkedin_apply.py login --interactive): the
      # user signs in once, with Google, in a browser a person uses. Not
      # Playwright's Chrome for Testing: its "only for automated testing" build
      # left Google's sign-in popup (accounts.google.com/gsi/select) blank in
      # three live attempts (14/09). Debian's chromium draws it, and openbox
      # gives the popup a window to live in. Checked by the manual_login_browser
      # gate below.
      chromium openbox \
      # CV PDF (skill cv-structure): pandoc -> HTML -> wkhtmltopdf. Were never
      # baked: they came from an agent's `sudo apt-get` inside a running
      # container, so every recreate lost them in silence and the Writer found
      # only weasyprint. Checked by the cv_pdf_render build gate below.
      pandoc wkhtmltopdf \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-tools.txt ./
RUN pip3 install --no-cache-dir -r requirements-tools.txt \
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
    && rm -rf /var/lib/apt/lists/*

# ── prefix-extras: the three tools the user asks for, on the core and not on the full image ────────────────────────
# The manual LinkedIn sign-in (Debian's chromium + openbox), the live screen of the CLOSER (Xvfb + x11vnc + websockify, and the
# full Chromium build of Playwright for the headed browser) and the media tools (ffmpeg + tesseract). They run in containers of
# their own, started on request from this image (one image, three entrypoints), so the tier is `extras` and not `full`: no
# headless shell (the scout's), no CV PDF toolchain. Until the tools leave `prefix-full` (P1b) the lists below are the same ones.
FROM prefix-core AS prefix-extras
ENV JHT_IMAGE_TIER=extras

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg tesseract-ocr \
      libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
      libnss3 libnspr4 libcups2 libdrm2 libgbm1 libasound2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libpango-1.0-0 libcairo2 libdbus-1-3 \
      xvfb x11vnc python3-websockify \
      chromium openbox \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-tools.txt ./
# --no-shell: the full Chromium build only (the headed browser of the CLOSER); the headless shell stays in the full image.
RUN pip3 install --no-cache-dir -r requirements-tools.txt \
    && playwright install --with-deps --no-shell chromium \
    && rm -rf /var/lib/apt/lists/*

# ── runtime: code, Pi, users, gates — built once on each prefix ───────────────────
# BASE is a stage (`prefix-core`, `prefix-full`) or an image by digest. The tier of the
# image is the one its BASE carries (ENV JHT_IMAGE_TIER above).
FROM ${BASE} AS runtime

COPY . .

# The browser of the manual sign-in must not keep what the person types: the profile sits under ~/.jht, which the agents read, and an
# accepted «Save password?» would leave the password in Default/Login Data. Managed policy of Chromium (it wins over any user setting),
# in every tier: password manager, address and card autofill off, no sync, no sign-in to the browser itself (the web sign-in of Google
# is not that). Tested in tests/test_login_chromium_policy.py.
COPY shared/login/chromium-policy.json /etc/chromium/policies/managed/jht-login.json

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

# Same gate for the CV PDF: render a synthetic CV with the cv-structure command
# (pandoc + wkhtmltopdf + pdf_layout_base.css) and measure it with pdf_layout_check.py.
# A missing binary, or a layout back to a narrow centred column, fails the
# BUILD instead of the first CV a CLOSER attaches.
RUN python3 shared/skills/tool_health.py --only cv_pdf_render \
    || { echo "BUILD GATE FAILED: CV PDF toolchain broken (pandoc/wkhtmltopdf/poppler) or the render is not full width — see shared/skills/tool_health.py" >&2; exit 1; }

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
RUN if [ "$JHT_IMAGE_TIER" = core ]; then echo "HEADED_LAUNCH_SKIPPED: the core image has no browser and no X"; exit 0; fi; \
    Xvfb :98 -screen 0 1280x1024x24 -nolisten tcp & xvfb_pid=$!; \
    for _ in $(seq 1 100); do [ -S /tmp/.X11-unix/X98 ] && break; sleep 0.1; done; \
    if [ -n "$TARGETARCH" ] && [ -n "$BUILDARCH" ] && [ "$TARGETARCH" != "$BUILDARCH" ]; then \
      echo "HEADED_LAUNCH_SKIPPED: emulated $TARGETARCH build on $BUILDARCH (QEMU cannot run headed Chromium)"; rc=0; \
    else \
      DISPLAY=:98 python3 -c "from playwright.sync_api import sync_playwright as s; p = s().start(); b = p.chromium.launch(headless=False, args=['--no-sandbox', '--disable-dev-shm-usage']); b.new_page().set_content('<p>live screen</p>'); b.close(); p.stop(); print('HEADED_LAUNCH_OK')"; \
      rc=$?; \
    fi; \
    kill "$xvfb_pid"; rm -f /tmp/.X98-lock /tmp/.X11-unix/X98; \
    [ "$rc" -eq 0 ] || { echo "BUILD GATE FAILED: headed chromium cannot open on Xvfb — see .launcher/live-screen.sh" >&2; exit 1; }

# Same gate for the manual LinkedIn sign-in: the system Chromium (never Chrome
# for Testing) must start and render a page, and a window manager must exist.
# Skipped only on an emulated build, like the headed gate above.
RUN if [ -n "$TARGETARCH" ] && [ -n "$BUILDARCH" ] && [ "$TARGETARCH" != "$BUILDARCH" ]; then \
      echo "MANUAL_LOGIN_BROWSER_SKIPPED: emulated $TARGETARCH build on $BUILDARCH"; \
    else \
      python3 shared/skills/tool_health.py --only manual_login_browser \
      || { echo "BUILD GATE FAILED: no system Chromium or window manager for the manual LinkedIn sign-in — see shared/skills/linkedin_apply.py" >&2; exit 1; }; \
    fi

# The tier the image declares must be the tools it carries, both ways. The core image has no
# browser, no X, no CV PDF toolchain and no media tools; the full one has them (and the gates
# above already proved they work). A wrong tier would let tool_health.py call a broken tool
# "not installed", or a tool that should not be there "fine".
RUN case "$JHT_IMAGE_TIER" in \
      core) for b in chromium openbox Xvfb x11vnc websockify pandoc wkhtmltopdf ffmpeg tesseract playwright; do \
              if command -v "$b" >/dev/null 2>&1; then echo "BUILD GATE FAILED: $b is in an image that says core" >&2; exit 1; fi; \
            done; \
            if [ -e /opt/playwright ] && [ -n "$(ls -A /opt/playwright)" ]; then echo "BUILD GATE FAILED: browsers in an image that says core" >&2; exit 1; fi ;; \
      full) for b in chromium openbox Xvfb pandoc wkhtmltopdf ffmpeg tesseract playwright; do \
              command -v "$b" >/dev/null 2>&1 || { echo "BUILD GATE FAILED: $b is missing from an image that says full" >&2; exit 1; }; \
            done ;; \
      extras) for b in chromium openbox Xvfb x11vnc websockify ffmpeg tesseract playwright; do \
                command -v "$b" >/dev/null 2>&1 || { echo "BUILD GATE FAILED: $b is missing from an image that says extras" >&2; exit 1; }; \
              done; \
              for b in pandoc wkhtmltopdf; do \
                if command -v "$b" >/dev/null 2>&1; then echo "BUILD GATE FAILED: $b (CV PDF) is in an image that says extras" >&2; exit 1; fi; \
              done; \
              if ls /opt/playwright 2>/dev/null | grep -q headless_shell; then echo "BUILD GATE FAILED: the headless shell of the scout is in an image that says extras" >&2; exit 1; fi ;; \
      *) echo "BUILD GATE FAILED: JHT_IMAGE_TIER must be core, full or extras, not '$JHT_IMAGE_TIER'" >&2; exit 1 ;; \
    esac

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

# Pi (the agent harness chosen with JHT_AGENT_HARNESS_<ROLE>=pi) IS baked into the
# image, unlike claude/codex/kimi: it installs from the reviewed lock of
# shared/runtime/pi-harness (exact version, sha512 integrity on every dependency, no
# install scripts, sha256 of the two files checked by the installer), so the first
# run does not need the network to fetch it. It lives in /opt/jht-pi, OUTSIDE the
# /opt/jht-deps volume (a volume made by an older image would hide it) and owned by
# root: the agents run it and cannot change it. The npm cache of this step stays out
# of the image.
RUN JHT_PI_PREFIX=/opt/jht-pi NPM_CONFIG_CACHE=/tmp/jht-pi-npm-cache \
      bash /app/shared/runtime/pi-harness/install-pi.sh \
    && rm -rf /tmp/jht-pi-npm-cache \
    && ln -sf /opt/jht-pi/bin/pi /usr/local/bin/pi \
    && PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 pi --version

RUN useradd --create-home --shell /bin/bash jht \
    # Il trasporto Telegram non condivide uid con gli agenti. Il gruppo serve
    # soltanto a leggere gli allegati inbound dal mount :ro; non ha scrittura.
    && groupadd --gid 1003 jhttelegram \
    && useradd --uid 1003 --gid 1003 --no-create-home --shell /usr/sbin/nologin jhttelegram \
    && usermod -aG jhttelegram jht \
    && mkdir -p /jht_home /jht_user \
    && install -d -o jhttelegram -g jhttelegram -m 0700 \
         /jht_telegram_secrets /jht_telegram_secrets/bots /jht_telegram_state \
    && install -d -o jhttelegram -g jhttelegram -m 0711 /run/jht-telegram \
    && install -d -o jhttelegram -g jhttelegram -m 0750 /jht_telegram_inbox \
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
    # /opt/playwright: la cartella resta di jht (un browser in più si installa da
    # jht), ma i browser GIA' installati restano di root: il Chromium completo
    # del CLOSER (chromium-<rev>) e la headless shell (chromium_headless_shell-
    # <rev>). Un chown -R copia ogni file toccato in questo layer (copy-on-write,
    # lo stesso motivo per cui /app è escluso sopra): il Chromium completo erano
    # +656M di immagine, la headless shell altri ~114M da scaricare a ogni primo
    # setup, per un solo cambio di proprietario. Un browser si lancia da jht
    # anche se resta di root, perché serve leggerlo ed eseguirlo, non scriverlo.
    && mkdir -p /opt/playwright \
    && chown jht:jht /opt/playwright \
    && find /opt/playwright -mindepth 1 -maxdepth 1 ! -name 'chromium-[0-9]*' \
         ! -name 'chromium_headless_shell-[0-9]*' -exec chown -R jht:jht {} + \
    # Espone i tool degli agenti (es. jht-send) in /usr/local/bin così
    # sono trovati anche dalle sub-shell login che Codex/Kimi --yolo
    # spawnano con PATH ripulito da /etc/login.defs. Senza questo,
    # PATH del Dockerfile (/app/agents/_tools:...) viene ignorato dai
    # bash -l -c "..." figli.
    # Un tool Python può chiamarsi `jht-x.py` (l'hook dei commit non accetta file
    # senza estensione fuori da un elenco): su PATH si chiama `jht-x`, come per
    # le skill qui sotto.
    && for f in /app/agents/_tools/*; do \
         if [ -x "$f" ]; then \
           name="$(basename "$f")"; name="${name%.py}"; \
           ln -sf "$f" "/usr/local/bin/$name"; \
         fi; \
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
    # La CLI stessa, per gli agenti: le skill chiamano `jht cloud quarantine`,
    # `jht cloud status`, `jht team start <ruolo>`. L'immagine non l'ha mai
    # esposta (l'entrypoint la lancia per percorso): su una VPS c'era solo
    # perché aggiunta a mano nel container, e col container ricreato il
    # 27/09 è sparita, e con lei quei comandi.
    && ln -sf /app/cli/bin/jht.js /usr/local/bin/jht \
    && ln -sf /app/shared/telegram_service/bin/jht-telegram-service.py /usr/local/bin/jht-telegram-service \
    && ln -sf /app/shared/telegram_service/bin/jht-telegram-admin.py /usr/local/bin/jht-telegram-admin \
    && ln -sf /app/shared/telegram_service/bin/jht-telegram-client.py /usr/local/bin/jht-telegram-client \
    && ln -sf /app/shared/telegram_service/bin/jht-telegram-legacy.py /usr/local/bin/jht-telegram-legacy \
    # Skill discovery: per-agente, popolato dal launcher.
    # `agents/_skills/` è la library (single source of truth). Il manifest
    # `agents/<role>/skills.list` dichiara quali skill l'agente consuma;
    # `start-agent.sh` legge il manifest e copia le skill richieste in
    # `~/.claude/skills/` (Claude Code) e `~/.agents/skills/` (Codex/Kimi)
    # del workspace runtime. Le skill private restano sotto
    # `agents/<role>/_skills/` e vengono copiate sempre, senza manifest.
    # Niente farm globale qui: ogni agente vede solo ciò che gli serve.
    # NIENTE sudo agli agenti (P1 del 08/10). La whitelist che c'era qui
    # (apt-get, apt, chown, mkdir, ln senza password) era root: `apt-get -o
    # APT::Update::Pre-Invoke::=<cmd>` e `chown` bastano a prendersi il
    # container, e con Docker rootful su Linux un file di root nel bind
    # di ~/.jht arriva sull'host. Gli agenti girano con --yolo e leggono
    # testo esterno: la shell di un agente non deve diventare root.
    # I pacchetti di sistema stanno nell'immagine (sopra); le librerie
    # Python passano per `uv pip install --user` in $JHT_HOME/.local
    # (RULE-T13), che non ha mai avuto bisogno di root. La riparazione dei
    # mount di Docker Desktop per Windows la fa l'host prima di `up`.
    && rm -f /etc/sudoers.d/jht \
    && if command -v sudo >/dev/null 2>&1 || [ -e /etc/sudoers.d/jht ]; then \
         echo "GATE: sudo must not be in the image" >&2; exit 1; \
       fi \
    # Pre-crea /app/web/.next vuota ma con ownership jht. Serve per il
    # compose dev dove mascheriamo .next con anonymous volume: Docker
    # copia le perms della dir "sorgente" nel volume, quindi se qui fosse
    # mancante o root-owned il volume nascerebbe non-scrivibile da jht
    # e Next.js crasha con "EACCES: mkdir '/app/web/.next/dev'".
    && mkdir -p /app/web/.next \
    && chown jht:jht /app/web/.next \
    # The two folders the media container shares with jht (named volumes copy owner and mode of the folder on first use).
    && mkdir -p /jht_media/in /jht_media/out \
    && chown jht:jht /jht_media /jht_media/in /jht_media/out \
    && chmod 0755 /jht_media /jht_media/in /jht_media/out \
    # The folder the volume of the closer's Chromium is mounted on, made here for the same reason (owner and mode are copied on first use).
    && mkdir -p /opt/playwright-extras \
    && chown jht:jht /opt/playwright-extras \
    && chmod 0755 /opt/playwright-extras \
    # Where the X socket of the live screen is: the sticky world-writable folder X wants, made here so the volume that holds the socket
    # (shared by jht and jht-screen) takes it on first use.
    && mkdir -p /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix \
    # The folders of sockets of the manual sign-in to LinkedIn (each volume takes owner and mode from the one in the image on first use).
    && mkdir -p /ipc/vnc /ipc/egress \
    && chown jht:jht /ipc /ipc/vnc /ipc/egress \
    && chmod 0700 /ipc/vnc /ipc/egress

# Broker of the portal secrets (P1 del 08/10): un secondo container della
# stessa immagine, con un uid suo. I tre mount point nascono qui con il
# proprietario giusto, perché un volume con nome vuoto ne copia proprietario e
# permessi al primo mount. Segreti e stato: 0700 del broker. Socket: 0711, gli
# agenti attraversano la cartella ma non la elencano; chi parla lo decide
# SO_PEERCRED nel broker, non i permessi.
RUN useradd --uid 1002 --user-group --no-create-home --home-dir /nonexistent \
        --shell /usr/sbin/nologin jhtbroker \
    && install -d -o jhtbroker -g jhtbroker -m 0700 /jht_secrets /jht_broker_state \
    && install -d -o jhtbroker -g jhtbroker -m 0711 /run/jht-broker /run/jht-broker-telegram \
    && ln -sf /app/shared/broker/bin/jht-broker.py /usr/local/bin/jht-broker \
    && ln -sf /app/shared/broker/bin/jht-broker-admin.py /usr/local/bin/jht-broker-admin

USER jht

# GATE, come l'utente degli agenti: `sudo -n true` deve fallire. I setuid di
# sistema che restano (su, passwd, mount) li spegne no-new-privileges nel compose.
RUN if sudo -n true 2>/dev/null; then echo "GATE: jht can sudo" >&2; exit 1; fi

# Nessuna porta esposta: la dashboard web locale e' stata ritirata
# (2026-07-23) — l'interazione passa dall'app desktop via docker exec.

VOLUME ["/jht_home", "/jht_user"]

# Il wrapper (sempre utente jht) controlla che i bind-mount siano scrivibili e
# poi exec-a la CLI. La riparazione di Docker Desktop su Windows la fa l'host
# prima di `up`: qui non c'e' modo di diventare root.
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/.launcher/entrypoint.sh"]
CMD ["--help"]
