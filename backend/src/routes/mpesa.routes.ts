/**
 * M-Pesa Payment Routes
 *
 * FIXES APPLIED:
 *   SEC-04: express-rate-limit on STK push (5 req/min per user)
 *   SEC-02: Safaricom IP whitelist middleware on callback/timeout/c2b endpoints
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { MpesaController } from '../controllers/mpesa.controller';
import { authenticate } from '../middleware/auth';
import { safaricomWhitelist } from '../middleware/safaricom-whitelist';
import { body, param, query } from 'express-validator';
import { validate } from '../middleware/validation';

const router = express.Router();

// ── FIX SEC-04: Rate limiter for STK Push ──────────────────────────────────
// 5 payment initiations per user per minute prevents abuse and API quota drain.
// Uses per-user keying (not per-IP) so mobile NAT gateways don't block groups.
const stkPushLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: (req) => {
    const user = (req as any).user;
    return user?.id?.toString() ?? req.ip;
  },
  message: {
    success: false,
    error: 'Too many payment requests. Please wait a minute before trying again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Initiate STK Push payment
 * POST /api/v1/payments/mpesa/initiate
 * Requires authentication (parent or admin)
 */
router.post(
  '/initiate',
  authenticate,
  stkPushLimiter, // FIX SEC-04
  [
    body('studentId').isInt().withMessage('Valid student ID is required'),
    body('amount')
      .isFloat({ min: 10, max: 250000 })
      .withMessage('Amount must be between Ksh 10 and Ksh 250,000'),
    body('phoneNumber')
      .matches(/^254\d{9}$/)
      .withMessage('Phone number must be in format 254XXXXXXXXX'),
    body('description').optional().isString(),
  ],
  validate,
  MpesaController.initiatePayment,
);

/**
 * M-Pesa callback (STK Push result)
 * POST /api/v1/payments/mpesa/callback
 * FIX SEC-02: Restricted to Safaricom IP ranges
 */
router.post(
  '/callback',
  safaricomWhitelist, // FIX SEC-02
  MpesaController.handleCallback,
);

/**
 * M-Pesa timeout callback
 * POST /api/v1/payments/mpesa/timeout
 * FIX SEC-02: Restricted to Safaricom IP ranges
 */
router.post(
  '/timeout',
  safaricomWhitelist, // FIX SEC-02
  MpesaController.handleTimeout,
);

/**
 * C2B Validation (PayBill)
 * POST /api/v1/payments/mpesa/c2b/validation
 * FIX SEC-02: Restricted to Safaricom IP ranges
 */
router.post(
  '/c2b/validation',
  safaricomWhitelist, // FIX SEC-02
  MpesaController.validateC2B,
);

/**
 * C2B Confirmation (PayBill)
 * POST /api/v1/payments/mpesa/c2b/confirmation
 * FIX SEC-02: Restricted to Safaricom IP ranges
 */
router.post(
  '/c2b/confirmation',
  safaricomWhitelist, // FIX SEC-02
  MpesaController.confirmC2B,
);

/**
 * Query payment status
 * GET /api/v1/payments/mpesa/status/:checkoutRequestId
 */
router.get(
  '/status/:checkoutRequestId',
  authenticate,
  [
    param('checkoutRequestId')
      .isString()
      .withMessage('Valid checkout request ID is required'),
  ],
  validate,
  MpesaController.queryStatus,
);

/**
 * Get payment history for a student
 * GET /api/v1/payments/student/:studentId/history
 */
router.get(
  '/student/:studentId/history',
  authenticate,
  [
    param('studentId').isInt().withMessage('Valid student ID is required'),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
  ],
  validate,
  MpesaController.getPaymentHistory,
);

/**
 * Record manual payment (cash/bank)
 * POST /api/v1/payments/manual
 */
router.post(
  '/manual',
  authenticate,
  [
    body('studentId').isInt().withMessage('Valid student ID is required'),
    body('amount').isFloat({ min: 1 }).withMessage('Valid amount is required'),
    body('paymentMethod')
      .isIn(['cash', 'bank', 'cheque'])
      .withMessage('Payment method must be cash, bank, or cheque'),
    body('receiptNumber').isString().withMessage('Receipt number is required'),
    body('paymentDate').optional().isISO8601(),
    body('notes').optional().isString(),
  ],
  validate,
  MpesaController.recordManualPayment,
);

export default router;
