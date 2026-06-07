import { NextResponse } from "next/server";
import { getSql, ensureReconciliationTables } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ memory: [] });
  try {
    await ensureReconciliationTables(sql);
    const rows = await sql`SELECT fingerprint, bank_account_name, sheet_category, sheet_account, confirmed_count FROM reconciliation_merchant_memory`;
    const memory = rows.map((r) => ({
      fingerprint: r.fingerprint,
      bankAccountName: r.bank_account_name,
      sheetCategory: r.sheet_category,
      sheetAccount: r.sheet_account,
      confirmedCount: Number(r.confirmed_count),
    }));
    return NextResponse.json({ memory });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
