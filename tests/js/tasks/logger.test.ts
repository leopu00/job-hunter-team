/**
 * Test unitari — shared/logger (vitest)
 *
 * Formatter pure functions, Logger levels, file JSON rolling,
 * console output, child logger, getLogger/resetLogger.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatLevel, formatTimestamp, formatTimestampLong,
  formatConsoleLine, formatSubsystem, theme,
} from "../../../shared/logger/formatter.js";
import { Logger, getLogger, resetLogger } from "../../../shared/logger/logger.js";
import type { LogLevel } from "../../../shared/logger/logger.js";
import fs from "node:fs";

// --- Formatter tests (pure functions, no mocking) ---

describe("formatTimestampLong", () => {
  it("formato YYYY-MM-DD HH:mm:ss.SSS con zero-padding", () => {
    expect(formatTimestampLong(new Date(2025, 5, 15, 9, 30, 45, 123))).toBe("2025-06-15 09:30:45.123");
    expect(formatTimestampLong(new Date(2025, 0, 5, 3, 7, 2, 9))).toBe("2025-01-05 03:07:02.009");
  });
});

describe("formatTimestamp", () => {
  it("formato HH:mm:ss.SSS (contiene i numeri)", () => {
    const d = new Date(2025, 0, 1, 14, 5, 30, 999);
    const ts = formatTimestamp(d);
    expect(ts).toContain("14:05:30.999");
  });
});

describe("formatLevel", () => {
  it("ritorna label DBG/INF/WRN/ERR per ogni livello", () => {
    expect(formatLevel("debug")).toContain("DBG");
    expect(formatLevel("info")).toContain("INF");
    expect(formatLevel("warn")).toContain("WRN");
    expect(formatLevel("error")).toContain("ERR");
  });
  it("livello sconosciuto usa default INF", () => {
    expect(formatLevel("unknown")).toContain("INF");
  });
});

describe("formatSubsystem", () => {
  it("contiene nome tra parentesi quadre", () => {
    expect(formatSubsystem("telegram")).toContain("[telegram]");
  });
});

describe("formatConsoleLine", () => {
  it("compone timestamp + level + subsystem + messaggio", () => {
    const d = new Date(2025, 0, 1, 12, 0, 0, 0);
    const line = formatConsoleLine("info", "test", "hello world", d);
    expect(line).toContain("12:00:00");
    expect(line).toContain("INF");
    expect(line).toContain("[test]");
    expect(line).toContain("hello world");
  });
  it("subsystem vuoto non aggiunge parentesi", () => {
    const line = formatConsoleLine("warn", "", "msg");
    expect(line).not.toContain("[");
  });
});

describe("theme helpers", () => {
  it("tutte le funzioni ritornano stringa con il testo originale", () => {
    for (const [k, fn] of Object.entries(theme)) expect(fn("test")).toContain("test");
  });
});

// --- Logger class tests (mock fs e process.stdout/stderr) ---

describe("Logger — log levels", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("info visibile con consoleLevel=info", () => {
    const log = new Logger({ consoleLevel: "info", level: "silent" });
    log.info("test msg");
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("test msg"));
  });

  it("debug nascosto con consoleLevel=info", () => {
    const log = new Logger({ consoleLevel: "info", level: "silent" });
    log.debug("hidden");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("error va su stderr", () => {
    const log = new Logger({ consoleLevel: "info", level: "silent" });
    log.error("errore");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("errore"));
  });

  it("warn visibile con consoleLevel=warn", () => {
    const log = new Logger({ consoleLevel: "warn", level: "silent" });
    log.warn("attenzione");
    expect(stdoutSpy).toHaveBeenCalled();
    log.info("hidden");
    // info ha priority 1 < warn priority 2, non dovrebbe aggiungere altre chiamate
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
  });

  it("silent non produce output", () => {
    const log = new Logger({ consoleLevel: "silent", level: "silent" });
    log.info("nope");
    log.error("nope");
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe("Logger — child e subsystem", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("child logger usa subsystem diverso", () => {
    const parent = new Logger({ consoleLevel: "info", level: "silent", subsystem: "parent" });
    const child = parent.child("child-sub");
    child.info("from child");
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("[child-sub]"));
  });

  it("child eredita livelli dal parent", () => {
    const parent = new Logger({ consoleLevel: "warn", level: "silent" });
    const child = parent.child("sub");
    child.info("hidden");
    expect(stdoutSpy).not.toHaveBeenCalled();
    child.warn("visible");
    expect(stdoutSpy).toHaveBeenCalled();
  });
});

describe("Logger — file output JSON", () => {
  let mkdirSpy: ReturnType<typeof vi.spyOn>;
  let appendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mkdirSpy = vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined);
    appendSpy = vi.spyOn(fs, "appendFileSync").mockReturnValue(undefined);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 0 } as any);
    vi.spyOn(fs, "readdirSync").mockReturnValue([] as any);
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("scrive JSON strutturato su file", () => {
    const log = new Logger({ level: "info", consoleLevel: "silent", logDir: "/tmp/test-logs" });
    log.info("file test", { key: "val" });
    expect(mkdirSpy).toHaveBeenCalledWith("/tmp/test-logs", { recursive: true });
    expect(appendSpy).toHaveBeenCalled();
    const written = appendSpy.mock.calls[0][1] as string;
    const entry = JSON.parse(written.trim());
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("file test");
    expect(entry.data).toEqual({ key: "val" });
    expect(entry.subsystem).toBe("jht");
  });

  it("debug non scritto con level=info", () => {
    const log = new Logger({ level: "info", consoleLevel: "silent", logDir: "/tmp/test-logs" });
    log.debug("should not write");
    expect(appendSpy).not.toHaveBeenCalled();
  });
});

describe("getLogger / resetLogger", () => {
  afterEach(() => { resetLogger(); vi.restoreAllMocks(); });

  it("getLogger ritorna Logger e child con subsystem", () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const log = getLogger();
    expect(log).toBeInstanceOf(Logger);
    const child = getLogger("telegram");
    expect(child).toBeInstanceOf(Logger);
  });

  it("resetLogger permette di ricreare il logger", () => {
    const a = getLogger();
    resetLogger();
    const b = getLogger();
    expect(a).not.toBe(b);
  });
});
