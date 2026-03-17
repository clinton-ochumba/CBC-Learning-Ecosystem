/**
 * CBC Learning Ecosystem — Assessments Routes
 *
 * POST /api/v1/assessments                       — create assessment
 * GET  /api/v1/assessments/:assessmentId         — get assessment + class stats
 * POST /api/v1/assessments/:assessmentId/grades  — submit grades (bulk)
 * GET  /api/v1/schools/:schoolId/assessments     — list school assessments
 */

import { Router } from 'express';
import { Knex } from 'knex';
import { AssessmentsController } from '../controllers/assessments.controller';
import { authenticate, requireRole, requireSameSchool } from '../middleware/auth';

export function createAssessmentsRouter(db: Knex): Router {
  const router = Router();
  const ctrl   = new AssessmentsController(db as any);

  // Create an assessment — teachers and above
  router.post(
    '/',
    authenticate,
    requireRole('teacher', 'principal', 'admin', 'super_admin'),
    ctrl.createAssessment
  );

  // Get single assessment with class stats
  router.get(
    '/:assessmentId',
    authenticate,
    ctrl.getAssessment
  );

  // Bulk grade submission — teachers only
  router.post(
    '/:assessmentId/grades',
    authenticate,
    requireRole('teacher', 'principal', 'admin', 'super_admin'),
    ctrl.submitGrades
  );

  // List assessments for a school
  router.get(
    '/schools/:schoolId',
    authenticate,
    requireSameSchool,
    ctrl.listAssessments
  );

  return router;
}
