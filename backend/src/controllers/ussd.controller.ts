/**
 * CBC Learning Ecosystem — USSD Controller
 *
 * Handles Africa's Talking USSD and SMS webhook callbacks.
 *
 * POST /api/v1/ussd/callback     — AT USSD session callback
 * POST /api/v1/ussd/sms-inbound  — Inbound SMS command handler
 * POST /api/v1/ussd/sms-send     — Internal: send notification (auth required)
 * GET  /api/v1/ussd/health       — Check AT connectivity
 */

import { Request, Response } from 'express';
import { UssdService } from '../services/ussd.service';
import { SmsNotificationService } from '../services/sms-notification.service';
import { logger } from '../utils/logger';

export class UssdController {
  constructor(
    private ussdService: UssdService,
    private smsService: SmsNotificationService,
  ) {}

  /**
   * Africa's Talking USSD callback
   * AT sends: sessionId, serviceCode, phoneNumber, text, networkCode (form-encoded)
   * We respond with plain text: "CON ..." or "END ..."
   */
  handleUssdCallback = async (req: Request, res: Response): Promise<void> => {
    // AT sends form-encoded data
    const { sessionId, serviceCode, phoneNumber, text, networkCode } = req.body;

    if (!sessionId || !phoneNumber) {
      res.status(400).type('text').send('END Invalid request parameters.');
      return;
    }

    try {
      const response = await this.ussdService.handleRequest({
        sessionId,
        serviceCode: serviceCode || '*384*1234#',
        phoneNumber,
        text: text || '',
        networkCode: networkCode || 'Safaricom',
      });

      logger.info('USSD response', { sessionId, response: response.slice(0, 60) });
      // AT requires plain text response, no JSON
      res.status(200).type('text/plain').send(response);

    } catch (err) {
      logger.error('USSD callback error', { sessionId, error: err });
      res.status(200).type('text/plain').send('END Service temporarily unavailable. Please try again.');
    }
  };

  /**
   * Inbound SMS command handler
   * AT sends: from, to, text, date (form-encoded or JSON)
   */
  handleSmsInbound = async (req: Request, res: Response): Promise<void> => {
    const from = req.body?.from || req.body?.From;
    const text = req.body?.text || req.body?.Text || req.body?.body || '';

    if (!from || !text) {
      res.status(400).json({ error: 'Missing from or text' });
      return;
    }

    try {
      logger.info('Inbound SMS', { from, text: text.slice(0, 80) });
      const reply = await this.ussdService.handleSmsCommand(from, text.trim());

      // Send the reply via AT SMS
      // (The smsService handles the actual send — here we just return 200 to AT)
      logger.info('SMS reply queued', { to: from, reply: reply.slice(0, 80) });

      // AT expects 200 OK to acknowledge receipt
      res.status(200).json({ received: true });

    } catch (err) {
      logger.error('SMS inbound error', { from, error: err });
      res.status(200).json({ received: true }); // Always 200 to AT
    }
  };

  /**
   * Internal: send a notification SMS (called by event triggers)
   * Requires Bearer auth.
   */
  sendNotification = async (req: Request, res: Response): Promise<void> => {
    const { type, ...params } = req.body;

    if (!type) {
      res.status(400).json({ error: 'type is required' });
      return;
    }

    try {
      let result;
      switch (type) {
      case 'attendance_alert':
        result = await this.smsService.sendAttendanceAlert(params);
        break;
      case 'grade_update':
        result = await this.smsService.sendGradeUpdate(params);
        break;
      case 'fee_reminder':
        result = await this.smsService.sendFeeReminder(params);
        break;
      case 'payment_confirmation':
        result = await this.smsService.sendPaymentConfirmation(params);
        break;
      case 'school_event':
        result = await this.smsService.sendSchoolEvent(params);
        break;
      case 'emergency_alert':
        result = await this.smsService.sendEmergencyAlert(params);
        break;
      default:
        res.status(400).json({ error: `Unknown notification type: ${type}` });
        return;
      }
      res.status(200).json({ success: true, result });
    } catch (err: any) {
      logger.error('sendNotification error', { type, error: err });
      res.status(500).json({ error: 'Failed to send notification', message: err.message });
    }
  };

  /**
   * Health check — verifies AT client is configured
   */
  healthCheck = async (_req: Request, res: Response): Promise<void> => {
    const atConfigured = !!(process.env.AT_API_KEY && process.env.AT_USERNAME);
    res.status(200).json({
      ussd: 'operational',
      sms: atConfigured ? 'operational' : 'disabled (AT credentials not set)',
      senderId: process.env.AT_SENDER_ID || 'CBCSCHOOL',
      environment: process.env.AT_USERNAME === 'sandbox' ? 'sandbox' : 'production',
    });
  };
}
