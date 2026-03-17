// backend-implementation/services/referral.service.ts
// SCHOOL REFERRAL PROGRAM
// Reduces CAC to Ksh 1,250 per school (83% cheaper than direct sales)

import { Knex } from 'knex';
import { Logger } from '../utils/logger';
import { EmailService } from './email.service';
import { SMSService } from './sms.service';

interface Referral {
  id: string;
  referrer_school_id: string;
  referred_school_id: string;
  referral_code: string;
  status: 'pending' | 'converted' | 'expired' | 'cancelled';
  reward_type: 'free_month' | 'discount' | 'cash';
  reward_amount: number;
  reward_status: 'pending' | 'granted' | 'paid';
  referred_at: Date;
  converted_at?: Date;
  expires_at: Date;
}

interface ReferralStats {
  total_referrals: number;
  converted: number;
  pending: number;
  conversion_rate: number;
  total_rewards: number;
  cac_savings: number;
}

export class ReferralService {
  private db: Knex;
  private logger: Logger;
  private emailService: EmailService;
  private smsService: SMSService;

  // Reward configuration
  private readonly REWARD_AMOUNT = 1250; // Ksh 1,250 (1 month free for Tier 1)
  private readonly REFERRAL_EXPIRY_DAYS = 90; // 90 days to convert
  private readonly CONVERSION_REQUIREMENTS = {
    payment_received: true,
    school_active_days: 30,
  };

  constructor(db: Knex) {
    this.db = db;
    this.logger = new Logger('ReferralService');
    this.emailService = new EmailService();
    this.smsService = new SMSService();
  }

  /**
   * Generate unique referral code for school
   */
  async generateReferralCode(schoolId: string): Promise<string> {
    const school = await this.db('schools')
      .where({ id: schoolId })
      .first();

    if (!school) {
      throw new Error('School not found');
    }

    // Format: SCHOOL-NEMIS-RANDOM
    // Example: CBC-12345-A7F2
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `CBC-${school.nemis_code}-${random}`;

    // Store referral code
    await this.db('school_referral_codes').insert({
      school_id: schoolId,
      referral_code: code,
      created_at: new Date(),
      active: true,
    });

    return code;
  }

  /**
   * Get school's referral code (generate if doesn't exist)
   */
  async getOrCreateReferralCode(schoolId: string): Promise<string> {
    const existing = await this.db('school_referral_codes')
      .where({ school_id: schoolId, active: true })
      .first();

    if (existing) {
      return existing.referral_code;
    }

    return await this.generateReferralCode(schoolId);
  }

