/**
 * CBC Learning Ecosystem — Attendance Routes
 *
 * POST /api/v1/attendance/bulk           — mark register for a class (teachers)
 * GET  /api/v1/attendance/:classId/date  — fetch register by class + date
 * PUT  /api/v1/attendance/:recordId      — correct a single entry (teacher/admin)
 */

import { Router } from 'express';
import { Knex } from 'knex';
import { AttendanceController } from '../controllers/attendance.controller';
import { authenticate, requireRole } from '../middleware/auth';

export function createAttendanceRouter(db: Knex): Router {
  const router = Router();
  const ctrl   = new AttendanceController(db as any);

  // Mark full-class register — teacher or above
  router.post(
    '/bulk',
    authenticate,
    requireRole('teacher', 'school_admin', 'super_admin'),
    ctrl.markBulkAttendance
  );

  // Fetch register for class on a date
  router.get(
    '/:classId/date',
    authenticate,
    requireRole('teacher', 'school_admin', 'super_admin'),
    ctrl.getClassRegister
  );

  // Correct a single record
  router.put(
    '/:recordId',
    authenticate,
    requireRole('teacher', 'school_admin', 'super_admin'),
    ctrl.correctAttendance
  );

  return router;
}
