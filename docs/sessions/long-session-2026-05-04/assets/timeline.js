// Timeline page — costruisce ECharts overview, tabella finestre,
// liste per fase ("atti") e log eventi filtrabile.
//
// Tutti gli eventi sono normalizzati nello stesso shape:
//   { ts: number(ms), kind: "window"|"capitano"|"kickoff"|"throttle"|"peak",
//     label: string, body: string, agent?: string, payload?: object }

(async function () {
  if (!window.ReportData) return;
  const { loadAll, inSession, agentEmoji, agentColor, SESSION_START, SESSION_END } = window.ReportData;

  let data;
  try {
    data = await loadAll();
  } catch (err) {
    console.error("timeline loadAll failed", err);
    return;
  }

  const sentinel = data.sentinel.filter(inSession).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const throttle = data.throttle
    .filter(inSession)
    .filter((r) => r.event !== "checkpoint")
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const messages = data.messages
    .filter(inSession)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  // ---------- estrazione eventi ----------
  const events = [];

  // 1. Transizioni di finestra (cambio session_id) — "vista bridge"
  let prevSid = null;
  const windows = []; // anche per la tabella sotto
  let curWin = null;
  for (const r of sentinel) {
    const sid = r.session_id;
    if (sid && sid !== prevSid) {
      const ts = Date.parse(r.ts);
      events.push({
        ts,
        kind: "window",
        label: "Nuova finestra",
        body: `session_id=${sid} provider=${r.provider} usage iniziale ${r.usage}% reset@${r.reset_at}`,
        payload: { sid, provider: r.provider, reset: r.reset_at },
      });
      curWin = { sid, provider: r.provider, first: ts, last: ts, peak: r.usage || 0, reset: r.reset_at };
      windows.push(curWin);
      prevSid = sid;
    } else if (curWin) {
      curWin.last = Date.parse(r.ts);
      curWin.peak = Math.max(curWin.peak, r.usage || 0);
    }
  }

  // 2. Picchi usage ≥90%, dedotti UNA volta per finestra (primo tick che supera)
  const peakSeen = new Set();
  for (const r of sentinel) {
    const u = Number(r.usage) || 0;
    if (u >= 90 && r.session_id && !peakSeen.has(r.session_id)) {
      peakSeen.add(r.session_id);
      events.push({
        ts: Date.parse(r.ts),
        kind: "peak",
        label: `Peak ${u}%`,
        body: `Finestra ${r.session_id} tocca ${u}% (proj=${r.projection}% vel=${r.velocity_smooth}%/h)`,
      });
    }
  }

  // 3. Kickoff agenti: primo MSG di capitano verso ciascun agente con keyword
  const kickoffSeen = new Set();
  for (const m of messages) {
    if (m.from !== "capitano" || m.type !== "MSG") continue;
    const target = m.to;
    if (!target || kickoffSeen.has(target)) continue;
    const p = m.preview || "";
    if (!/Avvia|Inizia|loop/i.test(p)) continue;
    kickoffSeen.add(target);
    events.push({
      ts: Date.parse(m.ts),
      kind: "kickoff",
      label: `Kickoff ${target}`,
      body: p.slice(0, 140),
      agent: target,
    });
  }

  // 4. Messaggi capitano (filtriamo a tipi "interessanti": MSG, ACK su kickoff,
  //    URG, FEEDBACK, FAILURE). Limitiamo per non sommergere l'event log.
  for (const m of messages) {
    if (m.from !== "capitano") continue;
    if (!["URG", "FEEDBACK", "FAILURE", "ALERT", "WARN", "REPORT", "DONE"].includes(m.type)) continue;
    events.push({
      ts: Date.parse(m.ts),
      kind: "capitano",
      label: `${m.type} → ${m.to || "?"}`,
      body: (m.preview || "").slice(0, 160),
    });
  }

  // 5. Throttle events. Tutti in event-log; nel chart aggreghiamo a "applied_sec".
  for (const t of throttle) {
    events.push({
      ts: Date.parse(t.ts),
      kind: "throttle",
      label: `Throttle ${t.agent} ${Math.round(t.applied_sec || 0)}s`,
      body: t.reason || "",
      agent: t.agent,
      payload: { applied_sec: t.applied_sec, requested_sec: t.requested_sec },
    });
  }

  events.sort((a, b) => a.ts - b.ts);

  // ---------- grafico overview ----------
  renderOverviewChart(events, sentinel);

  // ---------- tabella finestre ----------
  renderWindowsTable(windows);

  // ---------- atti / phasi ----------
  renderPhases(events);

  // ---------- log filtrabile ----------
  renderEventLog(events);

  // ===================================================================

  function renderOverviewChart(events, sentinel) {
    const el = document.getElementById("timeline-chart");
    if (!el || !window.echarts) return;
    const chart = echarts.init(el, "dark");

    // Lane Y per categoria
    const LANES = {
      window: { y: 4, color: "#56ccf2", emoji: "🪟" },
      capitano: { y: 3, color: "#f2994a", emoji: "🧭" },
      throttle: { y: 2, color: "#eb5757", emoji: "⏸" },
      peak: { y: 1, color: "#f2c94c", emoji: "🔥" },
    };

    const seriesData = events
      .filter((e) => LANES[e.kind])
      .map((e) => {
        const lane = LANES[e.kind];
        let symbolSize = 10;
        if (e.kind === "throttle") {
          const s = (e.payload && e.payload.applied_sec) || 60;
          symbolSize = Math.max(8, Math.min(22, 6 + Math.sqrt(s)));
        } else if (e.kind === "window") {
          symbolSize = 16;
        } else if (e.kind === "peak") {
          symbolSize = 18;
        }
        return {
          value: [e.ts, lane.y],
          itemStyle: { color: lane.color, opacity: e.kind === "throttle" ? 0.7 : 0.95, borderColor: "rgba(255,255,255,0.2)", borderWidth: 1 },
          symbolSize,
          name: e.label,
          label: e.label,
          body: e.body,
          kind: e.kind,
          agent: e.agent || null,
          payload: e.payload || null,
        };
      });

    // Linea usage di sfondo (lane 0, scalata 0→0.9 → height piena)
    const usagePoints = sentinel.map((r) => [Date.parse(r.ts), (Number(r.usage) || 0) / 100 * 0.85 + 0.05]);

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 70, right: 30, top: 30, bottom: 60 },
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove|click",
        confine: true,
        appendToBody: true,
        enterable: false,
        backgroundColor: "rgba(17,21,30,0.97)",
        borderColor: "#3a5077",
        borderWidth: 1,
        padding: [10, 12],
        textStyle: { color: "#e8ecf3", fontSize: 13, lineHeight: 18 },
        extraCssText: "max-width: 420px; white-space: normal; box-shadow: 0 8px 24px rgba(0,0,0,0.45); z-index: 9999;",
        axisPointer: { type: "cross", crossStyle: { color: "#3a5077" } },
        formatter: (p) => {
          if (!p.data) return "";
          // Linea usage di sfondo
          if (p.seriesName === "usage") {
            const u = Math.round(((p.data[1] - 0.05) / 0.85) * 100);
            return `<div style="font-size:13px"><b>${new Date(p.data[0]).toISOString().slice(11, 19)}Z</b> &nbsp;<span style="color:#5d6c84">UTC</span></div>` +
                   `<div style="margin-top:4px"><span style="color:#8a93a4">Asse Y · Usage finestra:</span> <b style="color:#56ccf2">${u}%</b></div>` +
                   `<div style="color:#5d6c84;font-size:11px;margin-top:6px">Linea di sfondo (sentinella, ~3 min/sample). Scala interna 5%–90% del riquadro.</div>`;
          }
          const d = p.data;
          const ts = new Date(d.value[0]).toISOString().slice(11, 19) + "Z";
          const date = new Date(d.value[0]).toISOString().slice(0, 10);
          // Spiegazione semantica per tipo di evento
          const head = {
            window: "🪟 <b>Transizione finestra Claude/Kimi</b>",
            capitano: "🧭 <b>Messaggio capitano</b>",
            throttle: "⏸ <b>Throttle event</b>",
            peak: "🔥 <b>Picco usage ≥ 90%</b>",
          };
          const explain = {
            window: "Il bridge ha visto un nuovo <code>session_id</code>: la finestra è stata resettata.",
            capitano: "Comunicazione di tipo URG / WARN / REPORT / DONE / ALERT verso un agente.",
            throttle: "Pausa applicata dal pacing-bridge per evitare che la proiezione sfori la finestra.",
            peak: "Primo tick in cui la finestra raggiunge soglia di guardia. Il termostato stringe.",
          };
          let extras = "";
          if (d.agent) extras += `<div><span style="color:#8a93a4">Agente:</span> <b style="color:${LANES[d.kind].color}">${escapeHtml(d.agent)}</b></div>`;
          if (d.kind === "throttle" && d.payload) {
            extras += `<div><span style="color:#8a93a4">Pausa applicata:</span> <b>${Math.round(d.payload.applied_sec)} s</b>` +
                      (d.payload.requested_sec && d.payload.requested_sec !== d.payload.applied_sec
                        ? ` <span style="color:#5d6c84">(richiesti ${Math.round(d.payload.requested_sec)} s)</span>`
                        : "") + "</div>";
          }
          if (d.kind === "window" && d.payload) {
            extras += `<div><span style="color:#8a93a4">Provider:</span> <b>${escapeHtml(d.payload.provider || "?")}</b> &nbsp; <span style="color:#8a93a4">reset@</span>${escapeHtml(d.payload.reset || "?")}</div>` +
                      `<div><span style="color:#8a93a4">session_id:</span> <code style="color:#56ccf2">${escapeHtml(d.payload.sid || "")}</code></div>`;
          }
          return `<div style="font-size:13px"><b>${date} ${ts}</b> &nbsp;<span style="color:#5d6c84">UTC</span></div>` +
                 `<div style="margin-top:4px">${head[d.kind] || ""}</div>` +
                 `<div style="color:#8a93a4;font-size:12px;margin-top:2px">${explain[d.kind] || ""}</div>` +
                 `<div style="margin-top:6px;color:#d6dde9"><b>${escapeHtml(d.label)}</b></div>` +
                 extras +
                 (d.body ? `<div style="color:#94a0b4;font-size:12px;margin-top:4px">${escapeHtml(d.body)}</div>` : "");
        },
      },
      xAxis: {
        type: "time",
        min: SESSION_START,
        max: SESSION_END,
        axisLabel: { color: "#8a93a4" },
        splitLine: { lineStyle: { color: "#1a1f2c" } },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 5,
        interval: 1,
        axisLabel: {
          color: "#8a93a4",
          formatter: (v) => {
            const map = { 1: "🔥 Peak", 2: "⏸ Throttle", 3: "🧭 Capitano", 4: "🪟 Finestra" };
            return map[v] || "";
          },
        },
        splitLine: { lineStyle: { color: "#1a1f2c" } },
      },
      dataZoom: [
        { type: "slider", height: 22, bottom: 18 },
        { type: "inside" },
      ],
      series: [
        {
          name: "usage",
          type: "line",
          data: usagePoints,
          showSymbol: false,
          lineStyle: { color: "#3a4a64", width: 1.4, type: "dashed" },
          areaStyle: { color: "rgba(86,204,242,0.06)" },
          z: 1,
          emphasis: { lineStyle: { color: "#56ccf2", width: 1.8 } },
          tooltip: { show: true },
        },
        {
          name: "events",
          type: "scatter",
          data: seriesData,
          z: 5,
          emphasis: {
            scale: 1.6,
            itemStyle: { borderColor: "#fff", borderWidth: 2, shadowBlur: 10, shadowColor: "rgba(255,255,255,0.4)" },
          },
        },
      ],
    });

    new ResizeObserver(() => chart.resize()).observe(el);
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
        <div class="cell"><code>${w.sid}</code></div>
        <div class="cell">${fmtDate(w.first)} ${fmt(w.first)}</div>
        <div class="cell">${fmtDate(w.last)} ${fmt(w.last)}</div>
        <div class="cell right">${h > 0 ? h + "h " : ""}${m}m</div>
        <div class="cell right">${w.peak}%</div>
      </div>`);
    }
    el.innerHTML = rows.join("");
  }

  function renderPhases(events) {
    // Phase boundaries (UTC):
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
      // Highlight: window/capitano/kickoff/peak — escludo throttle nella sintesi per non sommergere
      const sub = events.filter((e) => e.ts >= from && e.ts <= to && e.kind !== "throttle");
      // Aggiungi un "summary throttle" come prima riga
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

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
