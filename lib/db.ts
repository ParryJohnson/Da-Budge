import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

export function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  return neon(connectionString);
}

let ensured = false;

/**
 * Idempotently ensures all reconciliation-related tables exist. Mirrors
 * docs/neon-budget-setup.sql so the app self-migrates on first DB call.
 */
export async function ensureReconciliationTables(sql: Sql) {
  if (ensured) return;
  await sql`CREATE TABLE IF NOT EXISTS processed_transactions (
    hash TEXT PRIMARY KEY,
    account_name TEXT,
    processed_at TIMESTAMP DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS account_anchors (
    account_name TEXT PRIMARY KEY,
    confirmed_balance NUMERIC,
    as_of_date DATE
  )`;
  await sql`CREATE TABLE IF NOT EXISTS reconciliation_claim_links (
    bank_hash TEXT NOT NULL,
    account_name TEXT,
    sheet_name TEXT NOT NULL DEFAULT 'Expenses',
    sheet_row_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (bank_hash, sheet_name, sheet_row_id),
    UNIQUE (sheet_name, sheet_row_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS reconciliation_transfer_claim_links (
    transfer_sheet_row_id TEXT NOT NULL,
    bank_hash TEXT NOT NULL,
    bank_account_name TEXT,
    bank_amount_cents INTEGER NOT NULL,
    expected_legs INTEGER NOT NULL DEFAULT 2 CHECK (expected_legs IN (1, 2)),
    created_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (transfer_sheet_row_id, bank_hash),
    UNIQUE (bank_hash)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS reconciliation_statement_dismissals (
    hash TEXT NOT NULL,
    account_name TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (hash, account_name)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS reconciliation_merchant_memory (
    fingerprint TEXT NOT NULL,
    bank_account_name TEXT NOT NULL,
    sheet_category TEXT,
    sheet_account TEXT,
    confirmed_count INTEGER NOT NULL DEFAULT 1,
    last_confirmed_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (fingerprint, bank_account_name)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS reconciliation_activity_log (
    id UUID PRIMARY KEY,
    occurred_at TIMESTAMP NOT NULL DEFAULT now(),
    action_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    csv_upload_id UUID,
    bulk_action_id UUID,
    parent_action_id UUID,
    payload JSONB NOT NULL,
    reverted_at TIMESTAMP,
    reverted_by_action_id UUID
  )`;
  ensured = true;
}
