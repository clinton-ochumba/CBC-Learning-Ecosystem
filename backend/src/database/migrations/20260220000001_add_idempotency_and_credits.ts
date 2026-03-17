/**
 * Migration: Add idempotency key to mpesa_transactions + student_credits table
 *
 * FIX GAP-03: idempotency_key column prevents duplicate STK Push requests from
 *             double-tap / network retry scenarios.
 *
 * FIX BUG-02: student_credits table records overpayments as credits rather than
 *             allowing fee_balance to go negative.
 */

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── GAP-03: Idempotency key on STK Push transactions ──────────────────────
  const hasIdempotencyKey = await knex.schema.hasColumn(
    'mpesa_transactions',
    'idempotency_key',
  );

  if (!hasIdempotencyKey) {
    await knex.schema.alterTable('mpesa_transactions', (table) => {
      table
        .string('idempotency_key', 255)
        .nullable()
        .comment(
          'Client-generated key to prevent duplicate payment initiation. ' +
          'Format: {studentId}-{amount}-{minuteSlot}',
        );

      table.index('idempotency_key');
    });
  }

  // ── BUG-02: student_credits table for overpayment tracking ────────────────
  const hasCreditTable = await knex.schema.hasTable('student_credits');

  if (!hasCreditTable) {
    await knex.schema.createTable('student_credits', (table) => {
      table.increments('id').primary();

      table
        .integer('student_id')
        .notNullable()
        .references('id')
        .inTable('students')
        .onDelete('CASCADE');

      table
        .integer('school_id')
        .notNullable()
        .references('id')
        .inTable('schools')
        .onDelete('CASCADE');

      table
        .decimal('amount', 10, 2)
        .notNullable()
        .comment('Credit amount in KES');

      table
        .string('source', 100)
        .notNullable()
        .comment('e.g. mpesa_overpayment, manual_credit, fee_waiver');

      table
        .string('mpesa_receipt_number', 50)
        .nullable()
        .comment('Linked M-Pesa receipt if credit arose from overpayment');

      table
        .boolean('applied')
        .defaultTo(false)
        .comment('Whether this credit has been applied to a future fee');

      table.timestamp('applied_at').nullable();

      table
        .integer('applied_to_payment_id')
        .nullable()
        .references('id')
        .inTable('fee_payments')
        .onDelete('SET NULL');

      table.text('notes').nullable();

      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      // Indexes
      table.index('student_id');
      table.index('school_id');
      table.index('applied');
      table.index('created_at');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('student_credits');

  const hasIdempotencyKey = await knex.schema.hasColumn(
    'mpesa_transactions',
    'idempotency_key',
  );
  if (hasIdempotencyKey) {
    await knex.schema.alterTable('mpesa_transactions', (table) => {
      table.dropColumn('idempotency_key');
    });
  }
}
