/**
 * M-Pesa Payment Service
 * Frontend service for handling school fee payments
 */

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export interface InitiatePaymentRequest {
  studentId: number;
  amount: number;
  phoneNumber: string;
  description?: string;
}

export interface InitiatePaymentResponse {
  success: boolean;
  message: string;
  data?: {
    checkoutRequestId: string;
    merchantRequestId: string;
    customerMessage: string;
  };
}

export interface PaymentStatusResponse {
  success: boolean;
  data?: {
    status: 'pending' | 'successful' | 'failed' | 'timeout';
    amount: number;
    receiptNumber?: string;
    transactionDate?: string;
    phoneNumber: string;
    resultDesc?: string;
  };
}

export interface PaymentHistoryResponse {
  success: boolean;
  data?: {
    payments: Payment[];
    total: number;
    summary: {
      totalPaid: number;
      outstandingBalance: number;
    };
  };
}

export interface Payment {
  id: number;
  amount: number;
  paymentMethod: string;
  receiptNumber: string;
  paymentDate: string;
  status: string;
  term: string;
  academicYear: string;
}

class MpesaPaymentService {
  private apiClient = axios.create({
    baseURL: `${API_BASE_URL}/api/v1/payments/mpesa`,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  constructor() {
    // Add auth token to requests
    this.apiClient.interceptors.request.use((config) => {
      const token = localStorage.getItem('authToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  /**
   * Initiate M-Pesa STK Push payment
   */
  async initiatePayment(
    request: InitiatePaymentRequest,
  ): Promise<InitiatePaymentResponse> {
    try {
      // Validate phone number format
      if (!this.validatePhoneNumber(request.phoneNumber)) {
        return {
          success: false,
          message: 'Invalid phone number. Use format: 254712345678',
        };
      }

      // Validate amount
      if (request.amount < 10 || request.amount > 250000) {
        return {
          success: false,
          message: 'Amount must be between Ksh 10 and Ksh 250,000',
        };
      }

      const response = await this.apiClient.post<InitiatePaymentResponse>(
        '/initiate',
        request,
      );

      return response.data;
    } catch (error: any) {
      return {
        success: false,
        message:
          error.response?.data?.message ||
          'Failed to initiate payment. Please try again.',
      };
    }
  }

  /**
   * Query payment status
   */
  async queryPaymentStatus(
    checkoutRequestId: string,
  ): Promise<PaymentStatusResponse> {
    try {
      const response = await this.apiClient.get<PaymentStatusResponse>(
        `/status/${checkoutRequestId}`,
      );
      return response.data;
    } catch (error: any) {
      return {
        success: false,
      };
    }
  }

  /**
   * Get payment history for a student
   */
  async getPaymentHistory(
    studentId: number,
    params?: {
      limit?: number;
      offset?: number;
      from?: string;
      to?: string;
    },
  ): Promise<PaymentHistoryResponse> {
    try {
      const response = await this.apiClient.get<PaymentHistoryResponse>(
        `/student/${studentId}/history`,
        { params },
      );
      return response.data;
    } catch (error: any) {
      return {
        success: false,
      };
    }
  }

  /**
   * Poll payment status until completed or timeout
   */
  async pollPaymentStatus(
    checkoutRequestId: string,
    maxAttempts: number = 30,
    intervalMs: number = 2000,
  ): Promise<PaymentStatusResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.sleep(intervalMs);

      const status = await this.queryPaymentStatus(checkoutRequestId);

      if (
        status.success &&
        status.data?.status &&
        ['successful', 'failed', 'timeout'].includes(status.data.status)
      ) {
        return status;
      }
    }

    // Timeout
    return {
      success: false,
      data: {
        status: 'timeout',
        amount: 0,
        phoneNumber: '',
        resultDesc: 'Payment verification timed out',
      },
    };
  }

  /**
   * Validate Kenyan phone number format
   */
  private validatePhoneNumber(phone: string): boolean {
    // Must be 254XXXXXXXXX (12 digits starting with 254)
    const phoneRegex = /^254\d{9}$/;
    return phoneRegex.test(phone);
  }

  /**
   * Format phone number to 254XXXXXXXXX
   */
  formatPhoneNumber(phone: string): string {
    // Remove spaces, dashes, plus signs
    let cleaned = phone.replace(/[\s\-\+]/g, '');

    // If starts with 0, replace with 254
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.substring(1);
    }

    // If starts with +254, remove the +
    if (cleaned.startsWith('+254')) {
      cleaned = cleaned.substring(1);
    }

    // If doesn't start with 254, add it
    if (!cleaned.startsWith('254') && cleaned.length === 9) {
      cleaned = '254' + cleaned;
    }

    return cleaned;
  }

  /**
   * Format amount for display
   */
  formatAmount(amount: number): string {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      minimumFractionDigits: 0,
    }).format(amount);
  }

  /**
   * Helper: Sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const mpesaPaymentService = new MpesaPaymentService();
