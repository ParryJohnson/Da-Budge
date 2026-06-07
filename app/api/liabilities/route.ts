import { NextRequest, NextResponse } from "next/server";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sql = NeonQueryFunction<false, false>;

type ManualItem = {
  id: string;
  name: string;
  value: number;
  category: string;
  acquisition_date?: string | null;
  details?: Record<string, unknown>;
  updated_at?: string;
};

async function ensureTable(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS manual_liabilities (
      id text PRIMARY KEY,
      name text NOT NULL,
      value numeric(14, 2) NOT NULL,
      category text NOT NULL,
      acquisition_date date,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`ALTER TABLE manual_liabilities ADD COLUMN IF NOT EXISTS acquisition_date date`;
  await sql`ALTER TABLE manual_liabilities ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb`;
}

export async function GET() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return NextResponse.json({ liabilities: [] });
  try {
    const sql = neon(connectionString);
    await ensureTable(sql);
    const rows = await sql`SELECT id, name, value, category, acquisition_date, details, updated_at FROM manual_liabilities ORDER BY category, name`;
    return NextResponse.json({ liabilities: rows });
  } catch (err) {
    console.error("Liabilities GET error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load liabilities" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  let body: Partial<ManualItem>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const id = body.id && String(body.id).trim() ? String(body.id) : crypto.randomUUID();
  const name = String(body.name ?? "").trim();
  const value = Number(body.value);
  const category = String(body.category ?? "").trim();
  if (!name || !Number.isFinite(value) || !category) {
    return NextResponse.json({ error: "name, value, and category are required" }, { status: 400 });
  }
  const acquisitionDate = body.acquisition_date ? String(body.acquisition_date) : null;
  const details = body.details && typeof body.details === "object" ? body.details : {};
  try {
    const sql = neon(connectionString);
    await ensureTable(sql);
    const rows = await sql`
      INSERT INTO manual_liabilities (id, name, value, category, acquisition_date, details, updated_at)
      VALUES (${id}, ${name}, ${value}, ${category}, ${acquisitionDate}, ${details}, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, value = EXCLUDED.value, category = EXCLUDED.category,
        acquisition_date = EXCLUDED.acquisition_date, details = EXCLUDED.details, updated_at = now()
      RETURNING id, name, value, category, acquisition_date, details, updated_at`;
    return NextResponse.json({ liability: rows[0] });
  } catch (err) {
    console.error("Liabilities POST error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save liability" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const sql = neon(connectionString);
    await ensureTable(sql);
    await sql`DELETE FROM manual_liabilities WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Liabilities DELETE error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete liability" }, { status: 502 });
  }
}
