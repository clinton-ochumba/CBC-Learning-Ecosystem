import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // M-Pesa STK Push Transactions
  await knex.schema.createTable('mpesa_transactions', (table) => {
    table.increments('id').primary();

    // M-Pesa Request IDs
    table.string('merchant_request_id', 255).unique().notNullable();
    table.string('checkout_request_id', 255).unique().notNullable();

    // Payment Details
    table.decimal('amount', 10, 2).notNullable();
    table.string('account_reference', 100).notNullable();
    table.string('phone_number', 15).notNullable();
    table.text('transaction_desc');

    // M-Pesa Response
    table.string('mpesa_receipt_number', 50).unique();
    table.timestamp('transaction_date');
    table.integer('result_code');
    table.text('result_desc');

    // Internal References
    table.integer('student_id').references('id').inTable('students').onDelete('CASCADE');
    table.integer('school_id').references('id').inTable('schools').onDelete('CASCADE');
    table.integer('payment_id').references('id').inTable('fee_payments').onDelete('SET NULL');

    // Status Tracking
    table.enum('status', ['pending', 'successful', 'failed', 'timeout', 'reversed']).defaultTo('pending');
    table.boolean('callback_received').defaultTo(false);
    table.boolean('reconciled').defaultTo(false);

    // Metadata
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Indexes
    table.index('merchant_request_id');
    table.index('checkout_request_id');
    table.index('mpesa_receipt_number');
    table.index('student_id');
    table.index('school_id');
    table.index('status');
    table.index('created_at');
    table.index(['student_id', 'created_at']);
  });

  // M-Pesa PayBill C2B Transactions
  await knex.schema.createTable('mpesa_paybill_payments', (table) => {
    table.increments('id').primary();

    // M-Pesa Details
    table.string('trans_id', 50).unique().notNullable(); // M-Pesa transaction ID
    table.timestamp('trans_time').notNullable();
    table.decimal('trans_amount', 10, 2).notNullable();
    table.string('business_short_code', 20).notNullable();
    table.string('bill_ref_number', 100); // Account reference from customer
    table.string('invoice_number', 100);
    table.decimal('org_account_balance', 12, 2);
    table.string('third_party_trans_id', 100);

    // Customer Details
    table.string('msisdn', 15); // Sender's phone
    table.string('first_name', 100);
    table.string('middle_name', 100);
    table.string('last_name', 100);

    // Internal Mapping
    table.integer('student_id').references('id').inTable('students').onDelete('CASCADE');
    table.integer('school_id').references('id').inTable('schools').onDelete('CASCADE');
    table.integer('payment_id').references('id').inTable('fee_payments').onDelete('SET NULL');

    // Reconciliation Status
    table.boolean('reconciled').defaultTo(false);
    table.enum('reconciliation_status', ['auto_matched', 'manual_matched', 'unmatched', 'pending_review']);
    table.timestamp('reconciled_at');
    table.integer('reconciled_by').references('id').inTable('users').onDelete('SET NULL');

    // Metadata
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Indexes
    table.index('trans_id');
    table.index('bill_ref_number');
    table.index('reconciled');
    table.index('school_id');
    table.index('student_id');
    table.index('trans_time');
  });

  // M-Pesa Configuration (per school)
  await knex.schema.createTable('mpesa_config', (table) => {
    table.increments('id').primary();
    table.integer('school_id').unique().references('id').inTable('schools').onDelete('CASCADE');

    // Credentials (should be encrypted in application layer)
    table.text('consumer_key').notNullable();
    table.text('consumer_secret').notNullable();
    table.text('passkey').notNullable();

    // Business Details
    table.string('shortcode', 20).notNullable();
    table.enum('shortcode_type', ['paybill', 'till']).notNullable();

    // URLs
    table.text('callback_url').notNullable();
    table.text('timeout_url').notNullable();
    table.text('validation_url');
    table.text('confirmation_url');

    // Settings
    table.boolean('is_active').defaultTo(true);
    table.boolean('is_test_mode').defaultTo(false);

    // Metadata
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Index
    table.index('school_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('mpesa_config');
  await knex.schema.dropTableIfExists('mpesa_paybill_payments');
  await knex.schema.dropTableIfExists('mpesa_transactions');
}
