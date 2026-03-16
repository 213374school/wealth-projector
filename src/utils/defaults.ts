import type { Account, Transfer, Scenario } from "../types";

export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (HTTP)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const ACCOUNT_COLORS = [
  "#4f46e5", "#0891b2", "#059669", "#d97706",
  "#dc2626", "#7c3aed", "#db2777", "#0284c7",
];

let colorIndex = 0;
export function nextColor(): string {
  return ACCOUNT_COLORS[colorIndex++ % ACCOUNT_COLORS.length];
}

export function makeDefaultAccount(existingCount: number = 0): Account {
  return {
    id: generateId(),
    name: `Account ${existingCount + 1}`,
    color: ACCOUNT_COLORS[existingCount % ACCOUNT_COLORS.length],
    initialBalance: 0,
    initialPrincipalRatio: 1,
    growthRate: 0.04,
    growthPeriod: "yearly",
  };
}

export function makeDefaultTransfer(sourceId: string | null, targetId: string | null): Transfer {
  return {
    id: generateId(),
    name: "New Transfer",
    sourceAccountId: sourceId,
    targetAccountId: targetId,
    startDate: currentMonth(),
    endDate: null,
    isOneTime: false,
    amount: 1000,
    amountType: "fixed",
    period: "monthly",
    taxRate: 0,
    taxBasis: "full",
    inflationHedged: false,
  };
}

export function makeDefaultScenario(): Scenario {
  const now = currentMonth();
  const start = `${new Date().getFullYear()}-01`;
  return {
    id: generateId(),
    name: "My FIRE Plan",
    createdAt: now,
    updatedAt: now,
    timelineStart: start,
    timelineEnd: "2100-12",
    inflationRate: 0.02,
    inflationEnabled: false,
    currencyLocale: "en-US",
    currencySymbol: "$",
    accounts: [],
    transfers: [],
  };
}
