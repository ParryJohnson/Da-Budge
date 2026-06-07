import { NextRequest, NextResponse } from "next/server";
import { getSql, ensureReconciliationTables } from "@/lib/db";
import { insertActivityLog } from "@/lib/activityLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ claims: [] });
  try {
    await ensureReconciliationTables(sql);
    const rows = await sql`SELECT bank_hash, account_name, sheet_name, sheet_row_id, amount_cents FROM reconciliation_claim_links`;
    const claims = rows.map((r) => ({
      bankHash: r.bank_hash,
      accountName: r.account_name,
      sheetName: r.sheet_name,
      sheetRowId: r.sheet_row_id,
      amountCents: Number(r.amount_cents),
    }));
    return NextResponse.json({ claims });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  let body: {
    bankHash?: string; accountName?: string; sheetName?: string; sheetRowId?: string;
    amountCents?: number; csvUploadId?: string; fingerprint?: string; sheetCategory?: string; sheetAccount?: string;
  };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const bankHash = String(body.bankHash ?? "").trim();
  const sheetRowId = String(body.sheetRowId ?? "").trim();
  const sheetName = String(body.sheetName ?? "Expenses").trim() || "Expenses";
  const amountCents = Math.round(Number(body.amountCents));
  const accountName = body.accountName ? String(body.accountName) : null;
  if (!bankHash || !sheetRowId || !Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "bankHash, sheetRowId, and positive amountCents are required" }, { status: 400 });
  }
  try {
    await ensureReconciliationTables(sql);
    await sql`
      INSERT INTO reconciliation_claim_links (bank_hash, account_name, sheet_name, sheet_row_id, amount_cents)
      VALUES (${bankHash}, ${accountName}, ${sheetName}, ${sheetRowId}, ${amountCents})
      ON CONFLICT DO NOTHING`;
    if (body.fingerprint && accountName) {
      await sql`
        INSERT INTO reconciliation_merchant_memory (fingerprint, bank_account_name, sheet_category, sheet_account, confirmed_count, last_confirmed_at)
        VALUES (${body.fingerprint}, ${accountName}, ${body.sheetCategory ?? null}, ${body.sheetAccount ?? null}, 1, now())
        ON CONFLICT (fingerprint, bank_account_name) DO UPDATE SET
          sheet_category = COALESCE(EXCLUDED.sheet_category, reconciliation_merchant_memory.sheet_category),
          sheet_account = COALESCE(EXCLUDED.sheet_account, reconciliation_merchant_memory.sheet_account),
          confirmed_count = reconciliation_merchant_memory.confirmed_count + 1,
          last_confirmed_at = now()`;
    }
    await insertActivityLog(sql, {
      id: crypto.randomUUID(),
      action_type: "claim_create",
      actor: "user",
      csv_upload_id: body.csvUploadId ?? null,
      payload: { bankHash, accountName, sheetName, sheetRowId, amountCents },
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
  const bankHash = searchParams.get("bankHash");
  const sheetRowId = searchParams.get("sheetRowId");
  const sheetName = searchParams.get("sheetName") ?? "Expenses";
  if (!bankHash || !sheetRowId) return NextResponse.json({ error: "bankHash and sheetRowId are required" }, { status: 400 });
  try {
    await ensureReconciliationTables(sql);
    await sql`DELETE FROM reconciliation_claim_links WHERE bank_hash = ${bankHash} AND sheet_row_id = ${sheetRowId} AND sheet_name = ${sheetName}`;
    await insertActivityLog(sql, {
      id: crypto.randomUUID(),
      action_type: "claim_delete",
      actor: "user",
      payload: { bankHash, sheetRowId, sheetName },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
