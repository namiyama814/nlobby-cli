export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel;

  private constructor() {
    const isDebug =
      typeof process !== "undefined" &&
      (process.env.NLOBBY_DEBUG === "true" || process.env.DEBUG === "true");
    this.logLevel = isDebug ? LogLevel.DEBUG : LogLevel.WARN;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /** @deprecated No longer needed; default is already quiet. */
  forceProductionMode(): void {}

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level < this.logLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    const line =
      args.length > 0
        ? `[${timestamp}] [${levelName}] ${message} ${args.map((a) => this.safeStringify(a)).join(" ")}`
        : `[${timestamp}] [${levelName}] ${message}`;

    // stdout is reserved for the stdio MCP transport. Workers have no stderr.
    if (typeof process !== "undefined" && process.stderr) {
      process.stderr.write(line + "\n");
    } else {
      console.error(line);
    }
  }

  private safeStringify(value: unknown): string {
    if (typeof value !== "object" || value === null) return String(value);
    const secretKeys = /cookie|authorization|token|secret|password/i;
    try {
      return JSON.stringify(value, (key, current) =>
        secretKeys.test(key) ? "[REDACTED]" : current,
      );
    } catch {
      return "[Unserializable value]";
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }
}

export const logger = Logger.getInstance();
