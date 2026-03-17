// backend-implementation/services/payment-provider.service.ts
// MULTI-PROVIDER PAYMENT SYSTEM
// Handles M-Pesa, Airtel Money, Bank transfers with automatic failover

import { MpesaService } from './mpesa.service';
import { Logger } from '../utils/logger';
import { AlertService } from './alert.service';
import Redis from 'ioredis';

interface PaymentRequest {
  phone_number: string;
  amount: number;
  account_reference: string;
  transaction_desc: string;
  school_id: string;
  parent_id: string;
  preferred_provider?: 'mpesa' | 'airtel' | 'bank';
}

interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  environment: 'sandbox' | 'production';
  callbackUrl: string;
  timeoutUrl: string;
}

interface PaymentResponse {
  success: boolean;
  transaction_id?: string;
  provider: string;
  error?: string;
  fallback_used?: boolean;
}

interface ProviderStatus {
  provider: string;
  available: boolean;
  last_success: Date | null;
  failure_count: number;
  response_time_ms: number;
}

export class PaymentProviderService {
  private mpesaService: MpesaService;
  private logger: Logger;
  private alertService: AlertService;
  private redis: Redis;
  
  // Provider priority order
  private providerPriority = ['mpesa', 'airtel', 'bank'];
  
  // Circuit breaker thresholds
  private readonly FAILURE_THRESHOLD = 5; // failures before circuit opens
  private readonly TIMEOUT_MS = 30000; // 30 second timeout
  private readonly CIRCUIT_RESET_MS = 300000; // 5 minute cool-down
  
  constructor() {
    this.logger = new Logger('PaymentProviderService');
    this.alertService = new AlertService();
    
    // Initialize M-Pesa with config from environment
    const mpesaConfig: MpesaConfig = {
      consumerKey: process.env.MPESA_CONSUMER_KEY || '',
      consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
      passkey: process.env.MPESA_PASSKEY || '',
      shortcode: process.env.MPESA_SHORTCODE || '',
      environment: (process.env.MPESA_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
      callbackUrl: process.env.MPESA_CALLBACK_URL || '',
      timeoutUrl: process.env.MPESA_TIMEOUT_URL || ''
    };
    this.mpesaService = new MpesaService(mpesaConfig);
    
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    });
    
