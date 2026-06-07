"use client";
import { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Plus, Trash2, X, Loader2, RefreshCw } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useExpensesData } from "@/contexts/ExpensesDataContext";
import {
  computeNetWorthSummary, computeIncomeBreakdown, type ManualItem,
} from "@/services/netWorthService";
import { getAccountAnchors, type AccountAnchor } from "@/services/accountBalancesService";
import type { SupportedBroker } from "@/services/snaptradeApi";
import { ASSET_CATEGORIES, LIABILITY_CATEGORIES, PIE_COLORS } from "@/lib/constants";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

type SnapHistory = { fetchedAt: string; fidelityTotal: number; fidelityBrokerage: number; fidelityRothIra: number };

export default function NetWorthPage() {
  const { allRows, allTransfers } = useExpensesData();
  const [assets, setAssets] = useState<ManualItem[]>([]);
  const [liabilities, setLiabilities] = useState<ManualItem[]>([]);
  const [anchors, setAnchors] = useState<AccountAnchor[]>([]);
  const [liveBrokerBalances, setLiveBrokerBalances] = useState<Partial<Record<SupportedBroker, number>>>({});
  const [investments, setInvestments] = useState({ brokerage: 0, rothIra: 0 });
  const [history, setHistory] = useState<SnapHistory[]>([]);
  const [editing, setEditing] = useState<{ kind: "asset" | "liability"; item: ManualItem | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function loadAssets() {
    const r = await fetch("/api/assets").then((r) => r.json()).catch(() => ({ assets: [] }));
    setAssets((r.assets ?? []).map(normalizeItem));
  }
  async function loadLiabilities() {
    const r = await fetch("/api/liabilities").then((r) => r.json()).catch(() => ({ liabilities: [] }));
    setLiabilities((r.liabilities ?? []).map(normalizeItem));
  }

  useEffect(() => {
    loadAssets();
    loadLiabilities();
    getAccountAnchors().then(setAnchors).catch(() => {});
    fetch("/api/snaptrade/investments").then((r) => r.json()).then((d) => { if (d && !d.error) setInvestments(d); }).catch(() => {});
    fetch("/api/snaptrade/history").then((r) => r.json()).then((d) => { if (d?.history) setHistory(d.history); }).catch(() => {});
  }, []);

  const summary = useMemo(
    () => computeNetWorthSummary(allRows, allTransfers, assets, liabilities, liveBrokerBalances, anchors),
    [allRows, allTransfers, assets, liabilities, liveBrokerBalances, anchors],
  );

  const incomeBreakdown = useMemo(() => computeIncomeBreakdown(allRows), [allRows]);

  async function refreshBalances() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/snaptrade/refresh-balances", { method: "POST" });
      const data = await res.json();
      if (data?.balances) setLiveBrokerBalances(data.balances);
      fetch("/api/snaptrade/investments").then((r) => r.json()).then((d) => { if (d && !d.error) setInvestments(d); }).catch(() => {});
      fetch("/api/snaptrade/history").then((r) => r.json()).then((d) => { if (d?.history) setHistory(d.history); }).catch(() => {});
    } catch {} finally {
      setRefreshing(false);
    }
  }

  async function saveItem(kind: "asset" | "liability", item: ManualItem) {
    const url = kind === "asset" ? "/api/assets" : "/api/liabilities";
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
    if (kind === "asset") await loadAssets(); else await loadLiabilities();
    setEditing(null);
  }

  async function deleteItem(kind: "asset" | "liability", id: string) {
    const url = kind === "asset" ? "/api/assets" : "/api/liabilities";
    await fetch(`${url}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (kind === "asset") await loadAssets(); else await loadLiabilities();
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-white">Net Worth</h1>
          <button onClick={refreshBalances} disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-accent transition-colors disabled:opacity-50">
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh balances
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryTile label="Total Net Worth" value={fmt(summary.totalNetWorth)} accent="#50C878" />
          <SummaryTile label="Liquid" value={fmt(summary.liquidNetWorth)} accent="#4EA8FF" />
          <SummaryTile label="Savings Rate" value={`${(summary.savingsRate * 100).toFixed(0)}%`} accent="#F9B43B" />
          <SummaryTile label="Runway" value={`${summary.runwayMonths.toFixed(1)} mo`} accent="#9D59D5" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ItemSection
            title="Assets" kind="asset" items={assets} categories={[...ASSET_CATEGORIES]}
            onAdd={(cat) => setEditing({ kind: "asset", item: blankItem(cat) })}
            onEdit={(item) => setEditing({ kind: "asset", item })}
            onDelete={(id) => deleteItem("asset", id)} />
          <ItemSection
            title="Liabilities" kind="liability" items={liabilities} categories={[...LIABILITY_CATEGORIES]}
            onAdd={(cat) => setEditing({ kind: "liability", item: blankItem(cat) })}
            onEdit={(item) => setEditing({ kind: "liability", item })}
            onDelete={(id) => deleteItem("liability", id)} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Income Breakdown">
            {incomeBreakdown.length === 0 ? (
              <p className="text-gray-500 text-sm py-12 text-center">No income recorded.</p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={incomeBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={92} paddingAngle={2}>
                      {incomeBreakdown.map((entry, i) => (
                        <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#252525", border: "1px solid #333", borderRadius: 8, color: "#fff" }} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card title="Investments">
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-charcoal-dark text-sm">
                <span className="text-gray-300">Brokerage</span>
                <span className="text-gray-100">{fmt(investments.brokerage)}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-charcoal-dark text-sm">
                <span className="text-gray-300">Roth IRA</span>
                <span className="text-gray-100">{fmt(investments.rothIra)}</span>
              </div>
              <div className="flex items-center justify-between py-2 text-sm font-medium">
                <span className="text-gray-200">Total invested</span>
                <span className="text-accent">{fmt(investments.brokerage + investments.rothIra)}</span>
              </div>
              {investments.brokerage === 0 && investments.rothIra === 0 && (
                <p className="text-xs text-gray-500 pt-2">Connect SnapTrade and hit Refresh balances to populate live investment values.</p>
              )}
            </div>
          </Card>
        </div>

        <Card title="Net Worth History">
          {history.length === 0 ? (
            <p className="text-gray-500 text-sm py-12 text-center">No snapshots yet. Refresh balances to record one.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history.map((h) => ({ ...h, label: new Date(h.fetchedAt).toLocaleDateString() }))} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="#333" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#888" fontSize={11} />
                  <YAxis stroke="#888" fontSize={12} width={64} tickFormatter={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)} />
                  <Tooltip contentStyle={{ background: "#252525", border: "1px solid #333", borderRadius: 8, color: "#fff" }} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} formatter={(v: number) => fmt(v)} />
                  <Line type="monotone" dataKey="fidelityTotal" stroke="#50C878" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {editing && (
        <ItemModal
          kind={editing.kind}
          item={editing.item!}
          categories={editing.kind === "asset" ? [...ASSET_CATEGORIES] : [...LIABILITY_CATEGORIES]}
          onClose={() => setEditing(null)}
          onSave={(item) => saveItem(editing.kind, item)}
        />
      )}
    </DashboardLayout>
  );
}

function normalizeItem(r: Record<string, unknown>): ManualItem {
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    value: Number(r.value ?? 0),
    category: String(r.category ?? ""),
    acquisition_date: r.acquisition_date ? String(r.acquisition_date).slice(0, 10) : null,
    details: (r.details && typeof r.details === "object" ? r.details : {}) as Record<string, unknown>,
  };
}

function blankItem(category: string): ManualItem {
  return { id: "", name: "", value: 0, category, acquisition_date: null, details: {} };
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

function ItemSection({ title, kind, items, categories, onAdd, onEdit, onDelete }: {
  title: string; kind: "asset" | "liability"; items: ManualItem[]; categories: string[];
  onAdd: (category: string) => void; onEdit: (item: ManualItem) => void; onDelete: (id: string) => void;
}) {
  const total = items.reduce((a, i) => a + Number(i.value || 0), 0);
  return (
    <Card title={title} action={<span className="text-sm text-gray-400">{fmt(total)}</span>}>
      <div className="space-y-4">
        {categories.map((cat) => {
          const catItems = items.filter((i) => i.category === cat);
          return (
            <div key={cat}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs uppercase tracking-wider text-gray-500">{cat}</p>
                <button onClick={() => onAdd(cat)} className="text-gray-500 hover:text-accent" aria-label={`Add ${cat}`}>
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {catItems.length === 0 ? (
                <p className="text-xs text-gray-600 py-1">None</p>
              ) : (
                <div className="divide-y divide-charcoal-dark">
                  {catItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2 text-sm group">
                      <button onClick={() => onEdit(item)} className="text-gray-300 hover:text-white text-left flex-1 truncate mr-2">{item.name}</button>
                      <span className={`shrink-0 mr-2 ${kind === "liability" ? "text-red-400" : "text-gray-100"}`}>{fmt(Number(item.value || 0))}</span>
                      <button onClick={() => onDelete(item.id)} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ItemModal({ kind, item, categories, onClose, onSave }: {
  kind: "asset" | "liability"; item: ManualItem; categories: string[];
  onClose: () => void; onSave: (item: ManualItem) => void;
}) {
  const [name, setName] = useState(item.name);
  const [value, setValue] = useState(item.value ? String(item.value) : "");
  const [category, setCategory] = useState(item.category || categories[0]);
  const [date, setDate] = useState(item.acquisition_date ?? "");

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="rounded-xl bg-[#252525] border border-charcoal-dark w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 bg-[#353535] border-b border-charcoal-dark flex items-center justify-between">
          <h2 className="text-white font-medium">{item.id ? "Edit" : "Add"} {kind === "asset" ? "Asset" : "Liability"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
          <Field label="Value"><input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" className={inputCls} /></Field>
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Acquisition date (optional)"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="p-4 border-t border-charcoal-dark flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-charcoal border border-charcoal-dark text-gray-300 hover:text-white">Cancel</button>
          <button
            onClick={() => onSave({ ...item, name: name.trim(), value: parseFloat(value) || 0, category, acquisition_date: date || null })}
            disabled={!name.trim()}
            className="px-4 py-2 rounded-lg bg-accent text-white font-medium hover:bg-accent-dark disabled:opacity-50">Save</button>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full px-3 py-2 rounded-lg bg-charcoal border border-charcoal-dark text-gray-200 focus:border-accent focus:ring-1 focus:ring-accent outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  );
}
