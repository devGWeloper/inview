type Level = "INFO" | "WARN" | "ERROR";

function log(level: Level, msg: string, ctx?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  };
  const line = JSON.stringify(entry);
  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => log("INFO", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log("WARN", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log("ERROR", msg, ctx),
};
