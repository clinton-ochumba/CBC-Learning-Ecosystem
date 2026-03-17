/**
 * SMS Service — CBC Learning Ecosystem
 *
 * Generic SMS sending service for referrals and general communications
 * This is distinct from SmsNotificationService which handles event-triggered SMS
 *
 * Sends SMS via Africa's Talking
 */

import AfricasTalking from 'africastalking';
import { Logger } from '../utils/logger';

interface SmsPayload {
  to: string;
  message: string;
  schoolId?: string;
}

export class SMSService {
  private logger = new Logger('SMSService');
  private at: any;

  constructor() {
    const apiKey = process.env.AFRICASTALKING_API_KEY;
    const username = process.env.AFRICASTALKING_USERNAME || 'sandbox';

    if (!apiKey) {
      this.logger.warn('AFRICASTALKING_API_KEY not set - SMS will be logged only');
      this.at = null;
    } else {
      this.at = AfricasTalking({ apiKey, username });
    }
  }

  async send(payload: SmsPayload): Promise<void> {
    try {
      const { to, message } = payload;

      if (!this.at) {
        this.logger.info(`[SMS] To: ${to}, Message: ${message}`);
        return;
      }

      // Send via Africa's Talking
      const result = await this.at.SMS.send({
        to: [to],
        message,
      });

      this.logger.info(`SMS sent to ${to}`, { result });
    } catch (error) {
      this.logger.error(`Failed to send SMS: ${(error as Error).message}`);
      throw error;
    }
  }

  async sendBulk(messages: SmsPayload[]): Promise<void> {
    await Promise.all(messages.map(msg => this.send(msg)));
  }
}
