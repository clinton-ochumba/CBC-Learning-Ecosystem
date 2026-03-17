/**
 * Alert Service — CBC Learning Ecosystem
 *
 * Sends alerts to school administrators via SMS/Email for:
 *   - Payment failures and retries
 *   - System errors and critical issues
 *   - High payment volumes
 */

import { Logger } from '../utils/logger';
import { SmsNotificationService } from './sms-notification.service';

interface AlertPayload {
  type: 'payment_failure' | 'system_error' | 'payment_success' | 'retry_attempt';
  title: string;
  message: string;
  metadata?: Record<string, any>;
  schoolId?: string;
}

export class AlertService {
  private logger: Logger;
  private smsService = new SmsNotificationService(null as any); // SMS notify admins

  constructor(context: string) {
    this.logger = new Logger(context);
  }

  async sendAlert(payload: AlertPayload): Promise<void> {
    try {
      this.logger.info(`Alert [${payload.type}]: ${payload.title}`, {
        message: payload.message,
        metadata: payload.metadata,
      });

      // Optionally send SMS to school admin for critical alerts
      if (payload.type === 'system_error' || payload.type === 'payment_failure') {
        // Could queue SMS notification to school admin here
        // For now, just log it
        this.logger.warn(`Critical alert - should notify admin: ${payload.message}`);
      }
    } catch (error) {
      this.logger.error(`Failed to send alert: ${(error as Error).message}`);
    }
  }

  async sendBulkAlerts(alerts: AlertPayload[]): Promise<void> {
    await Promise.all(alerts.map(alert => this.sendAlert(alert)));
  }
}
