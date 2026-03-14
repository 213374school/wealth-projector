export type Period = "monthly" | "quarterly" | "half-yearly" | "yearly";

export type AmountType = "fixed" | "percent-balance" | "gains-only";

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
  sourceAccountId: string | null;
  targetAccountId: string | null;
  startDate: string;        // YYYY-MM
  endDate: string | null;   // YYYY-MM
  isOneTime: boolean;
  amount: number;
  amountType: AmountType;
  period: Period;
  taxRate: number;
  taxBasis: "full" | "gains-fraction";
  notes?: string;
}

export type EdgeId = "start" | "end";

export interface ItemEdge { itemId: string; edge: EdgeId; }

export interface TimeAnchor {
  id: string;
  date: string;       // YYYY-MM — shared date for all connected edges
  edges: ItemEdge[];  // length >= 2 for user anchors; fixed anchors may have fewer
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
