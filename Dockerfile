# Scoped interactive assisted-browser test candidate.
# Packages/browsers are inherited unchanged; runtime is maintenance by default.
FROM ghcr.io/leopu00/jht@sha256:265f5bd491ea06802ba6979d49c77e05721db9c80b9092f7ca73a4e4fafe64ae

COPY --chown=0:0 .launcher/spawn-lib.sh /app/.launcher/spawn-lib.sh
COPY --chown=0:0 .launcher/start-agent.sh /app/.launcher/start-agent.sh
COPY --chown=0:0 agents/_skills/chat-worker/SKILL.de.md /app/agents/_skills/chat-worker/SKILL.de.md
COPY --chown=0:0 agents/_skills/chat-worker/SKILL.es.md /app/agents/_skills/chat-worker/SKILL.es.md
COPY --chown=0:0 agents/_skills/chat-worker/SKILL.fr.md /app/agents/_skills/chat-worker/SKILL.fr.md
COPY --chown=0:0 agents/_skills/chat-worker/SKILL.hu.md /app/agents/_skills/chat-worker/SKILL.hu.md
COPY --chown=0:0 agents/_skills/chat-worker/SKILL.it.md /app/agents/_skills/chat-worker/SKILL.it.md
COPY --chown=0:0 agents/_skills/chat-worker/SKILL.md /app/agents/_skills/chat-worker/SKILL.md
COPY --chown=0:0 agents/_skills/chat-worker/SKILL.pt.md /app/agents/_skills/chat-worker/SKILL.pt.md
COPY --chown=0:0 docs/internal/closer-interactive.md /app/docs/internal/closer-interactive.md
COPY --chown=0:0 shared/skills/application_answers.py /app/shared/skills/application_answers.py
COPY --chown=0:0 shared/skills/apply_assisted.py /app/shared/skills/apply_assisted.py
COPY --chown=0:0 shared/skills/apply_flow.py /app/shared/skills/apply_flow.py
COPY --chown=0:0 shared/skills/apply_gate.py /app/shared/skills/apply_gate.py
COPY --chown=0:0 shared/skills/closer_desktop_rfb.py /app/shared/skills/closer_desktop_rfb.py
COPY --chown=0:0 shared/skills/closer_interactive.py /app/shared/skills/closer_interactive.py
COPY --chown=0:0 shared/skills/closer_interactive_screen.py /app/shared/skills/closer_interactive_screen.py
COPY --chown=0:0 .launcher/entrypoint.sh /app/.launcher/entrypoint.sh
COPY --chown=0:0 docs/internal/assisted-desktop-app-binding.md /app/docs/internal/assisted-desktop-app-binding.md
COPY --chown=0:0 docs/internal/closer-interactive-package.md /app/docs/internal/closer-interactive-package.md
COPY --chown=0:0 ops/closer-interactive/runtime-source.json ops/closer-interactive/lifecycle-contract.json ops/closer-interactive/app-runtime-resources.json /app/ops/closer-interactive/

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

# Same gate for the manual LinkedIn sign-in: the system Chromium (never Chrome
# for Testing) must start and render a page, and a window manager must exist.
# Skipped only on an emulated build, like the headed gate above.
RUN if [ -n "$TARGETARCH" ] && [ -n "$BUILDARCH" ] && [ "$TARGETARCH" != "$BUILDARCH" ]; then \
      echo "MANUAL_LOGIN_BROWSER_SKIPPED: emulated $TARGETARCH build on $BUILDARCH"; \
    else \
      python3 shared/skills/tool_health.py --only manual_login_browser \
      || { echo "BUILD GATE FAILED: no system Chromium or window manager for the manual LinkedIn sign-in — see shared/skills/linkedin_apply.py" >&2; exit 1; }; \
    fi

# Explicit inert default; controlled owners use reviewed exec only.
USER 1001:1001
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/bin/sleep"]
CMD ["infinity"]
