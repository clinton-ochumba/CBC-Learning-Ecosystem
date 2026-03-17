/**
 * CBC Learning Ecosystem — Student Routes
 *
 * GET  /api/v1/students/:studentId              — student profile
 * GET  /api/v1/students/:studentId/competencies — CBC competency levels + history
 * GET  /api/v1/students/:studentId/grades       — grade history
 * GET  /api/v1/students/:studentId/attendance   — attendance records
 * PUT  /api/v1/students/:studentId              — update profile (teacher/admin)
 * GET  /api/v1/schools/:schoolId/students       — list students in school
 * POST /api/v1/schools/:schoolId/students       — enrol new student (admin/principal)
 */

import { Router } from 'express';
import { Knex } from 'knex';
import { StudentsController } from '../controllers/students.controller';
import { authenticate, requireRole, requireSameSchool } from '../middleware/auth';

export function createStudentsRouter(db: Knex): Router {
  const router = Router();
  const ctrl   = new StudentsController(db as any);

  // ── Student profile ────────────────────────────────────────────────────────
  router.get(
    '/students/:studentId',
    authenticate,
    ctrl.getStudent
  );

  router.put(
    '/students/:studentId',
    authenticate,
    requireRole('teacher', 'school_admin', 'super_admin'),
    ctrl.updateStudent
  );

  // ── CBC competencies ───────────────────────────────────────────────────────
  router.get(
    '/students/:studentId/competencies',
    authenticate,
    ctrl.getCompetencies
  );

  // ── Grades ─────────────────────────────────────────────────────────────────
  router.get(
    '/students/:studentId/grades',
    authenticate,
    ctrl.getGrades
  );

  // ── Attendance per student ─────────────────────────────────────────────────
  router.get(
    '/students/:studentId/attendance',
    authenticate,
    ctrl.getAttendance
  );

  // ── School-scoped student management ──────────────────────────────────────
  router.get(
    '/schools/:schoolId/students',
    authenticate,
    requireSameSchool,
    ctrl.listStudents
  );

  router.post(
    '/schools/:schoolId/students',
    authenticate,
    requireRole('teacher', 'school_admin', 'super_admin'),
    requireSameSchool,
    ctrl.enrolStudent
  );

  return router;
}
