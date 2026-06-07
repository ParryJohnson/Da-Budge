import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { ensureSnapshotsTable } from "@/lib/snaptradeDb";
import { fetchSnapTradeBrokerBalances, fetchFidelitySplit, isSnapTradeConfigured } from "@/services/snaptradeApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isSnapTradeConfigured()) {
    return NextResponse.json({ balances: {}, configured: false });
  }
  try {
    const balances = await fetchSnapTradeBrokerBalances();
    const split = await fetchFidelitySplit();
    const sql = getSql();
    if (sql) {
      await ensureSnapshotsTable(sql);
      const accountCount = Object.keys(balances).length;
      await sql`
        INSERT INTO snaptrade_balance_snapshots
          (fetched_at, balances, account_count, matched_accounts, detail_failures,
           fidelity_total, fidelity_brokerage, fidelity_roth_ira)
        VALUES (now(), ${balances}, ${accountCount}, ${accountCount}, 0,
           ${split.fidelity_total}, ${split.fidelity_brokerage}, ${split.fidelity_roth_ira})`;
    }
    return NextResponse.json({ balances, configured: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
