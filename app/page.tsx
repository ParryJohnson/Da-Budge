"use client";
import { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Loader2, RefreshCw, X, Pencil, Plus } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import MonthDropdown from "@/components/MonthDropdown";
import GlassDropdown from "@/components/GlassDropdown";
import { useExpensesData } from "@/contexts/ExpensesDataContext";
import { useMonth } from "@/contexts/MonthContext";
import { useRefresh } from "@/contexts/RefreshContext";
import { rowMatchesMonth, transferMatchesMonth, submitTransfer } from "@/services/sheetsApi";
import {
  computeAccountBalances, getAccountAnchors, type AccountAnchor,
} from "@/services/accountBalancesService";
import type { SupportedBroker } from "@/services/snaptradeApi";
import type { MonthlyBudgets } from "@/lib/budgetCategoryMigration";
import { EXPENSE_CATEGORIES, CATEGORY_COLORS, normalizeExpenseCategoryType, TRANSFER_OPTIONS } from "@/lib/constants";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function progressColor(pct: number): string {
  if (pct >= 90) return "#FF5C5C";
  if (pct >= 70) return "#F9B43B";
  return "#50C878";
}

// Look up a month's budget, carrying forward from previous months if unset.
function resolveBudget(budgets: MonthlyBudgets, monthKey: string): Record<string, number> {
  if (monthKey === "full") {
    const total: Record<string, number> = {};
    for (let m = 1; m <= 12; m++) {
      const mb = resolveBudget(budgets, String(m));
      for (const [cat, amt] of Object.entries(mb)) total[cat] = (total[cat] ?? 0) + amt;
    }
    return total;
  }
  let n = Number(monthKey);
  while (n >= 1) {
    const entry = budgets[String(n)];
    if (entry && Object.keys(entry).length > 0) return entry;
    n--;
  }
  return {};
}

