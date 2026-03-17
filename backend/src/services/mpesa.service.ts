/**
 * M-Pesa Payment Service
 * Integrates with Safaricom Daraja API for school fee payments
 * Supports: STK Push, C2B (PayBill), Transaction Status Query
 *
 * FIXES APPLIED:
 *   BUG-02: fee_balance floor (Math.max prevents negative balances)
 *   BUG-03: .forUpdate() row lock prevents race condition on concurrent callbacks
 *   BUG-04: Africa's Talking SMS notifications implemented
 *   BUG-07: axios 401 interceptor clears token cache and retries
 *   TEST-04: getTransactionHistory() added
 *   TEST-05: getPaymentMetrics() added
 *   GAP-01: processTimeout() updates status to 'timeout' in DB
 */

import axios, { AxiosInstance } from 'axios';
import moment from 'moment';
import { logger } from '../utils/logger';
import { db } from '../config/database';
import AfricasTalking from 'africastalking';

interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  environment: 'sandbox' | 'production';
  callbackUrl: string;
  timeoutUrl: string;
}

interface STKPushRequest {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  transactionDesc: string;
  studentId: number;
  schoolId: number;
  idempotencyKey?: string;
}

interface STKPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

interface MpesaCallbackData {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{
          Name: string;
          Value: any;
        }>;
      };
    };
  };
}

export interface TransactionHistoryOptions {
  status?: string;
  limit?: number;
  offset?: number;
  from?: Date | string;
  to?: Date | string;
}

export interface PaymentMetrics {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  pendingTransactions: number;
  successRate: number;
  totalRevenue: number;
}

export class MpesaService {
  private config: MpesaConfig;
  private baseUrl: string;
  private tokenCache: { token: string; expiresAt: number } | null = null;
  private axiosInstance: AxiosInstance;
  // FIX BUG-04: Africa's Talking SMS client
  private smsClient: ReturnType<typeof AfricasTalking>['SMS'] | null = null;

