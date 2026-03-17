/**
 * Logger utility — CBC Learning Ecosystem
 *
 * Exports:
 *   logger        — singleton Winston logger (used by most services)
 *   Logger        — class-based logger with a name prefix (used by PaymentProviderService, etc.)
 */

import winston from 'winston';

const { combine, timestamp, printf, colorize, json } = winston.format;

const isProd = process.env.NODE_ENV === 'production';

// ── Shared format ─────────────────────────────────────────────────────────────
const devFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const extras = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level}] ${message}${extras}`;
});

const baseFormat = isProd
  ? combine(timestamp(), json())
  : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), devFormat);

// ── Singleton logger ──────────────────────────────────────────────────────────
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  format: baseFormat,
  transports: [
    new winston.transports.Console(),
    ...(isProd
      ? [new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' })]
      : []),
  ],
});

// ── Class-based logger (name prefix) ─────────────────────────────────────────
export class Logger {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  private fmt(msg: string): string {
    return `[${this.name}] ${msg}`;
  }

  debug(msg: string, meta?: object): void  { logger.debug(this.fmt(msg), meta); }
  info(msg: string, meta?: object): void   { logger.info(this.fmt(msg), meta); }
  warn(msg: string, meta?: object): void   { logger.warn(this.fmt(msg), meta); }
  error(msg: string, meta?: object): void  { logger.error(this.fmt(msg), meta); }
}
