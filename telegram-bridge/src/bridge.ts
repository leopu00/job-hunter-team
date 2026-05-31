/**
 * Bridge bidirezionale Telegram ↔ JHT.
 *
 * Entry point: avvia il bot, gestisce comandi in ingresso,
 * inoltra al coordinator, restituisce risposte su Telegram.
 */

import { execSync } from "node:child_process";
import { createBot, getDefaultCommands, syncMenuCommands } from "./bot.js";
import type { MessageContext } from "./bot.js";
import { sendMessage, sendStatus } from "./send.js";
import { resolveToken } from "./token.js";

type BridgeConfig = {
  allowFrom?: number[];
  coordinatorSession?: string;
};

/**
 * Invia comando al coordinator JHT via tmux.
 */
function sendToCoordinator(session: string, message: string): boolean {
  try {
    execSync(`tmux send-keys -t "${session}" "${message}"`);
    execSync(`tmux send-keys -t "${session}" Enter`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Output del wrapper Python `write_request.py` (single source of truth
 * per il validate+UPDATE della richiesta CV user-driven, V6).
 */
type WriteRequestResult = {
  ok: boolean;
  error?: string;
  status_code?: string;
  id?: number;
  title?: string;
  company?: string;
  score?: number | null;
  previous?: number;
  current?: number;
};

/**
 * Chiama `python3 shared/skills/write_request.py <id> --mode on` ed esce
 * SEMPRE con un JSON (anche su exit code != 0, perche' lo script lo
 * emette su validation failure prima di sys.exit(1)).
 */
function runWriteRequest(positionId: number, mode: "on" | "off"): WriteRequestResult {
  const skillsDir = process.env.JHT_SKILLS_DIR ?? "/app/shared/skills";
  let stdout = "";
  try {
    stdout = execSync(
      `python3 "${skillsDir}/write_request.py" ${positionId} --mode ${mode}`,
      { encoding: "utf-8" }
    );
  } catch (err) {
    // exit 1 da Python su validation failure — lo stdout JSON e' comunque
    // disponibile su err.stdout. Solo se Python crash davvero (Python non
    // installato, skill mancante) cadiamo nel catch interno.
    stdout = (err as { stdout?: Buffer | string }).stdout?.toString() ?? "";
  }
  try {
    const lastLine = stdout.trim().split("\n").pop() ?? "{}";
    return JSON.parse(lastLine) as WriteRequestResult;
  } catch {
    return { ok: false, error: "write_request.py: output non parseabile" };
  }
}

/**
 * Legge lo stato del team dal forum JHT.
 */
function readTeamStatus(): string[] {
  try {
    const output = execSync("tail -20 ~/.jht/forum.log", { encoding: "utf-8" });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return ["Forum non disponibile"];
  }
}

/**
 * Handler comandi — dispatch per nome comando.
 */
async function handleCommand(
  ctx: MessageContext,
  command: string,
  args: string,
  config: BridgeConfig,
  bot: ReturnType<typeof createBot>
): Promise<void> {
  const coordSession = config.coordinatorSession ?? "JHT-COORD";

  switch (command) {
    case "status": {
      const lines = readTeamStatus();
      const last5 = lines.slice(-5);
      await sendStatus(bot, ctx.chatId, "Stato Team JHT", last5);
      break;
    }

    case "run": {
      if (!args) {
        await ctx.replyTo("Uso: /run <descrizione task>");
        return;
      }
      const sent = sendToCoordinator(
        coordSession,
        `[@telegram -> @ace] [REQ] ${args}`
      );
      await ctx.replyTo(sent
        ? `Task inoltrato al coordinator: <i>${args}</i>`
        : "Errore: coordinator non raggiungibile"
      );
      break;
    }

    case "stop": {
      const sent = sendToCoordinator(
        coordSession,
        "[@telegram -> @ace] [URG] STOP richiesto da Telegram"
      );
      await ctx.replyTo(sent ? "STOP inviato al team" : "Errore: coordinator non raggiungibile");
      break;
    }

    case "cv": {
      // Writer-on-demand (V6): user-driven trigger via Telegram.
      // Setta `positions.write_requested = 1` su SQLite locale; il
      // Capitano spawna SCRITTORE on-demand alla prossima iterazione
      // (vedi RULE C-10 in capitano.md).
      const positionId = Number.parseInt(args, 10);
      if (!Number.isInteger(positionId) || positionId <= 0) {
        await ctx.replyTo(
          "Uso: <code>/cv &lt;position_id&gt;</code>\n" +
            "Es: <code>/cv 42</code>"
        );
        return;
      }

      const result = runWriteRequest(positionId, "on");

      if (!result.ok) {
        const subject = result.title && result.company
          ? `\n#${result.id} <b>${result.title}</b> · <i>${result.company}</i>`
          : "";
        await ctx.replyTo(`<b>❌</b> ${result.error ?? "Errore"}${subject}`);
        return;
      }

      // Notify Capitano ad-hoc (non aspettiamo il prossimo BRIDGE TICK).
      // Idempotente: anche se non riceve il messaggio, la C-10 lo trova
      // alla query db_query.py next-for-scrittore comunque.
      sendToCoordinator(
        coordSession,
        `[@utente -> @capitano] [TG] /cv ${positionId} -> write_requested=1 (${result.company} · ${result.title})`
      );

      const wasAlreadyOn = result.previous === 1;
      const header = wasAlreadyOn
        ? "<b>↻ Richiesta CV gia' attiva</b>"
        : "<b>✓ CV richiesto</b>";
      await ctx.replyTo(
        `${header}\n` +
          `#${result.id} <b>${result.title}</b>\n` +
          `<i>${result.company}</i> · score ${result.score ?? "?"}\n` +
          `Lo Scrittore inizia non appena il Capitano vede il flag (max ~5 min).`
      );
      break;
    }

    case "team": {
      try {
        const output = execSync(
          "tmux list-sessions -F '#{session_name}' 2>/dev/null",
          { encoding: "utf-8" }
        );
        const sessions = output.trim().split("\n")
          .filter((s) => s.startsWith("JHT-"));
        await sendStatus(bot, ctx.chatId, "Worker Attivi", sessions);
      } catch {
        await ctx.replyTo("Impossibile leggere le sessioni tmux");
      }
      break;
    }

    case "help": {
      const cmds = getDefaultCommands();
      const lines = cmds.map((c) => `/${c.name} — ${c.description}`);
      await sendStatus(bot, ctx.chatId, "Comandi Disponibili", lines);
      break;
    }

    default:
      await ctx.replyTo(`Comando sconosciuto: /${command}. Usa /help`);
  }
}

/**
 * Handler messaggi liberi — inoltra al coordinator.
 */
async function handleMessage(
  ctx: MessageContext,
  config: BridgeConfig
): Promise<void> {
  const coordSession = config.coordinatorSession ?? "JHT-COORD";
  const sent = sendToCoordinator(
    coordSession,
    `[@telegram -> @ace] [MSG] ${ctx.senderName}: ${ctx.text}`
  );
  if (sent) {
    await ctx.replyTo("Messaggio inoltrato al coordinator");
  }
}

/**
 * Avvia il bridge Telegram ↔ JHT.
 */
export async function startBridge(config: BridgeConfig = {}): Promise<void> {
  const { token, source } = resolveToken();
  if (!token) {
    console.error("Token Telegram non trovato. Imposta TELEGRAM_BOT_TOKEN o salva in ~/.jht/credentials/telegram_bot.json");
    process.exit(1);
  }
  console.log(`Token risolto da: ${source}`);

  const bot = createBot({
    token,
    allowFrom: config.allowFrom,
    onCommand: (ctx, cmd, args) => handleCommand(ctx, cmd, args, config, bot),
    onMessage: (ctx) => handleMessage(ctx, config),
  });

  const commands = getDefaultCommands();
  await syncMenuCommands(bot, commands);
  console.log("Menu comandi sincronizzato");

  console.log("Bridge Telegram avviato — polling attivo");
  await bot.start();
}

// Entry point diretto
startBridge({
  coordinatorSession: process.env.JHT_COORD_SESSION ?? "JHT-COORD",
});
