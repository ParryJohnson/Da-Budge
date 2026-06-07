"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import { Upload, Check, XCircle, Loader2, RotateCcw, Link2, EyeOff } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import GlassDropdown from "@/components/GlassDropdown";
import { useExpensesData } from "@/contexts/ExpensesDataContext";
import {
  BANK_PROFILES, parseCsvRows, matchRows, type BankRow, type MatchResult, type MatchType,
} from "@/lib/reconcileClient";
import { generateMerchantFingerprint } from "@/lib/merchantFingerprint";
import {
  getAccountAnchors, mapAccountNameToBalanceKey, type AccountAnchor,
} from "@/services/accountBalancesService";

const fmt = (n: number) =>
  Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

type Claim = { bankHash: string; sheetRowId: string; sheetName: string };
type Dismissal = { hash: string; accountName: string };
type Activity = {
  id: string; occurredAt: string; actionType: string; actor: string;
  payload: Record<string, unknown>; revertedAt: string | null;
};

const MATCH_LABEL: Record<MatchType, { label: string; color: string }> = {
  exact: { label: "Matched", color: "#50C878" },
  fuzzy: { label: "Fuzzy", color: "#F9B43B" },
  transfer: { label: "Transfer", color: "#4EA8FF" },
  suggested: { label: "Suggested", color: "#9D59D5" },
  unmatched: { label: "Unmatched", color: "#888" },
};

