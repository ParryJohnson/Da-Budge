/**
 * SnapTrade integration. Server-side only — these functions read env vars and
 * call the SnapTrade SDK. The SDK is imported lazily so this module can be
 * referenced for its `SupportedBroker` type from client code (type-only import).
 *
 * Env vars used:
 *   SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY,
 *   SNAPTRADE_USER_ID, SNAPTRADE_USER_SECRET
 *
 * If any credential is missing every function degrades gracefully (returns
 * empty data) so the app keeps working with computed balances only.
 */

export type SupportedBroker = "Fidelity" | "Robinhood" | "Charles Schwab";

export const SUPPORTED_BROKERS: SupportedBroker[] = ["Fidelity", "Robinhood", "Charles Schwab"];

type SnapTradeCredentials = {
  clientId: string;
  consumerKey: string;
  userId: string;
  userSecret: string;
};

function readCredentials(): SnapTradeCredentials | null {
  const clientId = process.env.SNAPTRADE_CLIENT_ID ?? "";
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY ?? "";
  const userId = process.env.SNAPTRADE_USER_ID ?? "";
  const userSecret = process.env.SNAPTRADE_USER_SECRET ?? "";
  if (!clientId || !consumerKey || !userId || !userSecret) return null;
  return { clientId, consumerKey, userId, userSecret };
}

export function isSnapTradeConfigured(): boolean {
  return readCredentials() !== null;
}

function brokerFromName(name: string): SupportedBroker | null {
  const lower = String(name ?? "").toLowerCase();
  if (lower.includes("fidelity")) return "Fidelity";
  if (lower.includes("robinhood")) return "Robinhood";
  if (lower.includes("schwab")) return "Charles Schwab";
  return null;
}

type SnapAccount = {
  id?: string;
  name?: string;
  brokerage_name?: string;
  institution_name?: string;
  balance?: { total?: { amount?: number } };
  meta?: Record<string, unknown>;
};

async function listAccounts(creds: SnapTradeCredentials): Promise<SnapAccount[]> {
  // Lazy import keeps the SDK out of any client bundle.
  const mod = await import("snaptrade-typescript-sdk");
  const Snaptrade = (mod as { Snaptrade: new (cfg: { clientId: string; consumerKey: string }) => unknown }).Snaptrade;
  const client = new Snaptrade({ clientId: creds.clientId, consumerKey: creds.consumerKey }) as {
    accountInformation: {
      listUserAccounts: (args: { userId: string; userSecret: string }) => Promise<{ data: SnapAccount[] }>;
    };
  };
  const res = await client.accountInformation.listUserAccounts({
    userId: creds.userId,
    userSecret: creds.userSecret,
  });
  return Array.isArray(res.data) ? res.data : [];
}

function accountTotal(acct: SnapAccount): number {
  const v = acct?.balance?.total?.amount;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isRothIra(acct: SnapAccount): boolean {
  const blob = `${acct.name ?? ""} ${JSON.stringify(acct.meta ?? {})}`.toLowerCase();
  return blob.includes("roth");
}

/** Returns the live balance per supported broker, summed across that broker's accounts. */
export async function fetchSnapTradeBrokerBalances(): Promise<Partial<Record<SupportedBroker, number>>> {
  const creds = readCredentials();
  if (!creds) return {};
  try {
    const accounts = await listAccounts(creds);
    const totals: Partial<Record<SupportedBroker, number>> = {};
    for (const acct of accounts) {
      const broker = brokerFromName(acct.brokerage_name ?? acct.institution_name ?? acct.name ?? "");
      if (!broker) continue;
      totals[broker] = (totals[broker] ?? 0) + accountTotal(acct);
    }
    return totals;
  } catch (err) {
    console.error("SnapTrade balance fetch failed:", err);
    return {};
  }
}

export type FidelitySplit = {
  fidelity_total: number;
  fidelity_brokerage: number;
  fidelity_roth_ira: number;
};

/** Splits Fidelity holdings into brokerage vs. Roth IRA buckets. */
export async function fetchSnapTradeInvestments(): Promise<{ brokerage: number; rothIra: number }> {
  const creds = readCredentials();
  if (!creds) return { brokerage: 0, rothIra: 0 };
  try {
    const accounts = await listAccounts(creds);
    let brokerage = 0;
    let rothIra = 0;
    for (const acct of accounts) {
      if (brokerFromName(acct.brokerage_name ?? acct.institution_name ?? acct.name ?? "") !== "Fidelity") continue;
      const total = accountTotal(acct);
      if (isRothIra(acct)) rothIra += total;
      else brokerage += total;
    }
    return { brokerage, rothIra };
  } catch (err) {
    console.error("SnapTrade investments fetch failed:", err);
    return { brokerage: 0, rothIra: 0 };
  }
}

export async function fetchFidelitySplit(): Promise<FidelitySplit> {
  const { brokerage, rothIra } = await fetchSnapTradeInvestments();
  return {
    fidelity_total: brokerage + rothIra,
    fidelity_brokerage: brokerage,
    fidelity_roth_ira: rothIra,
  };
}
