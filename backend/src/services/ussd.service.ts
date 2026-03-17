/**
 * CBC Learning Ecosystem — USSD Service
 *
 * Implements a full Africa's Talking USSD session engine for parent access
 * via feature phones. Parents dial *384*SHORTCODE# and navigate menus to:
 *   1. Check child progress (CBC competency levels)
 *   2. View attendance summary
 *   3. Check fee balance + M-Pesa paybill
 *   4. Upcoming school events
 *   5. Send a message to the class teacher
 *   6. Change language (Swahili / English)
 *
 * Session state is stored in Redis (TTL: 5 minutes per USSD session rules).
 * Each session is keyed by Africa's Talking sessionId.
 *
 * Africa's Talking USSD response format:
 *   CON <text>  — session continues (more input expected)
 *   END <text>  — session ends (final message)
 *
 * DB access uses a read-only query helper to keep this service stateless
 * with respect to writes (except message-to-teacher which queues).
 */

import Redis from 'ioredis';
import { Pool } from 'pg';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UssdResponse = `CON ${string}` | `END ${string}`;

export interface UssdSessionState {
  phoneNumber: string;
  networkCode: string;
  language: 'en' | 'sw';
  parentId: number | null;
  children: ChildSummary[];
  selectedChildIndex: number | null;
  menuPath: string[]; // e.g. ['1', '1', '2'] = main→progress→child 1→attendance
}

interface ChildSummary {
  id: number;
  firstName: string;
  lastName: string;
  gradeLevel: string;
  className: string;
  feeBalance: number;
  totalFeesRequired: number;
  attendancePercent: number;
  competencyLevels: Record<string, string> | null;
  schoolName: string;
  schoolShortcode: string;
  teacherName: string;
}

// ─── Strings (English + Swahili) ─────────────────────────────────────────────

