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
    inSession,
    SESSION_START,
    SESSION_END,
    AGENT_COLORS,
    agentColor,
    AGENT_EMOJI,
    agentEmoji,
  };
})(window);
