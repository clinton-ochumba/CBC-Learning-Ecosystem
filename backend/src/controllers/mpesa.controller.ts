/**
 * M-Pesa Payment Controller
 * Handles all M-Pesa payment-related API endpoints
 *
 * FIXES APPLIED:
 *   TEST-10: Validate callback body structure before returning 200
 *   GAP-01:  handleTimeout() now persists status='timeout' to DB
 *   GAP-03:  Idempotency key support on payment initiation
 *   BUG-06:  Server-side overpayment guard (amount vs student fee_balance)
 */

import { Request, Response } from 'express';
import { mpesaService } from '../services/mpesa.service';
import { logger } from '../utils/logger';
import { db } from '../config/database';

export class MpesaController {
  /**
   * POST /api/v1/payments/mpesa/initiate
   * Initiate STK Push payment
   */
  static async initiatePayment(req: Request, res: Response): Promise<void> {
    try {
      const { studentId, amount, phoneNumber, description } = req.body;
      const userId = (req as any).user.id;

      if (!studentId || !amount || !phoneNumber) {
        res.status(400).json({ success: false, message: 'Missing required fields' });
        return;
      }

      if (amount < 10 || amount > 250000) {
        res.status(400).json({
          success: false,
          message: 'Amount must be between Ksh 10 and Ksh 250,000',
        });
        return;
      }

      const phoneRegex = /^254\d{9}$/;
      if (!phoneRegex.test(phoneNumber)) {
        res.status(400).json({
          success: false,
          message: 'Invalid phone number format. Use 254XXXXXXXXX',
        });
        return;
      }

      const student = await db('students').where('id', studentId).first();
      if (!student) {
        res.status(404).json({ success: false, message: 'Student not found' });
        return;
      }

      const school = await db('schools').where('id', student.school_id).first();
      if (!school) {
        res.status(404).json({ success: false, message: 'School not found' });
        return;
      }

      const isParent = await db('student_parents')
        .where('student_id', studentId)
        .andWhere('parent_id', userId)
        .first();

      if (!isParent && (req as any).user.role !== 'admin') {
        res.status(403).json({
          success: false,
          message: 'Not authorized to make payments for this student',
        });
        return;
      }

      // FIX BUG-06: Server-side overpayment guard
      const feeBalance = parseFloat(student.fee_balance) || 0;
      if (amount > feeBalance && feeBalance > 0) {
        res.status(400).json({
          success: false,
          message: `Amount (Ksh ${amount}) exceeds outstanding balance (Ksh ${feeBalance})`,
        });
        return;
      }

      const accountReference = `${school.code}#${student.id}`;

      // FIX GAP-03: Generate idempotency key from request context
      // Minute-precision key prevents double-tap duplicates within the same minute
      const minuteSlot = Math.floor(Date.now() / 60000);
      const idempotencyKey = `${studentId}-${Math.round(amount)}-${minuteSlot}`;

      const response = await mpesaService.initiateSTKPush({
        phoneNumber,
        amount,
        accountReference,
        transactionDesc: description || `School fees for ${student.first_name}`,
        studentId: student.id,
        schoolId: school.id,
        idempotencyKey,
      });

      res.status(200).json({
        success: true,
        message: 'Payment initiated. Please check your phone and enter M-Pesa PIN.',
        data: {
          checkoutRequestId: response.CheckoutRequestID,
          merchantRequestId: response.MerchantRequestID,
          customerMessage: response.CustomerMessage,
        },
      });

      logger.info('Payment initiated via API', {
        userId,
        studentId,
        amount,
        checkoutRequestId: response.CheckoutRequestID,
      });
    } catch (error: any) {
      logger.error('Payment initiation failed', {
        error: error.message,
        userId: (req as any).user?.id,
      });
      res.status(500).json({
        success: false,
        message: error.message || 'Payment initiation failed',
      });
    }
  }

