const SHEETS_API = "/api/sheets";

export type SheetRow = {
  timestamp?: string;
  date?: string;
  expenseType: string;
  amount: number;
  description: string;
  month: string;
  account?: string;
  rowId?: string;
};

function getRawValue(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined) return raw[key];
  }
  const normalized = new Map<string, unknown>();
  for (const [k, v] of Object.entries(raw)) normalized.set(k.trim().toLowerCase(), v);
  for (const key of keys) {
    const value = normalized.get(key.trim().toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeRow(raw: Record<string, unknown>): SheetRow {
  const account = String(getRawValue(raw, ["Account", "account"]) ?? "");
  const rowIdRaw = getRawValue(raw, ["Row ID", "row id", "rowId", "row_id", "Row Id"]);
  const rowId = typeof rowIdRaw === "string" ? rowIdRaw.trim() : "";
  const dateRaw = getRawValue(raw, ["Date", "date"]);
  const dateStr = typeof dateRaw === "string" ? dateRaw.trim() : "";
  return {
    timestamp: (getRawValue(raw, ["Timestamp", "timestamp"]) as string | undefined),
    date: dateStr || undefined,
    expenseType: String(getRawValue(raw, ["Expense Type", "expenseType", "expense type"]) ?? ""),
    amount: Number(getRawValue(raw, ["Amount", "amount"]) ?? 0),
    description: String(getRawValue(raw, ["Description", "description"]) ?? ""),
    month: String(getRawValue(raw, ["Month", "month"]) ?? ""),
    account: account.trim() || undefined,
    rowId: rowId || undefined,
  };
}

function monthNameFromNumber(month: number): string {
  return ["january","february","march","april","may","june","july","august","september","october","november","december"][month - 1] ?? "";
}

export function rowMatchesMonth(row: SheetRow, selectedMonth?: string): boolean {
  if (!selectedMonth || selectedMonth === "full") return true;
  const monthNum = Number(selectedMonth);
  if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) return true;
  const rawMonth = String(row.month ?? "").trim().toLowerCase();
  if (rawMonth) {
    const monthName = monthNameFromNumber(monthNum);
    const normalizedNumeric = String(parseInt(rawMonth, 10));
    if (rawMonth === String(monthNum) || rawMonth === monthName ||
        rawMonth === `${monthName} 2026` || normalizedNumeric === String(monthNum)) return true;
  }
  if (row.timestamp) {
    const d = new Date(row.timestamp);
    if (!Number.isNaN(d.getTime()) && d.getMonth() + 1 === monthNum) return true;
  }
  return false;
}

export async function getExpenses(month?: string): Promise<SheetRow[]> {
  const url = month ? `${SHEETS_API}?month=${encodeURIComponent(month)}` : SHEETS_API;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to fetch expenses: ${res.status}`);
  }
  const data = await res.json();
  const rows: Record<string, unknown>[] = Array.isArray(data) ? data : (data.rows ?? data.data ?? []);
  return rows.map(normalizeRow).filter((row) => rowMatchesMonth(row, month));
}

export async function submitExpense(payload: {
  expenseType: string;
  amount: number;
  description: string;
  date?: string;
}): Promise<void> {
  const res = await fetch(SHEETS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to submit: ${res.status}`);
  }
}

export async function updateSheetEntryDate(payload: {
  sheet: "Expenses" | "Transfers";
  rowId: string;
  date: string;
}): Promise<void> {
  const res = await fetch(SHEETS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "update", ...payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to update: ${res.status}`);
  }
}

export type TransferRow = {
  timestamp?: string;
  date?: string;
  transferFrom: string;
  transferTo: string;
  amount: number;
  transferRowId?: string;
  description?: string;
  month: string;
};

function normalizeTransferRow(raw: Record<string, unknown>): TransferRow {
  const transferTo = String(getRawValue(raw, ["Transfer To", "transferTo", "transfer to"]) ?? "");
  const transferRowIdRaw = getRawValue(raw, ["Transfer Row ID","transfer row id","transferRowId","transfer_row_id","Transfer Row Id"]);
  const transferRowId = typeof transferRowIdRaw === "string" ? transferRowIdRaw.trim() : "";
  const dateRaw = getRawValue(raw, ["Date", "date"]);
  const dateStr = typeof dateRaw === "string" ? dateRaw.trim() : "";
  return {
    timestamp: (getRawValue(raw, ["Timestamp", "timestamp"]) as string | undefined),
    date: dateStr || undefined,
    transferFrom: String(getRawValue(raw, ["Transfer from","Transfer From","transferFrom","transfer from"]) ?? ""),
    transferTo,
    amount: Number(getRawValue(raw, ["Transfer Amount","transfer amount","amount"]) ?? 0),
    transferRowId: transferRowId || undefined,
    description: (() => {
      const d = getRawValue(raw, ["Transfer Description","Transfer Descriptior","transfer description","description"]);
      const s = typeof d === "string" ? d.trim() : "";
      return s || undefined;
    })(),
    month: String(getRawValue(raw, ["Month", "month"]) ?? ""),
  };
}

export function transferMatchesMonth(row: TransferRow, selectedMonth?: string): boolean {
  if (!selectedMonth || selectedMonth === "full") return true;
  const monthNum = Number(selectedMonth);
  if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) return true;
  const rawMonth = String(row.month ?? "").trim().toLowerCase();
  if (rawMonth) {
    const monthName = monthNameFromNumber(monthNum);
    const normalizedNumeric = String(parseInt(rawMonth, 10));
    if (rawMonth === String(monthNum) || rawMonth === monthName ||
        rawMonth === `${monthName} 2026` || normalizedNumeric === String(monthNum)) return true;
  }
  if (row.timestamp) {
    const d = new Date(row.timestamp);
    if (!Number.isNaN(d.getTime()) && d.getMonth() + 1 === monthNum) return true;
  }
  return false;
}

export async function getTransfers(month?: string): Promise<TransferRow[]> {
  const params = new URLSearchParams({ sheet: "Transfers" });
  if (month) params.set("month", month);
  const res = await fetch(`${SHEETS_API}?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to fetch transfers: ${res.status}`);
  }
  const data = await res.json();
  const rows: Record<string, unknown>[] = Array.isArray(data) ? data : (data.rows ?? data.data ?? []);
  return rows.map(normalizeTransferRow).filter((row) => transferMatchesMonth(row, month));
}

export async function submitTransfer(payload: {
  transferFrom: string;
  transferTo: string;
  amount: number;
}): Promise<void> {
  const res = await fetch(SHEETS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet: "Transfers", ...payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to submit transfer: ${res.status}`);
  }
}
