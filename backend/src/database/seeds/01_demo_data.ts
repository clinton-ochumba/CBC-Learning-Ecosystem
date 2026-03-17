/**
 * Demo seed data — CBC Learning Ecosystem
 * Creates investor demo environment: 3 schools, 6 users, 20 students, 15 M-Pesa transactions.
 *
 * Run: railway run --service cbc-backend npm run seed
 *
 * All accounts use password: Demo@2026!
 */

import { Knex } from 'knex';
import bcrypt from 'bcryptjs';

const DEMO_PASSWORD_HASH = bcrypt.hashSync('Demo@2026!', 10);
const TODAY = new Date().toISOString().split('T')[0];

export async function seed(knex: Knex): Promise<void> {
  // Idempotent: clean up previous demo data
  await knex('mpesa_transactions').where('account_reference', 'like', 'DEMO-%').delete().catch(() => {});
  await knex('students').where('school_id', 'in', [901, 902, 903]).delete().catch(() => {});
  await knex('teachers').where('school_id', 'in', [901, 902, 903]).delete().catch(() => {});
  await knex('parents').whereIn('user_id', [9001,9002,9003,9004,9005,9006]).delete().catch(() => {});
  await knex('users').where('email', 'like', '%@demo.cbclearning.co.ke').delete().catch(() => {});
  await knex('schools').where('id', 'in', [901, 902, 903]).delete().catch(() => {});

  // ─── Schools ───────────────────────────────────────────────────────────────
  await knex('schools').insert([
    {
      id: 901, code: 'DEMO-NAK-001', name: 'Nakuru Secondary School',
      type: 'public', category: 'day', level: 'secondary', cluster: 'C2',
      county: 'Nakuru', sub_county: 'Nakuru East',
      subscription_status: 'active', student_count: 520,
      settings: JSON.stringify({ demo: true }),
    },
    {
      id: 902, code: 'DEMO-ELD-001', name: 'Eldoret Boarding School',
      type: 'public', category: 'boarding', level: 'secondary', cluster: 'C3',
      county: 'Uasin Gishu', sub_county: 'Eldoret East',
      subscription_status: 'active', student_count: 380,
      settings: JSON.stringify({ demo: true }),
    },
    {
      id: 903, code: 'DEMO-MSA-001', name: 'Mombasa International Academy',
      type: 'private', category: 'day', level: 'both', cluster: 'C1',
      county: 'Mombasa', sub_county: 'Mvita',
      subscription_status: 'active', student_count: 680,
      settings: JSON.stringify({ demo: true }),
    },
  ]);

  // ─── Users ─────────────────────────────────────────────────────────────────
  await knex('users').insert([
    { id: 9001, school_id: 901, email: 'admin@demo.cbclearning.co.ke',
      password_hash: DEMO_PASSWORD_HASH, first_name: 'Sarah', last_name: 'Kamau',
      role: 'school_admin', phone: '+254700000001', is_active: true, consent_given: true },
    { id: 9002, school_id: 901, email: 'teacher@demo.cbclearning.co.ke',
      password_hash: DEMO_PASSWORD_HASH, first_name: 'James', last_name: 'Ochieng',
      role: 'teacher', phone: '+254700000002', is_active: true, consent_given: true },
    { id: 9003, school_id: 902, email: 'teacher2@demo.cbclearning.co.ke',
      password_hash: DEMO_PASSWORD_HASH, first_name: 'Faith', last_name: 'Wanjiru',
      role: 'teacher', phone: '+254700000003', is_active: true, consent_given: true },
    { id: 9004, school_id: 901, email: 'parent@demo.cbclearning.co.ke',
      password_hash: DEMO_PASSWORD_HASH, first_name: 'David', last_name: 'Mwangi',
      role: 'parent', phone: '+254708374149', is_active: true, consent_given: true },
    { id: 9005, school_id: 902, email: 'parent2@demo.cbclearning.co.ke',
      password_hash: DEMO_PASSWORD_HASH, first_name: 'Grace', last_name: 'Akinyi',
      role: 'parent', phone: '+254700000005', is_active: true, consent_given: true },
    { id: 9006, school_id: 901, email: 'student@demo.cbclearning.co.ke',
      password_hash: DEMO_PASSWORD_HASH, first_name: 'Brian', last_name: 'Mwangi',
      role: 'student', phone: '+254700000006', is_active: true, consent_given: true },
  ]);

  // ─── Teacher profiles ──────────────────────────────────────────────────────
  await knex('teachers').insert([
    { user_id: 9002, school_id: 901, email: 'teacher@demo.cbclearning.co.ke',
      phone_number: '+254700000002', specialization: 'Mathematics',
      employment_type: 'permanent', is_class_teacher: true, is_active: true },
    { user_id: 9003, school_id: 902, email: 'teacher2@demo.cbclearning.co.ke',
      phone_number: '+254700000003', specialization: 'English',
      employment_type: 'permanent', is_class_teacher: false, is_active: true },
  ]);

  // ─── Parent profiles ───────────────────────────────────────────────────────
  await knex('parents').insert([
    { user_id: 9004, phone_number: '+254708374149', mpesa_phone: '+254708374149',
      email: 'parent@demo.cbclearning.co.ke', relationship_type: 'father',
      county: 'Nakuru', is_primary_contact: true, receives_sms_alerts: true },
    { user_id: 9005, phone_number: '+254700000005', mpesa_phone: '+254700000005',
      email: 'parent2@demo.cbclearning.co.ke', relationship_type: 'mother',
      county: 'Uasin Gishu', is_primary_contact: true, receives_sms_alerts: true },
  ]);

  // ─── Students ──────────────────────────────────────────────────────────────
  const firstNames = ['Brian','Amina','Kevin','Fatuma','Peter','Wanjiku','Moses','Asha','John','Mary',
    'Daniel','Gladys','Samuel','Joyce','Paul','Rose','Joseph','Alice','James','Grace'];
  const lastNames  = ['Mwangi','Ouma','Kamau','Hassan','Njoroge','Wanjiru','Otieno','Ali','Kariuki','Njeri'];
  const grades     = ['G7','G8','G9','G10','G11','G12'];
  const genders    = ['male','female'];

  const students = firstNames.map((fn, i) => ({
    id: 90100 + i,
    school_id: i < 10 ? 901 : 902,
    user_id: i === 0 ? 9006 : null,
    admission_number: `DEMO${String(i + 1).padStart(4, '0')}`,
    first_name: fn,
    last_name: lastNames[i % 10],
    date_of_birth: '2010-03-15',
    gender: genders[i % 2],
    grade_level: grades[i % 6],
    class_name: `${grades[i % 6]} ${String.fromCharCode(65 + (i % 3))}`,
    enrollment_date: '2026-01-06',
    enrollment_status: 'active',
    fee_balance: Math.floor(Math.random() * 12000) + 3000,
    total_fees_required: 15000,
    total_fees_paid: Math.floor(Math.random() * 12000),
    competency_levels: JSON.stringify({ CC:'ME', CT:'AE', IC:'EE', LCT:'ME', SS:'ME', SD:'AE', CS:'ME' }),
    primary_phone: '+254700000010',
  }));
  await knex('students').insert(students);

  // ─── M-Pesa transactions ───────────────────────────────────────────────────
  const statuses = ['completed','completed','completed','pending','failed'];
  const amounts  = [2500, 5000, 7500, 3200, 4800];
  const txns = Array.from({ length: 15 }, (_, i) => {
    const daysAgo = Math.floor(Math.random() * 30);
    const status  = statuses[i % 5];
    return {
      id: `DEMO-TXN-${String(i + 1).padStart(4, '0')}`,
      school_id: i < 10 ? 901 : 902,
      student_id: 90100 + (i % 20),
      phone_number: '+254708374149',
      amount: amounts[i % 5],
      status,
      account_reference: `DEMO-${String(i + 1).padStart(6, '0')}`,
      merchant_request_id: `MR-DEMO-${i}`,
      checkout_request_id: `CR-DEMO-${i}`,
      receipt_number: status === 'completed' ? `RCP${String(i).padStart(8, '0')}` : null,
      created_at: new Date(Date.now() - daysAgo * 86400000),
      updated_at: new Date(Date.now() - daysAgo * 86400000 + 30000),
    };
  });
  await knex('mpesa_transactions').insert(txns);

  console.log('');
  console.log('✅ Demo seed complete — 3 schools, 20 students, 15 M-Pesa transactions');
  console.log('');
  console.log('Demo login accounts (password: Demo@2026!):');
  console.log('  Admin:   admin@demo.cbclearning.co.ke');
  console.log('  Teacher: teacher@demo.cbclearning.co.ke');
  console.log('  Parent:  parent@demo.cbclearning.co.ke   (M-Pesa: +254708374149)');
  console.log('  Student: student@demo.cbclearning.co.ke');
  console.log('');
}