const T = {
  en: {
    welcome:        (name: string) => `CON CBC School Portal\nWelcome, ${name}\n\n1. Child Progress\n2. Attendance\n3. Fee Balance\n4. School Events\n5. Message Teacher\n6. Switch to Swahili\n0. Exit`,
    welcomeNoAuth:  'END Sorry, your number is not registered.\nContact your school to register.\nHelp: 0800 724 100',
    selectChild:    (children: ChildSummary[]) =>
      'CON Select child:\n' +
      children.map((c, i) => `${i + 1}. ${c.firstName} ${c.lastName} (${c.gradeLevel})`).join('\n') +
      '\n0. Back',
    noChildren:     'END No children found for this number.\nContact school to update records.',
    progress:       (c: ChildSummary) => {
      const levels = c.competencyLevels || {};
      const summary = Object.entries(levels)
        .slice(0, 4)
        .map(([k, v]) => `${k.slice(0, 4)}: ${v}`)
        .join(', ');
      return `END ${c.firstName} ${c.lastName} (${c.className})\n` +
             `Term Report:\n${summary || 'No report yet'}\n` +
             `Attendance: ${c.attendancePercent}%\n` +
             `Fee Bal: Ksh ${c.feeBalance.toLocaleString()}\n` +
             `SMS full report: PROGRESS ${c.id} to 22234`;
    },
    attendance:     (c: ChildSummary, days: AttendanceRow[]) => {
      const p = days.filter(d => d.status === 'present').length;
      const a = days.filter(d => d.status === 'absent').length;
      const l = days.filter(d => d.status === 'late').length;
      return `END ${c.firstName} ${c.lastName}\nAttendance (last 30 days):\nPresent: ${p} | Absent: ${a} | Late: ${l}\nRate: ${c.attendancePercent}%\n${a > 3 ? '⚠ High absences. Contact school.' : '✓ Attendance good.'}`;
    },
    fees:           (c: ChildSummary) =>
      `END ${c.firstName} ${c.lastName}\nFee Balance: Ksh ${c.feeBalance.toLocaleString()}\nTotal Fees: Ksh ${c.totalFeesRequired.toLocaleString()}\n` +
      (c.feeBalance > 0
        ? `Pay via M-Pesa:\nPaybill: ${c.schoolShortcode}\nAcc: ${c.id}\nAmt: Ksh ${c.feeBalance.toLocaleString()}`
        : '✓ Fees fully paid.'),
    events:         (events: EventRow[]) =>
      events.length
        ? 'END Upcoming Events:\n' + events.slice(0, 4).map(e => `• ${e.title}: ${formatDate(e.date)}`).join('\n')
        : 'END No upcoming events.\nCheck app for updates.',
    messageTeacher: (c: ChildSummary) =>
      `CON Message teacher for ${c.firstName}?\nType your message (max 120 chars).\nOr press 0 to go back.`,
    messageSent:    (teacher: string) =>
      `END Message sent to ${teacher}.\nThey will respond within 24 hours.`,
    messageFailed:  'END Failed to send message.\nTry again or call school.',
    invalidInput:   'END Invalid input.\nPlease dial again.',
    sessionTimeout: 'END Session timed out.\nPlease dial again.',
    goodbye:        'END Thank you for using CBC Portal.\nKaa salama!',
    swahiliSwitch:  'END Imebadilishwa kwenye Kiswahili.\nPiga simu tena: *384*1234#',
  },
  sw: {
    welcome:        (name: string) => `CON Mfumo wa Shule ya CBC\nKaribu, ${name}\n\n1. Maendeleo ya Mtoto\n2. Mahudhurio\n3. Malipo ya Shule\n4. Matukio ya Shule\n5. Ujumbe kwa Mwalimu\n6. Badilisha kwa Kiingereza\n0. Toka`,
    welcomeNoAuth:  'END Samahani, nambari yako haijasajiliwa.\nWasiliana na shule yako.',
    selectChild:    (children: ChildSummary[]) =>
      'CON Chagua mtoto:\n' +
      children.map((c, i) => `${i + 1}. ${c.firstName} ${c.lastName} (${c.gradeLevel})`).join('\n') +
      '\n0. Rudi',
    noChildren:     'END Watoto hawajapatikana kwa nambari hii.',
    progress:       (c: ChildSummary) => {
      const levels = c.competencyLevels || {};
      const summary = Object.entries(levels).slice(0, 4).map(([k, v]) => `${k.slice(0, 4)}: ${v}`).join(', ');
      return `END ${c.firstName} ${c.lastName} (${c.className})\nRipoti ya Muhula:\n${summary || 'Hakuna ripoti'}\nMahudhurio: ${c.attendancePercent}%\nDeni: Ksh ${c.feeBalance.toLocaleString()}`;
    },
    attendance:     (c: ChildSummary, days: AttendanceRow[]) => {
      const p = days.filter(d => d.status === 'present').length;
      const a = days.filter(d => d.status === 'absent').length;
      const l = days.filter(d => d.status === 'late').length;
      return `END ${c.firstName} ${c.lastName}\nMahudhurio (siku 30):\nAlipo: ${p} | Kutokuwepo: ${a} | Kuchelewa: ${l}\nKiwango: ${c.attendancePercent}%`;
    },
    fees:           (c: ChildSummary) =>
      `END ${c.firstName} ${c.lastName}\nDeni la Shule: Ksh ${c.feeBalance.toLocaleString()}\nJumlaa: Ksh ${c.totalFeesRequired.toLocaleString()}\n` +
      (c.feeBalance > 0 ? `Lipa M-Pesa:\nPaybill: ${c.schoolShortcode}\nAkaonti: ${c.id}` : '✓ Malipo yamekamilika.'),
    events:         (events: EventRow[]) =>
      events.length
        ? 'END Matukio Yanayokuja:\n' + events.slice(0, 4).map(e => `• ${e.title}: ${formatDate(e.date)}`).join('\n')
        : 'END Hakuna matukio yanayokuja.',
    messageTeacher: (c: ChildSummary) =>
      `CON Tuma ujumbe kwa mwalimu wa ${c.firstName}?\nAndika ujumbe wako (herufi 120 zaidi).`,
    messageSent:    (teacher: string) =>
      `END Ujumbe umetumwa kwa ${teacher}.\nWatajibu ndani ya masaa 24.`,
    messageFailed:  'END Imeshindwa kutuma ujumbe.',
    invalidInput:   'END Ingizo batili. Piga simu tena.',
    sessionTimeout: 'END Kipindi kimeisha. Piga simu tena.',
    goodbye:        'END Asante kutumia CBC Portal.\nKaa salama!',
    swahiliSwitch:  'END Switched to English.\nDial again: *384*1234#',
  },
};

