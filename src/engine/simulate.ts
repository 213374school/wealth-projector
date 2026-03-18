import type { Scenario, Account, Transfer, SimulationResult, Period } from "../types";

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

function applyTransfer(
  t: Transfer,
  balance: Record<string, number>,
  principal: Record<string, number>,
  monthIndex: number,
  scenario: Scenario
): void {
  const src = t.sourceAccountId;
  const tgt = t.targetAccountId;

  const srcBal = src ? (balance[src] ?? 0) : 0;
  const srcPrincipal = src ? (principal[src] ?? 0) : 0;

  // Resolve amount
  let resolvedAmount: number;
  if (t.amountType === "fixed") {
    resolvedAmount = t.amount;
    if (
      scenario.inflationEnabled &&
      scenario.inflationRate !== 0 &&
      (t.inflationAdjusted ?? false) === true
    ) {
      resolvedAmount = t.amount * Math.pow(1 + scenario.inflationRate, monthIndex / 12);
    }
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

  if (src !== null && src === tgt && t.amountType === "gains-only") {
    // Self-rebalance: pay tax, reset principal to new balance
    balance[src] -= taxCost;
    principal[src] = balance[src];
  } else {
    if (src !== null) {
      balance[src] -= resolvedAmount;
      if (srcBal !== 0) {
        const fraction = srcPrincipal / srcBal;
        principal[src] -= resolvedAmount * fraction;
      }
    }
    if (tgt !== null && tgt in balance) {
      balance[tgt] += netToTarget;
      principal[tgt] += netToTarget;
    }
  }
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

  // All accounts are active from timelineStart
  for (const acc of accounts) {
    balance[acc.id] = acc.initialBalance;
    principal[acc.id] = acc.initialBalance * (acc.initialPrincipalRatio ?? 1);
  }

  for (let i = 0; i < totalMonths; i++) {
    const M = months[i];

    // Phase 1: External income (null-source transfers, in scenario.transfers order)
    for (const t of transfers) {
      if (t.sourceAccountId !== null) continue;
      if (!isTransferActive(t, M, accounts, timelineStart)) continue;
      applyTransfer(t, balance, principal, i, scenario);
    }

    // Phase 2: Per-account in scenario.accounts order
    for (const acc of accounts) {
      if (!(acc.id in balance)) continue;

      // a. Apply growth to current balance (post-Phase-1)
      const N = periodToMonths(acc.growthPeriod);
      const monthsFromStart = monthsBetween(timelineStart, M);
      if (monthsFromStart >= 0 && monthsFromStart % N === 0) {
        const rate = periodRate(acc.growthRate, N);
        balance[acc.id] += balance[acc.id] * rate;
        // principal is NOT updated for growth
      }

      // b. Apply all active outgoing transfers from this account
      for (const t of transfers) {
        if (t.sourceAccountId !== acc.id) continue;
        if (!isTransferActive(t, M, accounts, timelineStart)) continue;
        applyTransfer(t, balance, principal, i, scenario);
      }
    }

    // Phase 3: End-of-month bookkeeping
    for (const acc of accounts) {
      if (!(acc.id in balance)) continue;
      // Clamp: principal cannot go below min(0, balance)
      principal[acc.id] = Math.max(principal[acc.id], Math.min(0, balance[acc.id]));
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

function isTransferActive(t: Transfer, M: string, accounts: Account[], timelineStart: string): boolean {
  const effectiveStart = t.startDate ?? timelineStart;
  const endDate = t.endDate;

  if (M < effectiveStart) return false;
  if (endDate !== null && M > endDate) return false;
  if (t.isOneTime && M !== effectiveStart) return false;

  // Check recurrence
  if (!t.isOneTime) {
    const N = periodToMonths(t.period);
    const diff = monthsBetween(effectiveStart, M);
    if (diff % N !== 0) return false;
  }

  // Check source and target accounts exist (null = external, always valid)
  if (t.sourceAccountId && !accounts.find(a => a.id === t.sourceAccountId)) return false;
  if (t.targetAccountId && !accounts.find(a => a.id === t.targetAccountId)) return false;

  return true;
}
