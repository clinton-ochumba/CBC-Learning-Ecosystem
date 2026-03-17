import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('schools', (table) => {
    table.increments('id').primary();
    table.string('code', 50).unique().notNullable(); // e.g., SCHOOL001
    table.string('name', 255).notNullable();

    // Classification
    table.enum('type', ['public', 'private', 'international']).notNullable();
    table.enum('category', ['day', 'boarding', 'day_and_boarding']).notNullable();
    table.enum('level', ['primary', 'secondary', 'both']).notNullable();
    table.enum('cluster', ['C1', 'C2', 'C3', 'C4']).notNullable(); // Kenya school classification

    // Location
    table.string('county', 100).notNullable();
    table.string('sub_county', 100);
    table.string('ward', 100);
    table.string('location', 100);
    table.text('physical_address');
    table.decimal('latitude', 10, 8);
    table.decimal('longitude', 11, 8);

    // Infrastructure
    table.enum('infrastructure_level', ['1', '2', '3', '4', '5']).defaultTo('3');
    table.enum('internet_connectivity', ['fiber', '4g', '3g', 'none']).defaultTo('none');
    table.boolean('has_computer_lab').defaultTo(false);
    table.integer('computer_count').defaultTo(0);
    table.boolean('has_electricity').defaultTo(true);
    table.boolean('has_solar_power').defaultTo(false);

    // Registration & Compliance
    table.string('nemis_code', 50).unique(); // National Education Management Information System
    table.string('knec_code', 50); // Kenya National Examinations Council
    table.string('registration_number', 100);
    table.date('registration_date');

    // Subscription
    table.enum('subscription_tier', ['tier1', 'tier2', 'tier3', 'tier4']).notNullable();
    table.enum('subscription_status', ['active', 'inactive', 'trial', 'suspended']).defaultTo('trial');
    table.date('subscription_start_date');
    table.date('subscription_end_date');
    table.decimal('subscription_amount', 10, 2);
    table.boolean('auto_renew').defaultTo(false);

    // Contact Information
    table.string('primary_email', 255);
    table.string('primary_phone', 20);
    table.string('alternative_phone', 20);
    table.string('website', 255);

    // Leadership
    table.string('principal_name', 255);
    table.string('principal_email', 255);
    table.string('principal_phone', 20);

    // Statistics
    table.integer('total_students').defaultTo(0);
    table.integer('total_teachers').defaultTo(0);
    table.integer('total_classes').defaultTo(0);

    // M-Pesa Integration
    table.boolean('mpesa_enabled').defaultTo(false);
    table.string('mpesa_shortcode', 20); // Paybill/Till number
    table.string('mpesa_account_name', 255);

    // Settings
    table.json('settings'); // Additional school-specific settings
    table.boolean('is_active').defaultTo(true);

    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Indexes
    table.index('code');
    table.index('nemis_code');
    table.index('county');
    table.index('subscription_status');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('schools');
}
