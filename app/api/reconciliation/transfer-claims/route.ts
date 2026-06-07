import { NextRequest, NextResponse } from "next/server";
import { getSql, ensureReconciliationTables } from "@/lib/db";
import { insertActivityLog } from "@/lib/activityLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ transferClaims: [] });
  try {
    await ensureReconciliationTables(sql);
    const rows = await sql`SELECT transfer_sheet_row_id, bank_hash, bank_account_name, bank_amount_cents, expected_legs FROM reconciliation_transfer_claim_links`;
    const transferClaims = rows.map((r) => ({
      transferSheetRowId: r.transfer_sheet_row_id,
      bankHash: r.bank_hash,
      bankAccountName: r.bank_account_name,
      bankAmountCents: Number(r.bank_amount_cents),
      expectedLegs: Number(r.expected_legs),
    }));
    return NextResponse.json({ transferClaims });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  let body: {
    transferSheetRowId?: string; bankHash?: string; bankAccountName?: string;
    bankAmountCents?: number; expectedLegs?: number; csvUploadId?: string;
  };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const transferSheetRowId = String(body.transferSheetRowId ?? "").trim();
  const bankHash = String(body.bankHash ?? "").trim();
  const bankAmountCents = Math.round(Number(body.bankAmountCents));
  const expectedLegs = body.expectedLegs === 1 ? 1 : 2;
  const bankAccountName = body.bankAccountName ? String(body.bankAccountName) : null;
  if (!transferSheetRowId || !bankHash || !Number.isFinite(bankAmountCents)) {
    return NextResponse.json({ error: "transferSheetRowId, bankHash, bankAmountCents are required" }, { status: 400 });
  }
  try {
    await ensureReconciliationTables(sql);
    await sql`
      INSERT INTO reconciliation_transfer_claim_links (transfer_sheet_row_id, bank_hash, bank_account_name, bank_amount_cents, expected_legs)
      VALUES (${transferSheetRowId}, ${bankHash}, ${bankAccountName}, ${bankAmountCents}, ${expectedLegs})
      ON CONFLICT DO NOTHING`;
    await insertActivityLog(sql, {
      id: crypto.randomUUID(),
      action_type: "transfer_claim_create",
      actor: "user",
      csv_upload_id: body.csvUploadId ?? null,
      payload: { transferSheetRowId, bankHash, bankAccountName, bankAmountCents, expectedLegs },
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
  const transferSheetRowId = searchParams.get("transferSheetRowId");
  const bankHash = searchParams.get("bankHash");
  if (!transferSheetRowId || !bankHash) return NextResponse.json({ error: "transferSheetRowId and bankHash are required" }, { status: 400 });
  try {
    await ensureReconciliationTables(sql);
    await sql`DELETE FROM reconciliation_transfer_claim_links WHERE transfer_sheet_row_id = ${transferSheetRowId} AND bank_hash = ${bankHash}`;
    await insertActivityLog(sql, {
      id: crypto.randomUUID(),
      action_type: "transfer_claim_delete",
      actor: "user",
      payload: { transferSheetRowId, bankHash },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