export default function ReconcilePage() {
  const { allRows, allTransfers } = useExpensesData();
  const [tab, setTab] = useState<"match" | "activity">("match");

  const [accountName, setAccountName] = useState<string>(Object.keys(BANK_PROFILES)[0]);
  const [bankRows, setBankRows] = useState<BankRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [csvUploadId, setCsvUploadId] = useState<string>("");

  const [claims, setClaims] = useState<Claim[]>([]);
  const [dismissals, setDismissals] = useState<Dismissal[]>([]);
  const [merchantMemory, setMerchantMemory] = useState<Map<string, string>>(new Map());
  const [anchors, setAnchors] = useState<AccountAnchor[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);

  const loadClaims = useCallback(async () => {
    const d = await fetch("/api/reconciliation/claims").then((r) => r.json()).catch(() => ({ claims: [] }));
    setClaims((d.claims ?? []).map((c: Record<string, unknown>) => ({ bankHash: String(c.bankHash), sheetRowId: String(c.sheetRowId), sheetName: String(c.sheetName ?? "Expenses") })));
  }, []);
  const loadDismissals = useCallback(async () => {
    const d = await fetch("/api/reconciliation/dismissals").then((r) => r.json()).catch(() => ({ dismissals: [] }));
    setDismissals((d.dismissals ?? []).map((x: Record<string, unknown>) => ({ hash: String(x.hash), accountName: String(x.accountName) })));
  }, []);
  const loadMemory = useCallback(async () => {
    const d = await fetch("/api/reconciliation/memory").then((r) => r.json()).catch(() => ({ memory: [] }));
    const m = new Map<string, string>();
    for (const row of d.memory ?? []) if (row.fingerprint && row.sheetCategory) m.set(String(row.fingerprint), String(row.sheetCategory));
    setMerchantMemory(m);
  }, []);
  const loadActivity = useCallback(async () => {
    const d = await fetch("/api/reconciliation/activity").then((r) => r.json()).catch(() => ({ activity: [] }));
    setActivity(d.activity ?? []);
  }, []);

  useEffect(() => {
    loadClaims(); loadDismissals(); loadMemory(); loadActivity();
    getAccountAnchors().then(setAnchors).catch(() => {});
  }, [loadClaims, loadDismissals, loadMemory, loadActivity]);

  const claimedHashes = useMemo(() => new Set(claims.map((c) => c.bankHash)), [claims]);
  const claimedSheetIds = useMemo(() => new Set(claims.map((c) => c.sheetRowId)), [claims]);
  const dismissedHashes = useMemo(
    () => new Set(dismissals.filter((d) => d.accountName === accountName).map((d) => d.hash)),
    [dismissals, accountName],
  );

  const onDrop = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    setParseError(null);
    Papa.parse<string[]>(file, {
      complete: (res) => {
        const rows = (res.data as string[][]).filter((r) => Array.isArray(r) && r.some((c) => String(c).trim()));
        const profile = BANK_PROFILES[accountName];
        // Drop a likely header row if the amount column isn't numeric.
        const body = rows.length > 0 && Number.isNaN(Number(String(rows[0][profile.amountCol] ?? "").replace(/[$,]/g, ""))) ? rows.slice(1) : rows;
        const parsed = parseCsvRows(body, accountName, profile);
        if (parsed.length === 0) setParseError("No usable rows found. Check that the bank profile matches this CSV's columns.");
        setBankRows(parsed);
        setCsvUploadId(crypto.randomUUID());
      },
      error: (err) => setParseError(err.message),
    });
  }, [accountName]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { "text/csv": [".csv"] }, multiple: false });

  const matches = useMemo(
    () => matchRows(bankRows, allRows, allTransfers, claimedSheetIds, merchantMemory),
    [bankRows, allRows, allTransfers, claimedSheetIds, merchantMemory],
  );

  const visibleMatches = useMemo(
    () => matches.filter((m) => !dismissedHashes.has(m.bankRow.hash)),
    [matches, dismissedHashes],
  );

  async function claim(m: MatchResult) {
    if (!m.sheetRow?.rowId) return;
    setBusy(true);
    try {
      const fp = generateMerchantFingerprint(m.bankRow.description, m.bankRow.amount);
      await fetch("/api/reconciliation/claims", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankHash: m.bankRow.hash, accountName, sheetName: "Expenses",
          sheetRowId: m.sheetRow.rowId, amountCents: Math.round(Math.abs(m.bankRow.amount) * 100),
          csvUploadId, fingerprint: fp, sheetCategory: m.sheetRow.expenseType,
        }),
      });
      await loadClaims(); await loadMemory(); await loadActivity();
    } finally { setBusy(false); }
  }

  async function unclaim(bankHash: string, sheetRowId: string) {
    setBusy(true);
    try {
      await fetch(`/api/reconciliation/claims?bankHash=${bankHash}&sheetRowId=${encodeURIComponent(sheetRowId)}`, { method: "DELETE" });
      await loadClaims(); await loadActivity();
    } finally { setBusy(false); }
  }

  async function dismiss(m: MatchResult) {
    setBusy(true);
    try {
      await fetch("/api/reconciliation/user-dismissals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash: m.bankRow.hash, accountName, csvUploadId }),
      });
      await loadDismissals(); await loadActivity();
    } finally { setBusy(false); }
  }

  async function undo(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/reconciliation/activity/${id}/undo`, { method: "POST" });
      await Promise.all([loadClaims(), loadDismissals(), loadActivity(), getAccountAnchors().then(setAnchors)]);
    } finally { setBusy(false); }
  }

  const summary = useMemo(() => {
    const counts: Record<MatchType, number> = { exact: 0, fuzzy: 0, transfer: 0, suggested: 0, unmatched: 0 };
    for (const m of visibleMatches) counts[m.matchType]++;
    return counts;
  }, [visibleMatches]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-white">Reconcile</h1>
          <div className="flex gap-1 bg-charcoal rounded-lg p-1 border border-charcoal-dark">
            {(["match", "activity"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${tab === t ? "bg-accent text-white" : "text-gray-400 hover:text-white"}`}>
                {t === "match" ? "Upload & Match" : "Activity Log"}
              </button>
            ))}
          </div>
        </div>

        {tab === "match" ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-4">
                <Card title="Upload Statement">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Bank account</label>
                      <GlassDropdown value={accountName} onChange={(v) => { setAccountName(v); setBankRows([]); }}
                        options={Object.keys(BANK_PROFILES).map((k) => ({ value: k, label: k }))} aria-label="Bank account" />
                    </div>
                    <div {...getRootProps()}
                      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${isDragActive ? "border-accent bg-accent/5" : "border-charcoal-dark hover:border-accent/40"}`}>
                      <input {...getInputProps()} />
                      <Upload className="w-8 h-8 mx-auto text-gray-500 mb-2" />
                      <p className="text-sm text-gray-400">{isDragActive ? "Drop the CSV here" : "Drag a bank CSV here, or click to browse"}</p>
                    </div>
                    {parseError && <p className="text-sm text-red-400">{parseError}</p>}
                    {bankRows.length > 0 && (
                      <p className="text-sm text-gray-400">{bankRows.length} rows parsed · {Object.entries(summary).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${MATCH_LABEL[k as MatchType].label.toLowerCase()}`).join(", ")}</p>
                    )}
                  </div>
                </Card>

                {visibleMatches.length > 0 && (
                  <Card title="Matches">
                    <div className="divide-y divide-charcoal-dark">
                      {visibleMatches.map((m) => {
                        const meta = MATCH_LABEL[m.matchType];
                        const isClaimed = claimedHashes.has(m.bankRow.hash);
                        return (
                          <div key={m.bankRow.hash} className="py-3 flex items-start gap-3">
                            <span className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta.color }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm text-gray-200 truncate">{m.bankRow.description || "—"}</p>
                                <span className="text-sm text-gray-100 shrink-0">{fmt(m.bankRow.amount)}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                                <span>{m.bankRow.date}</span>
                                <span style={{ color: meta.color }}>· {isClaimed ? "Claimed" : meta.label}</span>
                                {m.sheetRow && <span className="truncate">→ {m.sheetRow.expenseType} {m.sheetRow.description}</span>}
                                {m.suggestedCategory && <span>→ {m.suggestedCategory}</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {isClaimed ? (
                                <button onClick={() => { const c = claims.find((x) => x.bankHash === m.bankRow.hash); if (c) unclaim(c.bankHash, c.sheetRowId); }} disabled={busy}
                                  className="p-1.5 rounded-lg text-accent hover:bg-charcoal" title="Unclaim"><Check className="w-4 h-4" /></button>
                              ) : m.sheetRow ? (
                                <button onClick={() => claim(m)} disabled={busy}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-charcoal" title="Claim match"><Link2 className="w-4 h-4" /></button>
                              ) : null}
                              <button onClick={() => dismiss(m)} disabled={busy}
                                className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-charcoal" title="Dismiss"><EyeOff className="w-4 h-4" /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}
              </div>

              <div className="space-y-4">
                <AnchorsPanel anchors={anchors} onChange={() => getAccountAnchors().then(setAnchors)} />
              </div>
            </div>
          </>
        ) : (
          <Card title="Activity Log">
            {activity.length === 0 ? (
              <p className="text-gray-500 text-sm py-8 text-center">No activity yet.</p>
            ) : (
              <div className="divide-y divide-charcoal-dark">
                {activity.map((a) => (
                  <div key={a.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-200">{a.actionType.replace(/_/g, " ")}</p>
                      <p className="text-xs text-gray-500">{new Date(a.occurredAt).toLocaleString()} · {a.actor}{a.revertedAt ? " · reverted" : ""}</p>
                    </div>
                    {!a.revertedAt && !a.actionType.endsWith("_delete") && (
                      <button onClick={() => undo(a.id)} disabled={busy}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-charcoal border border-charcoal-dark text-gray-400 hover:text-accent transition-colors">
                        <RotateCcw className="w-3.5 h-3.5" /> Undo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </DashboardLayout>
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

function AnchorsPanel({ anchors, onChange }: { anchors: AccountAnchor[]; onChange: () => void }) {
  const [account, setAccount] = useState(Object.keys(BANK_PROFILES)[0]);
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function save() {
    const num = parseFloat(balance);
    if (!Number.isFinite(num)) return;
    setSaving(true);
    try {
      await fetch("/api/reconciliation/anchors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountName: mapAccountNameToBalanceKey(account), confirmedBalance: num, asOfDate: date }),
      });
      setBalance("");
      onChange();
    } finally { setSaving(false); }
  }

  async function remove(name: string) {
    await fetch(`/api/reconciliation/anchors?accountName=${encodeURIComponent(name)}`, { method: "DELETE" });
    onChange();
  }

  return (
    <Card title="Account Anchors">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">Set a confirmed balance as of a date. Only transactions after that date are applied.</p>
        <GlassDropdown value={account} onChange={setAccount} options={Object.keys(BANK_PROFILES).map((k) => ({ value: k, label: k }))} aria-label="Anchor account" />
        <input type="number" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="Confirmed balance"
          className="w-full px-3 py-2 rounded-lg bg-charcoal border border-charcoal-dark text-gray-200 focus:border-accent focus:ring-1 focus:ring-accent outline-none" />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-charcoal border border-charcoal-dark text-gray-200 focus:border-accent focus:ring-1 focus:ring-accent outline-none" />
        <button onClick={save} disabled={saving} className="w-full px-4 py-2 rounded-lg bg-accent text-white font-medium hover:bg-accent-dark disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Set anchor
        </button>
        {anchors.length > 0 && (
          <div className="pt-2 border-t border-charcoal-dark divide-y divide-charcoal-dark">
            {anchors.map((a) => (
              <div key={a.accountName} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-gray-300 truncate">{a.accountName}</p>
                  <p className="text-xs text-gray-500">{fmt(a.confirmedBalance)} · {a.asOfDate}</p>
                </div>
                <button onClick={() => remove(a.accountName)} className="text-gray-600 hover:text-red-400"><XCircle className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
