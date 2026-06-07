# Da Budge

A Next.js 14 personal finance PWA: budget dashboard, net worth tracking, bank-statement
reconciliation, an investment life-stage planner, and quick expense entry — backed by
Google Sheets (transactions), Neon Postgres (budgets, reconciliation state, manual
assets/liabilities), and optionally SnapTrade (live brokerage balances).

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run generate-icons       # creates public/icons/*.png from favicon.svg
npm run dev
```

Open http://localhost:3000.

## Required setup (one-time)

1. **Google Sheet** — Two tabs, `Expenses` and `Transfers`.
   - `Expenses` headers: `Timestamp | Expense Type | Amount | Description | Month | Row ID`
   - `Transfers` headers: `Timestamp | Transfer from | Transfer To | Transfer Amount | Month | Transfer Row ID`
2. **Apps Script** — In the sheet: Extensions → Apps Script. Paste
   [docs/google-apps-script-sample.js](docs/google-apps-script-sample.js), replace
   `YOUR_SPREADSHEET_ID_HERE`, then Deploy → New deployment → Web app → Execute as **Me**,
   access **Anyone**. Copy the `/exec` URL into `NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL`.
3. **Neon Postgres** — Create a project, copy the pooled connection string into
   `DATABASE_URL`, then run [docs/neon-budget-setup.sql](docs/neon-budget-setup.sql) and
   [docs/neon-manual-assets-liabilities.sql](docs/neon-manual-assets-liabilities.sql) in the
   Neon SQL editor. (The app also self-migrates these tables on first use.)
4. **SnapTrade (optional)** — Fill the four `SNAPTRADE_*` vars for live brokerage balances.
   Leave blank to fall back to balances computed from your Sheets transactions.

## Environment variables

See [.env.example](.env.example). `.env.local` is gitignored — never commit it.

## Customization

These are tuned to the original author's accounts; update for your own:

- `contexts/MonthContext.tsx` — the hardcoded `2026` year.
- `services/accountBalancesService.ts` — `BASE_ACCOUNT_BALANCES` and
  `TRANSFER_LABEL_TO_BALANCE_KEY`. Set bases to `0` and use **Account Anchors** (Reconcile
  page) to seed current balances.
- `lib/reconcileClient.ts` — `BANK_PROFILES` column indices to match your bank CSV exports.
- `lib/constants.ts` — `EXPENSE_CATEGORIES`.

## Pages

| Route | What it does |
|-------|--------------|
| `/` | Budget dashboard: pie + cumulative charts, category progress, income/transfers, account balances |
| `/new-expense` | Add a transaction to the Sheet |
| `/net-worth` | Manual assets/liabilities CRUD, income breakdown, investments, history |
| `/reconcile` | Upload bank CSVs, match against the Sheet, claim/dismiss, anchors, activity log + undo |
| `/investment-calculator` | Client-side life-stage compound-interest planner |

## Deploy

Push to GitHub, import in Vercel, add all `.env.local` values under Settings → Environment
Variables. Vercel auto-detects Next.js.
