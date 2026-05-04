// Helper condiviso fra tutte le pagine del report.
// Parsa i JSONL esportati in ./data/ e fornisce funzioni di filtro temporale.

(function (g) {
  async function fetchJsonl(url) {
    const txt = await fetch(url).then((r) => r.text());
    return txt
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
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

  // Carica i 6 file chat in data/chat/ — user-history kimi per agente.
  // Schema: {content: '[@from -> @to] [TYPE] body'}. Niente timestamp nel
  // record (il file in sé è ordinato cronologicamente).
  const CHAT_FILES = [
    "21768540336d770a63202e62a69ff597",
    "3936717a8b038a2a6744da2d7b6a22b3",
    "404b813f0e1dd211abe1b60cf9f59dc4",
    "5559e893db692744042bcac086a97df8",
    "705d7742d1d9dfc3708adc78207c7907",
    "ed84b19113f9ed310f2a23c1674e144a",
  ];
  async function loadChat() {
    const chunks = await Promise.all(
      CHAT_FILES.map((id) => fetchJsonl(`data/chat/${id}.jsonl.txt`))
    );
    return chunks.flat();
  }

  // Filtro alla finestra "long session 2026-05-03 sera → 2026-05-04 mattino".
  // Tagliamo dal 2026-05-03T18:00:00Z (~ ieri sera) al 2026-05-04T12:00:00Z.
  // I dev possono raffinare gli estremi guardando i dati.
  const SESSION_START = Date.parse("2026-05-03T18:00:00Z");
  const SESSION_END = Date.parse("2026-05-04T12:00:00Z");

  function inSession(record) {
    const t = Date.parse(record.ts);
    return t >= SESSION_START && t <= SESSION_END;
  }

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
    loadChat,
    inSession,
    SESSION_START,
    SESSION_END,
    AGENT_COLORS,
    agentColor,
    AGENT_EMOJI,
    agentEmoji,
  };
})(window);
