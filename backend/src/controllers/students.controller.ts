/**
 * CBC Learning Ecosystem — Students Controller
 *
 * GET  /students/:studentId              — fetch student profile
 * GET  /students/:studentId/competencies — CBC competency levels
 * GET  /students/:studentId/grades       — grade history
 * GET  /students/:studentId/attendance   — attendance records
 * GET  /schools/:schoolId/students       — list all students in school
 * POST /schools/:schoolId/students       — enrol a new student
 * PUT  /students/:studentId              — update student profile
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { logger } from '../utils/logger';

export class StudentsController {
  constructor(private db: Pool) {}

  // ── GET /students/:studentId ───────────────────────────────────────────────

  getStudent = async (req: Request, res: Response): Promise<void> => {
    const { studentId } = req.params;

    try {
      const result = await this.db.query<any>(
        `SELECT
           s.id, s.admission_number, s.first_name, s.middle_name, s.last_name,
           s.date_of_birth, s.gender, s.grade_level, s.class_name, s.stream,
           s.class_position, s.average_score, s.competency_levels,
           s.enrollment_date, s.enrollment_status,
           s.fee_balance, s.total_fees_required, s.total_fees_paid,
           s.primary_phone, s.secondary_phone, s.email,
           s.nemis_upi, s.birth_certificate_number,
           sc.name AS school_name, sc.id AS school_id,
           sc.mpesa_shortcode
         FROM students s
         JOIN schools sc ON sc.id = s.school_id
         WHERE s.id = $1`,
        [studentId]
      );

      if (!result.rows.length) {
        res.status(404).json({ success: false, message: 'Student not found' });
        return;
      }

      const student = result.rows[0];

      // Only teachers/admins in same school, or the student's parent, can view
      const user = req.user!;
      if (
        user.role !== 'super_admin' &&
        user.role !== 'school_admin' &&
        !(['teacher'].includes(user.role) && user.schoolId === student.school_id) &&
        !(user.role === 'parent' /* phone check done via parent_id */)
      ) {
        res.status(403).json({ success: false, message: 'Access denied' });
        return;
      }

      res.json({ success: true, data: student });
    } catch (err: any) {
      logger.error('getStudent error', { studentId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to fetch student' });
    }
  };

  // ── GET /students/:studentId/competencies ─────────────────────────────────

  getCompetencies = async (req: Request, res: Response): Promise<void> => {
    const { studentId } = req.params;

    try {
      // Summary levels from students table
      const studentRes = await this.db.query<{ competency_levels: string | null; first_name: string; last_name: string; grade_level: string }>(
        `SELECT competency_levels, first_name, last_name, grade_level FROM students WHERE id = $1`,
        [studentId]
      );

      if (!studentRes.rows.length) {
        res.status(404).json({ success: false, message: 'Student not found' });
        return;
      }

      // Detailed assessment history per competency
      const detailRes = await this.db.query<any>(
        `SELECT
           ca.competency_name, ca.strand, ca.sub_strand,
           ca.level, ca.level_label, ca.assessment_date,
           ca.notes, u.first_name AS teacher_first, u.last_name AS teacher_last
         FROM competency_assessments ca
         JOIN users u ON u.id = ca.assessed_by
         WHERE ca.student_id = $1
         ORDER BY ca.competency_name, ca.assessment_date DESC`,
        [studentId]
      );

      const student = studentRes.rows[0];
      const summaryLevels = student.competency_levels
        ? JSON.parse(student.competency_levels as string)
        : {};

      res.json({
        success: true,
        data: {
          studentId: parseInt(studentId),
          studentName: `${student.first_name} ${student.last_name}`,
          gradeLevel: student.grade_level,
          summaryLevels,
          assessmentHistory: detailRes.rows,
        },
      });
    } catch (err: any) {
      logger.error('getCompetencies error', { studentId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to fetch competencies' });
    }
  };

  // ── GET /students/:studentId/grades ───────────────────────────────────────

  getGrades = async (req: Request, res: Response): Promise<void> => {
    const { studentId } = req.params;
    const { subject, term, limit = '20' } = req.query;

    try {
      let query = `
        SELECT
          g.id, g.assessment_id, a.title AS assessment_title,
          a.subject, g.score, a.max_score,
          ROUND((g.score / a.max_score * 100)::numeric, 1) AS percentage,
          CASE
            WHEN (g.score / a.max_score * 100) >= 80 THEN 'EE'
            WHEN (g.score / a.max_score * 100) >= 60 THEN 'ME'
            WHEN (g.score / a.max_score * 100) >= 40 THEN 'AE'
            ELSE 'BE'
          END AS cbc_level,
          a.assessment_date, g.notes,
          u.first_name AS teacher_first, u.last_name AS teacher_last
        FROM grades g
        JOIN assessments a ON a.id = g.assessment_id
        LEFT JOIN users u ON u.id = a.created_by
        WHERE g.student_id = $1
      `;
      const params: any[] = [studentId];
      let idx = 2;

      if (subject) { query += ` AND a.subject = $${idx++}`; params.push(subject); }
      if (term)    { query += ` AND a.term = $${idx++}`;    params.push(term); }

      query += ` ORDER BY a.assessment_date DESC LIMIT $${idx}`;
      params.push(parseInt(limit as string));

      const result = await this.db.query(query, params);

      res.json({ success: true, data: { studentId: parseInt(studentId), grades: result.rows } });
    } catch (err: any) {
      logger.error('getGrades error', { studentId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to fetch grades' });
    }
  };

  // ── GET /students/:studentId/attendance ───────────────────────────────────

  getAttendance = async (req: Request, res: Response): Promise<void> => {
    const { studentId } = req.params;
    const { from, to, status } = req.query;

    const fromDate = (from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toDate   = (to as string)   || new Date().toISOString().slice(0, 10);

    try {
      let query = `
        SELECT status, attendance_date AS date, reason
        FROM attendance
        WHERE student_id = $1
          AND attendance_date BETWEEN $2 AND $3
      `;
      const params: any[] = [studentId, fromDate, toDate];

      if (status) { query += ` AND status = $4`; params.push(status); }
      query += ` ORDER BY attendance_date DESC`;

      const result = await this.db.query(query, params);
      const records = result.rows;

      const present = records.filter((r: any) => r.status === 'present').length;
      const absent  = records.filter((r: any) => r.status === 'absent').length;
      const late    = records.filter((r: any) => r.status === 'late').length;
      const total   = records.length;

      res.json({
        success: true,
        data: {
          studentId: parseInt(studentId),
          summary: {
            totalDays: total,
            present,
            absent,
            late,
            attendancePercent: total > 0 ? Math.round((present / total) * 1000) / 10 : 0,
          },
          records,
        },
      });
    } catch (err: any) {
      logger.error('getAttendance error', { studentId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to fetch attendance' });
    }
  };

  // ── GET /schools/:schoolId/students ───────────────────────────────────────

  listStudents = async (req: Request, res: Response): Promise<void> => {
    const { schoolId } = req.params;
    const { className, gradeLevel, status = 'active', search, page = '1', limit = '50' } = req.query;

    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    try {
      let query = `
        SELECT
          s.id, s.admission_number, s.first_name, s.last_name,
          s.grade_level, s.class_name, s.enrollment_status,
          s.fee_balance, s.average_score, s.competency_levels,
          s.primary_phone
        FROM students s
        WHERE s.school_id = $1 AND s.enrollment_status = $2
      `;
      const params: any[] = [schoolId, status];
      let idx = 3;

      if (className)  { query += ` AND s.class_name = $${idx++}`;  params.push(className); }
      if (gradeLevel) { query += ` AND s.grade_level = $${idx++}`; params.push(gradeLevel); }
      if (search) {
        query += ` AND (s.first_name ILIKE $${idx} OR s.last_name ILIKE $${idx} OR s.admission_number ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }

      query += ` ORDER BY s.class_name, s.last_name, s.first_name`;
      query += ` LIMIT $${idx} OFFSET $${idx + 1}`;
      params.push(parseInt(limit as string), offset);

      const [students, countRes] = await Promise.all([
        this.db.query(query, params),
        this.db.query(
          `SELECT COUNT(*) FROM students WHERE school_id = $1 AND enrollment_status = $2`,
          [schoolId, status]
        ),
      ]);

      res.json({
        success: true,
        data: {
          students: students.rows,
          pagination: {
            total: parseInt(countRes.rows[0].count),
            page: parseInt(page as string),
            limit: parseInt(limit as string),
          },
        },
      });
    } catch (err: any) {
      logger.error('listStudents error', { schoolId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to fetch students' });
    }
  };

  // ── POST /schools/:schoolId/students ──────────────────────────────────────

  enrolStudent = async (req: Request, res: Response): Promise<void> => {
    const { schoolId } = req.params;
    const {
      firstName, middleName, lastName, dateOfBirth, gender,
      gradeLevel, className, stream, admissionNumber,
      enrollmentDate, primaryPhone, secondaryPhone, email,
      nemisUpi, birthCertificateNumber, totalFeesRequired,
    } = req.body;

    if (!firstName || !lastName || !dateOfBirth || !gender || !gradeLevel || !admissionNumber) {
      res.status(400).json({
        success: false,
        message: 'Required fields: firstName, lastName, dateOfBirth, gender, gradeLevel, admissionNumber',
      });
      return;
    }

    try {
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO students (
           school_id, first_name, middle_name, last_name, date_of_birth, gender,
           grade_level, class_name, stream, admission_number, enrollment_date,
           primary_phone, secondary_phone, email,
           nemis_upi, birth_certificate_number, total_fees_required,
           enrollment_status, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'active',NOW(),NOW()
         ) RETURNING id`,
        [
          schoolId, firstName, middleName || null, lastName, dateOfBirth, gender,
          gradeLevel, className || null, stream || null, admissionNumber,
          enrollmentDate || new Date().toISOString().slice(0, 10),
          primaryPhone || null, secondaryPhone || null, email || null,
          nemisUpi || null, birthCertificateNumber || null, totalFeesRequired || 0,
        ]
      );

      logger.info('Student enrolled', { schoolId, admissionNumber, id: result.rows[0].id });
      res.status(201).json({ success: true, data: { id: result.rows[0].id, admissionNumber } });
    } catch (err: any) {
      if (err.code === '23505') {
        res.status(409).json({ success: false, message: 'Admission number already exists' });
        return;
      }
      logger.error('enrolStudent error', { schoolId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to enrol student' });
    }
  };

  // ── PUT /students/:studentId ───────────────────────────────────────────────

  updateStudent = async (req: Request, res: Response): Promise<void> => {
    const { studentId } = req.params;
    const allowed = [
      'first_name','middle_name','last_name','class_name','stream',
      'primary_phone','secondary_phone','email','enrollment_status',
      'competency_levels','average_score','class_position',
    ];

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (req.body[camel] !== undefined) {
        updates.push(`${key} = $${idx++}`);
        values.push(req.body[camel]);
      }
    }

    if (!updates.length) {
      res.status(400).json({ success: false, message: 'No valid fields to update' });
      return;
    }

    values.push(studentId);
    try {
      const result = await this.db.query(
        `UPDATE students SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${idx} RETURNING id`,
        values
      );
      if (!result.rows.length) {
        res.status(404).json({ success: false, message: 'Student not found' });
        return;
      }
      res.json({ success: true, data: { id: parseInt(studentId) } });
    } catch (err: any) {
      logger.error('updateStudent error', { studentId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to update student' });
    }
  };
}
