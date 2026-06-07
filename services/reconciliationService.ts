import crypto from "node:crypto";
import type { SheetRow, TransferRow } from "@/services/sheetsApi";

export type BankRow = {
  date: string; // YYYY-MM-DD
  amount: number; // positive = debit/expense, negative = credit/income
  description: string;
  hash: string; // SHA-256 of normalized fields
  rawCsvLine: string;
  accountName: string;
};

export function hashBankRow(date: string, amount: number, description: string): string {
  const normalized = `${date}|${Math.abs(amount).toFixed(2)}|${description.trim().toLowerCase()}`;
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export type MatchType = "exact" | "fuzzy" | "transfer" | "suggested" | "unmatched";

export type MatchResult = {
  bankRow: BankRow;
  matchType: MatchType;
  sheetRow?: SheetRow;
  transferRow?: TransferRow;
  confidence: number; // 0..1
  suggestedCategory?: string;
};

function toDateKey(value?: string): string {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${toDateKey(a)}T00:00:00Z`).getTime();
  const db = new Date(`${toDateKey(b)}T00:00:00Z`).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(da - db) / 86_400_000;
}

function tokenize(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

function amountsMatch(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) <= tolerance;
}

/**
 * Match a single bank row against sheet expenses and transfers.
 * `existingClaims` holds already-claimed sheet row IDs so they aren't re-matched.
 * `merchantMemory` maps a fingerprint to a previously-confirmed category.
 */
export function matchBankRow(
  bankRow: BankRow,
  sheetRows: SheetRow[],
  transferRows: TransferRow[],
  existingClaims: Set<string>,
  merchantMemory: Map<string, string>,
  fingerprint?: string,
): MatchResult {
  const available = sheetRows.filter((r) => !r.rowId || !existingClaims.has(r.rowId));

  // 1. Exact: amount within $0.01, date within 7 days, good description similarity.
  let bestExact: { row: SheetRow; score: number } | null = null;
  for (const row of available) {
    if (!amountsMatch(bankRow.amount, row.amount)) continue;
    const within = bankRow.date && row.timestamp ? daysBetween(bankRow.date, row.timestamp) <= 7 : true;
    if (!within) continue;
    const sim = tokenOverlap(bankRow.description, `${row.expenseType} ${row.description}`);
    if (sim > 0.5 && (!bestExact || sim > bestExact.score)) {
      bestExact = { row, score: sim };
    }
  }
  if (bestExact) {
    return { bankRow, matchType: "exact", sheetRow: bestExact.row, confidence: Math.min(1, 0.7 + bestExact.score * 0.3) };
  }

  // 2. Transfer: amount matches either leg.
  for (const t of transferRows) {
    if (amountsMatch(bankRow.amount, t.amount)) {
      return { bankRow, matchType: "transfer", transferRow: t, confidence: 0.7 };
    }
  }

  // 3. Fuzzy: amount matches, partial description overlap.
  let bestFuzzy: { row: SheetRow; score: number } | null = null;
  for (const row of available) {
    if (!amountsMatch(bankRow.amount, row.amount)) continue;
    const sim = tokenOverlap(bankRow.description, `${row.expenseType} ${row.description}`);
    if (sim > 0.3 && (!bestFuzzy || sim > bestFuzzy.score)) {
      bestFuzzy = { row, score: sim };
    }
  }
  if (bestFuzzy) {
    return { bankRow, matchType: "fuzzy", sheetRow: bestFuzzy.row, confidence: 0.4 + bestFuzzy.score * 0.3 };
  }

  // 4. Suggested from merchant memory.
  if (fingerprint && merchantMemory.has(fingerprint)) {
    return { bankRow, matchType: "suggested", confidence: 0.3, suggestedCategory: merchantMemory.get(fingerprint) };
  }

  // 5. Unmatched.
  return { bankRow, matchType: "unmatched", confidence: 0 };
}

export function matchAllBankRows(
  bankRows: BankRow[],
  sheetRows: SheetRow[],
  transferRows: TransferRow[],
  existingClaims: Set<string>,
  merchantMemory: Map<string, string>,
  fingerprintFor?: (row: BankRow) => string,
): MatchResult[] {
  const claimed = new Set(existingClaims);
  const results: MatchResult[] = [];
  for (const bankRow of bankRows) {
    const result = matchBankRow(
      bankRow,
      sheetRows,
      transferRows,
      claimed,
      merchantMemory,
      fingerprintFor?.(bankRow),
    );
    if ((result.matchType === "exact" || result.matchType === "fuzzy") && result.sheetRow?.rowId) {
      claimed.add(result.sheetRow.rowId);
    }
    results.push(result);
  }
  return results;
}
