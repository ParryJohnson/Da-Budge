import { NextRequest, NextResponse } from "next/server";
import { getSql, ensureReconciliationTables } from "@/lib/db";
import { insertActivityLog } from "@/lib/activityLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ dismissals: [] });
  try {
    await ensureReconciliationTables(sql);
    const rows = await sql`SELECT hash, account_name, note FROM reconciliation_statement_dismissals`;
    const dismissals = rows.map((r) => ({ hash: r.hash, accountName: r.account_name, note: r.note }));
    return NextResponse.json({ dismissals });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  let body: { hash?: string; accountName?: string; note?: string; csvUploadId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const hash = String(body.hash ?? "").trim();
  const accountName = String(body.accountName ?? "").trim();
  const note = String(body.note ?? "").trim() || "auto";
  if (!hash || !accountName) return NextResponse.json({ error: "hash and accountName are required" }, { status: 400 });
  try {
    await ensureReconciliationTables(sql);
    await sql`
      INSERT INTO reconciliation_statement_dismissals (hash, account_name, note)
      VALUES (${hash}, ${accountName}, ${note})
      ON CONFLICT (hash, account_name) DO UPDATE SET note = EXCLUDED.note`;
    await insertActivityLog(sql, {
      id: crypto.randomUUID(),
      action_type: "dismiss_create",
      actor: "auto",
      csv_upload_id: body.csvUploadId ?? null,
      payload: { hash, accountName, note },
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
  const hash = searchParams.get("hash");
  const accountName = searchParams.get("accountName");
  if (!hash || !accountName) return NextResponse.json({ error: "hash and accountName are required" }, { status: 400 });
  try {
    await ensureReconciliationTables(sql);
    await sql`DELETE FROM reconciliation_statement_dismissals WHERE hash = ${hash} AND account_name = ${accountName}`;
    await insertActivityLog(sql, {
      id: crypto.randomUUID(),
      action_type: "dismiss_delete",
      actor: "user",
      payload: { hash, accountName },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
