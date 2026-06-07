import { NextRequest, NextResponse } from "next/server";
import { getSql, ensureReconciliationTables } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ activity: [] });
  const { searchParams } = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? 200)));
  try {
    await ensureReconciliationTables(sql);
    const rows = await sql`
      SELECT id, occurred_at, action_type, actor, csv_upload_id, bulk_action_id, parent_action_id, payload, reverted_at, reverted_by_action_id
      FROM reconciliation_activity_log
      ORDER BY occurred_at DESC
      LIMIT ${limit}`;
    const activity = rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at,
      actionType: r.action_type,
      actor: r.actor,
      csvUploadId: r.csv_upload_id,
      bulkActionId: r.bulk_action_id,
      parentActionId: r.parent_action_id,
      payload: r.payload,
      revertedAt: r.reverted_at,
      revertedByActionId: r.reverted_by_action_id,
    }));
    return NextResponse.json({ activity });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
