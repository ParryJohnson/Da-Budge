import { NextResponse } from "next/server";
import { getSql, ensureReconciliationTables } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  try {
    await ensureReconciliationTables(sql);
    await sql`TRUNCATE
      reconciliation_claim_links,
      reconciliation_transfer_claim_links,
      reconciliation_statement_dismissals,
      reconciliation_merchant_memory,
      reconciliation_activity_log`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
