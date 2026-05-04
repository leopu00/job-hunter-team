// Helper condiviso fra tutte le pagine del report.
// Parsa i JSONL esportati in ./data/ e fornisce funzioni di filtro temporale.
//
// Round 2: aggiunto loader user-history (data/chat/), data cleaning robusto
// (parse difensivo, dedup, normalize UTC, drop righe corrotte) e indice di
// matching prefisso per arricchire i preview di messages.jsonl con il content
// full delle chat. L'indice è progettato per essere riusato anche da
// throttle.html (correlazione aggregata per-agente).

(function (g) {
  // -------------------- core JSONL fetch --------------------

  async function fetchJsonl(url) {
    const txt = await fetch(url).then((r) => r.text());
    const stats = { total: 0, ok: 0, parse_error: 0, empty: 0 };
    const out = [];
    for (const raw of txt.split("\n")) {
      const line = raw.trim();
      if (!line) {
        stats.empty++;
        stats.total++;
        continue;
      }
      stats.total++;
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === "object") {
          out.push(obj);
          stats.ok++;
        } else {
          stats.parse_error++;
        }
      } catch {
        stats.parse_error++;
      }
    }
    out.__stats = stats;
    return out;
  }

  async function loadAll() {
    // I file di dati hanno estensione .jsonl.txt: il pre-commit hook del repo
    // ammette solo estensioni note, e .jsonl non è in whitelist. Il contenuto
    // resta JSONL "uno-per-riga".
    const [sentinel, throttle, messages] = await Promise.all([
      fetchJsonl("data/sentinel-data.jsonl.txt"),
      fetchJsonl("data/throttle-events.jsonl.txt"),
      fetchJsonl("data/messages.jsonl.txt"),
    ]);
    return { sentinel, throttle, messages };
  }

  // -------------------- chat loader (data/chat/*.jsonl.txt) --------------------

  // I 6 file user-history Kimi visti durante la long session 2026-05-04. I
  // nomi sono hash MD5 del path interno, ma per il report si possono trattare
  // come una cartella "chat" da cui leggere tutto a blocco.
  const CHAT_FILES = [
    "data/chat/21768540336d770a63202e62a69ff597.jsonl.txt",
    "data/chat/3936717a8b038a2a6744da2d7b6a22b3.jsonl.txt",
    "data/chat/404b813f0e1dd211abe1b60cf9f59dc4.jsonl.txt",
    "data/chat/5559e893db692744042bcac086a97df8.jsonl.txt",
    "data/chat/705d7742d1d9dfc3708adc78207c7907.jsonl.txt",
    "data/chat/ed84b19113f9ed310f2a23c1674e144a.jsonl.txt",
  ];

  // Header messaggi `[@from -> @to] [TYPE] body...`. I chat hanno SOLO
  // `content`, niente timestamp: per portarli sul timeline ci agganciamo a
  // messages.jsonl (preview = stesso prefisso del content).
  const HDR_RE_JS = /^\[@([^\]]+) -> @([^\]]+)\] \[([A-Z]+)\] ([\s\S]*)$/;
  // Variante "broadcast": [SENTINELLA] [URG] body, [BRIDGE TICK] usage=…
  const HDR_RE_BCAST = /^\[([A-Z][A-Z0-9 ]+)\] \[([A-Z]+)\] ([\s\S]*)$/;

  async function loadChats() {
    const results = await Promise.all(CHAT_FILES.map((u) => fetchJsonl(u)));
    const stats = {
      files: CHAT_FILES.length,
      total: 0,
      parsed: 0,
      hdr: 0,
      bcast: 0,
      no_hdr: 0,
      empty: 0,
      parse_error: 0,
    };
    const records = [];
    for (let i = 0; i < results.length; i++) {
      const arr = results[i];
      stats.parse_error += arr.__stats.parse_error;
      stats.empty += arr.__stats.empty;
      stats.total += arr.__stats.total;
      stats.parsed += arr.__stats.ok;
      const file = CHAT_FILES[i].split("/").pop();
      for (const obj of arr) {
        const content = (obj && obj.content) || "";
        if (!content) {
          stats.empty++;
          continue;
        }
        const m = HDR_RE_JS.exec(content);
        if (m) {
          stats.hdr++;
          records.push({
            file,
            content,
            from: m[1].toLowerCase().trim(),
            to: m[2].toLowerCase().trim(),
            type: m[3],
            body: m[4],
          });
          continue;
        }
        const b = HDR_RE_BCAST.exec(content);
        if (b) {
          stats.bcast++;
          records.push({
            file,
            content,
            from: b[1].toLowerCase().trim(),
            to: "*",
            type: b[2],
            body: b[3],
          });
          continue;
        }
        stats.no_hdr++;
        // Mantieniamo le righe senza header in coda — non vanno sul timeline,
        // ma possono essere utili per ricerche keyword in altri grafici.
        records.push({ file, content, from: null, to: null, type: null, body: content });
      }
    }
    return { records, stats };
  }

  // Indice per matching prefix-based: messages.jsonl ha `preview` (~80 char)
  // del primo prefisso del content full. Costruiamo Map<prefix60, fullContent>.
  // Utilizzato anche da throttle.html in iterazione successiva (peer dev2).
  function buildChatIndex(chatRecords, prefixLen = 60) {
    const idx = new Map();
    for (const r of chatRecords) {
      if (!r || !r.content) continue;
      // Chiave: prima i primi N caratteri del content full (dopo trim leading).
      const key = r.content.trim().slice(0, prefixLen);
      // In caso di duplicati, mantieni il primo (record originale è più "vicino"
      // all'evento storico — i duplicati sono spesso re-injection).
      if (!idx.has(key)) idx.set(key, r);
    }
    return idx;
  }

  function enrichPreview(preview, chatIdx, prefixLen = 60) {
    if (!preview || !chatIdx) return null;
    const key = String(preview).trim().slice(0, prefixLen);
    return chatIdx.get(key) || null;
  }

  // -------------------- finestra di sessione --------------------

  // Filtro alla finestra "long session 2026-05-03 sera → 2026-05-04 mattino".
  // Tagliamo dal 2026-05-03T18:00:00Z (~ ieri sera) al 2026-05-04T12:00:00Z.
  // I dev possono raffinare gli estremi guardando i dati.
  const SESSION_START = Date.parse("2026-05-03T18:00:00Z");
  const SESSION_END = Date.parse("2026-05-04T12:00:00Z");

  function inSession(record) {
    const t = Date.parse(record.ts);
    return Number.isFinite(t) && t >= SESSION_START && t <= SESSION_END;
  }

  // -------------------- cleaning utility --------------------

  // Filtraggio + dedup + normalizzazione su un dataset arbitrario. Ritorna
  // l'array pulito + uno stats {kept, dropped_window, dropped_dup, dropped_invalid_ts}.
  // dedupKey: funzione record → string (es. ts+from+to+type+preview).
  function cleanInWindow(records, dedupKey) {
    const out = [];
    const seen = new Set();
    const stats = { input: records.length, kept: 0, dropped_window: 0, dropped_dup: 0, dropped_invalid_ts: 0 };
    for (const r of records) {
      const ts = r && r.ts;
      const t = ts ? Date.parse(ts) : NaN;
      if (!Number.isFinite(t)) {
        stats.dropped_invalid_ts++;
        continue;
      }
      if (t < SESSION_START || t > SESSION_END) {
        stats.dropped_window++;
        continue;
      }
      if (dedupKey) {
        const k = dedupKey(r);
        if (seen.has(k)) {
          stats.dropped_dup++;
          continue;
        }
        seen.add(k);
      }
      out.push(r);
      stats.kept++;
    }
    return { records: out, stats };
  }

  // -------------------- mapping agenti (canonico) --------------------

  // Mapping colori canonico (allineato a web/.../agent-colors.ts).
  const AGENT_COLORS = {
    capitano: "#f2994a",
    scout: "#6fcf97",
    scrittore: "#56ccf2",
    scorer: "#bb6bd9",
    critico: "#eb5757",
    analista: "#f2c94c",
    assistente: "#9bd9c5",
    sentinella: "#828282",
    maestro: "#9b51e0",
  };

  function agentColor(agentRaw) {
    if (!agentRaw) return "#888";
    const base = String(agentRaw).split("-")[0].toLowerCase();
    return AGENT_COLORS[base] || "#888";
  }

  const AGENT_EMOJI = {
    capitano: "🧭",
    scout: "🔎",
    scrittore: "✍️",
    scorer: "🎯",
    critico: "🧐",
    analista: "📊",
    assistente: "🤝",
    sentinella: "👁",
    maestro: "🎓",
  };

  function agentEmoji(agentRaw) {
    if (!agentRaw) return "🤖";
    const base = String(agentRaw).split("-")[0].toLowerCase();
    return AGENT_EMOJI[base] || "🤖";
  }

  g.ReportData = {
    fetchJsonl,
    loadAll,
    loadChats,
    buildChatIndex,
    enrichPreview,
    cleanInWindow,
    inSession,
    SESSION_START,
    SESSION_END,
    AGENT_COLORS,
    agentColor,
    AGENT_EMOJI,
    agentEmoji,
  };
})(window);
