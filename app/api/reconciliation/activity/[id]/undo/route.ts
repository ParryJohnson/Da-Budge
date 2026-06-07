import { NextRequest, NextResponse } from "next/server";
import { getSql, ensureReconciliationTables } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = Record<string, unknown>;

/**
 * Reverses a previously-logged action and marks it reverted. Each create action
 * is undone by deleting the row it created; delete actions are undone by
 * recreating the row from the stored payload.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  const id = params.id;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    await ensureReconciliationTables(sql);
    const rows = await sql`SELECT id, action_type, payload, reverted_at FROM reconciliation_activity_log WHERE id = ${id}::uuid`;
    const action = rows[0];
    if (!action) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    if (action.reverted_at) return NextResponse.json({ error: "Already reverted" }, { status: 400 });

    const p = (action.payload ?? {}) as Payload;
    const str = (k: string) => (p[k] != null ? String(p[k]) : "");
    const num = (k: string) => Number(p[k]);

    switch (action.action_type as string) {
      case "claim_create":
        await sql`DELETE FROM reconciliation_claim_links WHERE bank_hash = ${str("bankHash")} AND sheet_row_id = ${str("sheetRowId")} AND sheet_name = ${str("sheetName") || "Expenses"}`;
        break;
      case "claim_delete":
        await sql`INSERT INTO reconciliation_claim_links (bank_hash, account_name, sheet_name, sheet_row_id, amount_cents)
          VALUES (${str("bankHash")}, ${p.accountName ?? null}, ${str("sheetName") || "Expenses"}, ${str("sheetRowId")}, ${num("amountCents") || 1})
          ON CONFLICT DO NOTHING`;
        break;
      case "transfer_claim_create":
        await sql`DELETE FROM reconciliation_transfer_claim_links WHERE transfer_sheet_row_id = ${str("transferSheetRowId")} AND bank_hash = ${str("bankHash")}`;
        break;
      case "transfer_claim_delete":
        await sql`INSERT INTO reconciliation_transfer_claim_links (transfer_sheet_row_id, bank_hash, bank_account_name, bank_amount_cents, expected_legs)
          VALUES (${str("transferSheetRowId")}, ${str("bankHash")}, ${p.bankAccountName ?? null}, ${num("bankAmountCents") || 0}, ${num("expectedLegs") || 2})
          ON CONFLICT DO NOTHING`;
        break;
      case "dismiss_create":
      case "user_dismiss_create":
        await sql`DELETE FROM reconciliation_statement_dismissals WHERE hash = ${str("hash")} AND account_name = ${str("accountName")}`;
        break;
      case "dismiss_delete":
      case "user_dismiss_delete":
        await sql`INSERT INTO reconciliation_statement_dismissals (hash, account_name, note)
          VALUES (${str("hash")}, ${str("accountName")}, ${str("note") || "auto"})
          ON CONFLICT (hash, account_name) DO NOTHING`;
        break;
      case "anchor_create":
        await sql`DELETE FROM account_anchors WHERE account_name = ${str("accountName")}`;
        break;
      case "anchor_delete":
        await sql`INSERT INTO account_anchors (account_name, confirmed_balance, as_of_date)
          VALUES (${str("accountName")}, ${num("confirmedBalance") || 0}, ${p.asOfDate ?? null})
          ON CONFLICT (account_name) DO NOTHING`;
        break;
      default:
        return NextResponse.json({ error: `Cannot undo action type: ${action.action_type}` }, { status: 400 });
    }

    const undoId = crypto.randomUUID();
    await sql`UPDATE reconciliation_activity_log SET reverted_at = now(), reverted_by_action_id = ${undoId}::uuid WHERE id = ${id}::uuid`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