  constructor(config: MpesaConfig) {
    this.config = config;
    this.baseUrl =
      config.environment === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 60000,
    });

    // FIX BUG-07: Intercept 401 errors — clear token cache and retry once
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (
          error.response?.status === 401 &&
          !originalRequest._retried
        ) {
          originalRequest._retried = true;
          this.tokenCache = null; // Invalidate stale cache
          logger.warn('M-Pesa 401 received — clearing token cache and retrying');
          try {
            const freshToken = await this.getAccessToken();
            originalRequest.headers.Authorization = `Bearer ${freshToken}`;
            return this.axiosInstance(originalRequest);
          } catch (retryError) {
            return Promise.reject(retryError);
          }
        }
        return Promise.reject(error);
      },
    );

    // FIX BUG-04: Initialise Africa's Talking SMS client
    if (process.env.AT_API_KEY && process.env.AT_USERNAME) {
      const at = AfricasTalking({
        apiKey: process.env.AT_API_KEY,
        username: process.env.AT_USERNAME,
      });
      this.smsClient = at.SMS;
    } else {
      logger.warn('Africa\'s Talking credentials not set — SMS notifications disabled');
    }
  }

  /**
   * Get OAuth access token from Safaricom
   * Tokens are cached for 50 minutes (they expire after 1 hour)
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();

    if (this.tokenCache && this.tokenCache.expiresAt > now) {
      return this.tokenCache.token;
    }

    try {
      const auth = Buffer.from(
        `${this.config.consumerKey}:${this.config.consumerSecret}`,
      ).toString('base64');

      const response = await this.axiosInstance.get(
        '/oauth/v1/generate?grant_type=client_credentials',
        {
          headers: { Authorization: `Basic ${auth}` },
        },
      );

      const token = response.data.access_token;
      const expiresIn = parseInt(response.data.expires_in) || 3600;

      this.tokenCache = {
        token,
        expiresAt: now + (expiresIn - 600) * 1000,
      };

      logger.info('M-Pesa access token obtained successfully');
      return token;
    } catch (error: any) {
      logger.error('Failed to get M-Pesa access token', {
        error: error.message,
        response: error.response?.data,
      });
      throw new Error('M-Pesa authentication failed');
    }
  }

  /**
   * Initiate STK Push payment
   * Sends payment prompt to customer's phone
   */
  async initiateSTKPush(request: STKPushRequest): Promise<STKPushResponse> {
    // FIX GAP-03: Idempotency — check for existing pending transaction
    if (request.idempotencyKey) {
      const existing = await db('mpesa_transactions')
        .where('idempotency_key', request.idempotencyKey)
        .where('status', 'pending')
        .where('created_at', '>', new Date(Date.now() - 5 * 60 * 1000))
        .first();

      if (existing) {
        logger.info('Idempotency key matched — returning existing pending transaction', {
          idempotencyKey: request.idempotencyKey,
          checkoutRequestId: existing.checkout_request_id,
        });
        // Return a synthetic response so the caller can poll the existing transaction
        return {
          MerchantRequestID: existing.merchant_request_id,
          CheckoutRequestID: existing.checkout_request_id,
          ResponseCode: '0',
          ResponseDescription: 'Request already in progress',
          CustomerMessage: 'Payment already initiated. Please check your phone.',
        };
      }
    }

    try {
      const token = await this.getAccessToken();
      const timestamp = moment().format('YYYYMMDDHHmmss');
      const password = Buffer.from(
        `${this.config.shortcode}${this.config.passkey}${timestamp}`,
      ).toString('base64');

      const payload = {
        BusinessShortCode: this.config.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(request.amount),
        PartyA: request.phoneNumber,
        PartyB: this.config.shortcode,
        PhoneNumber: request.phoneNumber,
        CallBackURL: this.config.callbackUrl,
        AccountReference: request.accountReference,
        TransactionDesc: request.transactionDesc,
      };

      logger.info('Initiating M-Pesa STK Push', {
        phoneNumber: request.phoneNumber,
        amount: request.amount,
        accountReference: request.accountReference,
      });

      const response = await this.axiosInstance.post<STKPushResponse>(
        '/mpesa/stkpush/v1/processrequest',
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      await this.logSTKPushTransaction({
        merchantRequestId: response.data.MerchantRequestID,
        checkoutRequestId: response.data.CheckoutRequestID,
        amount: request.amount,
        accountReference: request.accountReference,
        phoneNumber: request.phoneNumber,
        transactionDesc: request.transactionDesc,
        studentId: request.studentId,
        schoolId: request.schoolId,
        idempotencyKey: request.idempotencyKey,
        responseCode: response.data.ResponseCode,
        responseDescription: response.data.ResponseDescription,
      });

      logger.info('STK Push initiated successfully', {
        checkoutRequestId: response.data.CheckoutRequestID,
      });

      return response.data;
    } catch (error: any) {
      logger.error('STK Push failed', {
        error: error.message,
        response: error.response?.data,
        request,
      });
      throw new Error(
        error.response?.data?.errorMessage || 'Payment initiation failed',
      );
    }
  }

  /**
   * Process M-Pesa callback
   * Called by Safaricom after payment attempt
   */
  async processCallback(data: MpesaCallbackData): Promise<void> {
    const callback = data.Body.stkCallback;

    try {
      const transaction = await db('mpesa_transactions')
        .where('checkout_request_id', callback.CheckoutRequestID)
        .first();

      if (!transaction) {
        logger.error('Transaction not found for callback', {
          checkoutRequestId: callback.CheckoutRequestID,
        });
        return;
      }

      if (callback.ResultCode === 0) {
        await this.handleSuccessfulPayment(callback, transaction);
      } else {
        await this.handleFailedPayment(callback, transaction);
      }
    } catch (error: any) {
      logger.error('Error processing M-Pesa callback', {
        error: error.message,
        callback,
      });
      throw error;
    }
  }

  /**
   * FIX GAP-01: Process STK Push timeout — mark transaction as timed out in DB
   */
  async processTimeout(checkoutRequestId: string): Promise<void> {
    try {
      const updated = await db('mpesa_transactions')
        .where('checkout_request_id', checkoutRequestId)
        .where('status', 'pending')
        .update({
          status: 'timeout',
          callback_received: true,
          result_code: -1,
          result_desc: 'Transaction timed out — no response from customer',
          updated_at: new Date(),
        });

      if (updated) {
        logger.info('Transaction marked as timeout', { checkoutRequestId });
      } else {
        logger.warn('Timeout received for already-resolved transaction', { checkoutRequestId });
      }
    } catch (error: any) {
      logger.error('Failed to process timeout', {
        error: error.message,
        checkoutRequestId,
      });
    }
  }

  /**
   * Handle successful payment
   */
  private async handleSuccessfulPayment(
    callback: any,
    transaction: any,
  ): Promise<void> {
    const metadata = callback.CallbackMetadata.Item;

    const amount = metadata.find((i: any) => i.Name === 'Amount')?.Value;
    const mpesaReceiptNumber = metadata.find(
      (i: any) => i.Name === 'MpesaReceiptNumber',
    )?.Value;
    const transactionDate = metadata.find(
      (i: any) => i.Name === 'TransactionDate',
    )?.Value;

    await db.transaction(async (trx) => {
      await trx('mpesa_transactions')
        .where('id', transaction.id)
        .update({
          status: 'successful',
          mpesa_receipt_number: mpesaReceiptNumber,
          transaction_date: moment(transactionDate, 'YYYYMMDDHHmmss').toDate(),
          result_code: 0,
          result_desc: callback.ResultDesc,
          callback_received: true,
          updated_at: new Date(),
        });

      const [payment] = await trx('fee_payments')
        .insert({
          student_id: transaction.student_id,
          school_id: transaction.school_id,
          amount,
          payment_method: 'mpesa',
          mpesa_receipt_number: mpesaReceiptNumber,
          payment_status: 'completed',
          payment_date: new Date(),
          term: this.getCurrentTerm(),
          academic_year: this.getCurrentAcademicYear(),
          created_at: new Date(),
        })
        .returning('*');

      await trx('mpesa_transactions')
        .where('id', transaction.id)
        .update({ payment_id: payment.id, reconciled: true });

      // FIX BUG-03: .forUpdate() acquires a row-level lock, preventing concurrent
      // callbacks from racing to read and update the same fee_balance simultaneously.
      const student = await trx('students')
        .where('id', transaction.student_id)
        .forUpdate()
        .first();

      if (student) {
        // FIX BUG-02: Math.max(0, ...) prevents fee_balance from going negative.
        // Record any overpayment as credit separately.
        const currentBalance = parseFloat(student.fee_balance) || 0;
        const overpayment = Math.max(0, amount - currentBalance);
        const newBalance = Math.max(0, currentBalance - amount);

        await trx('students')
          .where('id', transaction.student_id)
          .update({ fee_balance: newBalance, updated_at: new Date() });

        if (overpayment > 0) {
          await trx('student_credits').insert({
            student_id: transaction.student_id,
            school_id: transaction.school_id,
            amount: overpayment,
            source: 'mpesa_overpayment',
            mpesa_receipt_number: mpesaReceiptNumber,
            created_at: new Date(),
          });
          logger.info('Overpayment recorded as credit', {
            studentId: transaction.student_id,
            overpayment,
          });
        }
      }
    });

    logger.info('Payment processed successfully', {
      receiptNumber: mpesaReceiptNumber,
      amount,
      studentId: transaction.student_id,
    });

    // FIX BUG-04: Send actual SMS confirmation — fire-and-forget
    this.sendPaymentSuccessSMS(transaction, amount, mpesaReceiptNumber).catch(
      (err) => logger.error('SMS send failed (non-fatal)', { error: err.message }),
    );
  }

  /**
   * Handle failed payment
   */
  private async handleFailedPayment(
    callback: any,
    transaction: any,
  ): Promise<void> {
    await db('mpesa_transactions')
      .where('id', transaction.id)
      .update({
        status: 'failed',
        result_code: callback.ResultCode,
        result_desc: callback.ResultDesc,
        callback_received: true,
        updated_at: new Date(),
      });

    logger.warn('Payment failed', {
      checkoutRequestId: callback.CheckoutRequestID,
      resultCode: callback.ResultCode,
      resultDesc: callback.ResultDesc,
    });

    // FIX BUG-04: Notify parent of failure
    this.sendPaymentFailureSMS(transaction, callback.ResultDesc).catch(
      (err) => logger.error('Failure SMS send failed (non-fatal)', { error: err.message }),
    );
  }

  /**
   * Query transaction status
   */
  async queryTransactionStatus(checkoutRequestId: string): Promise<any> {
    try {
      const token = await this.getAccessToken();
      const timestamp = moment().format('YYYYMMDDHHmmss');
      const password = Buffer.from(
        `${this.config.shortcode}${this.config.passkey}${timestamp}`,
      ).toString('base64');

      const response = await this.axiosInstance.post(
        '/mpesa/stkpushquery/v1/query',
        {
          BusinessShortCode: this.config.shortcode,
          Password: password,
          Timestamp: timestamp,
          CheckoutRequestID: checkoutRequestId,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      logger.error('Transaction status query failed', {
        error: error.message,
        checkoutRequestId,
      });
      throw error;
    }
  }

  /**
   * Register C2B URLs (PayBill)
   * Must be called once during deployment setup
   */
  async registerC2BUrls(
    confirmationUrl: string,
    validationUrl: string,
  ): Promise<void> {
    try {
      const token = await this.getAccessToken();

      await this.axiosInstance.post(
        '/mpesa/c2b/v1/registerurl',
        {
          ShortCode: this.config.shortcode,
          ResponseType: 'Completed',
          ConfirmationURL: confirmationUrl,
          ValidationURL: validationUrl,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      logger.info('C2B URLs registered successfully');
    } catch (error: any) {
      logger.error('C2B URL registration failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Process C2B payment confirmation
   */
  async processC2BConfirmation(data: any): Promise<void> {
    try {
      const billRefNumber = data.BillRefNumber || '';
      const [schoolCode, studentIdStr] = billRefNumber.split('#');

      if (!schoolCode || !studentIdStr) {
        logger.warn('Invalid account reference format', { billRefNumber });
        return;
      }

      const school = await db('schools').where('code', schoolCode).first();
      const student = await db('students')
        .where('id', parseInt(studentIdStr))
        .first();

      if (!school || !student) {
        logger.warn('School or student not found', { schoolCode, studentId: studentIdStr });
        return;
      }

      // Duplicate check uses unique DB constraint — if trans_id exists, insert throws
      // and the catch below handles it cleanly (no TOCTOU risk)
      await db.transaction(async (trx) => {
        await trx('mpesa_paybill_payments').insert({
          trans_id: data.TransID,
          trans_time: moment(data.TransTime, 'YYYYMMDDHHmmss').toDate(),
          trans_amount: parseFloat(data.TransAmount),
          business_short_code: data.BusinessShortCode,
          bill_ref_number: data.BillRefNumber,
          invoice_number: data.InvoiceNumber,
          org_account_balance: parseFloat(data.OrgAccountBalance || '0'),
          third_party_trans_id: data.ThirdPartyTransID,
          msisdn: data.MSISDN,
          first_name: data.FirstName,
          middle_name: data.MiddleName,
          last_name: data.LastName,
          student_id: student.id,
          school_id: school.id,
          reconciled: true,
          reconciliation_status: 'auto_matched',
          created_at: new Date(),
        });

        await trx('fee_payments').insert({
          student_id: student.id,
          school_id: school.id,
          amount: parseFloat(data.TransAmount),
          payment_method: 'mpesa',
          mpesa_receipt_number: data.TransID,
          payment_status: 'completed',
          payment_date: moment(data.TransTime, 'YYYYMMDDHHmmss').toDate(),
          term: this.getCurrentTerm(),
          academic_year: this.getCurrentAcademicYear(),
          created_at: new Date(),
        });

        // FIX BUG-03: Row lock + FIX BUG-02: balance floor
        const freshStudent = await trx('students')
          .where('id', student.id)
          .forUpdate()
          .first();
        const currentBalance = parseFloat(freshStudent.fee_balance) || 0;
        const newBalance = Math.max(0, currentBalance - parseFloat(data.TransAmount));
        await trx('students')
          .where('id', student.id)
          .update({ fee_balance: newBalance, updated_at: new Date() });
      });

      logger.info('C2B payment processed successfully', {
        transId: data.TransID,
        amount: data.TransAmount,
        studentId: student.id,
      });
    } catch (error: any) {
      // Handle duplicate transaction gracefully
      if (error.code === '23505' || error.message?.includes('unique')) {
        logger.info('Duplicate C2B transaction ignored', { transId: data.TransID });
        return;
      }
      logger.error('C2B payment processing failed', { error: error.message, data });
      throw error;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST-04 FIX: getTransactionHistory — was called in tests but missing
  // ──────────────────────────────────────────────────────────────────────────
  /**
   * Get transaction history for a school, with optional filters
   */
  async getTransactionHistory(
    schoolId: number,
    options: TransactionHistoryOptions = {},
  ): Promise<any[]> {
    const { status, limit = 50, offset = 0, from, to } = options;

    let query = db('mpesa_transactions')
      .where('school_id', schoolId)
      .orderBy('created_at', 'desc');

    if (status) query = query.where('status', status);
    if (from) query = query.where('created_at', '>=', new Date(from));
    if (to) query = query.where('created_at', '<=', new Date(to));

    return query.limit(limit).offset(offset);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST-05 FIX: getPaymentMetrics — was called in tests but missing
  // ──────────────────────────────────────────────────────────────────────────
  /**
   * Calculate payment metrics for a school
   */
  async getPaymentMetrics(
    schoolId: number,
    options: { from?: Date | string; to?: Date | string } = {},
  ): Promise<PaymentMetrics> {
    let query = db('mpesa_transactions').where('school_id', schoolId);

    if (options.from) query = query.where('created_at', '>=', new Date(options.from));
    if (options.to) query = query.where('created_at', '<=', new Date(options.to));

    const rows: any[] = await query;

    const successfulTransactions = rows.filter((r) => r.status === 'successful');
    const failedTransactions = rows.filter((r) => r.status === 'failed');
    const pendingTransactions = rows.filter((r) => r.status === 'pending');
    const totalRevenue = successfulTransactions.reduce(
      (sum, r) => sum + parseFloat(r.amount || '0'),
      0,
    );

    return {
      totalTransactions: rows.length,
      successfulTransactions: successfulTransactions.length,
      failedTransactions: failedTransactions.length,
      pendingTransactions: pendingTransactions.length,
      successRate:
        rows.length > 0
          ? (successfulTransactions.length / rows.length) * 100
          : 0,
      totalRevenue,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private async logSTKPushTransaction(data: any): Promise<void> {
    await db('mpesa_transactions').insert({
      merchant_request_id: data.merchantRequestId,
      checkout_request_id: data.checkoutRequestId,
      amount: data.amount,
      account_reference: data.accountReference,
      phone_number: data.phoneNumber,
      transaction_desc: data.transactionDesc,
      student_id: data.studentId,
      school_id: data.schoolId,
      idempotency_key: data.idempotencyKey || null,
      status: 'pending',
      callback_received: false,
      reconciled: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  private getCurrentTerm(): string {
    const month = moment().month() + 1;
    if (month >= 1 && month <= 4) return 'Term 1';
    if (month >= 5 && month <= 8) return 'Term 2';
    return 'Term 3';
  }

  private getCurrentAcademicYear(): string {
    return moment().year().toString();
  }

  // FIX BUG-04: Actual SMS implementation via Africa's Talking
  private async sendPaymentSuccessSMS(
    transaction: any,
    amount: number,
    receiptNumber: string,
  ): Promise<void> {
    if (!this.smsClient) {
      logger.info('SMS skipped — Africa\'s Talking not configured', { receiptNumber });
      return;
    }

    const message =
      `CBC Schools: Payment of Ksh ${amount.toLocaleString()} received. ` +
      `Receipt: ${receiptNumber}. Thank you!`;

    await this.smsClient.send({
      to: [`+${transaction.phone_number}`],
      message,
      from: process.env.AT_SENDER_ID || 'CBCSCHOOL',
    });

    logger.info('Payment confirmation SMS sent', { receiptNumber });
  }

  private async sendPaymentFailureSMS(
    transaction: any,
    reason: string,
  ): Promise<void> {
    if (!this.smsClient) return;

    const message =
      `CBC Schools: Your M-Pesa payment did not complete. Reason: ${reason}. ` +
      `Please try again or use Paybill ${this.config.shortcode}.`;

    await this.smsClient.send({
      to: [`+${transaction.phone_number}`],
      message,
      from: process.env.AT_SENDER_ID || 'CBCSCHOOL',
    });

    logger.info('Payment failure SMS sent', { phone: transaction.phone_number });
  }
}

export const mpesaService = new MpesaService({
  consumerKey: process.env.MPESA_CONSUMER_KEY || '',
  consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
  passkey: process.env.MPESA_PASSKEY || '',
  shortcode: process.env.MPESA_SHORTCODE || '',
  environment:
    (process.env.MPESA_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
  callbackUrl: `${process.env.API_BASE_URL}/api/v1/payments/mpesa/callback`,
  timeoutUrl: `${process.env.API_BASE_URL}/api/v1/payments/mpesa/timeout`,
});