  /**
   * POST /api/v1/payments/mpesa/callback
   * Handle M-Pesa payment callback from Safaricom
   *
   * FIX TEST-10: Validate minimum body structure before acknowledging.
   * Malformed payloads (e.g. { invalid: "callback" }) now get 400 instead of 200.
   */
  static async handleCallback(req: Request, res: Response): Promise<void> {
    // Validate minimum structure
    if (
      !req.body?.Body?.stkCallback?.CheckoutRequestID ||
      !req.body?.Body?.stkCallback?.MerchantRequestID
    ) {
      logger.warn('Invalid M-Pesa callback structure received', { body: req.body });
      res.status(400).json({
        success: false,
        message: 'Invalid callback structure. Expected Body.stkCallback.',
      });
      return;
    }

    // M-Pesa spec: respond quickly with 200 for valid callbacks
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Callback received successfully',
    });

    // Process asynchronously — do not block the response
    mpesaService.processCallback(req.body).catch((error: any) => {
      logger.error('M-Pesa callback processing failed', {
        error: error.message,
        body: req.body,
      });
    });
  }

  /**
   * POST /api/v1/payments/mpesa/timeout
   * Handle M-Pesa timeout callback
   *
   * FIX GAP-01: Now persists status='timeout' to mpesa_transactions table
   */
  static async handleTimeout(req: Request, res: Response): Promise<void> {
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Timeout received' });

    const checkoutRequestId = req.body?.Body?.stkCallback?.CheckoutRequestID
      || req.body?.CheckoutRequestID;

    if (checkoutRequestId) {
      await mpesaService.processTimeout(checkoutRequestId).catch((error: any) => {
        logger.error('Failed to process timeout in DB', {
          error: error.message,
          checkoutRequestId,
        });
      });
    } else {
      logger.warn('M-Pesa timeout received with no CheckoutRequestID', { body: req.body });
    }
  }

  /**
   * POST /api/v1/payments/mpesa/c2b/validation
   */
  static async validateC2B(req: Request, res: Response): Promise<void> {
    try {
      const { BillRefNumber } = req.body;
      const [schoolCode, studentIdStr] = (BillRefNumber || '').split('#');

      if (!schoolCode || !studentIdStr) {
        res.json({
          ResultCode: 'C2B00011',
          ResultDesc: 'Invalid account reference format. Use SCHOOLCODE#STUDENTID',
        });
        return;
      }

      const school = await db('schools').where('code', schoolCode).first();
      const student = await db('students')
        .where('id', parseInt(studentIdStr))
        .first();

      if (!school || !student) {
        res.json({ ResultCode: 'C2B00012', ResultDesc: 'Student or school not found' });
        return;
      }

      res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    } catch (error: any) {
      logger.error('C2B validation failed', { error: error.message, body: req.body });
      res.json({ ResultCode: 'C2B00013', ResultDesc: 'Validation error' });
    }
  }

  /**
   * POST /api/v1/payments/mpesa/c2b/confirmation
   */
  static async confirmC2B(req: Request, res: Response): Promise<void> {
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Confirmation received' });

    mpesaService.processC2BConfirmation(req.body).catch((error: any) => {
      logger.error('C2B confirmation processing failed', {
        error: error.message,
        body: req.body,
      });
    });
  }

  /**
   * GET /api/v1/payments/mpesa/status/:checkoutRequestId
   */
  static async queryStatus(req: Request, res: Response): Promise<void> {
    try {
      const { checkoutRequestId } = req.params;

      const transaction = await db('mpesa_transactions')
        .where('checkout_request_id', checkoutRequestId)
        .first();

      if (!transaction) {
        res.status(404).json({ success: false, message: 'Transaction not found' });
        return;
      }

      if (transaction.callback_received) {
        res.json({
          success: true,
          data: {
            status: transaction.status,
            amount: transaction.amount,
            receiptNumber: transaction.mpesa_receipt_number,
            transactionDate: transaction.transaction_date,
            phoneNumber: transaction.phone_number,
            resultDesc: transaction.result_desc,
          },
        });
        return;
      }

      const status = await mpesaService.queryTransactionStatus(checkoutRequestId);
      res.json({ success: true, data: status });
    } catch (error: any) {
      logger.error('Status query failed', {
        error: error.message,
        checkoutRequestId: req.params.checkoutRequestId,
      });
      res.status(500).json({ success: false, message: 'Failed to query transaction status' });
    }
  }

  /**
   * GET /api/v1/payments/student/:studentId/history
   */
  static async getPaymentHistory(req: Request, res: Response): Promise<void> {
    try {
      const { studentId } = req.params;
      const { limit = 50, offset = 0, from, to } = req.query;

      const userId = (req as any).user.id;
      const isParent = await db('student_parents')
        .where('student_id', studentId)
        .andWhere('parent_id', userId)
        .first();

      if (!isParent && (req as any).user.role !== 'admin') {
        res.status(403).json({ success: false, message: 'Not authorized' });
        return;
      }

      let query = db('fee_payments')
        .where('student_id', studentId)
        .orderBy('payment_date', 'desc');

      if (from) query = query.where('payment_date', '>=', from);
      if (to) query = query.where('payment_date', '<=', to);

      const payments = await query
        .limit(parseInt(limit as string))
        .offset(parseInt(offset as string));

      const total = await db('fee_payments')
        .where('student_id', studentId)
        .count('* as count')
        .first();

      const student = await db('students').where('id', studentId).first();

      res.json({
        success: true,
        data: {
          payments,
          total: total?.count || 0,
          summary: {
            totalPaid: payments.reduce(
              (sum: number, p: any) => sum + parseFloat(p.amount),
              0,
            ),
            outstandingBalance: Math.max(0, student?.fee_balance || 0),
          },
        },
      });
    } catch (error: any) {
      logger.error('Failed to get payment history', {
        error: error.message,
        studentId: req.params.studentId,
      });
      res.status(500).json({ success: false, message: 'Failed to retrieve payment history' });
    }
  }

  /**
   * POST /api/v1/payments/manual
   * Record manual payment (cash/bank transfer) — admin/bursar only
   */
  static async recordManualPayment(req: Request, res: Response): Promise<void> {
    try {
      const { studentId, amount, paymentMethod, receiptNumber, paymentDate, notes } = req.body;

      const userRole = (req as any).user.role;
      if (userRole !== 'admin' && userRole !== 'bursar') {
        res.status(403).json({
          success: false,
          message: 'Only admins or bursars can record manual payments',
        });
        return;
      }

      const student = await db('students').where('id', studentId).first();
      if (!student) {
        res.status(404).json({ success: false, message: 'Student not found' });
        return;
      }

      await db.transaction(async (trx) => {
        await trx('fee_payments').insert({
          student_id: studentId,
          school_id: student.school_id,
          amount,
          payment_method: paymentMethod,
          receipt_number: receiptNumber,
          payment_status: 'completed',
          payment_date: paymentDate || new Date(),
          notes,
          recorded_by: (req as any).user.id,
          created_at: new Date(),
        });

        // FIX BUG-03: row lock + FIX BUG-02: floor
        const freshStudent = await trx('students')
          .where('id', studentId)
          .forUpdate()
          .first();
        const newBalance = Math.max(0, (parseFloat(freshStudent.fee_balance) || 0) - amount);
        await trx('students')
          .where('id', studentId)
          .update({ fee_balance: newBalance, updated_at: new Date() });
      });

      res.json({ success: true, message: 'Payment recorded successfully' });

      logger.info('Manual payment recorded', {
        studentId,
        amount,
        paymentMethod,
        recordedBy: (req as any).user.id,
      });
    } catch (error: any) {
      logger.error('Failed to record manual payment', { error: error.message });
      res.status(500).json({ success: false, message: 'Failed to record payment' });
    }
  }
}
