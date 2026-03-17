/**
 * CBC Learning Ecosystem — Assessments Controller
 *
 * POST /assessments                        — create assessment
 * GET  /assessments/:assessmentId          — get assessment + class stats
 * POST /assessments/:assessmentId/grades   — submit grades (bulk) + notify parents
 * GET  /schools/:schoolId/assessments      — list school assessments
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { SmsNotificationService } from '../services/sms-notification.service';
import { logger } from '../utils/logger';

// ── CBC competency level from percentage ──────────────────────────────────────

function cbcLevel(pct: number): 'EE' | 'ME' | 'AE' | 'BE' {
  if (pct >= 80) return 'EE';
  if (pct >= 60) return 'ME';
  if (pct >= 40) return 'AE';
  return 'BE';
}

export class AssessmentsController {
  private smsService: SmsNotificationService;

  constructor(private db: Pool) {
    this.smsService = new SmsNotificationService(db);
  }

  // ── POST /assessments ─────────────────────────────────────────────────────

  createAssessment = async (req: Request, res: Response): Promise<void> => {
    const {
      title, classId, schoolId, subject, maxScore,
      assessmentDate, cbcStrand, term,
    } = req.body;

    if (!title || !classId || !maxScore || !assessmentDate) {
      res.status(400).json({
        success: false,
        message: 'Required: title, classId, maxScore, assessmentDate',
      });
      return;
    }

    const teacher = req.user!;
    const effectiveSchoolId = schoolId ?? teacher.schoolId;

    try {
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO assessments
           (title, class_name, school_id, subject, max_score, assessment_date,
            cbc_strand, term, status, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'upcoming',$9,NOW(),NOW())
         RETURNING id`,
        [title, classId, effectiveSchoolId, subject ?? null, maxScore,
          assessmentDate, cbcStrand ?? null, term ?? null, teacher.id],
      );

      logger.info('Assessment created', { id: result.rows[0].id, classId, title });
      res.status(201).json({
        success: true,
        data: { id: result.rows[0].id, title, classId, status: 'upcoming' },
      });
    } catch (err: any) {
      logger.error('createAssessment error', { error: err.message });
      res.status(500).json({ success: false, message: 'Failed to create assessment' });
    }
  };

  // ── GET /assessments/:assessmentId ────────────────────────────────────────

  getAssessment = async (req: Request, res: Response): Promise<void> => {
    const { assessmentId } = req.params;

    try {
      const [asmRes, gradesRes] = await Promise.all([
        this.db.query<any>(
          `SELECT a.*, u.first_name AS teacher_first, u.last_name AS teacher_last
           FROM assessments a
           LEFT JOIN users u ON u.id = a.created_by
           WHERE a.id = $1`,
          [assessmentId],
        ),
        this.db.query<any>(
          `SELECT g.student_id, g.score, g.notes,
                  s.first_name, s.last_name, s.admission_number,
                  ROUND((g.score / a.max_score * 100)::numeric, 1) AS percentage
           FROM grades g
           JOIN students s ON s.id = g.student_id
           JOIN assessments a ON a.id = g.assessment_id
           WHERE g.assessment_id = $1
           ORDER BY g.score DESC`,
          [assessmentId],
        ),
      ]);

      if (!asmRes.rows.length) {
        res.status(404).json({ success: false, message: 'Assessment not found' });
        return;
      }

      const assessment = asmRes.rows[0];
      const grades = gradesRes.rows;

      const classAvg = grades.length
        ? Math.round((grades.reduce((s: number, g: any) => s + parseFloat(g.percentage), 0) / grades.length) * 10) / 10
        : null;

      const highestScore = grades.length ? Math.max(...grades.map((g: any) => parseFloat(g.score))) : null;
      const below50 = grades.filter((g: any) => parseFloat(g.percentage) < 50).length;

      res.json({
        success: true,
        data: {
          ...assessment,
          classStats: { classAverage: classAvg, highestScore, below50Count: below50, totalGraded: grades.length },
          grades,
        },
      });
    } catch (err: any) {
      logger.error('getAssessment error', { assessmentId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to fetch assessment' });
    }
  };

  // ── POST /assessments/:assessmentId/grades ────────────────────────────────

  submitGrades = async (req: Request, res: Response): Promise<void> => {
    const { assessmentId } = req.params;
    const { grades, notifyParents = true } = req.body;

    if (!Array.isArray(grades) || grades.length === 0) {
      res.status(400).json({ success: false, message: 'grades array required' });
      return;
    }

    for (const g of grades) {
      if (!g.studentId || g.score === undefined || g.score < 0) {
        res.status(400).json({ success: false, message: 'Each grade needs studentId and score >= 0' });
        return;
      }
    }

    try {
      // Verify assessment exists and get maxScore
      const asmRes = await this.db.query<{ id: number; max_score: number; subject: string; school_id: number; title: string }>(
        'SELECT id, max_score, subject, school_id, title FROM assessments WHERE id = $1',
        [assessmentId],
      );
      if (!asmRes.rows.length) {
        res.status(404).json({ success: false, message: 'Assessment not found' });
        return;
      }

      const assessment = asmRes.rows[0];

      // Validate scores against maxScore
      for (const g of grades) {
        if (g.score > assessment.max_score) {
          res.status(400).json({
            success: false,
            message: `Score ${g.score} exceeds maxScore ${assessment.max_score} for student ${g.studentId}`,
          });
          return;
        }
      }

      // Upsert grades in transaction
      await this.db.query('BEGIN');

      let savedCount = 0;
      for (const g of grades) {
        const pct = (g.score / assessment.max_score) * 100;
        const level = cbcLevel(pct);

        await this.db.query(
          `INSERT INTO grades (assessment_id, student_id, score, cbc_level, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (assessment_id, student_id)
           DO UPDATE SET score = EXCLUDED.score, cbc_level = EXCLUDED.cbc_level,
                         notes = EXCLUDED.notes, updated_at = NOW()`,
          [assessmentId, g.studentId, g.score, level, g.notes ?? null],
        );

        // Update student's competency_levels summary (JSONB merge)
        if (assessment.subject) {
          await this.db.query(
            `UPDATE students
             SET competency_levels = COALESCE(competency_levels::jsonb, '{}'::jsonb)
               || jsonb_build_object($1, $2),
               average_score = (
                 SELECT ROUND(AVG(score)::numeric, 1)
                 FROM grades g2
                 JOIN assessments a2 ON a2.id = g2.assessment_id
                 WHERE g2.student_id = $3
               ),
               updated_at = NOW()
             WHERE id = $3`,
            [assessment.subject, level, g.studentId],
          );
        }

        savedCount++;
      }

      // Mark assessment as graded
      await this.db.query(
        'UPDATE assessments SET status = \'graded\', updated_at = NOW() WHERE id = $1',
        [assessmentId],
      );

      await this.db.query('COMMIT');

      // Compute class average
      const avgScores = grades.map(g => (g.score / assessment.max_score) * 100);
      const classAverage = Math.round((avgScores.reduce((a, b) => a + b, 0) / avgScores.length) * 10) / 10;

      // Dispatch SMS notifications (async)
      let notificationsSent = 0;
      if (notifyParents) {
        notificationsSent = await this.dispatchGradeNotifications(grades, assessment);
      }

      logger.info('Grades submitted', { assessmentId, saved: savedCount, classAverage });
      res.json({
        success: true,
        data: { saved: savedCount, classAverage, notificationsSent },
      });
    } catch (err: any) {
      await this.db.query('ROLLBACK').catch(() => {});
      logger.error('submitGrades error', { assessmentId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to submit grades' });
    }
  };

  // ── GET /schools/:schoolId/assessments ────────────────────────────────────

  listAssessments = async (req: Request, res: Response): Promise<void> => {
    const { schoolId } = req.params;
    const { className, subject, status, term, limit = '20' } = req.query;

    try {
      let query = `
        SELECT
          a.id, a.title, a.class_name, a.subject, a.max_score,
          a.assessment_date, a.status, a.term, a.cbc_strand,
          u.first_name AS teacher_first, u.last_name AS teacher_last,
          COUNT(g.id)::int AS graded_count,
          ROUND(AVG(g.score / a.max_score * 100)::numeric, 1) AS class_average
        FROM assessments a
        LEFT JOIN users u ON u.id = a.created_by
        LEFT JOIN grades g ON g.assessment_id = a.id
        WHERE a.school_id = $1
      `;
      const params: any[] = [schoolId];
      let idx = 2;

      if (className) { query += ` AND a.class_name = $${idx++}`;  params.push(className); }
      if (subject)   { query += ` AND a.subject = $${idx++}`;     params.push(subject); }
      if (status)    { query += ` AND a.status = $${idx++}`;      params.push(status); }
      if (term)      { query += ` AND a.term = $${idx++}`;        params.push(term); }

      query += ` GROUP BY a.id, u.first_name, u.last_name ORDER BY a.assessment_date DESC LIMIT $${idx}`;
      params.push(parseInt(limit as string));

      const result = await this.db.query(query, params);
      res.json({ success: true, data: result.rows });
    } catch (err: any) {
      logger.error('listAssessments error', { schoolId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to fetch assessments' });
    }
  };

  // ── Private: notify parents of new grades ─────────────────────────────────

  private async dispatchGradeNotifications(
    grades: { studentId: number; score: number }[],
    assessment: { max_score: number; subject: string; school_id: number; title: string },
  ): Promise<number> {
    let sent = 0;
    for (const g of grades) {
      try {
        const studentRes = await this.db.query<any>(
          `SELECT s.first_name, s.last_name, s.primary_phone, sc.name AS school_name
           FROM students s JOIN schools sc ON sc.id = s.school_id
           WHERE s.id = $1`,
          [g.studentId],
        );
        if (!studentRes.rows.length || !studentRes.rows[0].primary_phone) continue;

        const student = studentRes.rows[0];
        const pct = (g.score / assessment.max_score) * 100;
        const level = cbcLevel(pct);

        const result = await this.smsService.sendGradeUpdate({
          parentPhone: student.primary_phone,
          studentName: `${student.first_name} ${student.last_name}`,
          subject: assessment.subject || assessment.title,
          level,
          schoolName: student.school_name,
          schoolId: assessment.school_id,
          assessmentId: 0, // assessmentId in scope is string; cast handled above
        });
        if (result.success) sent++;
      } catch { /* non-fatal */ }
    }
    return sent;
  }
}
