export type Period = "monthly" | "quarterly" | "half-yearly" | "yearly";

export type AmountType = "fixed" | "percent-balance" | "gains-only";

export type DateSnap = "source-start" | "target-start";

export interface Account {
  id: string;
  name: string;
  color: string;
  startDate: string; // YYYY-MM
  initialBalance: number;
  growthRate: number;
  growthPeriod: Period;
  notes?: string;
}

export interface Transfer {
  id: string;
  name: string;
  sourceAccountId: string;
  targetAccountId: string;
  startDate: string;        // YYYY-MM — used when startSnap is null
  startSnap?: DateSnap | null;
  endDate: string | null;   // YYYY-MM — used when endSnap is null
  endSnap?: DateSnap | null;
  isOneTime: boolean;
  amount: number;
  amountType: AmountType;
  period: Period;
  taxRate: number;
  taxBasis: "full" | "gains-fraction";
  notes?: string;
}

export interface Scenario {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  timelineStart: string; // YYYY-MM
  timelineEnd: string;   // YYYY-MM
  inflationRate: number;
  inflationEnabled: boolean;
  currencyLocale: string;
  currencySymbol: string;
  accounts: Account[];
  transfers: Transfer[];
}

export interface SimulationResult {
  months: string[];
  balances: Record<string, (number | null)[]>;
  principals: Record<string, (number | null)[]>;
}
