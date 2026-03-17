/**
 * Startup Environment Validation
 * FIX SEC-03: Enforce minimum security requirements before the server accepts connections.
 *
 * Call validateStartupEnv() as the very first thing in index.ts / app.ts.
 * If any check fails the process exits immediately with a clear error message,
 * preventing insecure deployments from reaching production traffic.
 */

import { logger } from '../utils/logger';

interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'your_super_secret_jwt_key_min_32_characters',
  'your_super_secret_refresh_key_min_32_characters',
  'changeme',
  'secret',
  'password',
  'jwt_secret',
]);

export function validateStartupEnv(): void {
  const result = runValidations();

  result.warnings.forEach((w) =>
    logger.warn(`[startup] ⚠️  ${w}`),
  );

  if (!result.passed) {
    result.errors.forEach((e) =>
      logger.error(`[startup] ❌ FATAL: ${e}`),
    );
    logger.error('[startup] Server startup aborted — fix the above errors and restart.');
    process.exit(1);
  }

  logger.info('[startup] ✅ Environment validation passed');
}

function runValidations(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── JWT Secrets ────────────────────────────────────────────
  const jwtSecret = process.env.JWT_SECRET || '';
  const jwtRefresh = process.env.JWT_REFRESH_SECRET || '';

  if (!jwtSecret) {
    errors.push('JWT_SECRET is not set');
  } else if (jwtSecret.length < 64) {
    errors.push(
      `JWT_SECRET is too short (${jwtSecret.length} chars). Minimum 64 characters required.`,
    );
  } else if (KNOWN_PLACEHOLDER_SECRETS.has(jwtSecret.toLowerCase())) {
    errors.push('JWT_SECRET is using a placeholder/default value. Set a secure random secret.');
  }

  if (!jwtRefresh) {
    errors.push('JWT_REFRESH_SECRET is not set');
  } else if (jwtRefresh.length < 64) {
    errors.push(
      `JWT_REFRESH_SECRET is too short (${jwtRefresh.length} chars). Minimum 64 required.`,
    );
  } else if (KNOWN_PLACEHOLDER_SECRETS.has(jwtRefresh.toLowerCase())) {
    errors.push('JWT_REFRESH_SECRET is using a placeholder value.');
  }

  // ── Database ───────────────────────────────────────────────
  const dbRequired = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  dbRequired.forEach((key) => {
    if (!process.env[key]) errors.push(`${key} is not set`);
  });

  // ── M-Pesa ─────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    const mpesaRequired = [
      'MPESA_CONSUMER_KEY',
      'MPESA_CONSUMER_SECRET',
      'MPESA_PASSKEY',
      'MPESA_SHORTCODE',
    ];
    mpesaRequired.forEach((key) => {
      if (!process.env[key]) errors.push(`${key} is not set (required in production)`);
    });

    if (process.env.MPESA_ENVIRONMENT !== 'production') {
      warnings.push('MPESA_ENVIRONMENT is not "production" — running in sandbox mode');
    }
  }

  // ── Africa's Talking SMS ───────────────────────────────────
  if (!process.env.AT_API_KEY || !process.env.AT_USERNAME) {
    warnings.push(
      'AT_API_KEY / AT_USERNAME not set — SMS payment notifications will be disabled',
    );
  }

  // ── API Base URL ───────────────────────────────────────────
  if (!process.env.API_BASE_URL) {
    errors.push('API_BASE_URL is not set — M-Pesa callback URLs cannot be constructed');
  } else if (
    process.env.NODE_ENV === 'production' &&
    !process.env.API_BASE_URL.startsWith('https://')
  ) {
    errors.push('API_BASE_URL must use HTTPS in production');
  }

  // ── Redis ──────────────────────────────────────────────────
  if (!process.env.REDIS_HOST) {
    warnings.push('REDIS_HOST not set — using default localhost:6379');
  }

  return { passed: errors.length === 0, errors, warnings };
}
