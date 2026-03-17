/**
 * Migration 000 — Core Platform Tables
 * CBC Learning Ecosystem
 *
 * Creates all tables referenced by FK constraints in later migrations.
 * Timestamp 20260208 ensures this runs FIRST.
 *
 * Tables: users, teachers, parents, classes, competencies,
 *         assessments, fee_payments, payments(VIEW), notifications, audit_log
 */

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Enable extensions used by performance indexes migration
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // ─── USERS ────────────────────────────────────────────────────────────────
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.integer('school_id').nullable();
    table.string('email', 255).unique().notNullable();
    table.string('password_hash', 255).notNullable();
    table.string('first_name', 100).notNullable();
    table.string('last_name', 100).notNullable();
    table.string('phone', 20).nullable();
    table.enum('role', ['super_admin','school_admin','teacher','parent','student'])
      .notNullable().defaultTo('parent');

    // Auth / session
    table.string('refresh_token_hash', 255).nullable();
    table.timestamp('refresh_token_expires_at').nullable();
    table.timestamp('last_login_at').nullable();
    table.integer('failed_login_attempts').defaultTo(0);
    table.timestamp('locked_until').nullable();

    // ODPC compliance (Kenya Data Protection Act)
    table.boolean('consent_given').defaultTo(false);
    table.timestamp('consent_given_at').nullable();
    table.boolean('data_processing_agreed').defaultTo(false);

    table.boolean('is_active').defaultTo(true);
    table.boolean('email_verified').defaultTo(false);
    table.string('email_verification_token', 255).nullable();
    table.string('password_reset_token', 255).nullable();
    table.timestamp('password_reset_expires_at').nullable();

    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('email');
    table.index('school_id');
    table.index('role');
  });

  // ─── TEACHERS ─────────────────────────────────────────────────────────────
  await knex.schema.createTable('teachers', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.integer('school_id').notNullable()
      .references('id').inTable('schools').onDelete('CASCADE');

    table.string('tsc_number', 50).nullable();
    table.string('national_id', 20).nullable();
    table.enum('employment_type', ['permanent','temporary','bom','intern']).defaultTo('permanent');
    table.string('qualification', 50).nullable();
    table.string('specialization', 100).nullable();
    table.integer('years_of_experience').defaultTo(0);
    table.json('subjects_taught').nullable();
    table.json('grade_levels').nullable();
    table.string('phone_number', 20).nullable();
    table.string('email', 255).nullable();
    table.boolean('is_class_teacher').defaultTo(false);
    table.boolean('is_active').defaultTo(true);

    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('user_id');
    table.index('school_id');
    table.index('phone_number');
    table.index('email');
  });

  // ─── PARENTS ──────────────────────────────────────────────────────────────
  await knex.schema.createTable('parents', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');

    table.string('national_id', 20).nullable();
    table.string('phone_number', 20).notNullable();
    table.string('alt_phone_number', 20).nullable();
    table.string('email', 255).nullable();
    table.string('occupation', 100).nullable();
    table.string('county', 100).nullable();
    table.string('mpesa_phone', 20).nullable();
    table.enum('relationship_type',
      ['father','mother','guardian','grandparent','sibling','other']).defaultTo('guardian');

    table.boolean('is_primary_contact').defaultTo(true);
    table.boolean('receives_sms_alerts').defaultTo(true);
    table.boolean('receives_email_alerts').defaultTo(false);
    table.boolean('is_active').defaultTo(true);

    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('user_id');
    table.index('phone_number');
    table.index('email');
  });

  // ─── CLASSES ──────────────────────────────────────────────────────────────
  await knex.schema.createTable('classes', (table) => {
    table.increments('id').primary();
    table.integer('school_id').notNullable()
      .references('id').inTable('schools').onDelete('CASCADE');
    table.integer('teacher_id').nullable()
      .references('id').inTable('teachers').onDelete('SET NULL');

    table.string('name', 100).notNullable();
    table.string('grade_level', 20).notNullable();
    table.string('stream', 20).nullable();
    table.integer('academic_year').notNullable().defaultTo(new Date().getFullYear());
    table.enum('term', ['1','2','3']).notNullable().defaultTo('1');
    table.integer('capacity').defaultTo(40);
    table.integer('enrolled_count').defaultTo(0);
    table.json('subjects').nullable();
    table.boolean('is_active').defaultTo(true);

    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('school_id');
    table.index('teacher_id');
    table.index(['school_id', 'grade_level']);
  });

  // ─── CBC COMPETENCIES (seeded) ────────────────────────────────────────────
  await knex.schema.createTable('competencies', (table) => {
    table.increments('id').primary();
    table.string('code', 20).unique().notNullable();
    table.string('name', 255).notNullable();
    table.string('short_name', 50).notNullable();
    table.text('description').nullable();
    table.enum('category', ['core','subject_specific']).defaultTo('core');
    table.integer('display_order').defaultTo(0);
    table.boolean('is_active').defaultTo(true);
  });

  await knex('competencies').insert([
    { code: 'CC',  short_name: 'Communication',    name: 'Communication and Collaboration',       display_order: 1 },
    { code: 'CT',  short_name: 'Critical Thinking', name: 'Critical Thinking and Problem Solving', display_order: 2 },
    { code: 'IC',  short_name: 'Imagination',       name: 'Imagination and Creativity',            display_order: 3 },
    { code: 'LCT', short_name: 'Digital Literacy',  name: 'Learning and Digital Literacy',         display_order: 4 },
    { code: 'SS',  short_name: 'Self-Efficacy',     name: 'Self-Efficacy',                         display_order: 5 },
    { code: 'SD',  short_name: 'Social Dev',        name: 'Social Development and Responsibility', display_order: 6 },
    { code: 'CS',  short_name: 'Citizenship',       name: 'Citizenship',                           display_order: 7 },
  ]);

  // ─── ASSESSMENTS ──────────────────────────────────────────────────────────
  await knex.schema.createTable('assessments', (table) => {
    table.increments('id').primary();
    table.integer('student_id').notNullable()
      .references('id').inTable('students').onDelete('CASCADE');
    table.integer('teacher_id').nullable()
      .references('id').inTable('teachers').onDelete('SET NULL');
    table.integer('school_id').notNullable()
      .references('id').inTable('schools').onDelete('CASCADE');
    table.integer('competency_id').notNullable()
      .references('id').inTable('competencies').onDelete('RESTRICT');
    table.integer('class_id').nullable()
      .references('id').inTable('classes').onDelete('SET NULL');

    table.enum('performance_level', ['EE','ME','AE','BE']).notNullable();
    table.decimal('score', 5, 2).nullable();
    table.text('notes').nullable();
    table.text('teacher_comment').nullable();
    table.integer('term').notNullable();
    table.integer('year').notNullable().defaultTo(new Date().getFullYear());
    table.enum('assessment_type',
      ['formative','summative','project','portfolio','observation']).defaultTo('formative');
    table.string('subject_code', 20).nullable();
    table.string('strand', 100).nullable();
    table.string('sub_strand', 100).nullable();

    table.timestamp('assessed_at').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('deleted_at').nullable();
  });

  // ─── FEE PAYMENTS ─────────────────────────────────────────────────────────
  await knex.schema.createTable('fee_payments', (table) => {
    table.increments('id').primary();
    table.integer('student_id').notNullable()
      .references('id').inTable('students').onDelete('CASCADE');
    table.integer('school_id').notNullable()
      .references('id').inTable('schools').onDelete('CASCADE');
    table.integer('parent_id').nullable()
      .references('id').inTable('parents').onDelete('SET NULL');

    table.decimal('amount', 10, 2).notNullable();
    table.decimal('fee_balance_before', 10, 2).nullable();
    table.decimal('fee_balance_after', 10, 2).nullable();

    table.enum('payment_method', ['mpesa','bank','cash','cheque']).notNullable();
    table.enum('status', ['pending','completed','failed','reversed']).defaultTo('pending');

    // M-Pesa fields
    table.string('mpesa_transaction_id', 50).nullable();
    table.string('checkout_request_id', 100).nullable();
    table.string('merchant_request_id', 100).nullable();
    table.string('receipt_number', 50).nullable();
    table.string('phone_number', 20).nullable();
    table.string('transaction_id', 100).nullable();

    // Bank fields
    table.string('bank_reference', 100).nullable();
    table.string('bank_name', 100).nullable();

    // Term billing
    table.integer('term').nullable();
    table.integer('academic_year').nullable();
    table.string('fee_type', 50).defaultTo('tuition');
    table.string('account_reference', 100).nullable();

    // Reconciliation
    table.boolean('reconciled').defaultTo(false);
    table.timestamp('reconciled_at').nullable();
    table.integer('reconciled_by').nullable()
      .references('id').inTable('users').onDelete('SET NULL');

    table.text('notes').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('student_id');
    table.index('school_id');
    table.index('parent_id');
    table.index('status');
    table.index('checkout_request_id');
    table.index('receipt_number');
    table.index('transaction_id');
    table.index('phone_number');
    table.index('merchant_request_id');
    table.index(['status', 'created_at']);
    table.index(['school_id', 'created_at']);
  });

  // 'payments' VIEW — alias for compatibility with performance indexes migration
  await knex.raw(`
    CREATE VIEW payments AS
    SELECT id, student_id, school_id, parent_id, amount, status,
           payment_method, checkout_request_id, merchant_request_id,
           receipt_number, phone_number, transaction_id, account_reference,
           reconciled, created_at, updated_at
    FROM fee_payments
  `);

  // ─── NOTIFICATIONS ────────────────────────────────────────────────────────
  await knex.schema.createTable('notifications', (table) => {
    table.increments('id').primary();
    table.integer('user_id').nullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.integer('school_id').nullable();
    table.enum('channel', ['sms','email','push','in_app']).notNullable();
    table.enum('type', ['payment_confirmed','payment_failed','fee_reminder',
      'assessment_published','report_ready','system']).notNullable();
    table.string('recipient', 255).notNullable();
    table.text('message').notNullable();
    table.string('subject', 255).nullable();
    table.enum('status', ['pending','sent','failed','delivered']).defaultTo('pending');
    table.string('provider_message_id', 255).nullable();
    table.text('error_message').nullable();
    table.integer('retry_count').defaultTo(0);
    table.timestamp('sent_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.index('user_id');
    table.index('status');
  });

  // ─── AUDIT LOG (ODPC) ─────────────────────────────────────────────────────
  await knex.schema.createTable('audit_log', (table) => {
    table.bigIncrements('id').primary();
    table.integer('user_id').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.integer('school_id').nullable();
    table.string('action', 100).notNullable();
    table.string('entity_type', 50).nullable();
    table.integer('entity_id').nullable();
    table.json('old_values').nullable();
    table.json('new_values').nullable();
    table.json('metadata').nullable();
    table.string('ip_address', 45).nullable();
    table.string('user_agent', 512).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.index('user_id');
    table.index('action');
    table.index('created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP VIEW IF EXISTS payments');
  for (const t of ['audit_log','notifications','fee_payments','assessments',
    'competencies','classes','parents','teachers','users']) {
    await knex.schema.dropTableIfExists(t);
  }
}
