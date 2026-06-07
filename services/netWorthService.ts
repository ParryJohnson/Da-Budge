import type { SheetRow, TransferRow } from "@/services/sheetsApi";
import type { SupportedBroker } from "@/services/snaptradeApi";
import {
  BASE_ACCOUNT_BALANCES,
  computeAccountBalances,
  type AccountAnchor,
} from "@/services/accountBalancesService";

export type ManualItem = {
  id: string;
  name: string;
  value: number;
  category: string;
  acquisition_date?: string | null;
  details?: Record<string, unknown>;
  updated_at?: string;
};

const LIQUID_ACCOUNT_KEYS = [
  "Wells Fargo Checking",
  "Wells Fargo Savings",
  "Venmo - Daniel",
  "Venmo - Katie",
  "Ally",
  "Capital One",
  "America First",
  "Discover",
];

const BROKER_KEYS: SupportedBroker[] = ["Fidelity", "Robinhood", "Charles Schwab"];

export type NetWorthSummary = {
  totalNetWorth: number;
  liquidNetWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  brokerTotal: number;
  totalIncome: number;
  totalExpenses: number;
  savingsRate: number;
  runwayMonths: number;
};

function sumValues(items: ManualItem[]): number {
  return items.reduce((acc, i) => acc + (Number.isFinite(Number(i.value)) ? Number(i.value) : 0), 0);
}

export function computeNetWorthSummary(
  allRows: SheetRow[],
  allTransfers: TransferRow[],
  assets: ManualItem[],
  liabilities: ManualItem[],
  liveBrokerBalances: Partial<Record<SupportedBroker, number>>,
  accountAnchors: AccountAnchor[] = [],
  periodMonths = 12,
): NetWorthSummary {
  const balances = computeAccountBalances(allRows, allTransfers, liveBrokerBalances, accountAnchors);

  const liquidNetWorth = LIQUID_ACCOUNT_KEYS.reduce(
    (acc, key) => acc + (balances[key] ?? 0),
    0,
  );
  const brokerTotal = BROKER_KEYS.reduce((acc, key) => acc + (balances[key] ?? 0), 0);

  const totalAssets = sumValues(assets);
  const totalLiabilities = sumValues(liabilities);

  const totalNetWorth = totalAssets - totalLiabilities + brokerTotal + liquidNetWorth;

  let totalIncome = 0;
  let totalExpenses = 0;
  for (const row of allRows) {
    const amount = Number(row.amount || 0);
    if (!Number.isFinite(amount)) continue;
    if (row.expenseType === "Income") totalIncome += amount;
    else totalExpenses += amount;
  }

  const savingsRate = totalIncome > 0 ? (totalIncome - totalExpenses) / totalIncome : 0;
  const monthlyExpenses = periodMonths > 0 ? totalExpenses / periodMonths : totalExpenses;
  const runwayMonths = monthlyExpenses > 0 ? liquidNetWorth / monthlyExpenses : 0;

  return {
    totalNetWorth,
    liquidNetWorth,
    totalAssets,
    totalLiabilities,
    brokerTotal,
    totalIncome,
    totalExpenses,
    savingsRate,
    runwayMonths,
  };
}

export function computeIncomeBreakdown(allRows: SheetRow[]): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const row of allRows) {
    if (row.expenseType !== "Income") continue;
    const key = (row.description || "Income").trim() || "Income";
    map.set(key, (map.get(key) ?? 0) + Number(row.amount || 0));
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export { BASE_ACCOUNT_BALANCES };
