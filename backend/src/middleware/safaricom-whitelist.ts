/**
 * Safaricom IP Whitelist Middleware
 * FIX SEC-02: Only allow M-Pesa callbacks from known Safaricom IP ranges.
 *
 * An open callback endpoint allows any actor to POST a fake "payment successful"
 * callback and credit a fraudulent payment. This middleware gates all
 * Safaricom-facing endpoints to their published IP ranges.
 *
 * Reference: https://developer.safaricom.co.ke/docs#ip-whitelisting
 */

import { Request, Response, NextFunction } from 'express';
import ipRangeCheck from 'ip-range-check';
import { logger } from '../utils/logger';

/**
 * Safaricom Daraja API outbound IP ranges (production).
 * Update this list whenever Safaricom publishes new IPs.
 * In sandbox environments these checks can be bypassed via the env flag below.
 */
const SAFARICOM_IP_RANGES: string[] = [
  '196.201.214.0/24',
  '196.201.214.200',
  '196.201.214.206',
  '196.201.214.207',
  '196.201.214.208',
  '196.201.214.209',
  '196.201.214.210',
  '196.201.214.211',
  '196.201.214.212',
  '196.201.214.213',
  '196.201.214.214',
  '196.201.214.215',
  '196.201.214.216',
  '196.201.214.217',
  '196.201.214.218',
  '196.201.214.219',
  '196.201.214.220',
  '196.201.214.221',
  '196.201.214.222',
  '196.201.214.223',
  '196.201.216.0/24',
];

export function safaricomWhitelist(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Allow bypass in sandbox / test environments only
  if (process.env.NODE_ENV !== 'production' || process.env.MPESA_ENVIRONMENT === 'sandbox') {
    logger.debug('Safaricom IP whitelist bypassed (non-production environment)', {
      ip: req.ip,
      env: process.env.NODE_ENV,
    });
    next();
    return;
  }

  // Trust the X-Forwarded-For header from Nginx reverse proxy
  const clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    req.ip;

  if (!clientIp || !ipRangeCheck(clientIp, SAFARICOM_IP_RANGES)) {
    logger.warn('M-Pesa callback rejected — IP not in Safaricom whitelist', {
      clientIp,
      path: req.path,
      userAgent: req.headers['user-agent'],
    });
    res.status(403).json({
      success: false,
      message: 'Forbidden',
    });
    return;
  }

  logger.debug('Safaricom IP whitelist passed', { clientIp });
  next();
}
