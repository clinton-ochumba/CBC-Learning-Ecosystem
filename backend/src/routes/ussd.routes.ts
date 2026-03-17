/**
 * CBC Learning Ecosystem — USSD & SMS Routes
 *
 * Public (Africa's Talking webhook — no JWT):
 *   POST /api/v1/ussd/callback     — USSD session callback
 *   POST /api/v1/ussd/sms-inbound  — Inbound SMS commands
 *
 * Internal (JWT required):
 *   POST /api/v1/ussd/notify       — Trigger a notification SMS
 *   GET  /api/v1/ussd/health       — AT connectivity check
 *
 * Security:
 *   - AT webhook endpoints are NOT JWT-protected (AT doesn't send tokens)
 *   - Instead, they are rate-limited and we validate AT-specific headers
 *   - The /notify endpoint requires a valid teacher/admin JWT
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { UssdController } from '../controllers/ussd.controller';
import { UssdService } from '../services/ussd.service';
import { SmsNotificationService } from '../services/sms-notification.service';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';

export function createUssdRouter(db: Pool, redis: Redis) {
  const router = express.Router();

  // Instantiate services
  const ussdService = new UssdService(redis, db);
  const smsService  = new SmsNotificationService(db);
  const controller  = new UssdController(ussdService, smsService);

  // ── Rate limiting ─────────────────────────────────────────────────────────

  // AT webhook endpoints: allow up to 300/min (AT may send bursts for large schools)
  const atWebhookLimit = rateLimit({
    windowMs: 60_000,
    max: 300,
    message: 'END Too many requests. Please try again later.',
    skipSuccessfulRequests: false,
    keyGenerator: (req) => req.body?.phoneNumber || req.ip,
    handler: (req, res) => {
      logger.warn('USSD rate limit hit', { ip: req.ip, phone: req.body?.phoneNumber });
      res.status(200).type('text/plain').send('END Service busy. Please dial again in a moment.');
    },
  });

  // Internal notify endpoint: 60/min per school
  const notifyLimit = rateLimit({
    windowMs: 60_000,
    max: 60,
    message: { error: 'Rate limit exceeded' },
  });

  // ── AT IP allowlist middleware (production only) ───────────────────────────
  // Africa's Talking callback IPs (documented at africastalking.com/docs)
  const AT_IPS = [
    '196.201.214.200',
    '196.201.214.201',
    '196.201.217.190',
    '196.201.214.137',
    '196.201.214.138',
    '196.201.217.184',
  ];

  const verifyAtOrigin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // In sandbox/test, skip IP check
    if (process.env.AT_USERNAME === 'sandbox' || process.env.NODE_ENV === 'test') {
      return next();
    }
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    if (AT_IPS.includes(ip)) return next();
    logger.warn('USSD request from non-AT IP', { ip, path: req.path });
    // Return 200 with END to avoid AT retry storms
    return res.status(200).type('text/plain').send('END Unauthorized origin.');
  };

  // ── Routes ────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/ussd/callback
   * Africa's Talking USSD session handler.
   * Accepts: application/x-www-form-urlencoded (AT default)
   */
  router.post(
    '/callback',
    atWebhookLimit,
    verifyAtOrigin,
    express.urlencoded({ extended: false }),
    controller.handleUssdCallback
  );

  /**
   * POST /api/v1/ussd/sms-inbound
   * Africa's Talking inbound SMS webhook.
   */
  router.post(
    '/sms-inbound',
    atWebhookLimit,
    verifyAtOrigin,
    express.urlencoded({ extended: false }),
    controller.handleSmsInbound
  );

  /**
   * POST /api/v1/ussd/notify
   * Internal: trigger a notification SMS.
   * Called by attendance service, grade posting, fee system.
   * Requires JWT (teacher or admin role).
   */
  router.post(
    '/notify',
    authenticate,
    notifyLimit,
    controller.sendNotification
  );

  /**
   * GET /api/v1/ussd/health
   */
  router.get('/health', controller.healthCheck);

  return router;
}
