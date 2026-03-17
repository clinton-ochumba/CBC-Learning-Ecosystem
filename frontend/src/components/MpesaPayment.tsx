/**
 * Parent M-Pesa Payment Component
 * Allows parents to pay school fees via M-Pesa
 *
 * FIXES APPLIED:
 *   BUG-01: Duplicate className JSX attribute merged into single expression
 *   BUG-10: localStorage replaced with sessionStorage (critical privacy fix for shared lab PCs)
 *   TEST-06: Added onSuccess/onError props alongside onPaymentComplete
 *   TEST-08: Subscription tier quick-select added with correct tier amounts
 */

import React, { useState, useEffect } from 'react';
import { mpesaPaymentService } from '../services/mpesa-payment.service';
import { CreditCard, Phone, DollarSign, CheckCircle, XCircle, Loader } from 'lucide-react';

interface Student {
  id: number;
  firstName: string;
  lastName: string;
  admissionNumber: string;
  gradeLevel: string;
  feeBalance: number;
  school: {
    name: string;
    code: string;
  };
}

/** TEST-06 FIX: accept onSuccess/onError in addition to onPaymentComplete */
interface MpesaPaymentProps {
  student: Student;
  /** Called with (receiptNumber, amount) on successful payment */
  onPaymentComplete?: (receiptNumber: string, amount: number) => void;
  /** Alias used by tests — same as onPaymentComplete success path */
  onSuccess?: (receiptNumber: string, amount: number) => void;
  /** Called with an Error object on payment failure */
  onError?: (error: Error) => void;
}

/** TEST-08 FIX: Kenya CBC school subscription tiers */
const SUBSCRIPTION_TIERS = [
  { label: 'Tier 1', description: 'Day School (Public)', amount: 15000 },
  { label: 'Tier 2', description: 'Boarding School', amount: 35000 },
  { label: 'Tier 3', description: 'National/Extra-County', amount: 75000 },
  { label: 'Tier 4', description: 'Private/International', amount: 150000 },
];

