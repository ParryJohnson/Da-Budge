"use client";
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useRefresh } from "@/contexts/RefreshContext";
import { getExpenses, getTransfers } from "@/services/sheetsApi";
import type { SheetRow, TransferRow } from "@/services/sheetsApi";

type ExpensesDataContextType = {
  allRows: SheetRow[];
  allTransfers: TransferRow[];
  loading: boolean;
  error: string | null;
};

const ExpensesDataContext = createContext<ExpensesDataContextType | null>(null);
const CACHE_KEY = "dabudge_expenses_v1";

type CachedData = { allRows: SheetRow[]; allTransfers: TransferRow[] };

function readCache(): CachedData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedData;
  } catch { return null; }
}

function writeCache(allRows: SheetRow[], allTransfers: TransferRow[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ allRows, allTransfers })); } catch {}
}

export function ExpensesDataProvider({ children }: { children: ReactNode }) {
  const { refreshKey } = useRefresh();
  const [allRows, setAllRows] = useState<SheetRow[]>(() =>
    typeof window === "undefined" ? [] : (readCache()?.allRows ?? [])
  );
  const [allTransfers, setAllTransfers] = useState<TransferRow[]>(() =>
    typeof window === "undefined" ? [] : (readCache()?.allTransfers ?? [])
  );
  const [loading, setLoading] = useState(() =>
    typeof window === "undefined" ? true : readCache() === null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([getExpenses(), getTransfers()])
      .then(([rows, transfers]) => {
        if (!cancelled) {
          setAllRows(rows);
          setAllTransfers(transfers);
          writeCache(rows, transfers);
          setError(null);
        }
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <ExpensesDataContext.Provider value={{ allRows, allTransfers, loading, error }}>
      {children}
    </ExpensesDataContext.Provider>
  );
}

export function useExpensesData() {
  const ctx = useContext(ExpensesDataContext);
  if (!ctx) throw new Error("useExpensesData must be used within ExpensesDataProvider");
  return ctx;
}
