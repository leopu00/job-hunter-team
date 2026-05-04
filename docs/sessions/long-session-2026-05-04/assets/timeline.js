// Timeline page — costruisce ECharts overview, tabella finestre,
// liste per fase ("atti") e log eventi filtrabile.
//
// Round 2:
// - Multi-series ECharts (una serie per kind) → legend nativa cliccabile
// - Toolbar Tutti / Nessuno / Inverti + checkbox per categoria
// - Tooltip arricchito con content full preso da data/chat/ via prefisso
// - dataZoom: slider + inside + toolbox box-zoom + restore
// - Window-id (Kimi K2 session_id) calcolato per ogni evento e mostrato in tooltip

(async function () {
  if (!window.ReportData) return;
  const RD = window.ReportData;

  // ----- caricamento + pulizia (parse difensivo, dedup, in-window) -----
  let raw, chats;
  try {
    [raw, chats] = await Promise.all([RD.loadAll(), RD.loadChats()]);
  } catch (err) {
    console.error("timeline load failed", err);
    return;
  }

  const sentinel = raw.sentinel
    .filter((r) => r && Number.isFinite(Date.parse(r.ts)))
    .filter(RD.inSession)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const throttleClean = RD.cleanInWindow(
    raw.throttle.filter((r) => r && r.event !== "checkpoint"),
    (r) => `${r.ts}|${r.agent || ""}|${r.applied_sec || 0}|${(r.reason || "").slice(0, 30)}`
  );
  const throttle = throttleClean.records;

  const messagesClean = RD.cleanInWindow(
    raw.messages,
    (m) => `${m.ts}|${m.from || ""}|${m.to || ""}|${m.type || ""}|${(m.preview || "").slice(0, 60)}`
  );
  const messages = messagesClean.records;

  // Pulizia report (per commit message + console)
  console.log("[timeline] cleaning:", {
    sentinel_in_window: sentinel.length,
    throttle: throttleClean.stats,
    messages: messagesClean.stats,
    chat: chats.stats,
  });

  // Indice prefisso content full → preview
  const chatIdx = RD.buildChatIndex(chats.records);

  // ----- mappa session_id (finestra Kimi K2) per ogni timestamp -----
  // Sliding cursor: per ogni ts trova l'ultima session_id ≤ ts.
  const windowAnchors = []; // { ts: ms, sid }
  let prevSid = null;
  for (const r of sentinel) {
    if (r.session_id && r.session_id !== prevSid) {
      windowAnchors.push({ ts: Date.parse(r.ts), sid: r.session_id });
      prevSid = r.session_id;
    }
  }
  function windowAtTs(tsMs) {
    let chosen = null;
    for (const a of windowAnchors) {
      if (a.ts <= tsMs) chosen = a.sid;
      else break;
    }
    return chosen;
  }

  // ----- estrazione eventi -----
  const events = [];

  // 1. Transizioni di finestra
  prevSid = null;
  const windowsList = [];
  let curWin = null;
  for (const r of sentinel) {
    const sid = r.session_id;
    if (sid && sid !== prevSid) {
      const ts = Date.parse(r.ts);
      events.push({
        ts,
        kind: "window",
        label: "Nuova finestra Kimi K2",
        body: `session_id=${sid} · usage iniziale ${r.usage}% · reset@${r.reset_at}`,
        agent: null,
        windowSid: sid,
        payload: { sid, provider: r.provider, reset: r.reset_at },
      });
      curWin = { sid, provider: r.provider, first: ts, last: ts, peak: r.usage || 0, reset: r.reset_at };
      windowsList.push(curWin);
      prevSid = sid;
    } else if (curWin) {
      curWin.last = Date.parse(r.ts);
      curWin.peak = Math.max(curWin.peak, r.usage || 0);
    }
  }

  // 2. Picchi usage ≥ 90% — uno per finestra
  const peakSeen = new Set();
  for (const r of sentinel) {
    const u = Number(r.usage) || 0;
    if (u >= 90 && r.session_id && !peakSeen.has(r.session_id)) {
      peakSeen.add(r.session_id);
      const ts = Date.parse(r.ts);
      events.push({
        ts,
        kind: "peak",
        label: `Peak ${u}%`,
        body: `Finestra ${r.session_id} tocca ${u}% · proj=${r.projection}% · vel_smooth=${r.velocity_smooth}%/h`,
        agent: null,
        windowSid: r.session_id,
      });
    }
  }

  // 3. Kickoff agenti
  const kickoffSeen = new Set();
  for (const m of messages) {
    if (m.from !== "capitano" || m.type !== "MSG") continue;
    const target = m.to;
    if (!target || kickoffSeen.has(target)) continue;
    const p = m.preview || "";
    if (!/Avvia|Inizia|loop/i.test(p)) continue;
    kickoffSeen.add(target);
    const ts = Date.parse(m.ts);
    const enriched = RD.enrichPreview(p, chatIdx);
    events.push({
      ts,
      kind: "kickoff",
      label: `Kickoff → ${target}`,
      body: p.slice(0, 200),
      agent: target,
      windowSid: windowAtTs(ts),
      fullContent: enriched ? enriched.content : null,
    });
  }

  // 4. Ordini capitano (URG / WARN / FEEDBACK / FAILURE / ALERT / REPORT / DONE)
  const ORDER_TYPES = new Set(["URG", "FEEDBACK", "FAILURE", "ALERT", "WARN", "REPORT", "DONE"]);
  for (const m of messages) {
    if (m.from !== "capitano") continue;
    if (!ORDER_TYPES.has(m.type)) continue;
    const ts = Date.parse(m.ts);
    const enriched = RD.enrichPreview(m.preview || "", chatIdx);
    events.push({
      ts,
      kind: "capitano",
      label: `${m.type} → ${m.to || "?"}`,
      body: (m.preview || "").slice(0, 200),
      agent: m.to,
      msgType: m.type,
      windowSid: windowAtTs(ts),
      fullContent: enriched ? enriched.content : null,
    });
  }

  // 5. Throttle events (anche enriched dal sentinel-log se applicabile, ma il
  //    throttle file è già autosufficiente per ts/agent/applied_sec/reason).
  for (const t of throttle) {
    const ts = Date.parse(t.ts);
    events.push({
      ts,
      kind: "throttle",
      label: `Throttle ${t.agent} ${Math.round(t.applied_sec || 0)}s`,
      body: t.reason || "",
      agent: t.agent,
      windowSid: windowAtTs(ts),
      payload: { applied_sec: t.applied_sec, requested_sec: t.requested_sec, reason: t.reason },
    });
  }

  events.sort((a, b) => a.ts - b.ts);

  // ----- render -----
  renderOverviewChart(events, sentinel);
  renderWindowsTable(windowsList);
  renderPhases(events);
  renderEventLog(events);
  renderInlineCharts(sentinel, events);

  // ===================================================================

  function renderOverviewChart(events, sentinel) {
    const el = document.getElementById("timeline-chart");
    if (!el || !window.echarts) return;
    if (!el.clientWidth || !el.clientHeight) {
      requestAnimationFrame(() => renderOverviewChart(events, sentinel));
      return;
    }
    const chart = echarts.init(el, "dark", { renderer: "canvas" });

    const LANES = {
      window: { y: 5, color: "#56ccf2", emoji: "🪟", legend: "🪟 Finestra" },
      kickoff: { y: 4, color: "#6fcf97", emoji: "🚀", legend: "🚀 Kickoff" },
      capitano: { y: 3, color: "#f2994a", emoji: "🧭", legend: "🧭 Ordini Capitano" },
      throttle: { y: 2, color: "#eb5757", emoji: "⏸", legend: "⏸ Throttle" },
      peak: { y: 1, color: "#f2c94c", emoji: "🔥", legend: "🔥 Peak ≥90%" },
    };

    // Una serie per kind → legend cliccabile nativa
    const series = [];
    // Linea usage di sfondo per prima
    const usagePoints = sentinel.map((r) => [Date.parse(r.ts), (Number(r.usage) || 0) / 100 * 0.85 + 0.05]);
    series.push({
      name: "Usage finestra (sfondo)",
      type: "line",
      data: usagePoints,
      showSymbol: false,
      lineStyle: { color: "#3a4a64", width: 1.4, type: "dashed" },
      areaStyle: { color: "rgba(86,204,242,0.06)" },
      z: 1,
      tooltip: { show: true },
      yAxisIndex: 0,
    });

    for (const kind of Object.keys(LANES)) {
      const lane = LANES[kind];
      const data = events
        .filter((e) => e.kind === kind)
        .map((e) => {
          let symbolSize = 10;
          if (kind === "throttle") {
            const s = (e.payload && e.payload.applied_sec) || 60;
            symbolSize = Math.max(8, Math.min(22, 6 + Math.sqrt(s)));
          } else if (kind === "window") symbolSize = 16;
          else if (kind === "peak") symbolSize = 18;
          else if (kind === "kickoff") symbolSize = 14;
          else if (kind === "capitano") symbolSize = 11;
          return {
            value: [e.ts, lane.y],
            itemStyle: {
              color: lane.color,
              opacity: kind === "throttle" ? 0.7 : 0.95,
              borderColor: "rgba(255,255,255,0.2)",
              borderWidth: 1,
            },
            symbolSize,
            kind: e.kind,
            label: e.label,
            body: e.body,
            agent: e.agent,
            windowSid: e.windowSid,
            payload: e.payload || null,
            msgType: e.msgType,
            fullContent: e.fullContent,
          };
        });
      series.push({
        name: lane.legend,
        type: "scatter",
        data,
        z: 5,
        emphasis: {
          scale: 1.6,
          itemStyle: { borderColor: "#fff", borderWidth: 2, shadowBlur: 10, shadowColor: "rgba(255,255,255,0.4)" },
        },
      });
    }

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 110, right: 30, top: 50, bottom: 80, containLabel: false },
      legend: {
        type: "scroll",
        top: 8,
        right: 70,
        textStyle: { color: "#b9c4d4", fontSize: 12 },
        inactiveColor: "#3a4a64",
        selectedMode: true,
      },
      toolbox: {
        right: 10,
        top: 8,
        iconStyle: { borderColor: "#8a93a4" },
        feature: {
          // Solo saveAsImage: niente dataZoom box-zoom (sarebbe wheel-style)
          // né restore (gestito dal bottone ⟲ esterno).
          saveAsImage: { title: "Salva PNG", backgroundColor: "#0d0f14" },
        },
      },
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove|click",
        confine: true,
        appendToBody: true,
        backgroundColor: "rgba(17,21,30,0.97)",
        borderColor: "#3a5077",
        borderWidth: 1,
        padding: [10, 12],
        textStyle: { color: "#e8ecf3", fontSize: 13, lineHeight: 18 },
        extraCssText: "max-width: 480px; white-space: normal; box-shadow: 0 8px 24px rgba(0,0,0,0.45); z-index: 9999;",
        formatter: (p) => {
          if (!p.data) return "";
          if (p.seriesName === "Usage finestra (sfondo)") {
            const u = Math.round(((p.data[1] - 0.05) / 0.85) * 100);
            return `<div style="font-size:13px"><b>${fmtTs(p.data[0])}</b> <span style="color:#5d6c84">UTC</span></div>` +
                   `<div style="margin-top:4px"><span style="color:#8a93a4">Asse Y · Usage finestra:</span> <b style="color:#56ccf2">${u}%</b></div>` +
                   `<div style="color:#5d6c84;font-size:11px;margin-top:6px">Linea sentinella ~3 min/sample. Scala interna 5%–90% del riquadro.</div>`;
          }
          const d = p.data;
          const ts = fmtTs(d.value[0]);
          const head = {
            window: "🪟 <b>Transizione finestra Kimi K2</b>",
            kickoff: "🚀 <b>Kickoff agente</b>",
            capitano: "🧭 <b>Ordine capitano</b>",
            throttle: "⏸ <b>Throttle event</b>",
            peak: "🔥 <b>Picco usage ≥ 90%</b>",
          };
          const explain = {
            window: "Nuovo session_id: la finestra Kimi K2 è stata resettata.",
            kickoff: "Primo MSG capitano→agente: apertura del loop di lavoro.",
            capitano: "Comunicazione di tipo URG / WARN / REPORT / DONE / ALERT.",
            throttle: "Pausa applicata dal pacing-bridge per non sforare la finestra.",
            peak: "Primo tick in cui la finestra raggiunge soglia di guardia.",
          };
          let lines = [`<div style="font-size:13px"><b>${ts}</b> <span style="color:#5d6c84">UTC</span></div>`];
          lines.push(`<div style="margin-top:4px">${head[d.kind] || ""}</div>`);
          lines.push(`<div style="color:#8a93a4;font-size:12px;margin-top:2px">${explain[d.kind] || ""}</div>`);
          lines.push(`<div style="margin-top:6px;color:#d6dde9"><b>${escapeHtml(d.label)}</b></div>`);
          if (d.agent) lines.push(`<div><span style="color:#8a93a4">Agente:</span> <b style="color:${LANES[d.kind].color}">${escapeHtml(d.agent)}</b></div>`);
          if (d.windowSid) lines.push(`<div><span style="color:#8a93a4">Finestra Kimi K2:</span> <code style="color:#56ccf2">${escapeHtml(d.windowSid)}</code></div>`);
          if (d.kind === "throttle" && d.payload) {
            lines.push(`<div><span style="color:#8a93a4">Pausa applicata:</span> <b>${Math.round(d.payload.applied_sec)} s</b>` +
                       (d.payload.requested_sec && d.payload.requested_sec !== d.payload.applied_sec
                         ? ` <span style="color:#5d6c84">(richiesti ${Math.round(d.payload.requested_sec)} s)</span>`
                         : "") + "</div>");
          }
          if (d.kind === "window" && d.payload) {
            lines.push(`<div><span style="color:#8a93a4">Provider:</span> <b>${escapeHtml(d.payload.provider || "?")}</b> · <span style="color:#8a93a4">reset@</span>${escapeHtml(d.payload.reset || "?")}</div>`);
          }
          if (d.body) lines.push(`<div style="color:#94a0b4;font-size:12px;margin-top:6px">${escapeHtml(d.body)}</div>`);
          if (d.fullContent && d.fullContent.length > (d.body || "").length + 5) {
            const extra = d.fullContent.slice((d.body || "").length).slice(0, 600);
            if (extra.trim()) {
              lines.push(`<div style="margin-top:8px;padding-top:8px;border-top:1px solid #2a3550;color:#94a0b4;font-size:12px"><b style="color:#b9c4d4">📨 chat full:</b> <span style="color:#8a93a4">${escapeHtml(extra)}…</span></div>`);
            }
          }
          return lines.join("");
        },
      },
      xAxis: {
        type: "time",
        min: RD.SESSION_START,
        max: RD.SESSION_END,
        axisLabel: { color: "#8a93a4" },
        splitLine: { lineStyle: { color: "#1a1f2c" } },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 6,
        interval: 1,
        axisLabel: {
          color: "#8a93a4",
          formatter: (v) => {
            const map = { 1: "🔥 Peak", 2: "⏸ Throttle", 3: "🧭 Capitano", 4: "🚀 Kickoff", 5: "🪟 Finestra" };
            return map[v] || "";
          },
        },
        splitLine: { lineStyle: { color: "#1a1f2c" } },
      },
      dataZoom: [
        // SOLO slider visibili — niente "inside" → scroll/pinch dentro al
        // riquadro è disabilitato (no zoom accidentale da trackpad). Lo
        // user controlla zoom/pan SOLO tramite slider o bottoni esterni.
        { type: "slider", xAxisIndex: 0, height: 22, bottom: 26, backgroundColor: "rgba(0,0,0,0.2)" },
        { type: "slider", yAxisIndex: 0, width: 16, left: 86, top: 50, bottom: 80, backgroundColor: "rgba(0,0,0,0.2)" },
      ],
      series,
    });

    requestAnimationFrame(() => chart.resize());
    new ResizeObserver(() => chart.resize()).observe(el);
    window.addEventListener("resize", () => chart.resize());

    // -------- bottoni zoom + pan (X + Y), unico controllo --------
    const zoomCtl = document.getElementById("zoom-controls");
    if (zoomCtl) {
      // start/end sono percentuali 0..100. Stato corrente lo leggiamo dagli
      // slider (l'unico altro modo di muoversi è cliccarli).
      function getDz(axis) {
        const opt = chart.getOption().dataZoom || [];
        const i = opt.findIndex((d) => d && d.type === "slider" && (axis === "x" ? d.xAxisIndex === 0 : d.yAxisIndex === 0));
        if (i < 0) return [0, 100];
        return [opt[i].start ?? 0, opt[i].end ?? 100];
      }
      function shrink(start, end, factor) {
        const center = (start + end) / 2;
        const half = (end - start) / 2 / factor;
        return [Math.max(0, center - half), Math.min(100, center + half)];
      }
      // Pan: trasla la finestra mantenendo la sua larghezza, cap 0..100.
      function pan(start, end, deltaPct) {
        const range = end - start;
        let s = start + (range * deltaPct) / 100;
        let e = end + (range * deltaPct) / 100;
        if (s < 0) { e -= s; s = 0; }
        if (e > 100) { s -= (e - 100); e = 100; }
        return [s, e];
      }

      // Step dolci ~13% zoom, ~10% pan. Niente factor 50%: l'utente itera.
      const ZOOM_STEP = 1.15;
      const PAN_STEP_PCT = 10;

      function dispatchAxis(axis, start, end) {
        chart.dispatchAction({
          type: "dataZoom",
          [axis === "x" ? "xAxisIndex" : "yAxisIndex"]: 0,
          start,
          end,
        });
      }

      zoomCtl.addEventListener("click", (ev) => {
        const btn = ev.target.closest("button.zoom-btn[data-zoom]");
        if (!btn) return;
        const action = btn.dataset.zoom;
        const [xs, xe] = getDz("x");
        const [ys, ye] = getDz("y");
        if (action === "in") {
          const [nxs, nxe] = shrink(xs, xe, ZOOM_STEP);
          const [nys, nye] = shrink(ys, ye, ZOOM_STEP);
          dispatchAxis("x", nxs, nxe);
          dispatchAxis("y", nys, nye);
        } else if (action === "out") {
          const [nxs, nxe] = shrink(xs, xe, 1 / ZOOM_STEP);
          const [nys, nye] = shrink(ys, ye, 1 / ZOOM_STEP);
          dispatchAxis("x", nxs, nxe);
          dispatchAxis("y", nys, nye);
        } else if (action === "reset") {
          dispatchAxis("x", 0, 100);
          dispatchAxis("y", 0, 100);
        } else if (action === "pan-left") {
          const [s, e] = pan(xs, xe, -PAN_STEP_PCT);
          dispatchAxis("x", s, e);
        } else if (action === "pan-right") {
          const [s, e] = pan(xs, xe, +PAN_STEP_PCT);
          dispatchAxis("x", s, e);
        } else if (action === "pan-up") {
          // ECharts y crescente verso l'alto, quindi "su" = aumenta start/end
          const [s, e] = pan(ys, ye, +PAN_STEP_PCT);
          dispatchAxis("y", s, e);
        } else if (action === "pan-down") {
          const [s, e] = pan(ys, ye, -PAN_STEP_PCT);
          dispatchAxis("y", s, e);
        }
      });
    }

    // -------- toolbar Tutti / Nessuno / Inverti + checkbox --------
    const toolbar = document.getElementById("timeline-filter-toolbar");
    if (toolbar) {
      const allKinds = ["window", "kickoff", "capitano", "throttle", "peak"];
      const kindToLegendName = (k) => LANES[k].legend;

      function applyState(state) {
        // state: object kind → bool
        for (const k of allKinds) {
          const cb = toolbar.querySelector(`input[type=checkbox][data-kind="${k}"]`);
          if (cb) cb.checked = !!state[k];
          chart.dispatchAction({
            type: state[k] ? "legendSelect" : "legendUnSelect",
            name: kindToLegendName(k),
          });
        }
      }

      toolbar.addEventListener("change", (ev) => {
        const cb = ev.target.closest("input[type=checkbox][data-kind]");
        if (!cb) return;
        chart.dispatchAction({
          type: cb.checked ? "legendSelect" : "legendUnSelect",
          name: kindToLegendName(cb.dataset.kind),
        });
      });

      toolbar.addEventListener("click", (ev) => {
        const btn = ev.target.closest("button.filter-btn[data-action]");
        if (!btn) return;
        const action = btn.dataset.action;
        const cur = {};
        for (const k of allKinds) {
          const cb = toolbar.querySelector(`input[type=checkbox][data-kind="${k}"]`);
          cur[k] = cb ? cb.checked : true;
        }
        let next = {};
        if (action === "all") allKinds.forEach((k) => (next[k] = true));
        else if (action === "none") allKinds.forEach((k) => (next[k] = false));
        else if (action === "invert") allKinds.forEach((k) => (next[k] = !cur[k]));
        else return;
        applyState(next);
      });

      // Mantieni le checkbox sincrone se l'utente clicca direttamente la legenda
      // ECharts (utile quando legend abilitata).
      chart.on("legendselectchanged", (params) => {
        const sel = params.selected || {};
        for (const k of allKinds) {
          const cb = toolbar.querySelector(`input[type=checkbox][data-kind="${k}"]`);
          if (cb) cb.checked = sel[kindToLegendName(k)] !== false;
        }
      });
    }
  }

  function renderWindowsTable(windows) {
    const el = document.getElementById("windows-table");
    if (!el) return;
    const fmt = (ms) => new Date(ms).toISOString().slice(11, 19) + "Z";
    const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 10);
    const rows = [
      `<div class="row header">
        <div class="cell">Session ID</div>
        <div class="cell">Inizio</div>
        <div class="cell">Fine</div>
        <div class="cell right">Durata</div>
        <div class="cell right">Peak</div>
      </div>`,
    ];
    for (const w of windows) {
      const dur = w.last - w.first;
      const long = dur > 30 * 60 * 1000;
      const h = Math.floor(dur / 3600e3);
      const m = Math.round((dur % 3600e3) / 60e3);
      rows.push(`<div class="row ${long ? "long" : ""}">
        <div class="cell"><code>${escapeHtml(w.sid)}</code></div>
        <div class="cell">${fmtDate(w.first)} ${fmt(w.first)}</div>
        <div class="cell">${fmtDate(w.last)} ${fmt(w.last)}</div>
        <div class="cell right">${h > 0 ? h + "h " : ""}${m}m</div>
        <div class="cell right">${w.peak}%</div>
      </div>`);
    }
    el.innerHTML = rows.join("");
  }

  function renderPhases(events) {
    const PHASES = [
      { id: "phase-1-events", from: "2026-05-03T18:00:00Z", to: "2026-05-03T19:30:00Z" },
      { id: "phase-2-events", from: "2026-05-03T19:30:00Z", to: "2026-05-03T23:00:00Z" },
      { id: "phase-3-events", from: "2026-05-03T23:00:00Z", to: "2026-05-04T00:30:00Z" },
      { id: "phase-4-events", from: "2026-05-04T00:30:00Z", to: "2026-05-04T05:16:00Z" },
      { id: "phase-5-events", from: "2026-05-04T05:16:00Z", to: "2026-05-04T12:00:00Z" },
    ];
    for (const ph of PHASES) {
      const el = document.getElementById(ph.id);
      if (!el) continue;
      const from = Date.parse(ph.from);
      const to = Date.parse(ph.to);
      const sub = events.filter((e) => e.ts >= from && e.ts <= to && e.kind !== "throttle");
      const thr = events.filter((e) => e.ts >= from && e.ts <= to && e.kind === "throttle");
      const summary = thr.length
        ? `<div class="ev k-throttle"><span class="t">—</span><span class="k">SUMMARY</span><span>⏸ ${thr.length} throttle in fase (${Math.round(thr.reduce((a, b) => a + (b.payload?.applied_sec || 0), 0) / 60)} min totali)</span></div>`
        : "";
      el.innerHTML =
        summary +
        sub
          .map((e) => {
            const t = new Date(e.ts).toISOString().slice(11, 16);
            return `<div class="ev k-${e.kind}"><span class="t">${t}Z</span><span class="k">${e.kind.toUpperCase()}</span><span>${escapeHtml(e.label)} — <span style="color:#94a0b4">${escapeHtml(e.body)}</span></span></div>`;
          })
          .join("");
      if (!sub.length && !thr.length) {
        el.innerHTML = '<div class="ev"><span class="t">—</span><span class="k">—</span><span>Nessun evento rilevante in questa finestra.</span></div>';
      }
    }
  }

  function renderEventLog(events) {
    const el = document.getElementById("event-log");
    const stats = document.getElementById("filter-stats");
    const filterRow = document.getElementById("filter-row");
    if (!el || !filterRow) return;
    const active = new Set(["window", "capitano", "kickoff", "throttle", "peak"]);

    function paint() {
      const filtered = events.filter((e) => active.has(e.kind));
      el.innerHTML = filtered
        .map((e) => {
          const t = new Date(e.ts).toISOString().slice(11, 16) + "Z";
          return `<li class="k-${e.kind}"><span class="t">${t}</span><span class="k">${e.kind}</span><span class="body">${escapeHtml(e.label)} — <span style="color:#94a0b4">${escapeHtml(e.body)}</span></span></li>`;
        })
        .join("");
      if (stats) stats.textContent = `${filtered.length} eventi su ${events.length}`;
    }

    filterRow.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-pill");
      if (!btn) return;
      const k = btn.dataset.kind;
      if (active.has(k)) {
        active.delete(k);
        btn.classList.remove("is-on");
      } else {
        active.add(k);
        btn.classList.add("is-on");
      }
      paint();
    });

    paint();
  }

  // ----- mini-chart inline (uno per atto rilevante) -----
  // Ogni mini-chart è una piccola line/scatter che racconta il momento. Non è
  // protagonista: contesto visivo per la prosa, h~220px.
  function renderInlineCharts(sentinel, events) {
    if (!window.echarts) return;

    // Range allineati al perimetro 3 finestre Kimi K2 (master 2026-05-04):
    // Atto 1 = W1 (23:07→00:08, peak 94%)
    // Atto 2 = W2 inizio regime (00:18→04:30)
    // Atto 3 = W2 climax (04:00→05:10, escalation 80→96)
    // Atto 4 = W3 decompressione (05:16→08:00)
    // Atto 5 = epilogo (no inline-chart)
    const ranges = {
      "1": { from: "2026-05-03T23:00:00Z", to: "2026-05-04T00:30:00Z", title: "usage% — W1 climax mini (23:07 → 00:08, peak 94%)" },
      "2": { from: "2026-05-04T00:18:00Z", to: "2026-05-04T04:30:00Z", title: "usage% & projection — W2 inizio regime (00:18 → 04:30)" },
      "3": { from: "2026-05-04T04:00:00Z", to: "2026-05-04T05:10:00Z", title: "W2 climax — escalation 80→96 e cross-over proj (04:00 → 05:10)" },
      "4": { from: "2026-05-04T05:16:00Z", to: "2026-05-04T08:00:00Z", title: "W3 decompressione — peak 64%, throttle che si rarefanno (05:16 → 08:00)" },
    };

    for (const act of Object.keys(ranges)) {
      const el = document.getElementById(`mini-chart-act${act}`);
      if (!el) continue;
      if (!el.clientWidth) {
        // Containers in details-collapsed o nascosti partono a 0 width: rinvio.
        requestAnimationFrame(() => renderInlineCharts(sentinel, events));
        return;
      }
      const r = ranges[act];
      const from = Date.parse(r.from);
      const to = Date.parse(r.to);
      const subSent = sentinel.filter((s) => {
        const t = Date.parse(s.ts);
        return t >= from && t <= to;
      });
      const subThr = events.filter((e) => e.kind === "throttle" && e.ts >= from && e.ts <= to);
      const subWin = events.filter((e) => e.kind === "window" && e.ts >= from && e.ts <= to);

      const usagePts = subSent.map((s) => [Date.parse(s.ts), Number(s.usage) || 0]);
      const projPts = subSent.map((s) => [Date.parse(s.ts), Math.min(150, Number(s.projection) || 0)]);
      const thrPts = subThr.map((e) => [
        e.ts,
        // posizioniamo i puntini throttle a y = -5 (sotto la linea usage), così
        // non occludono la curva e si leggono come "tappeto" sotto l'asse 0
        -5,
      ]);

      const winMarks = subWin.map((w) => ({
        xAxis: w.ts,
        label: { show: true, formatter: "🪟", position: "insideEndTop", color: "#56ccf2" },
        lineStyle: { color: "#56ccf2", width: 1.5, type: "solid" },
      }));

      const chart = echarts.init(el, "dark", { renderer: "canvas" });
      const series = [
        {
          name: "usage%",
          type: "line",
          data: usagePts,
          showSymbol: false,
          lineStyle: { color: "#56ccf2", width: 2 },
          areaStyle: { color: "rgba(86,204,242,0.12)" },
          markLine: winMarks.length ? { silent: true, symbol: "none", data: winMarks } : undefined,
        },
      ];
      if (act === "2" || act === "3" || act === "4") {
        series.push({
          name: "projection%",
          type: "line",
          data: projPts,
          showSymbol: false,
          lineStyle: { color: "#f2c94c", width: 1.5, type: "dashed" },
        });
      }
      if (subThr.length) {
        series.push({
          name: "throttle",
          type: "scatter",
          data: thrPts,
          symbol: "rect",
          symbolSize: [3, 8],
          itemStyle: { color: "rgba(235,87,87,0.55)" },
          tooltip: { show: false },
        });
      }

      chart.setOption({
        title: { text: r.title, left: 12, top: 6, textStyle: { color: "#b9c4d4", fontSize: 12, fontWeight: "normal" } },
        backgroundColor: "transparent",
        grid: { left: 50, right: 16, top: 30, bottom: 28 },
        legend: {
          right: 14,
          top: 4,
          textStyle: { color: "#8a93a4", fontSize: 11 },
          itemWidth: 14,
          itemHeight: 8,
        },
        tooltip: {
          trigger: "axis",
          confine: true,
          backgroundColor: "rgba(17,21,30,0.97)",
          borderColor: "#3a5077",
          textStyle: { color: "#e8ecf3", fontSize: 12 },
          formatter: (params) => {
            const ts = new Date(params[0].value[0]).toISOString().slice(11, 19) + "Z";
            return [`<b>${ts}</b>`]
              .concat(params.map((p) => `${p.marker} ${p.seriesName}: <b>${Math.round(p.value[1])}%</b>`))
              .join("<br/>");
          },
        },
        xAxis: {
          type: "time",
          min: from,
          max: to,
          axisLabel: { color: "#8a93a4", fontSize: 10 },
          splitLine: { lineStyle: { color: "#1a1f2c" } },
        },
        yAxis: {
          type: "value",
          min: -10,
          max: 110,
          axisLabel: { color: "#8a93a4", fontSize: 10, formatter: (v) => (v < 0 ? "" : v + "%") },
          splitLine: { lineStyle: { color: "#1a1f2c" } },
        },
        series,
      });
      new ResizeObserver(() => chart.resize()).observe(el);
    }
  }

  function fmtTs(ms) {
    const d = new Date(ms);
    return d.toISOString().slice(0, 10) + " " + d.toISOString().slice(11, 19) + "Z";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
