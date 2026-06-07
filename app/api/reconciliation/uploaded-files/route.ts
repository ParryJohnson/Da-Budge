import { NextResponse } from "next/server";
import { getSql, ensureReconciliationTables } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ uploads: [] });
  try {
    await ensureReconciliationTables(sql);
    const rows = await sql`
      SELECT csv_upload_id, MIN(occurred_at) AS first_seen, MAX(occurred_at) AS last_seen, COUNT(*) AS action_count
      FROM reconciliation_activity_log
      WHERE csv_upload_id IS NOT NULL
      GROUP BY csv_upload_id
      ORDER BY MAX(occurred_at) DESC`;
    const uploads = rows.map((r) => ({
      csvUploadId: r.csv_upload_id,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      actionCount: Number(r.action_count),
    }));
    return NextResponse.json({ uploads });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
