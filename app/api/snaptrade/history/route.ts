import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { ensureSnapshotsTable } from "@/lib/snaptradeDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ history: [] });
  try {
    await ensureSnapshotsTable(sql);
    const rows = await sql`
      SELECT fetched_at, fidelity_total, fidelity_brokerage, fidelity_roth_ira
      FROM snaptrade_balance_snapshots
      ORDER BY fetched_at DESC
      LIMIT 60`;
    const history = rows
      .map((r) => ({
        fetchedAt: r.fetched_at,
        fidelityTotal: Number(r.fidelity_total),
        fidelityBrokerage: Number(r.fidelity_brokerage),
        fidelityRothIra: Number(r.fidelity_roth_ira),
      }))
      .reverse();
    return NextResponse.json({ history });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
