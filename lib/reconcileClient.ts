import type { SheetRow, TransferRow } from "@/services/sheetsApi";
import { generateMerchantFingerprint } from "@/lib/merchantFingerprint";

// Bank CSV column profiles. Adjust column indices to match your bank exports.
export type BankProfile = {
  dateCol: number;
  amountCol: number;
  descCol: number;
  negativeIsExpense: boolean;
};

export const BANK_PROFILES: Record<string, BankProfile> = {
  "Wells Fargo Checking": { dateCol: 0, amountCol: 1, descCol: 4, negativeIsExpense: true },
  "Wells Fargo Savings": { dateCol: 0, amountCol: 1, descCol: 4, negativeIsExpense: true },
  "Venmo - Daniel": { dateCol: 0, amountCol: 2, descCol: 1, negativeIsExpense: true },
  "Capital One": { dateCol: 0, amountCol: 5, descCol: 3, negativeIsExpense: false },
  Discover: { dateCol: 0, amountCol: 2, descCol: 2, negativeIsExpense: false },
  "America First": { dateCol: 0, amountCol: 3, descCol: 1, negativeIsExpense: false },
};

export type BankRow = {
  date: string;
  amount: number; // positive = expense/debit
  description: string;
  hash: string;
  rawCsvLine: string;
  accountName: string;
};

// Deterministic, client-safe hash (FNV-1a) — stable across reloads so claims persist.
export function clientHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function hashBankRow(date: string, amount: number, description: string): string {
  const normalized = `${date}|${Math.abs(amount).toFixed(2)}|${description.trim().toLowerCase()}`;
  return clientHash(normalized);
}

function toDateKey(value: string): string {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString().slice(0, 10);
}

export function parseCsvRows(rows: string[][], accountName: string, profile: BankProfile): BankRow[] {
  const out: BankRow[] = [];
  for (const cols of rows) {
    if (!cols || cols.length === 0) continue;
    const dateRaw = cols[profile.dateCol] ?? "";
    const amtRaw = cols[profile.amountCol] ?? "";
    const desc = String(cols[profile.descCol] ?? "").trim();
    const parsedAmt = Number(String(amtRaw).replace(/[$,]/g, "").trim());
    if (!Number.isFinite(parsedAmt) || parsedAmt === 0) continue;
    // Normalize so positive = expense.
    const amount = profile.negativeIsExpense ? -parsedAmt : parsedAmt;
    const date = toDateKey(dateRaw);
    out.push({
      date,
      amount,
      description: desc,
      hash: hashBankRow(date, amount, desc),
      rawCsvLine: cols.join(","),
      accountName,
    });
  }
  return out;
}

export type MatchType = "exact" | "fuzzy" | "transfer" | "suggested" | "unmatched";

export type MatchResult = {
  bankRow: BankRow;
  matchType: MatchType;
  sheetRow?: SheetRow;
  transferRow?: TransferRow;
  suggestedCategory?: string;
};

function tokenize(s: string): Set<string> {
  return new Set(String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length > 2));
}
function overlap(a: string, b: string): number {
  const ta = tokenize(a), tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  ta.forEach((t) => { if (tb.has(t)) shared++; });
  return shared / Math.min(ta.size, tb.size);
}
function daysBetween(a: string, b: string): number {
  const da = new Date(`${toDateKey(a)}T00:00:00Z`).getTime();
  const db = new Date(`${toDateKey(b)}T00:00:00Z`).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.abs(da - db) / 86_400_000;
}
const amountsMatch = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) <= 0.01;

export function matchRows(
  bankRows: BankRow[],
  sheetRows: SheetRow[],
  transferRows: TransferRow[],
  claimedSheetIds: Set<string>,
  merchantMemory: Map<string, string>,
): MatchResult[] {
  const claimed = new Set(claimedSheetIds);
  const results: MatchResult[] = [];
  for (const bankRow of bankRows) {
    const avail = sheetRows.filter((r) => !r.rowId || !claimed.has(r.rowId));
    let best: { row: SheetRow; score: number } | null = null;
    for (const row of avail) {
      if (!amountsMatch(bankRow.amount, row.amount)) continue;
      const within = bankRow.date && row.timestamp ? daysBetween(bankRow.date, row.timestamp) <= 7 : true;
      const sim = overlap(bankRow.description, `${row.expenseType} ${row.description}`);
      const score = sim + (within ? 0.2 : 0);
      if (!best || score > best.score) best = { row, score: sim };
    }
    if (best && best.score > 0.5) {
      if (best.row.rowId) claimed.add(best.row.rowId);
      results.push({ bankRow, matchType: "exact", sheetRow: best.row });
      continue;
    }
    const transfer = transferRows.find((t) => amountsMatch(bankRow.amount, t.amount));
    if (transfer) { results.push({ bankRow, matchType: "transfer", transferRow: transfer }); continue; }
    if (best && best.score > 0.3) {
      if (best.row.rowId) claimed.add(best.row.rowId);
      results.push({ bankRow, matchType: "fuzzy", sheetRow: best.row });
      continue;
    }
    const fp = generateMerchantFingerprint(bankRow.description, bankRow.amount);
    if (merchantMemory.has(fp)) {
      results.push({ bankRow, matchType: "suggested", suggestedCategory: merchantMemory.get(fp) });
      continue;
    }
    results.push({ bankRow, matchType: "unmatched" });
  }
  return results;
}
