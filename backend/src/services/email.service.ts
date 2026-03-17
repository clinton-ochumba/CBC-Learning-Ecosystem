/**
 * Email Service — CBC Learning Ecosystem
 *
 * Sends emails for:
 *   - Referral notifications
 *   - Account creation
 *   - Password reset
 *   - Important school communications
 *
 * Note: In production, integrate with a service like SendGrid, AWS SES, or nodemailer
 */

import { Logger } from '../utils/logger';

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
}

export class EmailService {
  private logger = new Logger('EmailService');

  async send(payload: EmailPayload): Promise<void> {
    try {
      this.logger.info(`Email queued to ${payload.to}: ${payload.subject}`);

      /**
       * TODO: Implement actual email sending
       * Options:
       *   1. AWS SES (recommended for Kenya region)
       *   2. SendGrid
       *   3. Mailgun
       *   4. nodemailer (with configured SMTP)
       */

      // For now, just log it
      console.log(`[EMAIL] To: ${payload.to}, Subject: ${payload.subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email: ${(error as Error).message}`);
      throw error;
    }
  }

  async sendBulk(emails: EmailPayload[]): Promise<void> {
    await Promise.all(emails.map(email => this.send(email)));
  }
}