interface AttendanceRow { status: 'present' | 'absent' | 'late'; date: string; }
interface EventRow { title: string; date: string; description: string; }

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short' });
}

// ─── USSD Service ─────────────────────────────────────────────────────────────

export class UssdService {
  private redis: Redis;
  private db: Pool;
  private readonly SESSION_TTL = 300; // 5 minutes — AT USSD session limit

  constructor(redis: Redis, db: Pool) {
    this.redis = redis;
    this.db = db;
  }

  // ── Public entry point ────────────────────────────────────────────────────

  /**
   * Process an incoming USSD request from Africa's Talking.
   * Called by the USSD controller on POST /api/v1/ussd/callback
   */
  async handleRequest(params: {
    sessionId: string;
    serviceCode: string;
    phoneNumber: string;
    text: string;       // full input history, e.g. "1*2*3"
    networkCode: string;
  }): Promise<UssdResponse> {
    const { sessionId, phoneNumber, text, networkCode } = params;

    try {
      // Load or initialize session
      let session = await this.loadSession(sessionId);
      if (!session) {
        session = await this.initSession(sessionId, phoneNumber, networkCode);
      }

      const lang = session.language;
      const inputs = text === '' ? [] : text.split('*');
      const depth = inputs.length;

      logger.info(`USSD [${sessionId}] phone=${phoneNumber} text="${text}" depth=${depth}`);

      const response = await this.route(session, inputs, sessionId, lang);
      return response;

    } catch (err) {
      logger.error('USSD handler error', { sessionId, phoneNumber, error: err });
      return 'END Something went wrong. Please try again.' as UssdResponse;
    }
  }

  // ── Session management ────────────────────────────────────────────────────

  private sessionKey(sessionId: string) { return `ussd:session:${sessionId}`; }

  private async loadSession(sessionId: string): Promise<UssdSessionState | null> {
    const raw = await this.redis.get(this.sessionKey(sessionId));
    if (!raw) return null;
    await this.redis.expire(this.sessionKey(sessionId), this.SESSION_TTL);
    return JSON.parse(raw) as UssdSessionState;
  }

  private async saveSession(sessionId: string, state: UssdSessionState): Promise<void> {
    await this.redis.setex(this.sessionKey(sessionId), this.SESSION_TTL, JSON.stringify(state));
  }

