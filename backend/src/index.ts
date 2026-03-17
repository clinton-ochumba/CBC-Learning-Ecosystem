/**
 * CBC Learning Ecosystem — Backend API Entry Point
 *
 * Stack: Express 4 + TypeScript + Knex + PostgreSQL + Redis
 * Compliance: ODPC (Kenya Data Protection Act), M-Pesa Daraja API, CBC curriculum
 */

import 'express-async-errors';            // Patches Express to forward async errors to the error handler
import dotenv from 'dotenv';
dotenv.config();                          // Load .env before any other imports read process.env

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { validateStartupEnv }    from './middleware/startup-validation';
import { errorHandler }          from './middleware/error-handler';
import { checkDatabaseConnection } from './config/database';
import { logger }                from './utils/logger';

// Route modules
import mpesaRoutes from './routes/mpesa.routes';
import authRoutes  from './routes/auth.routes';
import { createStudentsRouter } from './routes/students.routes';
import { createAssessmentsRouter } from './routes/assessments.routes';
import { createAttendanceRouter } from './routes/attendance.routes';
import { createUssdRouter } from './routes/ussd.routes';
import { createEventsAndSyncRouter } from './routes/events-sync.routes';

// ── Startup validation (exits if secrets invalid) ─────────────────────────────
validateStartupEnv();

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,    // Handled by nginx on the frontend
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server calls (no origin header) and whitelisted domains
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ── Request logging ───────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Global rate limiter (defence in depth) ────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
}));

// ── Trust Railway / Render / Vercel reverse proxy ─────────────────────────────
app.set('trust proxy', 1);

// ── Health check (no auth required — used by Railway, Render, load balancers) ─
app.get('/health', async (_req, res) => {
  try {
    const { db } = await import('./config/database');
    const { redis } = await import('./config/redis');
    await db.raw('SELECT 1');
    const redisPing = await redis.ping();
    res.json({
      status: 'ok',
      version: '1.0.0',
      db: 'connected',
      redis: redisPing === 'PONG' ? 'connected' : 'degraded',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      mpesa: process.env.MPESA_ENVIRONMENT || 'not configured',
    });
  } catch {
    res.status(503).json({ status: 'degraded', timestamp: new Date().toISOString() });
  }
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',     authRoutes);
app.use('/api/v1/payments', mpesaRoutes);

// Routes that require db/redis will be registered after server starts
// (they are registered in the start() function below)

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '5000', 10);

async function start() {
  try {
    const { db } = await import('./config/database');
    const { redis } = await import('./config/redis');
    await checkDatabaseConnection();

    // Register routes that require db/redis
    app.use('/api/v1/students',      createStudentsRouter(db));
    app.use('/api/v1/assessments',   createAssessmentsRouter(db));
    app.use('/api/v1/attendance',    createAttendanceRouter(db));
    app.use('/api/v1/ussd',          createUssdRouter(db, redis));
    app.use('/api/v1/sync',          createEventsAndSyncRouter(db, redis));

    app.listen(PORT, () => {
      logger.info(`[server] ✅ CBC Learning Ecosystem API listening on port ${PORT}`);
      logger.info(`[server]    Environment: ${process.env.NODE_ENV}`);
      logger.info(`[server]    M-Pesa mode: ${process.env.MPESA_ENVIRONMENT || 'not configured'}`);
      logger.info(`[server]    CORS origins: ${allowedOrigins.join(', ')}`);
    });
  } catch (err) {
    logger.error('[server] ❌ Failed to start — database unreachable', {
      error: (err as Error).message,
    });
    process.exit(1);
  }
}

start();

start();