  /**
   * Track referral when new school signs up
   */
  async trackReferral(params: {
    referral_code: string;
    referred_school_id: string;
    referred_school_name: string;
    principal_name: string;
    principal_email: string;
    principal_phone: string;
  }): Promise<Referral> {

    // Validate referral code
    const referralCode = await this.db('school_referral_codes')
      .where({ referral_code: params.referral_code, active: true })
      .first();

    if (!referralCode) {
      throw new Error('Invalid referral code');
    }

    const referrerSchool = await this.db('schools')
      .where({ id: referralCode.school_id })
      .first();

    // Prevent self-referral
    if (referralCode.school_id === params.referred_school_id) {
      throw new Error('Cannot refer yourself');
    }

    // Check if referred school already exists
    const existingReferral = await this.db('referrals')
      .where({ referred_school_id: params.referred_school_id })
      .first();

    if (existingReferral) {
      this.logger.warn('School already referred', {
        school_id: params.referred_school_id,
        existing_referral: existingReferral.id,
      });
      return existingReferral;
    }

    // Create referral record
    const [referral] = await this.db('referrals').insert({
      referrer_school_id: referralCode.school_id,
      referred_school_id: params.referred_school_id,
      referral_code: params.referral_code,
      status: 'pending',
      reward_type: 'free_month',
      reward_amount: this.REWARD_AMOUNT,
      reward_status: 'pending',
      referred_at: new Date(),
      expires_at: new Date(Date.now() + this.REFERRAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    }).returning('*');

    // Log referral
    await this.db('referral_log').insert({
      referral_id: referral.id,
      action: 'referral_created',
      metadata: params,
      created_at: new Date(),
    });

    // Notify referrer school
    await this.notifyReferrer(referrerSchool, params.referred_school_name);

    this.logger.info('Referral tracked', {
      referral_id: referral.id,
      referrer: referralCode.school_id,
      referred: params.referred_school_id,
    });

    return referral;
  }

  /**
   * Mark referral as converted when school pays
   */
  async convertReferral(referredSchoolId: string): Promise<void> {
    const referral = await this.db('referrals')
      .where({
        referred_school_id: referredSchoolId,
        status: 'pending',
      })
      .first();

    if (!referral) {
      this.logger.warn('No pending referral found', { school_id: referredSchoolId });
      return;
    }

    // Check if requirements met
    const school = await this.db('schools')
      .where({ id: referredSchoolId })
      .first();

    const daysActive = Math.floor(
      (Date.now() - new Date(school.created_at).getTime()) / (24 * 60 * 60 * 1000),
    );

    const payments = await this.db('payments')
      .where({
        school_id: referredSchoolId,
        status: 'completed',
      })
      .first();

    const requirementsMet =
      payments &&
      daysActive >= this.CONVERSION_REQUIREMENTS.school_active_days;

    if (!requirementsMet) {
      this.logger.info('Referral conversion requirements not met', {
        referral_id: referral.id,
        days_active: daysActive,
        has_payment: !!payments,
      });
      return;
    }

    // Update referral status
    await this.db('referrals')
      .where({ id: referral.id })
      .update({
        status: 'converted',
        converted_at: new Date(),
        updated_at: new Date(),
      });

    // Grant reward to referrer
    await this.grantReward(referral);

    // Log conversion
    await this.db('referral_log').insert({
      referral_id: referral.id,
      action: 'referral_converted',
      metadata: { days_active: daysActive },
      created_at: new Date(),
    });

    this.logger.info('Referral converted', {
      referral_id: referral.id,
      referrer: referral.referrer_school_id,
    });
  }

  /**
   * Grant reward to referring school
   */
  private async grantReward(referral: Referral): Promise<void> {
    const referrerSchool = await this.db('schools')
      .where({ id: referral.referrer_school_id })
      .first();

    if (referral.reward_type === 'free_month') {
      // Extend subscription by 1 month
      const currentExpiry = new Date(referrerSchool.subscription_expires_at);
      const newExpiry = new Date(currentExpiry.getTime() + 30 * 24 * 60 * 60 * 1000);

      await this.db('schools')
        .where({ id: referral.referrer_school_id })
        .update({
          subscription_expires_at: newExpiry,
          updated_at: new Date(),
        });

      // Record credit
      await this.db('subscription_credits').insert({
        school_id: referral.referrer_school_id,
        credit_type: 'referral_reward',
        amount: this.REWARD_AMOUNT,
        months_credited: 1,
        referral_id: referral.id,
        applied_at: new Date(),
      });

    } else if (referral.reward_type === 'cash') {
      // Cash payout (for high-volume referrers)
      await this.db('referral_payouts').insert({
        school_id: referral.referrer_school_id,
        referral_id: referral.id,
        amount: referral.reward_amount,
        status: 'pending',
        created_at: new Date(),
      });
    }

    // Update reward status
    await this.db('referrals')
      .where({ id: referral.id })
      .update({
        reward_status: 'granted',
        updated_at: new Date(),
      });

    // Notify referrer
    await this.notifyRewardGranted(referrerSchool, referral);

    this.logger.info('Reward granted', {
      referral_id: referral.id,
      referrer: referral.referrer_school_id,
      reward_type: referral.reward_type,
      reward_amount: referral.reward_amount,
    });
  }

  /**
   * Get referral statistics for school
   */
  async getSchoolStats(schoolId: string): Promise<ReferralStats> {
    const referrals = await this.db('referrals')
      .where({ referrer_school_id: schoolId });

    const converted = referrals.filter(r => r.status === 'converted').length;
    const pending = referrals.filter(r => r.status === 'pending').length;

    const totalRewards = referrals
      .filter(r => r.reward_status === 'granted')
      .reduce((sum, r) => sum + r.reward_amount, 0);

    // CAC savings: Direct sales CAC (Ksh 8,000) - Referral CAC (Ksh 1,250) = Ksh 6,750 per school
    const cacSavings = converted * 6750;

    return {
      total_referrals: referrals.length,
      converted,
      pending,
      conversion_rate: referrals.length > 0 ? converted / referrals.length : 0,
      total_rewards: totalRewards,
      cac_savings: cacSavings,
    };
  }

  /**
   * Get leaderboard of top referrers
   */
  async getLeaderboard(limit: number = 10): Promise<any[]> {
    const leaderboard = await this.db('referrals')
      .select('referrer_school_id')
      .count('* as referral_count')
      .sum('reward_amount as total_rewards')
      .where({ status: 'converted' })
      .groupBy('referrer_school_id')
      .orderBy('referral_count', 'desc')
      .limit(limit);

    // Enrich with school details
    const enriched = await Promise.all(
      leaderboard.map(async (item) => {
        const school = await this.db('schools')
          .where({ id: item.referrer_school_id })
          .first();

        return {
          school_name: school.name,
          county: school.county,
          referral_count: parseInt(item.referral_count),
          total_rewards: parseFloat(item.total_rewards),
        };
      }),
    );

    return enriched;
  }

  /**
   * Expire old pending referrals
   */
  async expireOldReferrals(): Promise<number> {
    const expired = await this.db('referrals')
      .where({ status: 'pending' })
      .where('expires_at', '<', new Date())
      .update({
        status: 'expired',
        updated_at: new Date(),
      });

    this.logger.info(`Expired ${expired} old referrals`);

    return expired;
  }

  /**
   * Notify referrer of new referral
   */
  private async notifyReferrer(
    referrerSchool: any,
    referredSchoolName: string,
  ): Promise<void> {

    const principal = await this.db('users')
      .where({ school_id: referrerSchool.id, role: 'principal' })
      .first();

    if (!principal) return;

    // Send email
    await this.emailService.send({
      to: principal.email,
      subject: 'New School Referred!',
      body: `Great news! ${referredSchoolName} has signed up using your referral code from ${referrerSchool.name}. You'll earn Ksh ${this.REWARD_AMOUNT} credit when they complete payment. - CBC Learning`,
      html: `<p>Great news! <strong>${referredSchoolName}</strong> has signed up using your referral code from <strong>${referrerSchool.name}</strong>.</p><p>You'll earn <strong>Ksh ${this.REWARD_AMOUNT}</strong> credit when they complete payment.</p><p>- CBC Learning</p>`,
      cc: [],
      bcc: [],
    });

    // Send SMS
    await this.smsService.send({
      to: principal.phone_number,
      message: `Great news! ${referredSchoolName} has signed up using your referral code. You'll earn Ksh ${this.REWARD_AMOUNT} credit when they complete payment. - CBC Learning`,
    });
  }

  /**
   * Notify referrer that reward was granted
   */
  private async notifyRewardGranted(
    referrerSchool: any,
    referral: Referral,
  ): Promise<void> {

    const principal = await this.db('users')
      .where({ school_id: referrerSchool.id, role: 'principal' })
      .first();

    if (!principal) return;

    await this.emailService.send({
      to: principal.email,
      subject: 'Referral Reward Granted!',
      body: `Your referral reward has been granted! School: ${referrerSchool.name}, Amount: Ksh ${referral.reward_amount}, Type: ${referral.reward_type}. - CBC Learning`,
      html: `<p>Your referral reward has been granted!</p><p><strong>School:</strong> ${referrerSchool.name}</p><p><strong>Amount:</strong> Ksh ${referral.reward_amount}</p><p><strong>Type:</strong> ${referral.reward_type}</p><p>- CBC Learning</p>`,
      cc: [],
      bcc: [],
    });

    await this.smsService.send({
      to: principal.phone_number,
      message: `Congratulations! Your referral reward of Ksh ${referral.reward_amount} (1 month free) has been added to your account. Thank you for spreading the word! - CBC Learning`,
    });
  }

  /**
   * Generate referral marketing materials
   */
  async generateMarketingKit(schoolId: string): Promise<{
    referral_code: string;
    share_link: string;
    email_template: string;
    social_post: string;
    whatsapp_message: string;
  }> {

    const referralCode = await this.getOrCreateReferralCode(schoolId);
    const school = await this.db('schools').where({ id: schoolId }).first();

    const shareLink = `https://cbclearning.co.ke/signup?ref=${referralCode}`;

    return {
      referral_code: referralCode,
      share_link: shareLink,

      email_template: `
Subject: Transform Your School Management with CBC Learning Ecosystem

Dear [Principal Name],

I wanted to share an incredible platform that has transformed how we manage our school.

CBC Learning Ecosystem helps us:
✅ Track CBC competencies automatically
✅ Accept M-Pesa payments (FREE for parents!)
✅ Give parents real-time progress updates
✅ Save teachers 40% of admin time

We've been using it at ${school.name} and the results are amazing.

Sign up using my referral code: ${referralCode}
Or click: ${shareLink}

You'll get 10% discount, and I'll earn a month free (win-win!).

Best regards,
[Your Name]
Principal, ${school.name}
      `,

      social_post: `
🎓 Fellow school principals! We've transformed our school management with @CBCLearning

Results in 30 days:
✅ 95% parents now pay on time (M-Pesa integration)
✅ Teachers save 2 hours/day on paperwork
✅ Parents love real-time progress updates

Try it: ${shareLink}
Use code: ${referralCode} for 10% off

#EdTech #KenyaEducation #SchoolManagement
      `,

      whatsapp_message: `
Hi [Name], 

I'm using CBC Learning Ecosystem for school management and it's been amazing! 

M-Pesa payments, CBC tracking, parent portals - all in one.

Check it out: ${shareLink}
Use my code: ${referralCode}

Let me know if you have questions!
      `,
    };
  }
}

export default ReferralService;
