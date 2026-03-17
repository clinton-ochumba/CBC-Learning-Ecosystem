/**
 * Migration: Users & Authentication Tables
 *
 * MUST run before 20260209000002_create_mpesa_tables.ts which has
 * a FK reference to users(id). Filename prefix 20260209000000 ensures
 * it runs first in the sorted migration order.
 *
 * Tables created:
 *   users             — all platform users (parents, teachers, admins, principals)
 *   refresh_tokens    — issued refresh tokens with revocation support
 *   password_resets   — secure time-limited reset tokens
 *   auth_audit_log    — immutable auth event log
 */

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {

  // ── users ──────────────────────────────────────────────────────────────────
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();

    // Identity
    t.string('first_name', 100).notNullable();
    t.string('last_name',  100).notNullable();
    t.string('email',      255).unique().nullable();
    t.string('phone',       20).unique().nullable();
    t.string('password_hash', 255).notNullable();

    // Role & school
    t.enum('role', ['parent', 'teacher', 'principal', 'admin', 'super_admin'])
      .notNullable().defaultTo('parent');
    t.integer('school_id').nullable()
      .references('id').inTable('schools').onDelete('SET NULL');

    // Profile
    t.string('preferred_language', 10).defaultTo('en');
    t.string('national_id', 50).nullable();

    // Account state
    t.enum('status', ['active', 'suspended', 'pending_verification', 'deactivated'])
      .defaultTo('pending_verification');
    t.boolean('email_verified').defaultTo(false);
    t.boolean('phone_verified').defaultTo(false);

    // Security
    t.integer('failed_login_attempts').defaultTo(0);
    t.timestamp('locked_until').nullable();
    t.timestamp('last_login_at').nullable();
    t.string('last_login_ip', 45).nullable();
    t.timestamp('password_changed_at').nullable();

    t.timestamps(true, true);

    t.index(['email']);
    t.index(['phone']);
    t.index(['school_id', 'role']);
    t.index(['status']);
  });

  // ── refresh_tokens ─────────────────────────────────────────────────────────
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 255).notNullable().unique();
    t.string('device_info', 500).nullable();
    t.string('ip_address', 45).nullable();
    t.boolean('revoked').defaultTo(false);
    t.timestamp('revoked_at').nullable();
    t.timestamp('expires_at').notNullable();
    t.timestamps(true, true);

    t.index(['user_id']);
    t.index(['token_hash']);
  });

  // ── password_resets ────────────────────────────────────────────────────────
  await knex.schema.createTable('password_resets', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 255).notNullable().unique();
    t.enum('channel', ['email', 'sms']).defaultTo('sms');
    t.boolean('used').defaultTo(false);
    t.timestamp('used_at').nullable();
    t.timestamp('expires_at').notNullable();
    t.timestamps(true, true);
  });

  // ── auth_audit_log ─────────────────────────────────────────────────────────
  await knex.schema.createTable('auth_audit_log', (t) => {
    t.increments('id').primary();
    t.integer('user_id').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    t.enum('event', [
      'login_success', 'login_failed', 'logout', 'token_refreshed',
      'password_reset_requested', 'password_reset_completed',
      'account_locked', 'account_unlocked', 'role_changed',
      'email_verified', 'phone_verified',
    ]).notNullable();
    t.string('ip_address', 45).nullable();
    t.string('user_agent', 500).nullable();
    t.json('metadata').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['user_id', 'created_at']);
    t.index(['event', 'created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auth_audit_log');
  await knex.schema.dropTableIfExists('password_resets');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('users');
}
