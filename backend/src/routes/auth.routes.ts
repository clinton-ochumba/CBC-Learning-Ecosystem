/**
 * Auth Routes — CBC Learning Ecosystem
 *
 * POST /api/v1/auth/login
 * POST /api/v1/auth/register       (requires school_admin or super_admin JWT)
 * POST /api/v1/auth/refresh
 * POST /api/v1/auth/logout         (requires JWT)
 * GET  /api/v1/auth/me             (requires JWT)
 * POST /api/v1/auth/change-password (requires JWT)
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
import { AuthController } from '../controllers/auth.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';

const router = express.Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Strict limit on login to slow down brute-force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Key by IP
  keyGenerator: (req) => req.ip || 'unknown',
});

// Moderate limit on refresh — legitimate clients rotate infrequently
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 5,
  message: { success: false, message: 'Too many refresh requests' },
});

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/login
 * Public — rate limited to 10 req/15min per IP
 */
router.post(
  '/login',
  loginLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 1 }).withMessage('Password required'),
  ],
  validate,
  AuthController.login,
);

/**
 * POST /api/v1/auth/refresh
 * Public — but requires valid refresh token in body
 */
router.post(
  '/refresh',
  refreshLimiter,
  [body('refreshToken').isString().notEmpty().withMessage('Refresh token required')],
  validate,
  AuthController.refresh,
);

/**
 * POST /api/v1/auth/logout
 * Requires JWT — invalidates refresh token
 */
router.post('/logout', authenticate, AuthController.logout);

/**
 * GET /api/v1/auth/me
 * Requires JWT — returns current user profile
 */
router.get('/me', authenticate, AuthController.me);

/**
 * POST /api/v1/auth/register
 * Requires JWT — school_admin can create teacher/parent/student accounts
 */
router.post(
  '/register',
  authenticate,
  requireRole('school_admin', 'super_admin'),
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('firstName').isLength({ min: 1, max: 100 }).withMessage('First name required'),
    body('lastName').isLength({ min: 1, max: 100 }).withMessage('Last name required'),
    body('role').isIn(['teacher', 'parent', 'student', 'school_admin', 'super_admin'])
      .withMessage('Invalid role'),
  ],
  validate,
  AuthController.register,
);

/**
 * POST /api/v1/auth/change-password
 * Requires JWT — change own password
 */
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').isLength({ min: 1 }).withMessage('Current password required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  ],
  validate,
  AuthController.changePassword,
);

export default router;
