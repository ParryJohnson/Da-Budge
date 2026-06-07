import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { ensureSnapshotsTable } from "@/lib/snaptradeDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ brokerage: 0, rothIra: 0 });
  try {
    await ensureSnapshotsTable(sql);
    const rows = await sql`
      SELECT fidelity_brokerage, fidelity_roth_ira
      FROM snaptrade_balance_snapshots
      ORDER BY fetched_at DESC
      LIMIT 1`;
    const latest = rows[0];
    return NextResponse.json({
      brokerage: latest ? Number(latest.fidelity_brokerage) : 0,
      rothIra: latest ? Number(latest.fidelity_roth_ira) : 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
