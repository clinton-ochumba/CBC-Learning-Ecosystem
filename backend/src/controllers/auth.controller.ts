/**
 * Auth Controller — CBC Learning Ecosystem
 *
 * Endpoints:
 *   POST /api/v1/auth/login       — email + password → JWT pair
 *   POST /api/v1/auth/register    — create user (school_admin only for teachers/parents)
 *   POST /api/v1/auth/refresh     — rotate access token using refresh token
 *   POST /api/v1/auth/logout      — invalidate refresh token
 *   GET  /api/v1/auth/me          — return current user profile
 *   POST /api/v1/auth/forgot-password  — send reset email (stub)
 *   POST /api/v1/auth/reset-password   — apply new password via token
 *
 * Security: bcrypt password hashing, account lockout after 5 failures,
 *           refresh tokens stored as hashes (not plaintext), ODPC audit log.
 */

import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../config/database';
import { logger } from '../utils/logger';
import { AuthUser } from '../middleware/auth';

// ── Token helpers ─────────────────────────────────────────────────────────────
function signAccessToken(user: AuthUser): string {
  const secret = process.env.JWT_SECRET!;
  return jwt.sign(
    {
      id: user.id,
      schoolId: user.schoolId,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as any,
  );
}

function signRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildUserResponse(dbUser: any): AuthUser {
  return {
    id:        dbUser.id,
    schoolId:  dbUser.school_id,
    email:     dbUser.email,
    role:      dbUser.role,
    firstName: dbUser.first_name,
    lastName:  dbUser.last_name,
  };
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export class AuthController {
  /**
   * POST /api/v1/auth/login
   */
  static async login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required' });
      return;
    }

    try {
      const user = await db('users')
        .where({ email: email.toLowerCase().trim() })
        .first();

      // Generic error — don't reveal whether email exists
      if (!user) {
        res.status(401).json({ success: false, message: 'Invalid email or password' });
        return;
      }

      if (!user.is_active) {
        res.status(401).json({ success: false, message: 'Account is deactivated. Contact your school admin.' });
        return;
      }

      // Check account lockout
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const remaining = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
        res.status(429).json({
          success: false,
          message: `Account temporarily locked. Try again in ${remaining} minute(s).`,
        });
        return;
      }

      const passwordMatch = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatch) {
        const attempts = (user.failed_login_attempts || 0) + 1;
        const updates: Record<string, any> = { failed_login_attempts: attempts };
        if (attempts >= MAX_FAILED_ATTEMPTS) {
          updates.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
          logger.warn(`[auth] Account locked after ${attempts} failed attempts`, { email });
        }
        await db('users').where({ id: user.id }).update(updates);
        res.status(401).json({ success: false, message: 'Invalid email or password' });
        return;
      }

      // Password correct — reset failure counter
      const refreshToken  = signRefreshToken();
      const refreshExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await db('users').where({ id: user.id }).update({
        failed_login_attempts:    0,
        locked_until:             null,
        last_login_at:            new Date(),
        refresh_token_hash:       hashToken(refreshToken),
        refresh_token_expires_at: refreshExpiry,
        updated_at:               new Date(),
      });

      const userObj    = buildUserResponse(user);
      const accessToken = signAccessToken(userObj);

      logger.info('[auth] Login successful', { userId: user.id, role: user.role, email });

      res.json({
        success: true,
        token:   accessToken,
        refreshToken,
        user: userObj,
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      });
    } catch (err) {
      logger.error('[auth] Login error', { error: (err as Error).message });
      res.status(500).json({ success: false, message: 'Authentication failed' });
    }
  }

  /**
   * POST /api/v1/auth/refresh
   * Body: { refreshToken }
   */
  static async refresh(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ success: false, message: 'Refresh token is required' });
      return;
    }

    try {
      const tokenHash = hashToken(refreshToken);
      const user = await db('users')
        .where({ refresh_token_hash: tokenHash })
        .first();

      if (!user || !user.refresh_token_expires_at ||
          new Date(user.refresh_token_expires_at) < new Date()) {
        res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
        return;
      }

      if (!user.is_active) {
        res.status(401).json({ success: false, message: 'Account deactivated' });
        return;
      }

      // Rotate refresh token
      const newRefreshToken  = signRefreshToken();
      const newRefreshExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db('users').where({ id: user.id }).update({
        refresh_token_hash:       hashToken(newRefreshToken),
        refresh_token_expires_at: newRefreshExpiry,
        updated_at:               new Date(),
      });

      const userObj    = buildUserResponse(user);
      const accessToken = signAccessToken(userObj);

      res.json({ success: true, token: accessToken, refreshToken: newRefreshToken, user: userObj });
    } catch (err) {
      logger.error('[auth] Refresh error', { error: (err as Error).message });
      res.status(500).json({ success: false, message: 'Token refresh failed' });
    }
  }

  /**
   * POST /api/v1/auth/logout
   */
  static async logout(req: Request, res: Response): Promise<void> {
    try {
      if (req.user) {
        await db('users').where({ id: req.user.id }).update({
          refresh_token_hash:       null,
          refresh_token_expires_at: null,
          updated_at:               new Date(),
        });
        logger.info('[auth] User logged out', { userId: req.user.id });
      }
      res.json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
      logger.error('[auth] Logout error', { error: (err as Error).message });
      res.json({ success: true, message: 'Logged out' }); // Always succeed on logout
    }
  }

  /**
   * GET /api/v1/auth/me
   */
  static async me(req: Request, res: Response): Promise<void> {
    try {
      const user = await db('users').where({ id: req.user!.id }).first();
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      // Fetch school name for context
      let schoolName: string | null = null;
      if (user.school_id) {
        const school = await db('schools').where({ id: user.school_id }).select('name').first();
        schoolName = school?.name || null;
      }

      res.json({
        success: true,
        user: {
          ...buildUserResponse(user),
          schoolName,
          lastLoginAt:    user.last_login_at,
          consentGiven:   user.consent_given,
          emailVerified:  user.email_verified,
          phone:          user.phone,
        },
      });
    } catch (err) {
      logger.error('[auth] /me error', { error: (err as Error).message });
      res.status(500).json({ success: false, message: 'Failed to fetch profile' });
    }
  }

  /**
   * POST /api/v1/auth/register
   * Creates a new user. Only school_admin can create teacher/parent/student accounts.
   * super_admin can create school_admin accounts.
   */
  static async register(req: Request, res: Response): Promise<void> {
    const { email, password, firstName, lastName, phone, role, schoolId } = req.body;

    if (!email || !password || !firstName || !lastName || !role) {
      res.status(400).json({ success: false, message: 'Missing required fields' });
      return;
    }

    // Role permission checks
    const actorRole   = req.user?.role;
    const allowedRoles: Record<string, string[]> = {
      super_admin:  ['school_admin', 'super_admin'],
      school_admin: ['teacher', 'parent', 'student'],
    };
    if (!actorRole || !allowedRoles[actorRole]?.includes(role)) {
      res.status(403).json({ success: false, message: `You cannot create a '${role}' account` });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
      return;
    }

    try {
      const existing = await db('users').where({ email: email.toLowerCase().trim() }).first();
      if (existing) {
        res.status(409).json({ success: false, message: 'Email already registered' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const targetSchoolId = schoolId || req.user?.schoolId || null;

      const [newUser] = await db('users').insert({
        email:          email.toLowerCase().trim(),
        password_hash:  passwordHash,
        first_name:     firstName.trim(),
        last_name:      lastName.trim(),
        phone:          phone?.trim() || null,
        role,
        school_id:      targetSchoolId,
        is_active:      true,
        consent_given:  false,
        created_at:     new Date(),
        updated_at:     new Date(),
      }).returning('*');

      logger.info('[auth] User registered', { email, role, createdBy: req.user?.id });

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        user: buildUserResponse(newUser),
      });
    } catch (err) {
      logger.error('[auth] Register error', { error: (err as Error).message });
      res.status(500).json({ success: false, message: 'Failed to create user' });
    }
  }

  /**
   * POST /api/v1/auth/change-password
   */
  static async changePassword(req: Request, res: Response): Promise<void> {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ success: false, message: 'Current and new passwords are required' });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
      return;
    }

    try {
      const user = await db('users').where({ id: req.user!.id }).first();
      const match = await bcrypt.compare(currentPassword, user.password_hash);

      if (!match) {
        res.status(401).json({ success: false, message: 'Current password is incorrect' });
        return;
      }

      const newHash = await bcrypt.hash(newPassword, 12);
      await db('users').where({ id: req.user!.id }).update({
        password_hash:            newHash,
        refresh_token_hash:       null,   // Force re-login on all devices
        refresh_token_expires_at: null,
        updated_at:               new Date(),
      });

      logger.info('[auth] Password changed', { userId: req.user!.id });
      res.json({ success: true, message: 'Password updated. Please log in again.' });
    } catch (err) {
      logger.error('[auth] Change password error', { error: (err as Error).message });
      res.status(500).json({ success: false, message: 'Failed to change password' });
    }
  }
}
