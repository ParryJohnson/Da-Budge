import { NextRequest, NextResponse } from "next/server";
import { getSql, ensureReconciliationTables } from "@/lib/db";
import { insertActivityLog } from "@/lib/activityLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ anchors: [] });
  try {
    await ensureReconciliationTables(sql);
    const rows = await sql`SELECT account_name, confirmed_balance, as_of_date FROM account_anchors ORDER BY account_name`;
    const anchors = rows.map((r) => ({
      accountName: r.account_name,
      confirmedBalance: Number(r.confirmed_balance),
      asOfDate: r.as_of_date ? new Date(r.as_of_date).toISOString().slice(0, 10) : "",
    }));
    return NextResponse.json({ anchors });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  let body: { accountName?: string; confirmedBalance?: number; asOfDate?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const accountName = String(body.accountName ?? "").trim();
  const confirmedBalance = Number(body.confirmedBalance);
  const asOfDate = String(body.asOfDate ?? "").trim() || null;
  if (!accountName || !Number.isFinite(confirmedBalance)) {
    return NextResponse.json({ error: "accountName and confirmedBalance are required" }, { status: 400 });
  }
  try {
    await ensureReconciliationTables(sql);
    await sql`
      INSERT INTO account_anchors (account_name, confirmed_balance, as_of_date)
      VALUES (${accountName}, ${confirmedBalance}, ${asOfDate})
      ON CONFLICT (account_name) DO UPDATE SET
        confirmed_balance = EXCLUDED.confirmed_balance, as_of_date = EXCLUDED.as_of_date`;
    await insertActivityLog(sql, {
      id: crypto.randomUUID(),
      action_type: "anchor_create",
      actor: "user",
      payload: { accountName, confirmedBalance, asOfDate },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  const { searchParams } = new URL(request.url);
  const accountName = searchParams.get("accountName");
  if (!accountName) return NextResponse.json({ error: "accountName is required" }, { status: 400 });
  try {
    await ensureReconciliationTables(sql);
    await sql`DELETE FROM account_anchors WHERE account_name = ${accountName}`;
    await insertActivityLog(sql, {
      id: crypto.randomUUID(),
      action_type: "anchor_delete",
      actor: "user",
      payload: { accountName },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
