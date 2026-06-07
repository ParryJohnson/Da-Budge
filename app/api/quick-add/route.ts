import { NextRequest, NextResponse } from "next/server";
import { EXPENSE_CATEGORIES, normalizeExpenseCategoryType } from "@/lib/constants";

// Lightweight endpoint for logging a single expense from outside the app
// (e.g. an Apple Shortcut on the Lock Screen). Protected by a shared secret
// token so the open-internet URL can't be written to by anyone.

const BASE_URL = process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL ?? "";
const QUICK_ADD_TOKEN = process.env.QUICK_ADD_TOKEN ?? "";

// Constant-time-ish string comparison to avoid leaking length/contents via timing.
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Match a free-text category against the known list, case-insensitively, after
// applying legacy aliases. Returns the canonical category or null.
function resolveCategory(input: string): string | null {
  const normalized = normalizeExpenseCategoryType(input.trim());
  const found = EXPENSE_CATEGORIES.find(
    (cat) => cat.toLowerCase() === normalized.toLowerCase(),
  );
  return found ?? null;
}

export async function POST(request: NextRequest) {
  if (!QUICK_ADD_TOKEN) {
    return NextResponse.json({ error: "QUICK_ADD_TOKEN is not configured on the server" }, { status: 503 });
  }
  if (!BASE_URL) {
    return NextResponse.json({ error: "Google Apps Script URL not configured" }, { status: 503 });
  }

  const provided = request.headers.get("x-quick-add-token") ?? "";
  if (!tokensMatch(provided, QUICK_ADD_TOKEN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }

  const rawCategory = String(body.category ?? body.expenseType ?? "").trim();
  const category = resolveCategory(rawCategory);
  if (!category) {
    return NextResponse.json(
      { error: `Unknown category "${rawCategory}". Valid categories: ${EXPENSE_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }

  const description = String(body.description ?? "").trim();
  const date = typeof body.date === "string" && body.date.trim() ? body.date.trim() : undefined;

  const payload = { expenseType: category, amount, description, ...(date ? { date } : {}) };

  try {
    const res = await fetch(BASE_URL, {
      cache: "no-store",
      redirect: "follow",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream error (${res.status})` }, { status: 502 });
    }
    const isHtml = text.trimStart().toLowerCase().startsWith("<!doctype") || text.includes("</html>");
    if (isHtml) {
      return NextResponse.json({ error: "Apps Script returned an unexpected page" }, { status: 502 });
    }
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : { success: true };
    } catch {
      // Apps Script sometimes returns a bare success string; treat 2xx as OK.
      parsed = { success: true };
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
      && String((parsed as { status?: unknown }).status ?? "").toLowerCase() === "error") {
      const message = String((parsed as { message?: unknown }).message ?? "Apps Script reported an error");
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ success: true, expenseType: category, amount, description });
  } catch (err) {
    console.error("quick-add error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to submit" }, { status: 502 });
  }
}
