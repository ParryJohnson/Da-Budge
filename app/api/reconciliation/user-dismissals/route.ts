import { NextRequest, NextResponse } from "next/server";
import { getSql, ensureReconciliationTables } from "@/lib/db";
import { insertActivityLog } from "@/lib/activityLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_NOTE = "user";

export async function GET() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ dismissals: [] });
  try {
    await ensureReconciliationTables(sql);
    const rows = await sql`SELECT hash, account_name, note FROM reconciliation_statement_dismissals WHERE note = ${USER_NOTE}`;
    const dismissals = rows.map((r) => ({ hash: r.hash, accountName: r.account_name, note: r.note }));
    return NextResponse.json({ dismissals });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  let body: { hash?: string; accountName?: string; csvUploadId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const hash = String(body.hash ?? "").trim();
  const accountName = String(body.accountName ?? "").trim();
  if (!hash || !accountName) return NextResponse.json({ error: "hash and accountName are required" }, { status: 400 });
  try {
    await ensureReconciliationTables(sql);
    await sql`
      INSERT INTO reconciliation_statement_dismissals (hash, account_name, note)
      VALUES (${hash}, ${accountName}, ${USER_NOTE})
      ON CONFLICT (hash, account_name) DO UPDATE SET note = ${USER_NOTE}`;
    await insertActivityLog(sql, {
      id: crypto.randomUUID(),
      action_type: "user_dismiss_create",
      actor: "user",
      csv_upload_id: body.csvUploadId ?? null,
      payload: { hash, accountName, note: USER_NOTE },
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
    await sql`DELETE FROM reconciliation_statement_dismissals WHERE hash = ${hash} AND account_name = ${accountName} AND note = ${USER_NOTE}`;
    await insertActivityLog(sql, {
      id: crypto.randomUUID(),
      action_type: "user_dismiss_delete",
      actor: "user",
      payload: { hash, accountName },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
