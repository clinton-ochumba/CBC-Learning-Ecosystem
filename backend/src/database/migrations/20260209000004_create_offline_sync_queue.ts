import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('offline_sync_queue', (table) => {
    table.increments('id').primary();

    // Device & User Information
    table.string('device_id', 255).notNullable(); // Unique device identifier
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.integer('school_id').references('id').inTable('schools').onDelete('CASCADE');

    // Action Details
    table.enum('action_type', [
      'create',
      'update',
      'delete',
      'attendance_mark',
      'assignment_submit',
      'grade_record',
      'competency_assess',
    ]).notNullable();

    table.string('table_name', 100).notNullable(); // Which table the action affects
    table.json('record_data').notNullable(); // The actual data to sync
    table.string('record_id', 100); // ID of affected record (if applicable)

    // Sync Status
    table.enum('sync_status', [
      'pending',
      'processing',
      'completed',
      'failed',
      'conflict',
    ]).defaultTo('pending');

    table.text('error_message'); // If sync failed
    table.integer('retry_count').defaultTo(0);
    table.timestamp('last_retry_at');

    // Conflict Resolution
    table.boolean('requires_manual_review').defaultTo(false);
    table.text('conflict_details');
    table.integer('resolved_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('resolved_at');

    // Priority & Ordering
    table.integer('priority').defaultTo(5); // 1 (highest) to 10 (lowest)
    table.bigInteger('sequence_number'); // For maintaining order of operations

    // Metadata
    table.timestamp('action_timestamp').notNullable(); // When action was performed offline
    table.timestamp('created_at').defaultTo(knex.fn.now()); // When queued for sync
    table.timestamp('synced_at'); // When successfully synced

    // Indexes
    table.index('device_id');
    table.index('user_id');
    table.index('school_id');
    table.index('sync_status');
    table.index('action_type');
    table.index(['sync_status', 'priority', 'created_at']); // For processing queue
    table.index(['device_id', 'sync_status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('offline_sync_queue');
}