export default function BudgetDashboard() {
  const { allRows, allTransfers, loading, error } = useExpensesData();
  const { selectedMonth, selectedLabel } = useMonth();
  const { triggerRefresh } = useRefresh();

  const rows = useMemo(() => allRows.filter((r) => rowMatchesMonth(r, selectedMonth)), [allRows, selectedMonth]);
  const transfers = useMemo(() => allTransfers.filter((t) => transferMatchesMonth(t, selectedMonth)), [allTransfers, selectedMonth]);

  const [budgets, setBudgets] = useState<MonthlyBudgets>({});
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  const [anchors, setAnchors] = useState<AccountAnchor[]>([]);
  const [liveBrokerBalances, setLiveBrokerBalances] = useState<Partial<Record<SupportedBroker, number>>>({});
  const [refreshingBalances, setRefreshingBalances] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [addingTransfer, setAddingTransfer] = useState(false);

  // Load budgets + anchors on mount.
  useEffect(() => {
    fetch("/api/budget").then((r) => r.json()).then((d) => { if (d && !d.error) setBudgets(d); }).catch(() => {});
    getAccountAnchors().then(setAnchors).catch(() => {});
  }, []);

  useEffect(() => {
    setAccountBalances(computeAccountBalances(allRows, allTransfers, liveBrokerBalances, anchors));
  }, [allRows, allTransfers, liveBrokerBalances, anchors]);

  // Spending per category for the selected period.
  const spendByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of rows) {
      if (row.expenseType === "Income") continue;
      const cat = normalizeExpenseCategoryType(row.expenseType);
      if (!cat) continue;
      map[cat] = (map[cat] ?? 0) + Number(row.amount || 0);
    }
    return map;
  }, [rows]);

  const monthBudget = useMemo(() => resolveBudget(budgets, selectedMonth), [budgets, selectedMonth]);

  const pieData = useMemo(
    () => EXPENSE_CATEGORIES
      .map((cat) => ({ name: cat, value: spendByCategory[cat] ?? 0 }))
      .filter((d) => d.value > 0),
    [spendByCategory],
  );

  const totalSpent = useMemo(() => Object.values(spendByCategory).reduce((a, b) => a + b, 0), [spendByCategory]);
  const totalBudget = useMemo(() => Object.values(monthBudget).reduce((a, b) => a + b, 0), [monthBudget]);

  const incomeRows = useMemo(() => rows.filter((r) => r.expenseType === "Income"), [rows]);
  const totalIncome = useMemo(() => incomeRows.reduce((a, r) => a + Number(r.amount || 0), 0), [incomeRows]);

  // Cumulative expense over the period, by day.
  const cumulativeData = useMemo(() => {
    const byDay = new Map<number, number>();
    for (const row of rows) {
      if (row.expenseType === "Income") continue;
      const d = row.timestamp ? new Date(row.timestamp) : null;
      const day = d && !Number.isNaN(d.getTime()) ? (selectedMonth === "full" ? d.getMonth() + 1 : d.getDate()) : 0;
      byDay.set(day, (byDay.get(day) ?? 0) + Number(row.amount || 0));
    }
    const sorted = Array.from(byDay.entries()).sort((a, b) => a[0] - b[0]);
    let running = 0;
    return sorted.map(([day, amt]) => { running += amt; return { day, cumulative: Math.round(running * 100) / 100 }; });
  }, [rows, selectedMonth]);

  async function saveBudget(next: MonthlyBudgets) {
    setBudgets(next);
    try {
      await fetch("/api/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {}
  }

  async function refreshBalances() {
    setRefreshingBalances(true);
    try {
      const res = await fetch("/api/snaptrade/refresh-balances", { method: "POST" });
      const data = await res.json();
      if (data?.balances) setLiveBrokerBalances(data.balances);
    } catch {} finally {
      setRefreshingBalances(false);
    }
  }

  if (loading && allRows.length === 0) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-white">Budget</h1>
          <div className="flex items-center gap-2">
            <MonthDropdown />
            <button onClick={triggerRefresh} className="p-2 rounded-lg bg-charcoal border border-charcoal-dark text-gray-400 hover:text-accent transition-colors" aria-label="Refresh data">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-red-400">Couldn&apos;t load sheet data: {error}</p>}

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryTile label="Income" value={fmt(totalIncome)} accent="#50C878" />
          <SummaryTile label="Spent" value={fmt(totalSpent)} accent="#FF5C5C" />
          <SummaryTile label="Budget" value={totalBudget > 0 ? fmt(totalBudget) : "—"} accent="#4EA8FF" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Pie chart */}
          <Card title="Spending by Category">
            {pieData.length === 0 ? (
              <p className="text-gray-500 text-sm py-12 text-center">No expenses for {selectedLabel}.</p>
            ) : (
              <div className="expense-pie-chart h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}
                      onClick={(d: { name?: string }) => d?.name && setActiveCategory(d.name)}>
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name] ?? "#888"} stroke="none" cursor="pointer" />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "#252525", border: "1px solid #333", borderRadius: 8, color: "#fff" }}
                      formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Cumulative chart */}
          <Card title="Cumulative Spending">
            {cumulativeData.length === 0 ? (
              <p className="text-gray-500 text-sm py-12 text-center">No data yet.</p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cumulativeData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#333" strokeDasharray="3 3" />
                    <XAxis dataKey="day" stroke="#888" fontSize={12} />
                    <YAxis stroke="#888" fontSize={12} tickFormatter={(v) => `$${v}`} width={56} />
                    <Tooltip
                      contentStyle={{ background: "#252525", border: "1px solid #333", borderRadius: 8, color: "#fff" }}
                      formatter={(v: number) => fmt(v)} />
                    <Line type="monotone" dataKey="cumulative" stroke="#50C878" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>

        {/* Category progress */}
        <Card title="Categories" action={
          <button onClick={() => setEditingBudget(true)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-accent transition-colors">
            <Pencil className="w-3.5 h-3.5" /> Edit budget
          </button>
        }>
          <div className="space-y-2">
            {EXPENSE_CATEGORIES.map((cat) => {
              const spent = spendByCategory[cat] ?? 0;
              const budget = monthBudget[cat] ?? 0;
              const pct = budget > 0 ? (spent / budget) * 100 : spent > 0 ? 100 : 0;
              if (spent === 0 && budget === 0) return null;
              return (
                <button key={cat} onClick={() => setActiveCategory(cat)} className="w-full text-left group">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-200 group-hover:text-white flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY_COLORS[cat] }} />
                      {cat}
                    </span>
                    <span className="text-gray-400">
                      {fmt(spent)}{budget > 0 && <span className="text-gray-600"> / {fmt(budget)}</span>}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-charcoal-dark overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: progressColor(pct) }} />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Income */}
          <Card title="Income">
            {incomeRows.length === 0 ? (
              <p className="text-gray-500 text-sm py-6 text-center">No income recorded.</p>
            ) : (
              <div className="divide-y divide-charcoal-dark">
                {incomeRows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-gray-300">{r.description || "Income"}</span>
                    <span className="text-accent font-medium">{fmt(Number(r.amount || 0))}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Transfers */}
          <Card title="Transfers" action={
            <button onClick={() => setAddingTransfer(true)} aria-label="Add transfer"
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-accent transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          }>
            {transfers.length === 0 ? (
              <p className="text-gray-500 text-sm py-6 text-center">No transfers.</p>
            ) : (
              <div className="divide-y divide-charcoal-dark max-h-64 overflow-auto scrollbar-thin">
                {transfers.map((t, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-gray-300">{t.transferFrom} → {t.transferTo}</span>
                    <span className="text-gray-200">{fmt(Number(t.amount || 0))}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Account Balances */}
        <Card title="Account Balances" action={
          <button onClick={refreshBalances} disabled={refreshingBalances}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-accent transition-colors disabled:opacity-50">
            {refreshingBalances ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        }>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {Object.entries(accountBalances)
              .filter(([, v]) => Math.abs(v) > 0.005)
              .map(([name, value], i) => (
                <div key={name} className={`flex items-center justify-between py-2 text-sm ${i % 2 === 0 ? "" : ""}`}>
                  <span className="text-gray-300">{name}</span>
                  <span className={value < 0 ? "text-red-400" : "text-gray-100"}>{fmt(value)}</span>
                </div>
              ))}
          </div>
        </Card>
      </div>

      {activeCategory && (
        <CategoryModal
          category={activeCategory}
          rows={rows.filter((r) => normalizeExpenseCategoryType(r.expenseType) === activeCategory)}
          budget={monthBudget[activeCategory] ?? 0}
          monthKey={selectedMonth}
          onClose={() => setActiveCategory(null)}
          onSaveBudget={(amount) => {
            const key = selectedMonth === "full" ? "12" : selectedMonth;
            const next = { ...budgets, [key]: { ...resolveBudget(budgets, key), [activeCategory]: amount } };
            saveBudget(next);
          }}
        />
      )}

      {editingBudget && (
        <BudgetEditModal
          monthKey={selectedMonth}
          current={monthBudget}
          onClose={() => setEditingBudget(false)}
          onSave={(map) => {
            const key = selectedMonth === "full" ? "12" : selectedMonth;
            saveBudget({ ...budgets, [key]: map });
            setEditingBudget(false);
          }}
        />
      )}

      {addingTransfer && (
        <NewTransferModal
          onClose={() => setAddingTransfer(false)}
          onSaved={() => { setAddingTransfer(false); triggerRefresh(); }}
        />
      )}
    </DashboardLayout>
  );
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl bg-[#252525] border border-charcoal-dark p-4">
      <p className="text-xs uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-2xl font-semibold mt-1" style={{ color: accent }}>{value}</p>
    </div>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#252525] border border-charcoal-dark overflow-hidden">
      <div className="px-4 py-3 bg-[#353535] border-b border-charcoal-dark flex items-center justify-between">
        <h2 className="text-white font-medium text-sm">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function CategoryModal({ category, rows, budget, onClose, onSaveBudget }: {
  category: string;
  rows: { timestamp?: string; description: string; amount: number }[];
  budget: number;
  monthKey: string;
  onClose: () => void;
  onSaveBudget: (amount: number) => void;
}) {
  const [budgetInput, setBudgetInput] = useState(budget > 0 ? String(budget) : "");
  const total = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="rounded-xl bg-[#252525] border border-charcoal-dark w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 bg-[#353535] border-b border-charcoal-dark flex items-center justify-between">
          <h2 className="text-white font-medium flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: CATEGORY_COLORS[category] }} />{category}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 border-b border-charcoal-dark">
          <label className="block text-xs text-gray-400 mb-1">Monthly budget</label>
          <div className="flex gap-2">
            <input type="number" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} placeholder="0.00"
              className="flex-1 px-3 py-2 rounded-lg bg-charcoal border border-charcoal-dark text-gray-200 focus:border-accent focus:ring-1 focus:ring-accent outline-none" />
            <button onClick={() => onSaveBudget(parseFloat(budgetInput) || 0)}
              className="px-4 py-2 rounded-lg bg-accent text-white font-medium hover:bg-accent-dark">Save</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto scrollbar-thin p-4">
          <p className="text-sm text-gray-400 mb-2">Total: <span className="text-white">{fmt(total)}</span></p>
          <div className="divide-y divide-charcoal-dark">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-2 text-sm">
                <span className="text-gray-300 truncate mr-2">{r.description || "—"}</span>
                <span className="text-gray-200 shrink-0">{fmt(Number(r.amount || 0))}</span>
              </div>
            ))}
            {rows.length === 0 && <p className="text-gray-500 text-sm py-4 text-center">No transactions.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function BudgetEditModal({ current, onClose, onSave }: {
  monthKey: string;
  current: Record<string, number>;
  onClose: () => void;
  onSave: (map: Record<string, number>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const cat of EXPENSE_CATEGORIES) d[cat] = current[cat] ? String(current[cat]) : "";
    return d;
  });
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="rounded-xl bg-[#252525] border border-charcoal-dark w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 bg-[#353535] border-b border-charcoal-dark flex items-center justify-between">
          <h2 className="text-white font-medium">Edit Budget</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-auto scrollbar-thin p-4 space-y-2">
          {EXPENSE_CATEGORIES.map((cat) => (
            <div key={cat} className="flex items-center justify-between gap-3">
              <span className="text-sm text-gray-300 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY_COLORS[cat] }} />{cat}
              </span>
              <input type="number" value={draft[cat]} onChange={(e) => setDraft({ ...draft, [cat]: e.target.value })} placeholder="0.00"
                className="w-28 px-2 py-1.5 rounded-lg bg-charcoal border border-charcoal-dark text-gray-200 text-right focus:border-accent focus:ring-1 focus:ring-accent outline-none" />
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-charcoal-dark flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-charcoal border border-charcoal-dark text-gray-300 hover:text-white">Cancel</button>
          <button onClick={() => {
            const map: Record<string, number> = {};
            for (const [cat, v] of Object.entries(draft)) { const n = parseFloat(v); if (Number.isFinite(n) && n > 0) map[cat] = n; }
            onSave(map);
          }} className="px-4 py-2 rounded-lg bg-accent text-white font-medium hover:bg-accent-dark">Save</button>
        </div>
      </div>
    </div>
  );
}

function NewTransferModal({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(amount);
    if (!transferFrom || !transferTo || Number.isNaN(num) || num <= 0) {
      setStatus("error");
      setErrorMessage("Please choose both accounts and enter a valid amount.");
      return;
    }
    if (transferFrom === transferTo) {
      setStatus("error");
      setErrorMessage("Transfer from and to can't be the same account.");
      return;
    }
    setStatus("submitting");
    setErrorMessage("");
    try {
      await submitTransfer({ transferFrom, transferTo, amount: num });
      onSaved();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to submit.");
    }
  };

  const options = TRANSFER_OPTIONS.map((opt) => ({ value: opt, label: opt }));

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="rounded-xl bg-[#252525] border border-charcoal-dark w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 bg-[#353535] border-b border-charcoal-dark flex items-center justify-between">
          <h2 className="text-white font-medium">New Transfer</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="transferFrom" className="block text-sm font-medium text-gray-300 mb-1">Transfer from:</label>
            <GlassDropdown id="transferFrom" value={transferFrom} onChange={setTransferFrom}
              options={options} placeholder="Select account" className="w-full" aria-label="Transfer from" />
          </div>
          <div>
            <label htmlFor="transferTo" className="block text-sm font-medium text-gray-300 mb-1">Transfer to:</label>
            <GlassDropdown id="transferTo" value={transferTo} onChange={setTransferTo}
              options={options} placeholder="Select account" className="w-full" aria-label="Transfer to" />
          </div>
          <div>
            <label htmlFor="transferAmount" className="block text-sm font-medium text-gray-300 mb-1">Transfer Amount:</label>
            <input id="transferAmount" type="number" step="0.01" min="0" required value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
              className="w-full px-3 py-2 rounded-lg bg-charcoal border border-charcoal-dark text-gray-200 focus:border-accent focus:ring-1 focus:ring-accent outline-none" />
          </div>
          {status === "error" && <p className="text-sm text-red-400">{errorMessage}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg bg-charcoal border border-charcoal-dark text-gray-300 hover:text-white">Cancel</button>
            <button type="submit" disabled={status === "submitting"}
              className="px-4 py-2 rounded-lg bg-accent text-white font-medium hover:bg-accent-dark disabled:opacity-50 flex items-center gap-2">
              {status === "submitting" ? (<><Loader2 className="w-4 h-4 animate-spin" />Saving…</>) : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
