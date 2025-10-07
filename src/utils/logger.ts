// src/utils/logger.ts

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private static level: LogLevel = LogLevel.INFO;

  static setLevel(level: LogLevel): void {
    this.level = level;
  }

  static debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`🔍 ${message}`, ...args);
    }
  }

  static info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`ℹ️  ${message}`, ...args);
    }
  }

  static warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`⚠️  ${message}`, ...args);
    }
  }

  static error(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`❌ ${message}`, ...args);
    }
  }

  static success(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`✅ ${message}`, ...args);
    }
  }
}
