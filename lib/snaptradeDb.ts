import { type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

let ensured = false;

export async function ensureSnapshotsTable(sql: Sql) {
  if (ensured) return;
  await sql`CREATE TABLE IF NOT EXISTS snaptrade_balance_snapshots (
    id bigserial PRIMARY KEY,
    fetched_at timestamptz NOT NULL,
    balances jsonb NOT NULL,
    account_count integer NOT NULL,
    matched_accounts integer NOT NULL,
    detail_failures integer NOT NULL,
    fidelity_total numeric(14, 2) NOT NULL DEFAULT 0,
    fidelity_brokerage numeric(14, 2) NOT NULL DEFAULT 0,
    fidelity_roth_ira numeric(14, 2) NOT NULL DEFAULT 0
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_snaptrade_balance_snapshots_fetched_at
    ON snaptrade_balance_snapshots (fetched_at DESC)`;
  ensured = true;
}
