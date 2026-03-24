import type { Account, Scenario, TimeAnchor, Transfer } from "../types";

export const ACCOUNT_COLORS = [
  "#4f46e5", "#0891b2", "#059669", "#d97706",
  "#dc2626", "#7c3aed", "#db2777", "#0284c7",
];

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

export function makeDefaultScenario(): Scenario {
  const now = currentMonth();
  const year = new Date().getFullYear();
  const start = `${year}-01`;
  const midEnd = `${year + 24}-12`;
  const midStart = `${year + 25}-01`;
  const end = `${year + 49}-12`;
  const startAnchorDate = `${year - 1}-12`;

  const cashId = generateId();
  const investmentsId = generateId();
  const salaryId = generateId();
  const saveToInvestmentsId = generateId();
  const drawFromInvestmentsId = generateId();
  const midAnchorId = generateId();

  const accounts: Account[] = [
    {
      id: cashId,
      name: "Cash",
      color: "#059669",
      initialBalance: 150000,
      initialPrincipalRatio: 1,
      growthRate: 0.01,
      growthPeriod: "yearly",
    },
    {
      id: investmentsId,
      name: "Investments",
      color: "#0891b2",
      initialBalance: 100000,
      initialPrincipalRatio: 1,
      growthRate: 0.07,
      growthPeriod: "yearly",
    },
  ];

  const transfers: Transfer[] = [
    {
      id: salaryId,
      name: "Salary",
      sourceAccountId: null,
      targetAccountId: cashId,
      startDate: null,
      endDate: midEnd,
      isOneTime: false,
      amount: 10000,
      amountType: "fixed",
      period: "monthly",
      taxRate: 0.25,
      taxBasis: "full",
      inflationAdjusted: true,
    },
    {
      id: generateId(),
      name: "Expenses",
      sourceAccountId: cashId,
      targetAccountId: null,
      startDate: null,
      endDate: null,
      isOneTime: false,
      amount: 6000,
      amountType: "fixed",
      period: "monthly",
      taxRate: 0,
      taxBasis: "full",
      inflationAdjusted: true,
    },
    {
      id: saveToInvestmentsId,
      name: "Save to Investments",
      sourceAccountId: cashId,
      targetAccountId: investmentsId,
      startDate: null,
      endDate: midEnd,
      isOneTime: false,
      amount: 2400,
      amountType: "fixed",
      period: "monthly",
      taxRate: 0,
      taxBasis: "full",
      inflationAdjusted: false,
    },
    {
      id: drawFromInvestmentsId,
      name: "Draw from Investments",
      sourceAccountId: investmentsId,
      targetAccountId: cashId,
      startDate: midStart,
      endDate: null,
      isOneTime: false,
      amount: 8500,
      amountType: "fixed",
      period: "monthly",
      taxRate: 0.2,
      taxBasis: "full",
      inflationAdjusted: true,
    },
  ];

  const anchors: TimeAnchor[] = [
    { id: "__start__", date: startAnchorDate, edges: [], fixed: true },
    { id: "__end__", date: end, edges: [], fixed: true },
    {
      id: midAnchorId,
      date: midEnd,
      edges: [
        { itemId: salaryId, edge: "end" },
        { itemId: saveToInvestmentsId, edge: "end" },
        { itemId: drawFromInvestmentsId, edge: "start" },
      ],
    },
  ];

  return {
    id: generateId(),
    name: "My Wealth Plan",
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    timelineStart: start,
    timelineEnd: end,
    inflationRate: 0.02,
    inflationEnabled: true,
    currencyLocale: "en-US",
    currencySymbol: "$",
    currencySymbolPosition: "before",
    accounts,
    transfers,
    anchors,
  };
}
