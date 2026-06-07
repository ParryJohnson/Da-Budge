import { NextRequest, NextResponse } from "next/server";
import { getSql, ensureReconciliationTables } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ processed: [] });
  try {
    await ensureReconciliationTables(sql);
    const rows = await sql`SELECT hash, account_name FROM processed_transactions`;
    const processed = rows.map((r) => ({ hash: r.hash, accountName: r.account_name }));
    return NextResponse.json({ processed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  let body: { hash?: string; accountName?: string; hashes?: { hash: string; accountName?: string }[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    await ensureReconciliationTables(sql);
    const items = Array.isArray(body.hashes)
      ? body.hashes
      : body.hash
        ? [{ hash: body.hash, accountName: body.accountName }]
        : [];
    for (const item of items) {
      const hash = String(item.hash ?? "").trim();
      if (!hash) continue;
      await sql`
        INSERT INTO processed_transactions (hash, account_name)
        VALUES (${hash}, ${item.accountName ?? null})
        ON CONFLICT (hash) DO NOTHING`;
    }
    return NextResponse.json({ ok: true, count: items.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
