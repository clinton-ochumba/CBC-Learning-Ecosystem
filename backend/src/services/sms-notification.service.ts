/**
 * CBC Learning Ecosystem — SMS Notification Service
 *
 * Sends automated SMS notifications via Africa's Talking for 5 event types:
 *   1. Attendance alerts  (absent/late — sent same day at 10 AM)
 *   2. Grade updates      (when teacher posts new assessment results)
 *   3. Fee reminders      (weekly, for balances > 0; 7 days before term end)
 *   4. School events      (3 days before event + day-of reminder)
 *   5. Emergency alerts   (immediate, all parents in school)
 *
 * Design principles:
 *   - All sends are queued to `sms_queue` table first (idempotent)
 *   - Retry up to 3 times with exponential backoff on AT errors
 *   - Per-school SMS budget tracked in `sms_usage` table
 *   - Rate limit: max 100 SMS/minute per school (AT burst limit)
 *   - Messages are < 160 chars to avoid multipart billing
 *   - Kenya-specific: Ksh amounts, Safaricom paybill, Kenyan date format
 */

import AfricasTalking from 'africastalking';
import { Pool } from 'pg';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SmsEventType =
  | 'attendance_alert'
  | 'grade_update'
  | 'fee_reminder'
  | 'school_event'
  | 'emergency_alert'
  | 'payment_confirmation'
  | 'ussd_reply';

export interface SmsResult {
  success: boolean;
  messageId?: string;
  cost?: string;
  failureReason?: string;
}

interface SmsQueueRow {
  id: number;
  to_phone: string;
  message: string;
  event_type: SmsEventType;
  school_id: number;
  reference_id: string;
  attempt_count: number;
  status: 'pending' | 'sent' | 'failed' | 'rate_limited';
}

// ─── Message builders (< 160 chars each) ────────────────────────────────────

