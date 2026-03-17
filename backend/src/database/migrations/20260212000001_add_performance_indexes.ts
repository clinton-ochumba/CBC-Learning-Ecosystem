/**
 * Migration: Performance Indexes (PATCHED — safe for fresh DB)
 * CBC Learning Ecosystem
 *
 * PATCH NOTES:
 * - pg_trgm extension created in 20260208000001 (core tables migration)
 * - students.name col does not exist; uses first_name + last_name
 * - All table operations guarded with hasTable checks
 * - Partition logic removed (premature at <100K rows; re-add at Series A)
 * - payments is a VIEW on fee_payments — indexed via fee_payments instead
 */

import { Knex } from 'knex';

async function safeIndex(
  knex: Knex,
  table: string,
  fn: (t: Knex.AlterTableBuilder) => void,
): Promise<void> {
  if (!(await knex.schema.hasTable(table))) {
    console.log(`  ⚠  Skipping '${table}' indexes (table not found)`);
    return;
  }
  await knex.schema.table(table, fn);
}

async function safeRaw(knex: Knex, sql: string): Promise<void> {
  try { await knex.raw(sql); } catch (e: any) {
    if (!e.message?.includes('already exists')) console.warn('  ⚠ ', e.message);
  }
}

export async function up(knex: Knex): Promise<void> {
  console.log('Adding performance indexes...');

  await safeIndex(knex, 'students', (t) => {
    t.index(['school_id'], 'idx_students_school_id');
    t.index(['school_id', 'grade_level'], 'idx_students_school_grade');
  });

  await safeRaw(knex, 'CREATE INDEX IF NOT EXISTS idx_students_first_name_trgm ON students USING gin(first_name gin_trgm_ops)');
  await safeRaw(knex, 'CREATE INDEX IF NOT EXISTS idx_students_last_name_trgm  ON students USING gin(last_name  gin_trgm_ops)');

  await safeIndex(knex, 'assessments', (t) => {
    t.index(['student_id'],                              'idx_assessments_student_id');
    t.index(['student_id', 'created_at'],               'idx_assessments_student_date');
    t.index(['student_id', 'competency_id'],            'idx_assessments_student_competency');
    t.index(['teacher_id'],                              'idx_assessments_teacher_id');
    t.index(['teacher_id', 'created_at'],               'idx_assessments_teacher_date');
    t.index(['created_at'],                              'idx_assessments_created_at');
    t.index(['term', 'year'],                            'idx_assessments_term_year');
    t.index(['school_id', 'competency_id', 'created_at'],'idx_assessments_school_comp_date');
  });

  await safeRaw(knex, 'CREATE INDEX IF NOT EXISTS idx_assessments_dashboard ON assessments(student_id, created_at DESC, competency_id) WHERE deleted_at IS NULL');
  await safeRaw(knex, 'CREATE INDEX IF NOT EXISTS idx_assessments_progress  ON assessments(student_id, term, year, competency_id, score) WHERE deleted_at IS NULL');

  await safeIndex(knex, 'fee_payments', (t) => {
    t.index(['school_id'],               'idx_fee_payments_school_id');
    t.index(['school_id', 'created_at'], 'idx_fee_payments_school_date');
    t.index(['school_id', 'status'],     'idx_fee_payments_school_status');
    t.index(['parent_id'],               'idx_fee_payments_parent_id');
    t.index(['parent_id', 'created_at'], 'idx_fee_payments_parent_date');
    t.index(['status', 'created_at'],    'idx_fee_payments_status_date');
  });
  await safeRaw(knex, 'CREATE INDEX IF NOT EXISTS idx_fee_payments_reconciliation ON fee_payments(school_id, created_at, status, amount) WHERE status IN (\'completed\',\'pending\')');

  await safeIndex(knex, 'mpesa_transactions', (t) => {
    t.index(['school_id'],           'idx_mpesa_school_id');
    t.index(['status'],              'idx_mpesa_status');
    t.index(['created_at'],          'idx_mpesa_created_at');
  });

  await safeIndex(knex, 'offline_sync_queue', (t) => {
    t.index(['device_id'],           'idx_sync_device_id');
    t.index(['status'],              'idx_sync_status');
    t.index(['created_at'],          'idx_sync_created_at');
    t.index(['device_id', 'status'], 'idx_sync_device_status');
  });

  await safeIndex(knex, 'schools', (t) => {
    t.index(['subscription_status'],      'idx_schools_subscription_status');
    t.index(['county', 'sub_county'],     'idx_schools_location');
  });

  for (const tbl of ['students', 'assessments', 'fee_payments', 'schools', 'mpesa_transactions']) {
    if (await knex.schema.hasTable(tbl)) await knex.raw(`ANALYZE ${tbl}`).catch(() => {});
  }

  console.log('✅ Performance indexes created');
}

export async function down(knex: Knex): Promise<void> {
  const raw = (s: string) => knex.raw(s).catch(() => {});
  await raw('DROP INDEX IF EXISTS idx_students_first_name_trgm');
  await raw('DROP INDEX IF EXISTS idx_students_last_name_trgm');
  await raw('DROP INDEX IF EXISTS idx_assessments_dashboard');
  await raw('DROP INDEX IF EXISTS idx_assessments_progress');
  await raw('DROP INDEX IF EXISTS idx_fee_payments_reconciliation');
}
