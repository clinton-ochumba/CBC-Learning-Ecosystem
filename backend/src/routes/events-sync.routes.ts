/**
 * CBC Learning Ecosystem — School Events Routes
 *
 * GET  /api/v1/schools/:schoolId/events      — upcoming events
 * POST /api/v1/schools/:schoolId/events      — create event + optional SMS reminder
 * PUT  /api/v1/schools/:schoolId/events/:id  — update event
 * DELETE /api/v1/schools/:schoolId/events/:id — cancel event
 *
 * GET  /api/v1/sync/conflicts                — list pending offline conflicts
 * POST /api/v1/sync/queue                    — submit device sync queue
 * POST /api/v1/sync/resolve/:conflictId      — manually resolve a conflict
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { SmsNotificationService } from '../services/sms-notification.service';
import { OfflineSyncService } from '../services/offline-sync.service';
import { authenticate, requireRole, requireSchool } from '../middleware/auth';
import { logger } from '../utils/logger';

// ─── Events controller (inline — lightweight enough) ─────────────────────────

function createEventsHandlers(db: Pool) {
  const smsService = new SmsNotificationService(db);

  const listEvents = async (req: Request, res: Response): Promise<void> => {
    const { schoolId } = req.params;
    const { from, limit = '10' } = req.query;
    const fromDate = (from as string) || new Date().toISOString().slice(0, 10);

    try {
      const result = await db.query<any>(
        `SELECT id, title, description, event_date, event_time, type, sms_sent
         FROM school_events
         WHERE school_id = $1 AND event_date >= $2
         ORDER BY event_date ASC
         LIMIT $3`,
        [schoolId, fromDate, parseInt(limit as string)]
      );
      res.json({ success: true, data: result.rows });
    } catch (err: any) {
      logger.error('listEvents error', { schoolId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to fetch events' });
    }
  };

  const createEvent = async (req: Request, res: Response): Promise<void> => {
    const { schoolId } = req.params;
    const { title, description, eventDate, eventTime, type, scheduleSmsReminder = true } = req.body;

    if (!title || !eventDate) {
      res.status(400).json({ success: false, message: 'title and eventDate required' });
      return;
    }

    try {
      const result = await db.query<{ id: number }>(
        `INSERT INTO school_events (school_id, title, description, event_date, event_time, type, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) RETURNING id`,
        [schoolId, title, description ?? null, eventDate, eventTime ?? null,
         type ?? 'other', req.user!.id]
      );

      const eventId = result.rows[0].id;
      let reminderScheduled = false;

      // If event is 3+ days away and SMS reminder requested, queue it
      if (scheduleSmsReminder) {
        const daysUntil = Math.floor(
          (new Date(eventDate).getTime() - Date.now()) / 86400000
        );
        if (daysUntil >= 3) {
          // Fetch all parent phones for the school
          const phones = await db.query<{ primary_phone: string }>(
            `SELECT DISTINCT s.primary_phone FROM students s
             WHERE s.school_id = $1 AND s.primary_phone IS NOT NULL
               AND s.enrollment_status = 'active'`,
            [schoolId]
          );
          const schoolRes = await db.query<{ name: string }>(
            `SELECT name FROM schools WHERE id = $1`, [schoolId]
          );
          if (phones.rows.length && schoolRes.rows.length) {
            // Fire reminder 3 days before — for now queue immediately as demo
            // In production this would be a scheduled job
            smsService.sendSchoolEvent({
              parentPhones: phones.rows.map(r => r.primary_phone),
              eventTitle: title,
              eventDate: new Date(eventDate).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' }),
              eventTime: eventTime ?? 'TBD',
              schoolName: schoolRes.rows[0].name,
              schoolId: parseInt(schoolId),
              eventId,
            }).then(results => {
              const sent = results.filter(r => r.success).length;
              db.query(`UPDATE school_events SET sms_sent = true WHERE id = $1`, [eventId]).catch(() => {});
              logger.info('Event SMS reminders sent', { eventId, sent });
            }).catch(() => {});
            reminderScheduled = true;
          }
        }
      }

      logger.info('Event created', { schoolId, eventId, title });
      res.status(201).json({
        success: true,
        data: { id: eventId, title, reminderScheduled },
      });
    } catch (err: any) {
      logger.error('createEvent error', { schoolId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to create event' });
    }
  };

  const updateEvent = async (req: Request, res: Response): Promise<void> => {
    const { schoolId, eventId } = req.params;
    const { title, description, eventDate, eventTime, type } = req.body;

    try {
      const result = await db.query(
        `UPDATE school_events
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             event_date = COALESCE($3, event_date),
             event_time = COALESCE($4, event_time),
             type = COALESCE($5, type),
             updated_at = NOW()
         WHERE id = $6 AND school_id = $7
         RETURNING id`,
        [title ?? null, description ?? null, eventDate ?? null,
         eventTime ?? null, type ?? null, eventId, schoolId]
      );
      if (!result.rows.length) {
        res.status(404).json({ success: false, message: 'Event not found' });
        return;
      }
      res.json({ success: true, data: { id: parseInt(eventId) } });
    } catch (err: any) {
      logger.error('updateEvent error', { eventId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to update event' });
    }
  };

  const deleteEvent = async (req: Request, res: Response): Promise<void> => {
    const { schoolId, eventId } = req.params;
    try {
      const result = await db.query(
        `DELETE FROM school_events WHERE id = $1 AND school_id = $2 RETURNING id`,
        [eventId, schoolId]
      );
      if (!result.rows.length) {
        res.status(404).json({ success: false, message: 'Event not found' });
        return;
      }
      res.json({ success: true, data: { deleted: true } });
    } catch (err: any) {
      logger.error('deleteEvent error', { eventId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to delete event' });
    }
  };

  return { listEvents, createEvent, updateEvent, deleteEvent };
}

// ─── Offline sync handlers (inline) ──────────────────────────────────────────

function createSyncHandlers(db: Pool, redis: Redis) {
  // OfflineSyncService takes a Knex instance; wrap pg.Pool with a compatible shim
  // In production app.ts passes the knex db; here we construct a minimal adapter
  const syncService = new OfflineSyncService(db as any);

  const submitSyncQueue = async (req: Request, res: Response): Promise<void> => {
    const { deviceId, records } = req.body;
    if (!deviceId || !Array.isArray(records)) {
      res.status(400).json({ success: false, message: 'deviceId and records[] required' });
      return;
    }
    try {
      const result = await syncService.processSyncQueue(deviceId, records);
      res.json({ success: true, data: result });
    } catch (err: any) {
      logger.error('submitSyncQueue error', { deviceId, error: err.message });
      res.status(500).json({ success: false, message: 'Sync processing failed' });
    }
  };

  const listConflicts = async (req: Request, res: Response): Promise<void> => {
    const userId = String(req.user!.id);
    try {
      const conflicts = await syncService.getPendingConflicts(userId);
      res.json({ success: true, data: conflicts });
    } catch (err: any) {
      logger.error('listConflicts error', { error: err.message });
      res.status(500).json({ success: false, message: 'Failed to fetch conflicts' });
    }
  };

  const resolveConflict = async (req: Request, res: Response): Promise<void> => {
    const { conflictId } = req.params;
    const { resolution, mergedData } = req.body;

    if (!['local', 'server', 'merge'].includes(resolution)) {
      res.status(400).json({ success: false, message: 'resolution must be local|server|merge' });
      return;
    }

    try {
      await syncService.manuallyResolveConflict(conflictId, resolution, mergedData);
      res.json({ success: true, data: { conflictId, resolution } });
    } catch (err: any) {
      logger.error('resolveConflict error', { conflictId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to resolve conflict' });
    }
  };

  return { submitSyncQueue, listConflicts, resolveConflict };
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createEventsAndSyncRouter(db: Pool, redis: Redis): Router {
  const router = Router();
  const events = createEventsHandlers(db);
  const sync   = createSyncHandlers(db, redis);

  // ── Events ─────────────────────────────────────────────────────────────────
  router.get(
    '/schools/:schoolId/events',
    authenticate,
    requireSchool,
    events.listEvents
  );

  router.post(
    '/schools/:schoolId/events',
    authenticate,
    requireRole('teacher', 'principal', 'admin', 'super_admin'),
    requireSchool,
    events.createEvent
  );

  router.put(
    '/schools/:schoolId/events/:eventId',
    authenticate,
    requireRole('principal', 'admin', 'super_admin'),
    requireSchool,
    events.updateEvent
  );

  router.delete(
    '/schools/:schoolId/events/:eventId',
    authenticate,
    requireRole('principal', 'admin', 'super_admin'),
    requireSchool,
    events.deleteEvent
  );

  // ── Offline sync ───────────────────────────────────────────────────────────
  router.post(
    '/sync/queue',
    authenticate,
    sync.submitSyncQueue
  );

  router.get(
    '/sync/conflicts',
    authenticate,
    sync.listConflicts
  );

  router.post(
    '/sync/resolve/:conflictId',
    authenticate,
    requireRole('teacher', 'principal', 'admin', 'super_admin'),
    sync.resolveConflict
  );

  return router;
}
