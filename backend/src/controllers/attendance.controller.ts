/**
 * CBC Learning Ecosystem — Attendance Controller
 *
 * POST /attendance/bulk          — mark register for a whole class
 * GET  /attendance/:classId/date — fetch register for a class on a specific date
 * PUT  /attendance/:recordId     — correct a single attendance entry
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { SmsNotificationService } from '../services/sms-notification.service';
import { logger } from '../utils/logger';

export class AttendanceController {
  private smsService: SmsNotificationService;

  constructor(private db: Pool) {
    this.smsService = new SmsNotificationService(db);
  }

  // ── POST /attendance/bulk ─────────────────────────────────────────────────

  markBulkAttendance = async (req: Request, res: Response): Promise<void> => {
    const { classId, schoolId, date, records, notifyAbsent = true } = req.body;

    if (!classId || !date || !Array.isArray(records) || records.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Required: classId, date, records[]',
      });
      return;
    }

    // Validate status values
    const valid = ['present', 'absent', 'late'];
    for (const r of records) {
      if (!r.studentId || !valid.includes(r.status)) {
        res.status(400).json({
          success: false,
          message: 'Invalid record: studentId and status (present|absent|late) required',
        });
        return;
      }
    }

    const teacher = req.user!;
    const effectiveSchoolId = schoolId ?? teacher.schoolId;

    try {
      // Upsert all records in a transaction
      await this.db.query('BEGIN');

      let savedCount = 0;
      for (const record of records) {
        await this.db.query(
          `INSERT INTO attendance (student_id, class_name, school_id, attendance_date, status, reason, marked_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
           ON CONFLICT (student_id, attendance_date)
           DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason,
                         marked_by = EXCLUDED.marked_by, updated_at = NOW()`,
          [record.studentId, classId, effectiveSchoolId, date, record.status, record.reason ?? null, teacher.id],
        );
        savedCount++;
      }

      await this.db.query('COMMIT');

      // Dispatch SMS alerts for absent/late students (async, non-blocking)
      let alertsSent = 0;
      if (notifyAbsent) {
        const absentRecords = records.filter(r => r.status === 'absent' || r.status === 'late');
        alertsSent = await this.dispatchAbsenceAlerts(absentRecords, date, effectiveSchoolId);
      }

      logger.info('Bulk attendance saved', { classId, date, saved: savedCount, alerts: alertsSent });
      res.json({ success: true, data: { saved: savedCount, alertsSent } });
    } catch (err: any) {
      await this.db.query('ROLLBACK').catch(() => {});
      logger.error('markBulkAttendance error', { classId, date, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to save attendance' });
    }
  };

  // ── GET /attendance/:classId/date?date= ───────────────────────────────────

  getClassRegister = async (req: Request, res: Response): Promise<void> => {
    const { classId } = req.params;
    const { date, schoolId } = req.query;

    if (!date) {
      res.status(400).json({ success: false, message: 'date query param required (YYYY-MM-DD)' });
      return;
    }

    const effectiveSchoolId = schoolId ?? req.user!.schoolId;

    try {
      const result = await this.db.query<any>(
        `SELECT
           a.id, a.student_id, a.status, a.reason,
           s.first_name, s.last_name, s.admission_number
         FROM attendance a
         JOIN students s ON s.id = a.student_id
         WHERE a.class_name = $1
           AND a.school_id = $2
           AND a.attendance_date = $3
         ORDER BY s.last_name, s.first_name`,
        [classId, effectiveSchoolId, date],
      );

      const rows = result.rows;
      const present = rows.filter((r: any) => r.status === 'present').length;
      const absent  = rows.filter((r: any) => r.status === 'absent').length;
      const late    = rows.filter((r: any) => r.status === 'late').length;

      res.json({
        success: true,
        data: {
          classId,
          date,
          summary: { present, absent, late, total: rows.length },
          records: rows,
        },
      });
    } catch (err: any) {
      logger.error('getClassRegister error', { classId, date, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to fetch register' });
    }
  };

  // ── PUT /attendance/:recordId ──────────────────────────────────────────────

  correctAttendance = async (req: Request, res: Response): Promise<void> => {
    const { recordId } = req.params;
    const { status, reason } = req.body;

    if (!['present', 'absent', 'late'].includes(status)) {
      res.status(400).json({ success: false, message: 'status must be present|absent|late' });
      return;
    }

    try {
      const result = await this.db.query(
        `UPDATE attendance SET status = $1, reason = $2, updated_at = NOW()
         WHERE id = $3 RETURNING id`,
        [status, reason ?? null, recordId],
      );
      if (!result.rows.length) {
        res.status(404).json({ success: false, message: 'Attendance record not found' });
        return;
      }
      res.json({ success: true, data: { id: parseInt(recordId) } });
    } catch (err: any) {
      logger.error('correctAttendance error', { recordId, error: err.message });
      res.status(500).json({ success: false, message: 'Failed to update attendance' });
    }
  };

  // ── Private: dispatch SMS alerts ───────────────────────────────────────────

  private async dispatchAbsenceAlerts(
    absentRecords: { studentId: number; status: string }[],
    date: string,
    schoolId: number,
  ): Promise<number> {
    let sent = 0;
    for (const r of absentRecords) {
      try {
        const studentRes = await this.db.query<any>(
          `SELECT s.first_name, s.last_name, s.primary_phone, sc.name AS school_name
           FROM students s JOIN schools sc ON sc.id = s.school_id
           WHERE s.id = $1`,
          [r.studentId],
        );
        if (!studentRes.rows.length || !studentRes.rows[0].primary_phone) continue;

        const student = studentRes.rows[0];
        const result = await this.smsService.sendAttendanceAlert({
          parentPhone: student.primary_phone,
          studentName: `${student.first_name} ${student.last_name}`,
          status: r.status as 'absent' | 'late',
          date: new Date(date).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }),
          schoolName: student.school_name,
          schoolId,
          studentId: r.studentId,
        });
        if (result.success) sent++;
      } catch { /* non-fatal — don't fail bulk save for SMS errors */ }
    }
    return sent;
  }
}