export const SmsTemplates = {
  /** BUG-04 fix: proper AT send with school sender ID */
  attendanceAbsent: (studentName: string, date: string, schoolName: string) =>
    `${schoolName}: ${studentName} was ABSENT on ${date}. If this is an error, contact the school. Reply STOP to opt out.`,

  attendanceLate: (studentName: string, date: string) =>
    `CBC School: ${studentName} arrived LATE today (${date}). Contact school for details.`,

  gradeUpdate: (studentName: string, subject: string, level: string, schoolName: string) =>
    `${schoolName}: New grade for ${studentName} — ${subject}: ${level}. View full report on CBC Portal or dial *384*1234#`,

  feeReminder: (studentName: string, balance: number, shortcode: string, studentId: number) =>
    `CBC Fees Due: ${studentName} owes Ksh ${balance.toLocaleString()}. Pay via M-Pesa Paybill ${shortcode}, Acc ${studentId}. Reply FEES ${studentId} for details.`,

  feeCleared: (studentName: string, amount: number, receiptNo: string) =>
    `✓ Payment received: Ksh ${amount.toLocaleString()} for ${studentName}. Receipt: ${receiptNo}. Fees now cleared.`,

  feePartial: (studentName: string, paid: number, remaining: number, receiptNo: string) =>
    `✓ Payment Ksh ${paid.toLocaleString()} received for ${studentName} (Ref: ${receiptNo}). Balance: Ksh ${remaining.toLocaleString()}.`,

  schoolEvent: (eventTitle: string, date: string, time: string, schoolName: string) =>
    `${schoolName}: Reminder — "${eventTitle}" on ${date} at ${time}. Contact school for details.`,

  emergencyAlert: (message: string, schoolName: string) =>
    `URGENT — ${schoolName}: ${message}. This is an automated alert.`,

  paymentConfirmation: (studentName: string, amount: number, balance: number, receiptNo: string) =>
    `CBC: Ksh ${amount.toLocaleString()} received for ${studentName}. Receipt: ${receiptNo}. Bal: Ksh ${balance.toLocaleString()}.`,
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class SmsNotificationService {
  private smsClient: ReturnType<typeof AfricasTalking>['SMS'] | null = null;
  private db: Pool;
  private senderId: string;
  private isEnabled: boolean;

  // Simple in-memory rate limiter: school_id → { count, windowStart }
  private rateLimiter = new Map<number, { count: number; windowStart: number }>();
  private readonly RATE_LIMIT_PER_MINUTE = 100;
  private readonly MAX_RETRIES = 3;

  constructor(db: Pool) {
    this.db = db;
    this.senderId = process.env.AT_SENDER_ID || 'CBCSCHOOL';
    this.isEnabled = !!(process.env.AT_API_KEY && process.env.AT_USERNAME);

    if (this.isEnabled) {
      try {
        const at = AfricasTalking({
          apiKey:   process.env.AT_API_KEY!,
          username: process.env.AT_USERNAME!,
        });
        this.smsClient = at.SMS;
        logger.info('SMS notification service initialized (Africa\'s Talking)');
      } catch (err) {
        logger.error('Failed to initialize Africa\'s Talking SMS client', { error: err });
        this.isEnabled = false;
      }
    } else {
      logger.warn('SMS notifications disabled — AT_API_KEY / AT_USERNAME not set');
    }
  }

  // ── Public send methods ───────────────────────────────────────────────────

  async sendAttendanceAlert(params: {
    parentPhone: string;
    studentName: string;
    status: 'absent' | 'late';
    date: string;
    schoolName: string;
    schoolId: number;
    studentId: number;
  }): Promise<SmsResult> {
    const msg = params.status === 'absent'
      ? SmsTemplates.attendanceAbsent(params.studentName, params.date, params.schoolName)
      : SmsTemplates.attendanceLate(params.studentName, params.date);

    return this.queue({
      to: params.parentPhone,
      message: msg,
      eventType: 'attendance_alert',
      schoolId: params.schoolId,
      referenceId: `att-${params.studentId}-${params.date}`,
    });
  }

  async sendGradeUpdate(params: {
    parentPhone: string;
    studentName: string;
    subject: string;
    level: string;
    schoolName: string;
    schoolId: number;
    assessmentId: number;
  }): Promise<SmsResult> {
    return this.queue({
      to: params.parentPhone,
      message: SmsTemplates.gradeUpdate(params.studentName, params.subject, params.level, params.schoolName),
      eventType: 'grade_update',
      schoolId: params.schoolId,
      referenceId: `grade-${params.assessmentId}-${params.parentPhone}`,
    });
  }

  async sendFeeReminder(params: {
    parentPhone: string;
    studentName: string;
    balance: number;
    shortcode: string;
    schoolId: number;
    studentId: number;
  }): Promise<SmsResult> {
    if (params.balance <= 0) return { success: true }; // No reminder if paid
    return this.queue({
      to: params.parentPhone,
      message: SmsTemplates.feeReminder(params.studentName, params.balance, params.shortcode, params.studentId),
      eventType: 'fee_reminder',
      schoolId: params.schoolId,
      referenceId: `fee-reminder-${params.studentId}-${new Date().toISOString().slice(0,7)}`,
    });
  }

  async sendPaymentConfirmation(params: {
    parentPhone: string;
    studentName: string;
    amountPaid: number;
    newBalance: number;
    receiptNumber: string;
    schoolId: number;
    studentId: number;
  }): Promise<SmsResult> {
    const msg = params.newBalance <= 0
      ? SmsTemplates.feeCleared(params.studentName, params.amountPaid, params.receiptNumber)
      : SmsTemplates.feePartial(params.studentName, params.amountPaid, params.newBalance, params.receiptNumber);

    return this.queue({
      to: params.parentPhone,
      message: msg,
      eventType: 'payment_confirmation',
      schoolId: params.schoolId,
      referenceId: `payment-${params.receiptNumber}`,
    });
  }

  async sendSchoolEvent(params: {
    parentPhones: string[];
    eventTitle: string;
    eventDate: string;
    eventTime: string;
    schoolName: string;
    schoolId: number;
    eventId: number;
  }): Promise<SmsResult[]> {
    const msg = SmsTemplates.schoolEvent(params.eventTitle, params.eventDate, params.eventTime, params.schoolName);
    const results: SmsResult[] = [];
    for (const phone of params.parentPhones) {
      const r = await this.queue({
        to: phone,
        message: msg,
        eventType: 'school_event',
        schoolId: params.schoolId,
        referenceId: `event-${params.eventId}-${phone}`,
      });
      results.push(r);
    }
    return results;
  }

  async sendEmergencyAlert(params: {
    parentPhones: string[];
    message: string;
    schoolName: string;
    schoolId: number;
    alertId: string;
  }): Promise<{ sent: number; failed: number }> {
    const msg = SmsTemplates.emergencyAlert(params.message, params.schoolName);
    let sent = 0, failed = 0;
    for (const phone of params.parentPhones) {
      const r = await this.queue({
        to: phone,
        message: msg,
        eventType: 'emergency_alert',
        schoolId: params.schoolId,
        referenceId: `emergency-${params.alertId}-${phone}`,
      });
      r.success ? sent++ : failed++;
    }
    logger.info(`Emergency alert sent: ${sent} OK, ${failed} failed`, { schoolId: params.schoolId });
    return { sent, failed };
  }

  // ── Queue + send pipeline ─────────────────────────────────────────────────

  /**
   * Queue an SMS and send it immediately (or mark for retry).
   * Idempotent: duplicate referenceId returns the existing result.
   */
  private async queue(params: {
    to: string;
    message: string;
    eventType: SmsEventType;
    schoolId: number;
    referenceId: string;
  }): Promise<SmsResult> {
    const phone = this.normalizePhone(params.to);

    // Idempotency check — don't re-send same event
    try {
      const existing = await this.db.query<{ status: string; at_message_id: string }>(
        `SELECT status, at_message_id FROM sms_queue
         WHERE reference_id = $1 AND status = 'sent'
         LIMIT 1`,
        [params.referenceId]
      );
      if (existing.rows.length > 0) {
        return { success: true, messageId: existing.rows[0].at_message_id };
      }
    } catch { /* continue */ }

    // Check per-school SMS budget
    const hasQuota = await this.checkSchoolQuota(params.schoolId);
    if (!hasQuota) {
      logger.warn('SMS quota exceeded for school', { schoolId: params.schoolId });
      await this.logToDb({ ...params, to: phone, status: 'failed', failureReason: 'quota_exceeded' });
      return { success: false, failureReason: 'quota_exceeded' };
    }

    // Check rate limit
    if (this.isRateLimited(params.schoolId)) {
      await this.logToDb({ ...params, to: phone, status: 'rate_limited', failureReason: 'rate_limited' });
      return { success: false, failureReason: 'rate_limited' };
    }

    // Log to DB first (pending)
    const queueId = await this.logToDb({ ...params, to: phone, status: 'pending', failureReason: null });

    // Send with retry
    const result = await this.sendWithRetry(phone, params.message, params.eventType);

    // Update DB status
    await this.updateQueueStatus(queueId, result);

    // Increment usage counter
    if (result.success) {
      await this.incrementUsage(params.schoolId);
    }

    return result;
  }

  private async sendWithRetry(
    phone: string,
    message: string,
    eventType: SmsEventType,
    attempt = 0
  ): Promise<SmsResult> {
    if (!this.isEnabled || !this.smsClient) {
      // Log only, don't fail in test/dev environments
      logger.info(`[SMS MOCK] To: ${phone} | ${eventType} | ${message.slice(0, 60)}...`);
      return { success: true, messageId: `mock-${Date.now()}` };
    }

    try {
      const response = await this.smsClient.send({
        to:      [phone],
        message: message.slice(0, 160), // Hard cap at 160 chars
        from:    this.senderId,
      });

      const recipient = response.SMSMessageData?.Recipients?.[0];
      if (recipient?.status === 'Success') {
        return {
          success: true,
          messageId: recipient.messageId,
          cost: recipient.cost,
        };
      }

      const reason = recipient?.status || 'unknown';
      throw new Error(`AT send failed: ${reason}`);

    } catch (err: any) {
      if (attempt < this.MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        logger.warn(`SMS send attempt ${attempt + 1} failed, retrying in ${delay}ms`, { phone, error: err.message });
        await new Promise(r => setTimeout(r, delay));
        return this.sendWithRetry(phone, message, eventType, attempt + 1);
      }
      logger.error('SMS send failed after max retries', { phone, eventType, error: err.message });
      return { success: false, failureReason: err.message };
    }
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────

  private isRateLimited(schoolId: number): boolean {
    const now = Date.now();
    const bucket = this.rateLimiter.get(schoolId);
    if (!bucket || now - bucket.windowStart > 60_000) {
      this.rateLimiter.set(schoolId, { count: 1, windowStart: now });
      return false;
    }
    if (bucket.count >= this.RATE_LIMIT_PER_MINUTE) return true;
    bucket.count++;
    return false;
  }

  // ── Quota check ───────────────────────────────────────────────────────────

  private async checkSchoolQuota(schoolId: number): Promise<boolean> {
    try {
      // Each school gets 500 free SMS/term; check current usage
      const result = await this.db.query<{ sms_sent_this_term: string; sms_quota: string }>(
        `SELECT COALESCE(sms_sent_this_term, 0) AS sms_sent_this_term,
                COALESCE(sms_quota, 500) AS sms_quota
         FROM sms_usage WHERE school_id = $1`,
        [schoolId]
      );
      if (!result.rows.length) return true;
      const { sms_sent_this_term, sms_quota } = result.rows[0];
      return parseInt(sms_sent_this_term) < parseInt(sms_quota);
    } catch { return true; }
  }

  private async incrementUsage(schoolId: number): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO sms_usage (school_id, sms_sent_this_term, sms_quota, updated_at)
         VALUES ($1, 1, 500, NOW())
         ON CONFLICT (school_id) DO UPDATE
         SET sms_sent_this_term = sms_usage.sms_sent_this_term + 1,
             updated_at = NOW()`,
        [schoolId]
      );
    } catch { /* non-fatal */ }
  }

  // ── DB helpers ────────────────────────────────────────────────────────────

  private async logToDb(params: {
    to: string; message: string; eventType: SmsEventType;
    schoolId: number; referenceId: string;
    status: string; failureReason: string | null;
  }): Promise<number> {
    try {
      const r = await this.db.query<{ id: number }>(
        `INSERT INTO sms_queue
           (to_phone, message, event_type, school_id, reference_id, status, attempt_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, NOW())
         ON CONFLICT (reference_id) DO UPDATE
           SET status = EXCLUDED.status, attempt_count = sms_queue.attempt_count + 1, updated_at = NOW()
         RETURNING id`,
        [params.to, params.message, params.eventType, params.schoolId, params.referenceId, params.status]
      );
      return r.rows[0]?.id ?? 0;
    } catch { return 0; }
  }

  private async updateQueueStatus(queueId: number, result: SmsResult): Promise<void> {
    if (!queueId) return;
    try {
      await this.db.query(
        `UPDATE sms_queue SET
           status = $1, at_message_id = $2, at_cost = $3, failure_reason = $4, sent_at = NOW()
         WHERE id = $5`,
        [
          result.success ? 'sent' : 'failed',
          result.messageId ?? null,
          result.cost ?? null,
          result.failureReason ?? null,
          queueId,
        ]
      );
    } catch { /* non-fatal */ }
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('254')) return '+' + digits;
    if (digits.startsWith('0'))   return '+254' + digits.slice(1);
    if (digits.length === 9)      return '+254' + digits;
    return '+' + digits;
  }
}