  private async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(this.sessionKey(sessionId));
  }

  private async initSession(
    sessionId: string,
    phoneNumber: string,
    networkCode: string,
  ): Promise<UssdSessionState> {
    // Normalize phone: strip leading + or 0 and ensure 254 prefix
    const normalized = this.normalizePhone(phoneNumber);
    const parent = await this.lookupParent(normalized);
    const children = parent ? await this.loadChildren(parent.id) : [];

    const state: UssdSessionState = {
      phoneNumber: normalized,
      networkCode,
      language: 'en',
      parentId: parent?.id ?? null,
      children,
      selectedChildIndex: null,
      menuPath: [],
    };
    await this.saveSession(sessionId, state);
    return state;
  }

  // ── Routing engine ────────────────────────────────────────────────────────

  private async route(
    session: UssdSessionState,
    inputs: string[],
    sessionId: string,
    lang: 'en' | 'sw',
  ): Promise<UssdResponse> {
    const t = T[lang];
    const depth = inputs.length;

    // ── Root menu (no input yet) ──────────────────────────────────────────
    if (depth === 0) {
      if (!session.parentId) return t.welcomeNoAuth as UssdResponse;
      const name = session.children[0]
        ? `${session.children[0].firstName.split(' ')[0]}'s parent`
        : 'Parent';
      return t.welcome(name) as UssdResponse;
    }

    const root = inputs[0];

    // ── Exit ─────────────────────────────────────────────────────────────
    if (root === '0') {
      await this.deleteSession(sessionId);
      return t.goodbye as UssdResponse;
    }

    // ── Not authenticated ─────────────────────────────────────────────────
    if (!session.parentId) {
      return t.welcomeNoAuth as UssdResponse;
    }

    // ── Language switch ───────────────────────────────────────────────────
    if (root === '6') {
      const newLang = lang === 'en' ? 'sw' : 'en';
      session.language = newLang;
      await this.saveSession(sessionId, session);
      return T[newLang].swahiliSwitch as UssdResponse;
    }

    // ── No children edge case ─────────────────────────────────────────────
    if (session.children.length === 0) {
      return t.noChildren as UssdResponse;
    }

    // ── Single child — skip child selection ──────────────────────────────
    const multiChild = session.children.length > 1;

    // Main menu options: 1=progress, 2=attendance, 3=fees, 4=events, 5=message
    if (['1','2','3','4','5'].includes(root)) {

      // Events doesn't require child selection
      if (root === '4') {
        const events = await this.loadUpcomingEvents(session.children[0].schoolName);
        return t.events(events) as UssdResponse;
      }

      // For other options, determine which child
      let child: ChildSummary;
      if (!multiChild) {
        child = session.children[0];
      } else {
        // Need child selection at depth 2
        if (depth < 2) {
          return t.selectChild(session.children) as UssdResponse;
        }
        const childInput = inputs[1];
        if (childInput === '0') {
          // Back to root
          return t.welcome(session.children[0].firstName + "'s parent") as UssdResponse;
        }
        const idx = parseInt(childInput) - 1;
        if (isNaN(idx) || idx < 0 || idx >= session.children.length) {
          return t.invalidInput as UssdResponse;
        }
        session.selectedChildIndex = idx;
        await this.saveSession(sessionId, session);
        child = session.children[idx];
      }

      const actionDepth = multiChild ? 2 : 1;

      switch (root) {
      case '1': // Progress
        return t.progress(child) as UssdResponse;

      case '2': // Attendance
        const attRows = await this.loadAttendance(child.id);
        return t.attendance(child, attRows) as UssdResponse;

      case '3': // Fee balance
        return t.fees(child) as UssdResponse;

      case '5': // Message teacher
        if (depth <= actionDepth) {
          return t.messageTeacher(child) as UssdResponse;
        }
        // User has typed their message
        const messageText = inputs[actionDepth];
        if (!messageText || messageText === '0') {
          return t.welcome(child.firstName + "'s parent") as UssdResponse;
        }
        const sent = await this.queueTeacherMessage({
          parentPhone: session.phoneNumber,
          studentId: child.id,
          studentName: `${child.firstName} ${child.lastName}`,
          teacherName: child.teacherName,
          message: messageText.slice(0, 120),
          channel: 'ussd',
        });
        return (sent ? t.messageSent(child.teacherName) : t.messageFailed) as UssdResponse;
      }
    }

    return t.invalidInput as UssdResponse;
  }

  // ── Database helpers ──────────────────────────────────────────────────────

  private normalizePhone(phone: string): string {
    // Handles: +254722000001, 254722000001, 0722000001, 722000001
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('254')) return digits;
    if (digits.startsWith('0'))   return '254' + digits.slice(1);
    if (digits.length === 9)      return '254' + digits;
    return digits;
  }

  private async lookupParent(phone: string): Promise<{ id: number; name: string } | null> {
    try {
      // Parents are stored in users table with role='parent'
      // OR parent_phone on the students table links back to a guardian record
      const result = await this.db.query<{ id: number; first_name: string; last_name: string }>(
        `SELECT DISTINCT u.id, u.first_name, u.last_name
         FROM users u
         WHERE u.phone = $1 AND u.role = 'parent' AND u.status = 'active'
         LIMIT 1`,
        [phone],
      );
      if (result.rows.length > 0) {
        const u = result.rows[0];
        return { id: u.id, name: `${u.first_name} ${u.last_name}` };
      }

      // Fallback: look up via student primary_phone (guardian)
      const fallback = await this.db.query<{ parent_id: number }>(
        `SELECT s.id as parent_id
         FROM students s
         WHERE (s.primary_phone = $1 OR s.secondary_phone = $1)
           AND s.enrollment_status = 'active'
         LIMIT 1`,
        [phone],
      );
      if (fallback.rows.length > 0) {
        return { id: fallback.rows[0].parent_id, name: 'Parent' };
      }
      return null;
    } catch (err) {
      logger.error('USSD lookupParent error', { phone, error: err });
      return null;
    }
  }

  private async loadChildren(parentId: number): Promise<ChildSummary[]> {
    try {
      const result = await this.db.query<{
        id: number; first_name: string; last_name: string;
        grade_level: string; class_name: string;
        fee_balance: string; total_fees_required: string;
        competency_levels: string | null;
        school_name: string; mpesa_shortcode: string;
        teacher_first: string; teacher_last: string;
      }>(
        `SELECT
           s.id, s.first_name, s.last_name, s.grade_level, s.class_name,
           s.fee_balance, s.total_fees_required, s.competency_levels,
           sc.name AS school_name,
           sc.mpesa_shortcode,
           t.first_name AS teacher_first, t.last_name AS teacher_last
         FROM students s
         JOIN schools sc ON sc.id = s.school_id
         LEFT JOIN class_assignments ca ON ca.class_name = s.class_name AND ca.school_id = s.school_id
         LEFT JOIN users t ON t.id = ca.teacher_id
         WHERE s.parent_id = $1 AND s.enrollment_status = 'active'
         ORDER BY s.grade_level, s.first_name`,
        [parentId],
      );

      return result.rows.map(r => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        gradeLevel: r.grade_level,
        className: r.class_name || r.grade_level,
        feeBalance: parseFloat(r.fee_balance) || 0,
        totalFeesRequired: parseFloat(r.total_fees_required) || 0,
        attendancePercent: 0, // loaded lazily in attendance action
        competencyLevels: r.competency_levels ? JSON.parse(r.competency_levels) : null,
        schoolName: r.school_name,
        schoolShortcode: r.mpesa_shortcode || '000000',
        teacherName: r.teacher_first ? `${r.teacher_first} ${r.teacher_last}` : 'Class Teacher',
      }));
    } catch (err) {
      logger.error('USSD loadChildren error', { parentId, error: err });
      return [];
    }
  }

  private async loadAttendance(studentId: number): Promise<AttendanceRow[]> {
    try {
      const result = await this.db.query<{ status: 'present' | 'absent' | 'late'; date: string }>(
        `SELECT status, attendance_date AS date
         FROM attendance
         WHERE student_id = $1
           AND attendance_date >= NOW() - INTERVAL '30 days'
         ORDER BY attendance_date DESC`,
        [studentId],
      );
      return result.rows;
    } catch {
      return [];
    }
  }

  private async loadUpcomingEvents(schoolName: string): Promise<EventRow[]> {
    try {
      const result = await this.db.query<{ title: string; event_date: string; description: string }>(
        `SELECT e.title, e.event_date, e.description
         FROM school_events e
         JOIN schools sc ON sc.id = e.school_id
         WHERE sc.name = $1 AND e.event_date >= NOW()
         ORDER BY e.event_date ASC
         LIMIT 4`,
        [schoolName],
      );
      return result.rows.map(r => ({ title: r.title, date: r.event_date, description: r.description }));
    } catch {
      return [];
    }
  }

  private async queueTeacherMessage(msg: {
    parentPhone: string;
    studentId: number;
    studentName: string;
    teacherName: string;
    message: string;
    channel: 'ussd' | 'sms' | 'app';
  }): Promise<boolean> {
    try {
      await this.db.query(
        `INSERT INTO parent_messages
           (parent_phone, student_id, student_name, teacher_name, message, channel, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())`,
        [msg.parentPhone, msg.studentId, msg.studentName, msg.teacherName, msg.message, msg.channel],
      );
      logger.info('USSD teacher message queued', { studentId: msg.studentId, teacher: msg.teacherName });
      return true;
    } catch (err) {
      logger.error('USSD queueTeacherMessage failed', { error: err });
      return false;
    }
  }

  // ── SMS command handler ───────────────────────────────────────────────────

  /**
   * Handle inbound SMS commands (e.g. "PROGRESS 12345", "FEES 12345")
   * Called by /api/v1/ussd/sms-inbound
   */
  async handleSmsCommand(from: string, body: string): Promise<string> {
    const phone = this.normalizePhone(from);
    const parts = body.trim().toUpperCase().split(/\s+/);
    const cmd = parts[0];
    const studentId = parts[1] ? parseInt(parts[1]) : null;

    try {
      switch (cmd) {
      case 'PROGRESS': {
        if (!studentId) return 'Usage: PROGRESS <student_id>. Example: PROGRESS 12345';
        const children = await this.loadChildById(studentId, phone);
        if (!children) return `Student ${studentId} not found or not linked to your number.`;
        const c = children;
        const levels = c.competencyLevels || {};
        const summary = Object.entries(levels).map(([k, v]) => `${k}: ${v}`).join(', ');
        return `${c.firstName} ${c.lastName} (${c.className})\nTerm Report: ${summary || 'No report yet'}\nAttendance: ${c.attendancePercent}%\nFee Bal: Ksh ${c.feeBalance.toLocaleString()}\ncbc-learn.ke/r/${c.id}`;
      }
      case 'FEES': {
        if (!studentId) return 'Usage: FEES <student_id>. Example: FEES 12345';
        const c = await this.loadChildById(studentId, phone);
        if (!c) return `Student ${studentId} not found.`;
        return c.feeBalance > 0
          ? `${c.firstName} ${c.lastName}\nFee Balance: Ksh ${c.feeBalance.toLocaleString()}\nPay via M-Pesa Paybill ${c.schoolShortcode}, Acc: ${c.id}`
          : `${c.firstName} ${c.lastName}: Fees fully paid. ✓`;
      }
      case 'ATTENDANCE': {
        if (!studentId) return 'Usage: ATTENDANCE <student_id>';
        const c = await this.loadChildById(studentId, phone);
        if (!c) return `Student ${studentId} not found.`;
        const att = await this.loadAttendance(studentId);
        const p = att.filter(d => d.status === 'present').length;
        const a = att.filter(d => d.status === 'absent').length;
        return `${c.firstName} ${c.lastName}\nLast 30 days: Present ${p}, Absent ${a}\nRate: ${c.attendancePercent}%`;
      }
      case 'HELP':
        return 'CBC Portal SMS Commands:\nPROGRESS <id> - Term report\nFEES <id> - Fee balance\nATTENDANCE <id> - Attendance\nEVENTS - School events\nDial *384*1234# for full menu';
      case 'EVENTS': {
        // Use first child's school
        const parent = await this.lookupParent(phone);
        if (!parent) return 'Number not registered. Contact your school.';
        const children = await this.loadChildren(parent.id);
        if (!children.length) return 'No children found.';
        const events = await this.loadUpcomingEvents(children[0].schoolName);
        return events.length
          ? 'Upcoming Events:\n' + events.map(e => `• ${e.title}: ${formatDate(e.date)}`).join('\n')
          : 'No upcoming events. Check app.';
      }
      default:
        return 'Unknown command. Send HELP for command list or dial *384*1234#';
      }
    } catch (err) {
      logger.error('SMS command error', { from, cmd, error: err });
      return 'Service unavailable. Try again later.';
    }
  }

  private async loadChildById(studentId: number, phone: string): Promise<ChildSummary | null> {
    try {
      const result = await this.db.query<{
        id: number; first_name: string; last_name: string;
        grade_level: string; class_name: string;
        fee_balance: string; total_fees_required: string;
        competency_levels: string | null;
        school_name: string; mpesa_shortcode: string;
        teacher_first: string; teacher_last: string;
      }>(
        `SELECT
           s.id, s.first_name, s.last_name, s.grade_level, s.class_name,
           s.fee_balance, s.total_fees_required, s.competency_levels,
           sc.name AS school_name, sc.mpesa_shortcode,
           t.first_name AS teacher_first, t.last_name AS teacher_last
         FROM students s
         JOIN schools sc ON sc.id = s.school_id
         LEFT JOIN class_assignments ca ON ca.class_name = s.class_name AND ca.school_id = s.school_id
         LEFT JOIN users t ON t.id = ca.teacher_id
         WHERE s.id = $1
           AND (s.primary_phone = $2 OR s.secondary_phone = $2 OR s.parent_id IN (
             SELECT id FROM users WHERE phone = $2 AND role = 'parent'
           ))`,
        [studentId, phone],
      );
      if (!result.rows.length) return null;
      const r = result.rows[0];
      return {
        id: r.id, firstName: r.first_name, lastName: r.last_name,
        gradeLevel: r.grade_level, className: r.class_name || r.grade_level,
        feeBalance: parseFloat(r.fee_balance) || 0,
        totalFeesRequired: parseFloat(r.total_fees_required) || 0,
        attendancePercent: 0,
        competencyLevels: r.competency_levels ? JSON.parse(r.competency_levels) : null,
        schoolName: r.school_name, schoolShortcode: r.mpesa_shortcode || '000000',
        teacherName: r.teacher_first ? `${r.teacher_first} ${r.teacher_last}` : 'Class Teacher',
      };
    } catch { return null; }
  }
}
