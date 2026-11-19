"use strict";
/**
 * The spending gate of the agents on the pi harness: while the spending brake holds the team (pi_spend_cap.py writes
 * the daily-halt flag with reason "pi_spend_cap": budget spent, period over, pace, ceiling), no new turn and no new
 * model call start.
 *
 * The brake's pause was an ESC to every session, and a guard that sent another ESC when a session worked again: a call
 * was already made and paid by then. A Captain on Opus answering a message during a pause spent 0.43 $ in one call
 * (giro Windows 16/11: from 1.14 to 1.99 $ in nine minutes «paused», the Captain 70 % of the spending). Here the call
 * is not made: a message that arrives during the pause is held (`input` handled, nothing sent to the model) and a turn
 * already running is stopped before its next request (`before_provider_request`: ctx.abort()).
 *
 * The Assistente is the one left out: it is the person's voice, and answers them while the team waits. The launcher
 * loads this file for every other role on pi (`-e`, .launcher/spawn-harness.sh). Nothing here writes the flag, talks
 * to the network or reads the agent's files: one small file of the team's logs, read as a plain file. A reading that
 * fails is no pause (the brake's ESC still stands behind it), and a handler never throws into pi.
 *
 * The same gate holds a session that WAITS FOR ITS STAGE of the pace after a pause (its name in state/pace-wake-queue.json, put there by
 * the brake and taken out BEFORE the [RIPRENDI] that wakes it): every channel that writes into a session (the watchdogs, the language
 * line, the notices, the Dottore) reaches it as an input, so one place covers them all. What was held is not lost: it goes to the
 * session, summarised, inside the message that wakes it. A queue that cannot be read, or that nobody has touched for two hours, holds
 * nobody: a broken file never stops a team.
 */
const fs = require("node:fs");
const path = require("node:path");

const REASON = "pi_spend_cap";
const FLAG_MAX_BYTES = 64 * 1024;
const EXEMPT = new Set(["assistente"]);

function flagPath() {
  const home = process.env.JHT_HOME;
  return home ? path.join(home, "logs", "daily-halt.flag") : null;
}

/** True while the brake holds the team: the flag is a plain file of ours with the brake's reason. */
function paused() {
  const file = flagPath();
  if (!file) return false;
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.size <= 0 || info.size > FLAG_MAX_BYTES)
      return false;
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return (
      Boolean(payload) &&
      typeof payload === "object" &&
      payload.reason === REASON
    );
  } catch (_error) {
    return false;
  }
}

const QUEUE_STALE_MS = 2 * 3600 * 1000;
const HELD_MAX = 20;
const HELD_CHARS = 400;
const held = [];

/** True while this session waits for its stage of the pace: the queue is a plain file of the brake's, read the way the flag is. */
function queued() {
  try {
    const home = process.env.JHT_HOME;
    const name = agentName().toUpperCase();
    if (!home || !name) return false;
    const file = path.join(home, "state", "pace-wake-queue.json");
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.size <= 0 || info.size > FLAG_MAX_BYTES) return false;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data !== "object" || !Array.isArray(data.pending)) return false;
    const at = Number(data.at);
    if (!Number.isFinite(at) || Date.now() - at * 1000 > QUEUE_STALE_MS || at * 1000 - Date.now() > QUEUE_STALE_MS) return false;
    return data.pending.includes(name);
  } catch (_error) {
    return false;
  }
}

/** What was held while the session waited, in one block for the message that wakes it. */
function heldSummary() {
  const seen = new Set();
  const lines = [];
  for (const text of held.splice(0)) {
    const one = text.replace(/\s+/g, " ").trim().slice(0, HELD_CHARS);
    if (one && !seen.has(one)) {
      seen.add(one);
      lines.push("- " + one);
    }
  }
  return lines.length ? "\n\n[HELD WHILE YOU WAITED FOR THE PACE: messages that reached you before your turn, once each]\n" + lines.join("\n") : "";
}

function logLine(entry) {
  try {
    const home = process.env.JHT_HOME;
    if (!home) return;
    const dir = path.join(home, "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "pi-spend-gate.log"),
      JSON.stringify({
        at: new Date().toISOString(),
        agent: agentName(),
        ...entry,
      }) + "\n",
    );
  } catch (_error) {
    /* a log that cannot be written changes nothing */
  }
}

function agentName() {
  return String(process.env.JHT_AGENT_NAME || "").toLowerCase();
}

module.exports = function spendGate(pi) {
  if (EXEMPT.has(agentName())) return;

  pi.on("input", (event) => {
    try {
      const text = event && typeof event.text === "string" ? event.text : "";
      if (paused()) {
        // never the text of the message in the log: only that one was held, and how long it was
        logLine({ event: "input_held", length: text.length });
        return { action: "handled" };
      }
      if (queued()) {
        if (held.length < HELD_MAX) held.push(text);
        logLine({ event: "input_held_for_the_pace", length: text.length });
        return { action: "handled" };
      }
      if (held.length) {
        logLine({ event: "held_inputs_delivered", count: held.length });
        return { action: "transform", text: text + heldSummary() };
      }
      return { action: "continue" };
    } catch (_error) {
      return { action: "continue" };
    }
  });

  pi.on("before_provider_request", (_event, ctx) => {
    try {
      if ((paused() || queued()) && ctx && typeof ctx.abort === "function") {
        logLine({ event: "request_stopped" });
        ctx.abort();
      }
    } catch (_error) {
      /* never break the request of the agent */
    }
    return undefined;
  });
};
