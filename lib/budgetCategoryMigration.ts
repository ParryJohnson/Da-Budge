import { LEGACY_EXPENSE_CATEGORY_ALIASES } from "./constants";

export type MonthlyBudgets = Record<string, Record<string, number>>;

export function migrateBudgetCategoryKeys(data: MonthlyBudgets): MonthlyBudgets {
  let changed = false;
  const out: MonthlyBudgets = {};
  for (const [monthKey, monthMap] of Object.entries(data)) {
    const next: Record<string, number> = { ...monthMap };
    for (const [oldName, newName] of Object.entries(LEGACY_EXPENSE_CATEGORY_ALIASES)) {
      if (oldName in next) {
        const v = next[oldName]!;
        next[newName] = (next[newName] ?? 0) + v;
        delete next[oldName];
        changed = true;
      }
    }
    out[monthKey] = next;
  }
  return changed ? out : data;
}