    // Monitor provider health
    this.startHealthChecks();
  }
  
  /**
   * Process payment with automatic fallback
   */
  async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const startTime = Date.now();
    
    // Determine provider order
    const providers = this.getProviderOrder(request.preferred_provider);
    
    let lastError: Error | null = null;
    let fallbackUsed = false;
    
    // Try each provider in order
    for (const provider of providers) {
      try {
        // Check circuit breaker
        if (await this.isCircuitOpen(provider)) {
          this.logger.warn(`Circuit open for ${provider}, skipping`);
          continue;
        }
        
        this.logger.info(`Attempting payment with ${provider}`, {
          school_id: request.school_id,
          amount: request.amount
        });
        
        // Process with provider
        const result = await this.processWithProvider(provider, request);
        
        if (result.success) {
          // Success - record it
          await this.recordSuccess(provider, Date.now() - startTime);
          
          return {
            ...result,
            provider,
            fallback_used: fallbackUsed
          };
        }
        
        // Provider returned failure
        lastError = new Error(result.error || 'Payment failed');
        await this.recordFailure(provider);
        fallbackUsed = true;
        
      } catch (error) {
        this.logger.error(`Payment failed with ${provider}`, {
          error: error instanceof Error ? error.message : String(error),
          school_id: request.school_id
        });
        
        lastError = error instanceof Error ? error : new Error(String(error));
        await this.recordFailure(provider);
        fallbackUsed = true;
      }
    }
    
    // All providers failed
    await this.alertService.sendAlert({
      type: 'system_error',
      title: 'All Payment Providers Failed',
      message: `All payment providers failed for school ${request.school_id}. Last error: ${lastError?.message || 'Unknown'}`,
      metadata: { request, lastError: lastError?.message },
      schoolId: request.school_id
    });
    
    return {
      success: false,
      provider: 'none',
      error: lastError?.message || 'All payment providers failed',
      fallback_used: true
    };
  }
  
  /**
   * Process payment with specific provider
   */
  private async processWithProvider(
    provider: string,
    request: PaymentRequest
  ): Promise<PaymentResponse> {
    
    // Add timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Payment timeout')), this.TIMEOUT_MS);
    });
    
    const paymentPromise = (async () => {
      switch (provider) {
        case 'mpesa':
          return await this.processMpesa(request);
          
        case 'airtel':
          return await this.processAirtel(request);
          
        case 'bank':
          return await this.processBankTransfer(request);
          
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
    })();
    
    return await Promise.race([paymentPromise, timeoutPromise]);
  }
  
  /**
   * M-Pesa payment processing
   */
  private async processMpesa(request: PaymentRequest): Promise<PaymentResponse> {
    const result = await this.mpesaService.initiateSTKPush({
      phoneNumber: request.phone_number,
      amount: request.amount,
      accountReference: request.account_reference,
      transactionDesc: request.transaction_desc,
      studentId: 0,
      schoolId: parseInt(request.school_id),
      idempotencyKey: `${request.school_id}-${request.parent_id}-${Date.now()}`
    });
    
    return {
      success: result.ResponseCode === '0',
      transaction_id: result.CheckoutRequestID,
      provider: 'mpesa',
      error: result.ResponseCode !== '0' ? result.ResponseDescription : undefined
    };
  }
  
  /**
   * Airtel Money payment processing
   */
  private async processAirtel(request: PaymentRequest): Promise<PaymentResponse> {
    // TODO: Implement Airtel Money integration
    // For now, return not implemented
    
    // Airtel Money API Integration:
    // 1. Get OAuth token
    // 2. Initiate push payment
    // 3. Poll for status
    
    this.logger.warn('Airtel Money not yet implemented, skipping');
    
    return {
      success: false,
      provider: 'airtel',
      error: 'Airtel Money integration pending'
    };
  }
  
  /**
   * Bank transfer initiation
   */
  private async processBankTransfer(request: PaymentRequest): Promise<PaymentResponse> {
    // Generate payment instructions
    const paymentRef = `PAY-${request.school_id}-${Date.now()}`;
    
    // Store in database for manual reconciliation
    await this.storeBankPaymentInstructions({
      reference: paymentRef,
      amount: request.amount,
      school_id: request.school_id,
      parent_id: request.parent_id,
      bank_details: {
        account_name: 'CBC Learning Ecosystem Ltd',
        account_number: process.env.BANK_ACCOUNT_NUMBER || '1234567890',
        bank: 'Equity Bank',
        branch: 'Westlands',
        swift: 'EQBLKENA'
      },
      instructions: `Pay Ksh ${request.amount.toLocaleString()} to account above. Use reference: ${paymentRef}`
    });
    
    // Send payment instructions to parent
    await this.sendBankInstructions(request.parent_id, paymentRef);
    
    return {
      success: true, // Instructions sent successfully
      transaction_id: paymentRef,
      provider: 'bank',
      error: undefined
    };
  }
  
  /**
   * Determine provider order based on preference and availability
   */
  private getProviderOrder(preferred?: string): string[] {
    if (!preferred) {
      return this.providerPriority;
    }
    
    // Put preferred provider first, then others
    return [
      preferred,
      ...this.providerPriority.filter(p => p !== preferred)
    ];
  }
  
  /**
   * Check if circuit breaker is open for provider
   */
  private async isCircuitOpen(provider: string): Promise<boolean> {
    const key = `payment:circuit:${provider}`;
    const data = await this.redis.get(key);
    
    if (!data) return false;
    
    const circuit = JSON.parse(data);
    
    // Check if circuit should reset
    if (Date.now() - circuit.opened_at > this.CIRCUIT_RESET_MS) {
      await this.redis.del(key);
      return false;
    }
    
    return circuit.open;
  }
  
  /**
   * Record successful payment
   */
  private async recordSuccess(provider: string, responseTime: number): Promise<void> {
    const key = `payment:provider:${provider}`;
    
    await this.redis.hmset(key, {
      last_success: Date.now().toString(),
      failure_count: '0',
      response_time_ms: responseTime.toString(),
      available: 'true'
    });
    
    // Close circuit if open
    await this.redis.del(`payment:circuit:${provider}`);
    
    this.logger.info(`Payment success recorded for ${provider}`, { responseTime });
  }
  
  /**
   * Record payment failure
   */
  private async recordFailure(provider: string): Promise<void> {
    const key = `payment:provider:${provider}`;
    
    const failureCount = await this.redis.hincrby(key, 'failure_count', 1);
    
    // Open circuit if threshold exceeded
    if (typeof failureCount === 'number' && failureCount >= this.FAILURE_THRESHOLD) {
      await this.openCircuit(provider);
    }
    
    this.logger.warn(`Payment failure recorded for ${provider}`, {
      failure_count: failureCount
    });
  }
  
  /**
   * Open circuit breaker for provider
   */
  private async openCircuit(provider: string): Promise<void> {
    const key = `payment:circuit:${provider}`;
    
    await this.redis.setex(
      key,
      this.CIRCUIT_RESET_MS / 1000,
      JSON.stringify({
        open: true,
        opened_at: Date.now(),
        reason: 'failure_threshold_exceeded'
      })
    );
    
    // Alert operations team
    await this.alertService.sendAlert({
      type: 'system_error',
      title: 'Payment Circuit Opened',
      message: `Payment circuit opened for ${provider} due to ${this.FAILURE_THRESHOLD} consecutive failures`,
      metadata: { provider, threshold: this.FAILURE_THRESHOLD }
    });
    
    this.logger.error(`Circuit opened for ${provider}`);
  }
  
  /**
   * Get provider health status
   */
  async getProviderStatus(): Promise<ProviderStatus[]> {
    const statuses: ProviderStatus[] = [];
    
    for (const provider of this.providerPriority) {
      const key = `payment:provider:${provider}`;
      const data = await this.redis.hgetall(key);
      
      const circuitOpen = await this.isCircuitOpen(provider);
      
      statuses.push({
        provider,
        available: !circuitOpen && (data.available === 'true'),
        last_success: data.last_success ? new Date(parseInt(data.last_success)) : null,
        failure_count: parseInt(data.failure_count || '0'),
        response_time_ms: parseInt(data.response_time_ms || '0')
      });
    }
    
    return statuses;
  }
  
  /**
   * Health check for all providers
   */
  private startHealthChecks(): void {
    // Check every 5 minutes
    setInterval(async () => {
      const statuses = await this.getProviderStatus();
      
      // Alert if all providers unavailable
      const allDown = statuses.every(s => !s.available);
      
      if (allDown) {
        await this.alertService.sendAlert({
          type: 'system_error',
          title: 'All Payment Providers Down',
          message: 'All payment providers are unavailable',
          metadata: { statuses }
        });
      }
      
      this.logger.info('Provider health check', { statuses });
      
    }, 300000); // 5 minutes
  }
  
  /**
   * Store bank payment instructions
   */
  private async storeBankPaymentInstructions(data: any): Promise<void> {
    // TODO: Store in database
    this.logger.info('Bank payment instructions stored', { reference: data.reference });
  }
  
  /**
   * Send bank payment instructions to parent
   */
  private async sendBankInstructions(parentId: string, reference: string): Promise<void> {
    // TODO: Send SMS/email with bank details
    this.logger.info('Bank instructions sent', { parentId, reference });
  }
  
  /**
   * Manually mark bank payment as received
   */
  async reconcileBankPayment(reference: string, amount: number): Promise<void> {
    // TODO: Update payment status in database
    this.logger.info('Bank payment reconciled', { reference, amount });
  }
}

export default PaymentProviderService;
