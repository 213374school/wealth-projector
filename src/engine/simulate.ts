import type { Scenario, Account, Transfer, SimulationResult, Period } from "../types";
import { resolvedStartDate, resolvedEndDate } from "../utils/snapDates";

function monthsBetween(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm);
}

function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function periodToMonths(p: Period): number {
  switch (p) {
    case "monthly": return 1;
    case "quarterly": return 3;
    case "half-yearly": return 6;
    case "yearly": return 12;
  }
}

function periodRate(annualRate: number, n: number): number {
  return Math.pow(1 + annualRate, n / 12) - 1;
}

export function runSimulation(scenario: Scenario): SimulationResult {
  const { accounts, transfers, timelineStart, timelineEnd } = scenario;

  // Build month array
  const totalMonths = monthsBetween(timelineStart, timelineEnd) + 1;
  const months: string[] = [];
  for (let i = 0; i < totalMonths; i++) {
    months.push(addMonths(timelineStart, i));
  }

  // Initialize balances and principals
  const balances: Record<string, (number | null)[]> = {};
  const principals: Record<string, (number | null)[]> = {};

  for (const acc of accounts) {
    balances[acc.id] = new Array(totalMonths).fill(null);
    principals[acc.id] = new Array(totalMonths).fill(null);
  }

  // Running state
  const balance: Record<string, number> = {};
  const principal: Record<string, number> = {};

  // Initialize accounts that start at or before timelineStart
  for (const acc of accounts) {
    if (acc.startDate <= timelineStart) {
      balance[acc.id] = acc.initialBalance;
      principal[acc.id] = acc.initialBalance;
    }
  }

  for (let i = 0; i < totalMonths; i++) {
    const M = months[i];

    // Initialize any accounts that start this month
    for (const acc of accounts) {
      if (acc.startDate === M && !(acc.id in balance)) {
        balance[acc.id] = acc.initialBalance;
        principal[acc.id] = acc.initialBalance;
      }
    }

    // Snapshots at start of month
    const snapshot: Record<string, number> = { ...balance };
    const principalSnapshot: Record<string, number> = { ...principal };

    // Deltas to accumulate
    const balanceDelta: Record<string, number> = {};
    const principalDelta: Record<string, number> = {};

    for (const acc of accounts) {
      if (acc.id in balance) {
        balanceDelta[acc.id] = 0;
        principalDelta[acc.id] = 0;
      }
    }

    // Apply transfers
    for (const t of transfers) {
      if (!isTransferActive(t, M, accounts)) continue;

      const srcBal = snapshot[t.sourceAccountId] ?? 0;
      const srcPrincipal = principalSnapshot[t.sourceAccountId] ?? 0;

      // Resolve amount
      let resolvedAmount: number;
      if (t.amountType === "fixed") {
        resolvedAmount = t.amount;
      } else if (t.amountType === "percent-balance") {
        resolvedAmount = Math.abs(srcBal) * t.amount;
      } else {
        // gains-only
        resolvedAmount = Math.max(0, srcBal - srcPrincipal);
      }

      // Compute tax cost
      let taxCost: number;
      if (t.taxBasis === "full") {
        taxCost = resolvedAmount * t.taxRate;
      } else {
        // gains-fraction
        let gainsRatio: number;
        if (srcBal <= 0) {
          gainsRatio = 0;
        } else {
          gainsRatio = Math.max(0, srcBal - srcPrincipal) / srcBal;
        }
        taxCost = resolvedAmount * gainsRatio * t.taxRate;
      }

      const netToTarget = resolvedAmount - taxCost;

      const isSelf = t.sourceAccountId === t.targetAccountId;

      if (isSelf && t.amountType === "gains-only") {
        // Special case: self-transfer gains-only — just deduct tax from balance, reset principal
        balanceDelta[t.sourceAccountId] = (balanceDelta[t.sourceAccountId] ?? 0) - taxCost;
        // principal will be set to balance after commit — track via special flag
        // We'll handle this after committing balance deltas by marking a "reset principal" flag
        // For now store as a special signal: set principalDelta to NaN to indicate "set to balance"
        principalDelta[t.sourceAccountId] = NaN; // sentinel: reset to balance
      } else {
        // Deduct from source
        balanceDelta[t.sourceAccountId] = (balanceDelta[t.sourceAccountId] ?? 0) - resolvedAmount;

        // Update principal on source (proportional debit)
        if (snapshot[t.sourceAccountId] !== 0) {
          const principalFraction = srcPrincipal / snapshot[t.sourceAccountId];
          const principalDebit = resolvedAmount * principalFraction;
          if (!isNaN(principalDelta[t.sourceAccountId])) {
            principalDelta[t.sourceAccountId] = (principalDelta[t.sourceAccountId] ?? 0) - principalDebit;
          }
        }

        // Credit to target
        if (t.targetAccountId in balanceDelta) {
          balanceDelta[t.targetAccountId] = (balanceDelta[t.targetAccountId] ?? 0) + netToTarget;
          if (!isNaN(principalDelta[t.targetAccountId])) {
            principalDelta[t.targetAccountId] = (principalDelta[t.targetAccountId] ?? 0) + netToTarget;
          }
        }
      }
    }

    // Apply growth (uses snapshot values)
    for (const acc of accounts) {
      if (!(acc.id in balance)) continue;
      const N = periodToMonths(acc.growthPeriod);
      const monthsFromStart = monthsBetween(acc.startDate, M);
      if (monthsFromStart >= 0 && monthsFromStart % N === 0) {
        const rate = periodRate(acc.growthRate, N);
        const delta = snapshot[acc.id] * rate;
        balanceDelta[acc.id] = (balanceDelta[acc.id] ?? 0) + delta;
        // principal is NOT updated for growth
      }
    }

    // Commit deltas
    for (const acc of accounts) {
      if (!(acc.id in balance)) continue;

      balance[acc.id] += balanceDelta[acc.id] ?? 0;

      if (isNaN(principalDelta[acc.id])) {
        // Sentinel: reset principal to new balance (gains-only self-transfer)
        principal[acc.id] = balance[acc.id];
      } else {
        principal[acc.id] += principalDelta[acc.id] ?? 0;
        // Clamp: principal cannot go below min(0, balance)
        principal[acc.id] = Math.max(principal[acc.id], Math.min(0, balance[acc.id]));
      }

      balances[acc.id][i] = balance[acc.id];
      principals[acc.id][i] = principal[acc.id];
    }
  }

  // Inflation adjustment (post-simulation, display transform only)
  if (scenario.inflationEnabled && scenario.inflationRate !== 0) {
    for (const acc of accounts) {
      for (let i = 0; i < totalMonths; i++) {
        if (balances[acc.id][i] !== null) {
          const deflator = Math.pow(1 + scenario.inflationRate, i / 12);
          balances[acc.id][i] = (balances[acc.id][i] as number) / deflator;
        }
      }
    }
  }

  return { months, balances, principals };
}

function isTransferActive(t: Transfer, M: string, accounts: Account[]): boolean {
  const startDate = resolvedStartDate(t, accounts);
  const endDate = resolvedEndDate(t, accounts);

  if (M < startDate) return false;
  if (endDate !== null && M > endDate) return false;
  if (t.isOneTime && M !== startDate) return false;

  // Check recurrence
  if (!t.isOneTime) {
    const N = periodToMonths(t.period);
    const diff = monthsBetween(startDate, M);
    if (diff % N !== 0) return false;
  }

  // Check source and target accounts have started
  const srcAcc = accounts.find(a => a.id === t.sourceAccountId);
  const tgtAcc = accounts.find(a => a.id === t.targetAccountId);
  if (!srcAcc || !tgtAcc) return false;
  if (M < srcAcc.startDate) return false;
  if (M < tgtAcc.startDate) return false;

  return true;
}
