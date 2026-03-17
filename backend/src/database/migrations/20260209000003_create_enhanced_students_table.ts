import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('students', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.integer('school_id').references('id').inTable('schools').onDelete('CASCADE');

    // Personal Information
    table.string('admission_number', 50).unique().notNullable();
    table.string('first_name', 100).notNullable();
    table.string('middle_name', 100);
    table.string('last_name', 100).notNullable();
    table.date('date_of_birth').notNullable();
    table.enum('gender', ['male', 'female']).notNullable();

    // Identification
    table.string('birth_certificate_number', 50);
    table.string('nemis_upi', 50).unique(); // NEMIS Unique Personal Identifier

    // Academic Information
    table.enum('grade_level', [
      'PP1', 'PP2', // Pre-primary
      'G1', 'G2', 'G3', 'G4', 'G5', 'G6', // Primary
      'G7', 'G8', 'G9', // Junior Secondary
      'G10', 'G11', 'G12', // Senior Secondary
    ]).notNullable();
    table.string('class_name', 50); // e.g., "5A", "Form 1 East"
    table.string('stream', 20); // e.g., "A", "East", "Science"
    table.integer('class_position');
    table.decimal('average_score', 5, 2);

    // CBC Competency Assessment Summary
    table.json('competency_levels'); // Stores latest levels for 7 core competencies

    // Enrollment
    table.date('enrollment_date').notNullable();
    table.enum('enrollment_status', [
      'active',
      'transferred',
      'graduated',
      'suspended',
      'expelled',
      'dropped_out',
    ]).defaultTo('active');
    table.date('transfer_date');
    table.string('transfer_school', 255);

    // Fee Management
    table.decimal('fee_balance', 10, 2).defaultTo(0); // Positive = owed, Negative = overpaid
    table.decimal('total_fees_required', 10, 2).defaultTo(0);
    table.decimal('total_fees_paid', 10, 2).defaultTo(0);
    table.date('last_payment_date');

    // Contact Information
    table.string('primary_phone', 20);
    table.string('secondary_phone', 20);
    table.string('email', 255);

    // Residential Address
    table.text('address');
    table.string('county', 100);
    table.string('sub_county', 100);
    table.string('ward', 100);
    table.string('village', 100);

    // Emergency Contact
    table.string('emergency_contact_name', 255);
    table.string('emergency_contact_phone', 20);
    table.string('emergency_contact_relationship', 50);

    // Health Information
    table.text('medical_conditions');
    table.text('allergies');
    table.string('blood_group', 5);
    table.boolean('special_needs').defaultTo(false);
    table.text('special_needs_description');

    // Boarding Information (for boarding schools)
    table.boolean('is_boarder').defaultTo(false);
    table.string('dormitory', 100);
    table.string('bed_number', 20);

    // Academic Performance
    table.integer('total_assignments_submitted').defaultTo(0);
    table.integer('total_assignments_pending').defaultTo(0);
    table.decimal('assignment_completion_rate', 5, 2).defaultTo(0);
    table.decimal('attendance_rate', 5, 2).defaultTo(100);

    // Digital Access
    table.timestamp('last_login');
    table.integer('total_logins').defaultTo(0);
    table.string('preferred_access_method', 50); // 'computer_lab', 'tablet', 'kiosk'

    // Additional Information
    table.json('extra_curricular_activities');
    table.text('notes');
    table.boolean('is_active').defaultTo(true);

    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Indexes
    table.index('admission_number');
    table.index('nemis_upi');
    table.index('school_id');
    table.index('grade_level');
    table.index('enrollment_status');
    table.index(['school_id', 'grade_level']);
    table.index(['school_id', 'enrollment_status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('students');
}
