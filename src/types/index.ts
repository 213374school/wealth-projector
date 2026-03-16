export type Period = "monthly" | "quarterly" | "half-yearly" | "yearly";

export type AmountType = "fixed" | "percent-balance" | "gains-only";

export interface Account {
  id: string;
  name: string;
  color: string;
  initialBalance: number;
  initialPrincipalRatio: number; // 0–1, fraction of initialBalance that is principal (rest is unrealised gain)
  growthRate: number;
  growthPeriod: Period;
  notes?: string;
}

export interface Transfer {
  id: string;
  name: string;
  sourceAccountId: string | null;
  targetAccountId: string | null;
  startDate: string | null; // YYYY-MM, null = simulation start
  endDate: string | null;   // YYYY-MM, null = simulation end
  isOneTime: boolean;
  amount: number;
  amountType: AmountType;
  period: Period;
  taxRate: number;
  taxBasis: "full" | "gains-fraction";
  inflationHedged?: boolean;   // undefined treated as true (backward compat)
  notes?: string;
}

export type EdgeId = "start" | "end";

export interface ItemEdge { itemId: string; edge: EdgeId; }

export interface TimeAnchor {
  id: string;
  date: string;       // YYYY-MM — shared date for all connected edges
  edges: ItemEdge[];  // length >= 1 for user anchors; fixed anchors may have fewer
  fixed?: boolean;    // true for the two permanent timeline-start/end anchors
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
  anchors?: TimeAnchor[];
}

export interface SimulationResult {
  months: string[];
  balances: Record<string, (number | null)[]>;
  principals: Record<string, (number | null)[]>;
}
