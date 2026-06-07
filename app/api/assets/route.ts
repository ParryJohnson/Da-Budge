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
    CREATE TABLE IF NOT EXISTS manual_assets (
      id text PRIMARY KEY,
      name text NOT NULL,
      value numeric(14, 2) NOT NULL,
      category text NOT NULL,
      acquisition_date date,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`ALTER TABLE manual_assets ADD COLUMN IF NOT EXISTS acquisition_date date`;
  await sql`ALTER TABLE manual_assets ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb`;
}

export async function GET() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return NextResponse.json({ assets: [] });
  try {
    const sql = neon(connectionString);
    await ensureTable(sql);
    const rows = await sql`SELECT id, name, value, category, acquisition_date, details, updated_at FROM manual_assets ORDER BY category, name`;
    return NextResponse.json({ assets: rows });
  } catch (err) {
    console.error("Assets GET error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load assets" }, { status: 502 });
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
      INSERT INTO manual_assets (id, name, value, category, acquisition_date, details, updated_at)
      VALUES (${id}, ${name}, ${value}, ${category}, ${acquisitionDate}, ${details}, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, value = EXCLUDED.value, category = EXCLUDED.category,
        acquisition_date = EXCLUDED.acquisition_date, details = EXCLUDED.details, updated_at = now()
      RETURNING id, name, value, category, acquisition_date, details, updated_at`;
    return NextResponse.json({ asset: rows[0] });
  } catch (err) {
    console.error("Assets POST error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save asset" }, { status: 502 });
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
    await sql`DELETE FROM manual_assets WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Assets DELETE error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete asset" }, { status: 502 });
  }
}