export const MpesaPayment: React.FC<MpesaPaymentProps> = ({
  student,
  onPaymentComplete,
  onSuccess,
  onError,
}) => {
  const [amount, setAmount] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<
    'idle' | 'initiated' | 'waiting' | 'success' | 'failed'
  >('idle');
  const [checkoutRequestId, setCheckoutRequestId] = useState<string | null>(null);

  useEffect(() => {
    // FIX BUG-10: Use sessionStorage instead of localStorage.
    // sessionStorage is cleared when the tab/window closes, preventing a student's
    // parent phone number from pre-filling on the next student's session on a shared
    // school computer. localStorage would persist indefinitely across sessions.
    const savedPhone = sessionStorage.getItem('parentPhoneNumber');
    if (savedPhone) {
      setPhoneNumber(savedPhone);
    }

    // FIX BUG-10: Clear sessionStorage on unmount to further protect shared computers
    return () => {
      sessionStorage.removeItem('parentPhoneNumber');
    };
  }, []);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    setAmount(value);
    setError(null);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9+]/g, '');
    setPhoneNumber(value);
    setError(null);
  };

  const handlePhoneBlur = () => {
    if (phoneNumber) {
      const formatted = mpesaPaymentService.formatPhoneNumber(phoneNumber);
      setPhoneNumber(formatted);
    }
  };

  const handleQuickAmount = (quickAmount: number) => {
    setAmount(quickAmount.toString());
    setError(null);
  };

  const handleInitiatePayment = async () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 10) {
      setError('Please enter a valid amount (minimum Ksh 10)');
      return;
    }

    if (numAmount > student.feeBalance) {
      setError('Amount exceeds outstanding balance');
      return;
    }

    if (!phoneNumber) {
      setError('Please enter your M-Pesa phone number');
      return;
    }

    try {
      setIsProcessing(true);
      setError(null);
      setPaymentStatus('initiated');

      const formattedPhone = mpesaPaymentService.formatPhoneNumber(phoneNumber);

      // FIX BUG-10: sessionStorage — cleared when tab closes (safe on shared PCs)
      sessionStorage.setItem('parentPhoneNumber', phoneNumber);

      const response = await mpesaPaymentService.initiatePayment({
        studentId: student.id,
        amount: numAmount,
        phoneNumber: formattedPhone,
        description: `School fees for ${student.firstName} ${student.lastName}`,
      });

      if (response.success && response.data) {
        setCheckoutRequestId(response.data.checkoutRequestId);
        setPaymentStatus('waiting');
        setSuccess('Payment request sent! Please check your phone and enter M-Pesa PIN.');

        pollPaymentStatus(response.data.checkoutRequestId, numAmount);
      } else {
        throw new Error(response.message);
      }
    } catch (err: any) {
      const errObj = err instanceof Error ? err : new Error(err.message || 'Payment failed');
      setError(errObj.message);
      setPaymentStatus('failed');
      // TEST-06 FIX: call onError prop
      onError?.(errObj);
    } finally {
      setIsProcessing(false);
    }
  };

  const pollPaymentStatus = async (requestId: string, paidAmount: number) => {
    try {
      const status = await mpesaPaymentService.pollPaymentStatus(requestId);

      if (status.success && status.data) {
        if (status.data.status === 'successful') {
          setPaymentStatus('success');
          const receipt = status.data.receiptNumber ?? '';
          setSuccess(`Payment successful! Receipt: ${receipt}`);

          // TEST-06 FIX: call both onPaymentComplete and onSuccess
          onPaymentComplete?.(receipt, paidAmount);
          onSuccess?.(receipt, paidAmount);

          setTimeout(() => {
            setAmount('');
            setPaymentStatus('idle');
            setSuccess(null);
          }, 3000);
        } else if (status.data.status === 'failed') {
          setPaymentStatus('failed');
          const msg = status.data.resultDesc || 'Payment failed';
          setError(msg);
          onError?.(new Error(msg));
        } else if (status.data.status === 'timeout') {
          setPaymentStatus('failed');
          const msg = 'Payment verification timed out. Check M-Pesa messages or try again.';
          setError(msg);
          onError?.(new Error(msg));
        }
      } else {
        const msg = 'Failed to verify payment status';
        setPaymentStatus('failed');
        setError(msg);
        onError?.(new Error(msg));
      }
    } catch (err: any) {
      const msg = 'Payment verification failed';
      setPaymentStatus('failed');
      setError(msg);
      onError?.(new Error(msg));
    }
  };

  const getStatusIcon = () => {
    switch (paymentStatus) {
    case 'waiting':
      return <Loader className="w-6 h-6 animate-spin text-blue-500" />;
    case 'success':
      return <CheckCircle className="w-6 h-6 text-green-500" />;
    case 'failed':
      return <XCircle className="w-6 h-6 text-red-500" />;
    default:
      return null;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-md mx-auto">
      {/* Student Info */}
      <div className="mb-6 pb-4 border-b">
        <h2 className="text-2xl font-bold mb-2">Pay School Fees</h2>
        <div className="text-sm text-gray-600">
          <p><strong>Student:</strong> {student.firstName} {student.lastName}</p>
          <p><strong>Admission No:</strong> {student.admissionNumber}</p>
          <p><strong>Grade:</strong> {student.gradeLevel}</p>
          <p><strong>School:</strong> {student.school.name}</p>
        </div>
      </div>

      {/* Fee Balance */}
      <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-amber-900">Outstanding Balance</span>
          <span className="text-2xl font-bold text-amber-900">
            {mpesaPaymentService.formatAmount(student.feeBalance)}
          </span>
        </div>
      </div>

      {/* TEST-08 FIX: Subscription tier quick-select */}
      <div className="mb-6">
        <p className="text-sm font-medium text-gray-700 mb-2">Quick Select — Annual Fee Tier</p>
        <div className="grid grid-cols-2 gap-2">
          {SUBSCRIPTION_TIERS.map((tier) => (
            <button
              key={tier.label}
              onClick={() => handleQuickAmount(tier.amount)}
              disabled={isProcessing || paymentStatus === 'waiting'}
              className="flex flex-col items-start px-3 py-2 border border-gray-200 rounded-lg hover:border-green-400 hover:bg-green-50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="text-xs font-bold text-green-700">{tier.label}</span>
              <span className="text-xs text-gray-500">{tier.description}</span>
              <span className="text-sm font-semibold text-gray-900 mt-1">
                {mpesaPaymentService.formatAmount(tier.amount)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Payment Status */}
      {paymentStatus !== 'idle' && (
        // FIX BUG-01: Merged into a single className expression.
        // Previously there were TWO className props on this element; React used only
        // the second (conditional) one, silently losing all the layout classes.
        <div
          className={`mb-6 p-4 rounded-lg border flex items-center gap-3 ${
            paymentStatus === 'success'
              ? 'bg-green-50 border-green-200'
              : paymentStatus === 'failed'
                ? 'bg-red-50 border-red-200'
                : 'bg-blue-50 border-blue-200'
          }`}
        >
          {getStatusIcon()}
          <div className="flex-1">
            <p className="text-sm font-medium">
              {paymentStatus === 'waiting' && 'Waiting for M-Pesa confirmation...'}
              {paymentStatus === 'success' && 'Payment Successful!'}
              {paymentStatus === 'failed' && 'Payment Failed'}
            </p>
            {success && <p className="text-xs text-gray-600 mt-1">{success}</p>}
            {error && paymentStatus === 'failed' && (
              <p className="text-xs text-red-600 mt-1">{error}</p>
            )}
          </div>
        </div>
      )}

      {/* Payment Form */}
      <div className="space-y-4">
        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <DollarSign className="w-4 h-4 inline mr-1" />
            Amount (KES)
          </label>
          <input
            type="text"
            value={amount}
            onChange={handleAmountChange}
            placeholder="Enter amount"
            aria-label="Amount"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-lg"
            disabled={isProcessing || paymentStatus === 'waiting'}
          />
          {amount && (
            <p className="text-xs text-gray-500 mt-1">
              {mpesaPaymentService.formatAmount(parseFloat(amount) || 0)}
            </p>
          )}
        </div>

        {/* Phone Number Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <Phone className="w-4 h-4 inline mr-1" />
            M-Pesa Phone Number
          </label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={handlePhoneChange}
            onBlur={handlePhoneBlur}
            placeholder="254712345678"
            aria-label="Phone Number"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            disabled={isProcessing || paymentStatus === 'waiting'}
          />
          <p className="text-xs text-gray-500 mt-1">
            Enter your M-Pesa registered phone number (format: 254712345678)
          </p>
        </div>

        {/* Error Message */}
        {error && paymentStatus !== 'failed' && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Pay Button */}
        <button
          onClick={handleInitiatePayment}
          disabled={
            isProcessing || !amount || !phoneNumber || paymentStatus === 'waiting'
          }
          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? (
            <>
              <Loader className="w-5 h-5 animate-spin" />
              <span>Processing...</span>
            </>
          ) : (
            <>
              <CreditCard className="w-5 h-5" />
              <span>Pay via M-Pesa</span>
            </>
          )}
        </button>

        {/* Help Text */}
        <div className="text-xs text-gray-500 text-center space-y-1">
          <p>You will receive an STK Push prompt on your phone.</p>
          <p>Enter your M-Pesa PIN to complete the payment.</p>
          <p className="font-medium">Payment is FREE for you (no transaction charges).</p>
        </div>
      </div>

      {/* Manual Payment Instructions */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
        <p className="font-medium mb-2">Manual Payment (Alternative):</p>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Go to M-Pesa menu on your phone</li>
          <li>Select "Lipa na M-Pesa" → "Paybill"</li>
          <li>Business Number: <strong>{student.school.code}</strong></li>
          <li>Account: <strong>{student.school.code}#{student.id}</strong></li>
          <li>Enter amount and M-Pesa PIN</li>
        </ol>
      </div>
    </div>
  );
};

export default MpesaPayment;
