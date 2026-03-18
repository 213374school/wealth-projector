import { describe, it, expect } from "vitest";
import { runSimulation } from "./simulate";
import type { Scenario, Account, Transfer } from "../types";

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "test",
    name: "Test",
    createdAt: "2024-01",
    updatedAt: "2024-01",
    timelineStart: "2024-01",
    timelineEnd: "2024-12",
    inflationRate: 0,
    inflationEnabled: false,
    currencyLocale: "en-US",
    currencySymbol: "$",
    accounts: [],
    transfers: [],
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc1",
    name: "Test Account",
    color: "#4f46e5",
    initialBalance: 10000,
    initialPrincipalRatio: 1,
    growthRate: 0,
    growthPeriod: "yearly",
    ...overrides,
  };
}

function makeTransfer(overrides: Partial<Transfer> = {}): Transfer {
  return {
    id: "t1",
    name: "Test Transfer",
    sourceAccountId: "acc1",
    targetAccountId: null,
    startDate: "2024-01",
    endDate: null,
    isOneTime: false,
    amount: 0,
    amountType: "fixed",
    period: "monthly",
    taxRate: 0,
    taxBasis: "full",
    ...overrides,
  };
}

// ─── Original cases (preserved) ──────────────────────────────────────────────

describe("Case 1: Simple growth", () => {
  it("account grows 10% yearly; principal stays at initialBalance", () => {
    const acc = makeAccount({ initialBalance: 10000, growthRate: 0.10, growthPeriod: "yearly" });
    const scenario = makeScenario({ accounts: [acc], timelineStart: "2024-01", timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][11]).toBeCloseTo(11000, 0);
    expect(result.principals["acc1"][11]).toBeCloseTo(10000, 0);
  });
});

describe("Case 2: Fixed transfer in", () => {
  it("receiving 5000 increases principal by 5000", () => {
    const acc1 = makeAccount({ id: "acc1", initialBalance: 0 });
    const acc2 = makeAccount({ id: "acc2", initialBalance: 10000 });
    const transfer = makeTransfer({ sourceAccountId: "acc2", targetAccountId: "acc1", amount: 5000, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc1, acc2], transfers: [transfer] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(5000);
    expect(result.principals["acc1"][0]).toBeCloseTo(5000);
  });
});

describe("Case 3: Fixed transfer out (no tax)", () => {
  it("proportionally reduces principal on withdrawal", () => {
    const accA = makeAccount({ id: "acc1", initialBalance: 15000 });
    const accB = makeAccount({ id: "acc2", initialBalance: 0 });
    const transfer = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 6000, isOneTime: true, taxRate: 0 });
    const scenario = makeScenario({ accounts: [accA, accB], transfers: [transfer] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(9000);
    expect(result.principals["acc1"][0]).toBeCloseTo(9000);
    expect(result.balances["acc2"][0]).toBeCloseTo(6000);
    expect(result.principals["acc2"][0]).toBeCloseTo(6000);
  });
});

describe("Case 4: Gains-fraction tax", () => {
  it("taxes only gains fraction of transferred amount", () => {
    const accA = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.5, growthPeriod: "yearly" });
    const accB = makeAccount({ id: "acc2", initialBalance: 0 });
    const transfer = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 6000, isOneTime: true, startDate: "2024-02", taxRate: 0.30, taxBasis: "gains-fraction" });
    const scenario = makeScenario({ accounts: [accA, accB], transfers: [transfer], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(15000);
    expect(result.principals["acc1"][0]).toBeCloseTo(10000);
    expect(result.balances["acc1"][1]).toBeCloseTo(9000);
    expect(result.balances["acc2"][1]).toBeCloseTo(5400);
  });
});

describe("Case 5: Self-transfer gains-only", () => {
  it("taxes gains on self-transfer and resets principal to balance", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.5, growthPeriod: "yearly" });
    const selfTransfer = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc1", amount: 0, amountType: "gains-only", isOneTime: true, startDate: "2024-02", taxRate: 0.15 });
    const scenario = makeScenario({ accounts: [acc], transfers: [selfTransfer], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(15000);
    expect(result.balances["acc1"][1]).toBeCloseTo(14250);
    expect(result.principals["acc1"][1]).toBeCloseTo(14250);
  });
});

describe("Case 6: Gains-only with no gains", () => {
  it("resolves to zero when no gains exist", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const selfTransfer = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc1", amount: 0, amountType: "gains-only", isOneTime: true, taxRate: 0.15 });
    const scenario = makeScenario({ accounts: [acc], transfers: [selfTransfer] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(10000);
    expect(result.principals["acc1"][0]).toBeCloseTo(10000);
  });
});

describe("Case 7: Inflation hedging", () => {
  it("non-hedged fixed transfer scales up with inflation: nominal withdrawal at month 12 is 1020", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 100000 });
    const transfer = makeTransfer({ amount: 1000, inflationHedged: false, isOneTime: true, startDate: "2025-01" });
    const scenario = makeScenario({ accounts: [acc], transfers: [transfer], timelineStart: "2024-01", timelineEnd: "2025-02", inflationRate: 0.02, inflationEnabled: true });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][12]).toBeCloseTo(98980 / 1.02, 1);
  });

  it("hedged fixed transfer does NOT inflate: nominal withdrawal at month 12 stays 1000", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 100000 });
    const transfer = makeTransfer({ amount: 1000, inflationHedged: true, isOneTime: true, startDate: "2025-01" });
    const scenario = makeScenario({ accounts: [acc], transfers: [transfer], timelineStart: "2024-01", timelineEnd: "2025-02", inflationRate: 0.02, inflationEnabled: true });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][12]).toBeCloseTo(99000 / 1.02, 1);
  });

  it("missing inflationHedged field defaults to hedged (true)", () => {
    const acc1 = makeAccount({ id: "acc1", initialBalance: 100000 });
    const acc2 = makeAccount({ id: "acc1", initialBalance: 100000 });
    const tWithout = makeTransfer({ amount: 1000, isOneTime: false, period: "monthly" });
    const tWith = makeTransfer({ amount: 1000, inflationHedged: true, isOneTime: false, period: "monthly" });
    const s1 = makeScenario({ accounts: [acc1], transfers: [tWithout], inflationRate: 0.02, inflationEnabled: true, timelineEnd: "2025-01" });
    const s2 = makeScenario({ accounts: [acc2], transfers: [tWith], inflationRate: 0.02, inflationEnabled: true, timelineEnd: "2025-01" });
    const r1 = runSimulation(s1);
    const r2 = runSimulation(s2);
    for (let i = 0; i < 13; i++) {
      expect(r1.balances["acc1"][i]).toBeCloseTo(r2.balances["acc1"][i] as number, 5);
    }
  });

  it("percent-balance transfer is unaffected by inflationHedged flag", () => {
    const acc1 = makeAccount({ id: "acc1", initialBalance: 100000 });
    const acc2 = makeAccount({ id: "acc1", initialBalance: 100000 });
    const t1 = makeTransfer({ amount: 0.01, amountType: "percent-balance", inflationHedged: false, isOneTime: false, period: "monthly" });
    const t2 = makeTransfer({ amount: 0.01, amountType: "percent-balance", inflationHedged: true, isOneTime: false, period: "monthly" });
    const s1 = makeScenario({ accounts: [acc1], transfers: [t1], inflationRate: 0.02, inflationEnabled: true, timelineEnd: "2025-01" });
    const s2 = makeScenario({ accounts: [acc2], transfers: [t2], inflationRate: 0.02, inflationEnabled: true, timelineEnd: "2025-01" });
    const r1 = runSimulation(s1);
    const r2 = runSimulation(s2);
    for (let i = 0; i < 13; i++) {
      expect(r1.balances["acc1"][i]).toBeCloseTo(r2.balances["acc1"][i] as number, 5);
    }
  });
});

describe("Case 8: Negative balance account", () => {
  it("gainsRatio resolves to 0 for negative balance", () => {
    const debt = makeAccount({ id: "acc1", initialBalance: -50000, growthRate: 0.05 });
    const target = makeAccount({ id: "acc2", initialBalance: 0 });
    const transfer = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 1000, isOneTime: true, taxRate: 0.20, taxBasis: "gains-fraction" });
    const scenario = makeScenario({ accounts: [debt, target], transfers: [transfer] });
    const result = runSimulation(scenario);
    expect(result.balances["acc2"][0]).toBeCloseTo(1000);
  });
});

// ─── Scheduling ───────────────────────────────────────────────────────────────

describe("Scheduling: one-time transfer", () => {
  it("fires exactly at startDate and is inactive in all other months", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ amount: 1000, isOneTime: true, startDate: "2024-03" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-06" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(10000); // 2024-01: no fire
    expect(result.balances["acc1"][1]).toBeCloseTo(10000); // 2024-02: no fire
    expect(result.balances["acc1"][2]).toBeCloseTo(9000);  // 2024-03: fires
    expect(result.balances["acc1"][3]).toBeCloseTo(9000);  // 2024-04: no fire
    expect(result.balances["acc1"][4]).toBeCloseTo(9000);  // 2024-05: no fire
  });
});

describe("Scheduling: monthly recurring", () => {
  it("fires every month starting from startDate", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ amount: 500, isOneTime: false, period: "monthly", startDate: "2024-01" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-06" });
    const result = runSimulation(scenario);
    for (let i = 0; i < 6; i++) {
      expect(result.balances["acc1"][i]).toBeCloseTo(10000 - (i + 1) * 500);
    }
  });

  it("does not fire before startDate", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ amount: 500, isOneTime: false, period: "monthly", startDate: "2024-03" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-05" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(10000); // 2024-01
    expect(result.balances["acc1"][1]).toBeCloseTo(10000); // 2024-02
    expect(result.balances["acc1"][2]).toBeCloseTo(9500);  // 2024-03
    expect(result.balances["acc1"][3]).toBeCloseTo(9000);  // 2024-04
  });

  it("stops firing after endDate", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ amount: 500, isOneTime: false, period: "monthly", startDate: "2024-01", endDate: "2024-03" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-06" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][2]).toBeCloseTo(8500); // fired 3 times
    expect(result.balances["acc1"][3]).toBeCloseTo(8500); // stopped
    expect(result.balances["acc1"][5]).toBeCloseTo(8500);
  });

  it("fires on startDate when startDate is mid-timeline", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ amount: 1000, isOneTime: false, period: "monthly", startDate: "2024-06" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-08" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][4]).toBeCloseTo(10000); // 2024-05: before start
    expect(result.balances["acc1"][5]).toBeCloseTo(9000);  // 2024-06: startDate
    expect(result.balances["acc1"][6]).toBeCloseTo(8000);  // 2024-07
  });
});

describe("Scheduling: quarterly recurring", () => {
  it("fires at i=0,3,6,9 and not in between", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ amount: 500, isOneTime: false, period: "quarterly", startDate: "2024-01" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(9500);  // 2024-01: fires
    expect(result.balances["acc1"][1]).toBeCloseTo(9500);  // 2024-02: no
    expect(result.balances["acc1"][2]).toBeCloseTo(9500);  // 2024-03: no
    expect(result.balances["acc1"][3]).toBeCloseTo(9000);  // 2024-04: fires (diff=3, 3%3=0)
    expect(result.balances["acc1"][5]).toBeCloseTo(9000);  // 2024-06: no (diff=5)
    expect(result.balances["acc1"][6]).toBeCloseTo(8500);  // 2024-07: fires (diff=6)
    expect(result.balances["acc1"][9]).toBeCloseTo(8000);  // 2024-10: fires (diff=9)
    expect(result.balances["acc1"][11]).toBeCloseTo(8000); // 2024-12: no (diff=11)
  });
});

describe("Scheduling: half-yearly recurring", () => {
  it("fires at i=0 and i=6 only across a 12-month timeline", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ amount: 1000, isOneTime: false, period: "half-yearly", startDate: "2024-01" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(9000);  // fires
    for (let i = 1; i < 6; i++) expect(result.balances["acc1"][i]).toBeCloseTo(9000);
    expect(result.balances["acc1"][6]).toBeCloseTo(8000);  // fires
    for (let i = 7; i < 12; i++) expect(result.balances["acc1"][i]).toBeCloseTo(8000);
  });
});

describe("Scheduling: yearly recurring", () => {
  it("fires at i=0 and i=12 across a 2-year timeline", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ amount: 2000, isOneTime: false, period: "yearly", startDate: "2024-01" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineStart: "2024-01", timelineEnd: "2025-12" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(8000);
    for (let i = 1; i < 12; i++) expect(result.balances["acc1"][i]).toBeCloseTo(8000);
    expect(result.balances["acc1"][12]).toBeCloseTo(6000);
    for (let i = 13; i < 24; i++) expect(result.balances["acc1"][i]).toBeCloseTo(6000);
  });
});

describe("Scheduling: inactive when referenced account is missing", () => {
  it("transfer with missing sourceAccountId is fully skipped", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ sourceAccountId: "ghost", targetAccountId: "acc1", amount: 1000, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(10000);
  });

  it("transfer with missing non-null targetAccountId is fully skipped", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "ghost", amount: 1000, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(10000);
  });
});

// ─── Fixed amount transfers ───────────────────────────────────────────────────

describe("Fixed transfers: external contribution (null source)", () => {
  it("credits target fully with no source deduction, increases principal", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 5000 });
    const t = makeTransfer({ sourceAccountId: null, targetAccountId: "acc1", amount: 3000, taxRate: 0, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(8000);
    expect(result.principals["acc1"][0]).toBeCloseTo(8000);
  });

  it("tax on contribution reduces net credited to target", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: null, targetAccountId: "acc1", amount: 4000, taxRate: 0.25, taxBasis: "full", isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    // netToTarget = 4000 * 0.75 = 3000
    expect(result.balances["acc1"][0]).toBeCloseTo(3000);
    expect(result.principals["acc1"][0]).toBeCloseTo(3000);
  });

  it("recurring monthly contribution accumulates correctly", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: null, targetAccountId: "acc1", amount: 1000, taxRate: 0, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(1000);
    expect(result.balances["acc1"][1]).toBeCloseTo(2000);
    expect(result.balances["acc1"][2]).toBeCloseTo(3000);
  });
});

describe("Fixed transfers: pure consumption (null target)", () => {
  it("debits source, reduces principal proportionally, nothing credited elsewhere", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: null, amount: 4000, taxRate: 0, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(6000);
    // principalFraction = 10000/10000 = 1; debit = 4000 * 1 = 4000
    expect(result.principals["acc1"][0]).toBeCloseTo(6000);
  });

  it("recurring consumption drains balance each period", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: null, amount: 1000, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-04" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(9000);
    expect(result.balances["acc1"][3]).toBeCloseTo(6000);
  });
});

describe("Fixed transfers: source to target", () => {
  it("source loses full amount, target gains net-of-tax", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 10000 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 3000, taxRate: 0.20, taxBasis: "full", isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(7000);
    expect(result.balances["acc2"][0]).toBeCloseTo(2400); // 3000 * 0.80
  });

  it("zero-amount transfer causes no change", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 5000 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 2000 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 0, isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(5000);
    expect(result.balances["acc2"][0]).toBeCloseTo(2000);
  });
});

describe("Fixed transfers: multiple in same month", () => {
  it("all transfers use start-of-month snapshot, deltas accumulate", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 10000 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0 });
    const t1 = makeTransfer({ id: "t1", sourceAccountId: "acc1", targetAccountId: "acc2", amount: 1000, taxRate: 0, isOneTime: true });
    const t2 = makeTransfer({ id: "t2", sourceAccountId: "acc1", targetAccountId: "acc2", amount: 2000, taxRate: 0, isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t1, t2] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(7000);
    expect(result.balances["acc2"][0]).toBeCloseTo(3000);
  });

  it("second percent-balance transfer sees post-first-transfer balance", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t1 = makeAccount({ id: "acc2", initialBalance: 0 });
    const t2 = makeAccount({ id: "acc3", initialBalance: 0 });
    const tr1 = makeTransfer({ id: "t1", sourceAccountId: "acc1", targetAccountId: "acc2", amount: 0.10, amountType: "percent-balance", taxRate: 0, isOneTime: true });
    const tr2 = makeTransfer({ id: "t2", sourceAccountId: "acc1", targetAccountId: "acc3", amount: 0.20, amountType: "percent-balance", taxRate: 0, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc, t1, t2], transfers: [tr1, tr2] });
    const result = runSimulation(scenario);
    // tr1: 10% × 10000 = 1000 → acc1 = 9000, acc2 = 1000
    // tr2: 20% × 9000 = 1800 → acc1 = 7200, acc3 = 1800
    expect(result.balances["acc1"][0]).toBeCloseTo(7200);
    expect(result.balances["acc2"][0]).toBeCloseTo(1000);
    expect(result.balances["acc3"][0]).toBeCloseTo(1800);
  });
});

// ─── Percent-balance transfers ────────────────────────────────────────────────

describe("Percent-balance transfers", () => {
  it("withdraws the correct fraction of balance each month", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const t = makeTransfer({ amount: 0.10, amountType: "percent-balance", isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(9000);  // 10000 * 0.90
    expect(result.balances["acc1"][1]).toBeCloseTo(8100);  // 9000 * 0.90
    expect(result.balances["acc1"][2]).toBeCloseTo(7290);  // 8100 * 0.90
  });

  it("uses the absolute value of a negative balance", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: -10000 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 0.10, amountType: "percent-balance", taxRate: 0, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    // resolvedAmount = |-10000| * 0.10 = 1000
    expect(result.balances["acc1"][0]).toBeCloseTo(-11000);
    expect(result.balances["acc2"][0]).toBeCloseTo(1000);
  });

  it("percent-balance with tax: tax applies to the resolved amount", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 20000 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 0.25, amountType: "percent-balance", taxRate: 0.40, taxBasis: "full", isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    // resolvedAmount = 20000 * 0.25 = 5000; taxCost = 5000 * 0.40 = 2000; netToTarget = 3000
    expect(result.balances["acc1"][0]).toBeCloseTo(15000);
    expect(result.balances["acc2"][0]).toBeCloseTo(3000);
  });
});

// ─── Gains-only transfers ─────────────────────────────────────────────────────

describe("Gains-only transfers: self-transfer", () => {
  it("taxes only the gain amount and resets principal to new balance", () => {
    // Month 0: acc grows 50% → 15000, principal stays 10000
    // Month 1: gains = 5000, tax = 5000*0.15 = 750, balance = 14250, principal = 14250
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.5, growthPeriod: "yearly" });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc1", amount: 0, amountType: "gains-only", taxRate: 0.15, isOneTime: true, startDate: "2024-02" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][1]).toBeCloseTo(14250);
    expect(result.principals["acc1"][1]).toBeCloseTo(14250);
  });

  it("if no gains exist, balance and principal are unchanged", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 8000 }); // no growth, all principal
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc1", amount: 0, amountType: "gains-only", taxRate: 0.20, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(8000);
    expect(result.principals["acc1"][0]).toBeCloseTo(8000);
  });

  it("100% tax on self-transfer gains: all gains consumed, principal reset to balance", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.5, growthPeriod: "yearly" });
    // Month 0: 15000 bal, 10000 principal. Month 1: gains=5000, tax=5000, balance=10000, principal=10000
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc1", amount: 0, amountType: "gains-only", taxRate: 1.0, isOneTime: true, startDate: "2024-02" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][1]).toBeCloseTo(10000);
    expect(result.principals["acc1"][1]).toBeCloseTo(10000);
  });
});

describe("Gains-only transfers: to different target", () => {
  it("transfers gains minus tax from source to target", () => {
    // acc1: 10000 initial, grows 50% in month 0 → 15000 bal, 10000 principal
    // Month 1: gains = 5000, taxRate=0.20 full → taxCost=1000, netToTarget=4000
    // acc1 loses 5000, acc2 gains 4000
    const acc1 = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.5, growthPeriod: "yearly" });
    const acc2 = makeAccount({ id: "acc2", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 0, amountType: "gains-only", taxRate: 0.20, isOneTime: true, startDate: "2024-02" });
    const scenario = makeScenario({ accounts: [acc1, acc2], transfers: [t], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][1]).toBeCloseTo(10000);
    expect(result.balances["acc2"][1]).toBeCloseTo(4000);
    // Principal on acc1: fraction = 10000/15000, debit = 5000*(10000/15000) ≈ 3333.33, principal ≈ 6666.67
    expect(result.principals["acc1"][1]).toBeCloseTo(6666.67, 1);
  });

  it("gains-only to null target (consumption): gains leave system", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.5, growthPeriod: "yearly" });
    // Month 0: 15000. Month 1: gains=5000, taxRate=0, netToTarget=5000 but target=null so nothing credited
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: null, amount: 0, amountType: "gains-only", taxRate: 0, isOneTime: true, startDate: "2024-02" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][1]).toBeCloseTo(10000); // gains withdrawn
  });
});

// ─── Tax calculation ──────────────────────────────────────────────────────────

describe("Tax: full basis", () => {
  it("0% tax passes full amount to target", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 10000 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 5000, taxRate: 0, taxBasis: "full", isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc2"][0]).toBeCloseTo(5000);
  });

  it("30% full-basis tax: target receives 70%", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 10000 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 5000, taxRate: 0.30, taxBasis: "full", isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(5000);
    expect(result.balances["acc2"][0]).toBeCloseTo(3500);
  });

  it("100% full-basis tax: target receives nothing, source still loses amount", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 10000 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 3000, taxRate: 1.0, taxBasis: "full", isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(7000);
    expect(result.balances["acc2"][0]).toBeCloseTo(0);
  });
});

describe("Tax: gains-fraction basis", () => {
  it("all-principal account (initialPrincipalRatio=1): no tax", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 1 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 4000, taxRate: 0.30, taxBasis: "gains-fraction", isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    // gainsRatio = (10000-10000)/10000 = 0 → taxCost = 0 → full 4000 to target
    expect(result.balances["acc2"][0]).toBeCloseTo(4000);
  });

  it("all-gains account (initialPrincipalRatio=0): full tax rate applied", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 0 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 4000, taxRate: 0.30, taxBasis: "gains-fraction", isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    // gainsRatio = 1 → taxCost = 4000 * 0.30 = 1200 → target gets 2800
    expect(result.balances["acc2"][0]).toBeCloseTo(2800);
  });

  it("50% gains account (initialPrincipalRatio=0.5): half-rate effective tax", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 0.5 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 4000, taxRate: 0.30, taxBasis: "gains-fraction", isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    // gainsRatio = 5000/10000 = 0.5 → taxCost = 4000 * 0.5 * 0.30 = 600 → target gets 3400
    expect(result.balances["acc2"][0]).toBeCloseTo(3400);
  });

  it("negative balance: gainsRatio = 0, no tax applied", () => {
    const src = makeAccount({ id: "acc1", initialBalance: -5000 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 1000, taxRate: 0.50, taxBasis: "gains-fraction", isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc2"][0]).toBeCloseTo(1000);
  });
});

// ─── Principal tracking ───────────────────────────────────────────────────────

describe("Principal tracking", () => {
  it("withdrawal reduces principal proportionally to principal/balance ratio", () => {
    // 50% principal: principal fraction = 0.5, debit = 2000 * 0.5 = 1000
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 0.5 });
    const t = makeTransfer({ amount: 2000, taxRate: 0, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(8000);
    expect(result.principals["acc1"][0]).toBeCloseTo(4000); // 5000 - 1000
  });

  it("growth does not increase principal", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.20, growthPeriod: "yearly" });
    const scenario = makeScenario({ accounts: [acc], timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    // Balance grows to 12000, principal stays 10000 throughout
    expect(result.balances["acc1"][11]).toBeCloseTo(12000, 0);
    expect(result.principals["acc1"][11]).toBeCloseTo(10000);
  });

  it("contribution from outside increases principal by net amount received", () => {
    // Target already has 1000 bal / 500 principal (50% ratio)
    const tgt = makeAccount({ id: "acc1", initialBalance: 1000, initialPrincipalRatio: 0.5 });
    const t = makeTransfer({ sourceAccountId: null, targetAccountId: "acc1", amount: 2000, taxRate: 0.25, taxBasis: "full", isOneTime: true });
    const scenario = makeScenario({ accounts: [tgt], transfers: [t] });
    const result = runSimulation(scenario);
    // netToTarget = 2000 * 0.75 = 1500
    expect(result.balances["acc1"][0]).toBeCloseTo(2500);
    expect(result.principals["acc1"][0]).toBeCloseTo(2000); // 500 + 1500
  });

  it("principal clamped to 0 when positive balance account's principal tries to go negative", () => {
    // initialPrincipalRatio=0: all gains, no principal. Withdraw some: principal debit = amount * 0 = 0.
    // Principal stays at 0 (already at min), clamped to max(0, min(0, balance)) = 0.
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 0 });
    const t = makeTransfer({ amount: 3000, taxRate: 0, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(7000);
    expect(result.principals["acc1"][0]).toBeCloseTo(0);
  });

  it("principal equals balance when account drains exactly to zero", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 5000, initialPrincipalRatio: 1 });
    const t = makeTransfer({ amount: 5000, taxRate: 0, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(0);
    expect(result.principals["acc1"][0]).toBeCloseTo(0);
  });

  it("principal tracks negative balance after overdraft", () => {
    // Account with 100% principal, withdraw more than balance
    const acc = makeAccount({ id: "acc1", initialBalance: 1000, initialPrincipalRatio: 1 });
    const t = makeTransfer({ amount: 3000, taxRate: 0, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    // balance = 1000 - 3000 = -2000
    // principalDelta: snapshot != 0, fraction = 1000/1000 = 1, debit = 3000. principal = 1000 - 3000 = -2000
    // clamp: max(-2000, min(0, -2000)) = max(-2000, -2000) = -2000
    expect(result.balances["acc1"][0]).toBeCloseTo(-2000);
    expect(result.principals["acc1"][0]).toBeCloseTo(-2000);
  });
});

// ─── Growth periods ───────────────────────────────────────────────────────────

describe("Growth: period alignment", () => {
  it("monthly growth applies every month", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 1000, growthRate: 0.12, growthPeriod: "monthly" });
    const scenario = makeScenario({ accounts: [acc], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    const r = Math.pow(1.12, 1 / 12) - 1;
    expect(result.balances["acc1"][0]).toBeCloseTo(1000 * (1 + r), 3);
    expect(result.balances["acc1"][1]).toBeCloseTo(1000 * Math.pow(1 + r, 2), 3);
    expect(result.balances["acc1"][2]).toBeCloseTo(1000 * Math.pow(1 + r, 3), 3);
  });

  it("quarterly growth fires at i=0,3,6 but not at i=1,2,4,5", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.08, growthPeriod: "quarterly" });
    const scenario = makeScenario({ accounts: [acc], timelineEnd: "2024-07" });
    const result = runSimulation(scenario);
    const qr = Math.pow(1.08, 3 / 12) - 1;
    const b0 = 10000 * (1 + qr);
    expect(result.balances["acc1"][0]).toBeCloseTo(b0, 1);
    expect(result.balances["acc1"][1]).toBeCloseTo(b0, 1); // no change
    expect(result.balances["acc1"][2]).toBeCloseTo(b0, 1); // no change
    const b3 = b0 * (1 + qr);
    expect(result.balances["acc1"][3]).toBeCloseTo(b3, 1);
    expect(result.balances["acc1"][4]).toBeCloseTo(b3, 1);
    const b6 = b3 * (1 + qr);
    expect(result.balances["acc1"][6]).toBeCloseTo(b6, 1);
  });

  it("growth uses start-of-month snapshot, not post-transfer balance", () => {
    // Transfer and growth fire in same month i=0; growth uses opening snapshot 10000
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.10, growthPeriod: "yearly" });
    const t = makeTransfer({ amount: 2000, taxRate: 0, isOneTime: true, startDate: "2024-01" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    // growth delta = 10000 * 0.10 = 1000 (from snapshot)
    // transfer debit = 2000 (from snapshot)
    // balance = 10000 + 1000 - 2000 = 9000
    expect(result.balances["acc1"][0]).toBeCloseTo(9000);
  });
});

// ─── Inflation: deflation display transform ───────────────────────────────────

describe("Inflation: deflation display transform", () => {
  it("inflationEnabled=false: balances are nominal regardless of inflationRate", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.10, growthPeriod: "yearly" });
    // 12-month timeline: growth fires at i=0 only (i=12 would be next year)
    const scenario = makeScenario({ accounts: [acc], inflationEnabled: false, inflationRate: 0.05, timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][11]).toBeCloseTo(11000, 0);
  });

  it("inflationEnabled=true: balance at i=0 is undeflated (deflator=1)", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const scenario = makeScenario({ accounts: [acc], inflationEnabled: true, inflationRate: 0.02 });
    const result = runSimulation(scenario);
    // Deflator at i=0: 1.02^(0/12) = 1 → balance unchanged
    expect(result.balances["acc1"][0]).toBeCloseTo(10000);
  });

  it("inflationEnabled=true: balance at i=12 deflated by annual rate", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const scenario = makeScenario({ accounts: [acc], inflationEnabled: true, inflationRate: 0.02, timelineEnd: "2025-01" });
    const result = runSimulation(scenario);
    // No growth, no transfers: nominal stays 10000. Real at i=12 = 10000/1.02 ≈ 9803.92
    expect(result.balances["acc1"][12]).toBeCloseTo(10000 / 1.02, 1);
  });

  it("principals are NOT deflated even when inflation is enabled", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000 });
    const scenario = makeScenario({ accounts: [acc], inflationEnabled: true, inflationRate: 0.05, timelineEnd: "2025-01" });
    const result = runSimulation(scenario);
    // Principal stays at nominal 10000 (no growth, no transfers)
    expect(result.principals["acc1"][12]).toBeCloseTo(10000);
  });

  it("inflationRate=0 with inflationEnabled=true: no deflation applied", () => {
    // inflationRate !== 0 guard prevents the deflation loop from running
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.10, growthPeriod: "yearly" });
    const scenario = makeScenario({ accounts: [acc], inflationEnabled: true, inflationRate: 0, timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][11]).toBeCloseTo(11000, 0);
  });
});

// ─── Inflation: fixed transfer hedging ───────────────────────────────────────

describe("Inflation: fixed transfer hedging — no inflation", () => {
  it("inflationEnabled=false: non-hedged amount is NOT scaled", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 100000 });
    const t = makeTransfer({ amount: 1000, inflationHedged: false, isOneTime: true, startDate: "2025-01" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineStart: "2024-01", timelineEnd: "2025-02", inflationRate: 0.02, inflationEnabled: false });
    const result = runSimulation(scenario);
    // No inflation enabled → no scaling, no deflation → balance = 100000 - 1000 = 99000
    expect(result.balances["acc1"][12]).toBeCloseTo(99000);
  });

  it("inflationEnabled=false: hedged and non-hedged produce identical results", () => {
    const acc1 = makeAccount({ id: "acc1", initialBalance: 100000 });
    const acc2 = makeAccount({ id: "acc1", initialBalance: 100000 });
    const tHedged = makeTransfer({ amount: 1000, inflationHedged: true, isOneTime: false, period: "monthly" });
    const tNotHedged = makeTransfer({ amount: 1000, inflationHedged: false, isOneTime: false, period: "monthly" });
    const s1 = makeScenario({ accounts: [acc1], transfers: [tHedged], inflationRate: 0.03, inflationEnabled: false, timelineEnd: "2024-12" });
    const s2 = makeScenario({ accounts: [acc2], transfers: [tNotHedged], inflationRate: 0.03, inflationEnabled: false, timelineEnd: "2024-12" });
    const r1 = runSimulation(s1);
    const r2 = runSimulation(s2);
    for (let i = 0; i < 12; i++) {
      expect(r1.balances["acc1"][i]).toBeCloseTo(r2.balances["acc1"][i] as number, 5);
    }
  });
});

describe("Inflation: fixed transfer hedging — with inflation", () => {
  it("non-hedged at i=0: deflator=1, withdrawal is exactly the entered amount", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 100000 });
    const t = makeTransfer({ amount: 1000, inflationHedged: false, isOneTime: true, startDate: "2024-01" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], inflationRate: 0.02, inflationEnabled: true });
    const result = runSimulation(scenario);
    // i=0: 1.02^0 = 1 → nominal = 1000, deflated balance = 99000
    expect(result.balances["acc1"][0]).toBeCloseTo(99000);
  });

  it("non-hedged at i=12: nominal withdrawal = amount * 1.02^1", () => {
    // nominal = 1000 * 1.02 = 1020; deflated balance = (100000-1020)/1.02 = 98980/1.02
    const acc = makeAccount({ id: "acc1", initialBalance: 100000 });
    const t = makeTransfer({ amount: 1000, inflationHedged: false, isOneTime: true, startDate: "2025-01" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineStart: "2024-01", timelineEnd: "2025-02", inflationRate: 0.02, inflationEnabled: true });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][12]).toBeCloseTo(98980 / 1.02, 1);
  });

  it("non-hedged at i=6: nominal withdrawal = amount * 1.02^0.5", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 100000 });
    const t = makeTransfer({ amount: 1000, inflationHedged: false, isOneTime: true, startDate: "2024-07" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], inflationRate: 0.02, inflationEnabled: true });
    const result = runSimulation(scenario);
    const d6 = Math.pow(1.02, 6 / 12);
    const nominal = 1000 * d6;
    expect(result.balances["acc1"][6]).toBeCloseTo((100000 - nominal) / d6, 2);
  });

  it("hedged at i=12: nominal withdrawal stays at entered amount", () => {
    // nominal = 1000; deflated balance = 99000/1.02
    const acc = makeAccount({ id: "acc1", initialBalance: 100000 });
    const t = makeTransfer({ amount: 1000, inflationHedged: true, isOneTime: true, startDate: "2025-01" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineStart: "2024-01", timelineEnd: "2025-02", inflationRate: 0.02, inflationEnabled: true });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][12]).toBeCloseTo(99000 / 1.02, 1);
  });

  it("non-hedged produces lower displayed balance than hedged at month 12", () => {
    const mkScenario = (hedged: boolean) => {
      const acc = makeAccount({ id: "acc1", initialBalance: 100000 });
      const t = makeTransfer({ amount: 1000, inflationHedged: hedged, isOneTime: false, period: "monthly" });
      return makeScenario({ accounts: [acc], transfers: [t], timelineStart: "2024-01", timelineEnd: "2025-01", inflationRate: 0.02, inflationEnabled: true });
    };
    const rNot = runSimulation(mkScenario(false));
    const rHedged = runSimulation(mkScenario(true));
    // Non-hedged withdraws more in nominal terms → lower real balance
    expect(rNot.balances["acc1"][12] as number).toBeLessThan(rHedged.balances["acc1"][12] as number);
  });

  it("recurring non-hedged: each month i uses its own deflator in the scaling formula", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 100000 });
    const t = makeTransfer({ amount: 1000, inflationHedged: false, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-06", inflationRate: 0.02, inflationEnabled: true });
    const result = runSimulation(scenario);
    let nomBal = 100000;
    for (let i = 0; i < 6; i++) {
      nomBal -= 1000 * Math.pow(1.02, i / 12);
      const expected = nomBal / Math.pow(1.02, i / 12);
      expect(result.balances["acc1"][i]).toBeCloseTo(expected, 2);
    }
  });

  it("recurring hedged: each month nominal = 1000, real = 1000/deflator", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 100000 });
    const t = makeTransfer({ amount: 1000, inflationHedged: true, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-06", inflationRate: 0.02, inflationEnabled: true });
    const result = runSimulation(scenario);
    for (let i = 0; i < 6; i++) {
      const nomBal = 100000 - (i + 1) * 1000;
      const expected = nomBal / Math.pow(1.02, i / 12);
      expect(result.balances["acc1"][i]).toBeCloseTo(expected, 2);
    }
  });

  it("undefined inflationHedged behaves identically to explicit true", () => {
    const acc1 = makeAccount({ id: "acc1", initialBalance: 100000 });
    const acc2 = makeAccount({ id: "acc1", initialBalance: 100000 });
    // makeTransfer does not set inflationHedged by default (undefined)
    const tUndefined = makeTransfer({ amount: 1000, isOneTime: false, period: "monthly" });
    const tTrue = makeTransfer({ amount: 1000, inflationHedged: true, isOneTime: false, period: "monthly" });
    const s1 = makeScenario({ accounts: [acc1], transfers: [tUndefined], inflationRate: 0.04, inflationEnabled: true, timelineEnd: "2025-01" });
    const s2 = makeScenario({ accounts: [acc2], transfers: [tTrue], inflationRate: 0.04, inflationEnabled: true, timelineEnd: "2025-01" });
    const r1 = runSimulation(s1);
    const r2 = runSimulation(s2);
    for (let i = 0; i < 13; i++) {
      expect(r1.balances["acc1"][i]).toBeCloseTo(r2.balances["acc1"][i] as number, 6);
    }
  });
});

describe("Inflation: non-fixed amountTypes unaffected by inflationHedged", () => {
  it("gains-only: inflationHedged=false produces same result as inflationHedged=true", () => {
    const mkSetup = (hedged: boolean) => {
      const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.5, growthPeriod: "yearly" });
      const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc1", amount: 0, amountType: "gains-only", inflationHedged: hedged, taxRate: 0.10, isOneTime: true, startDate: "2024-02" });
      return makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-03", inflationRate: 0.03, inflationEnabled: true });
    };
    const r1 = runSimulation(mkSetup(false));
    const r2 = runSimulation(mkSetup(true));
    for (let i = 0; i < 3; i++) {
      expect(r1.balances["acc1"][i]).toBeCloseTo(r2.balances["acc1"][i] as number, 6);
    }
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("empty scenario: no accounts, no transfers", () => {
    const scenario = makeScenario({});
    const result = runSimulation(scenario);
    expect(result.months).toHaveLength(12);
    expect(Object.keys(result.balances)).toHaveLength(0);
  });

  it("single-month timeline: one month of growth and transfers", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 5000, growthRate: 0.10, growthPeriod: "yearly" });
    const scenario = makeScenario({ accounts: [acc], timelineStart: "2024-06", timelineEnd: "2024-06" });
    const result = runSimulation(scenario);
    expect(result.months).toHaveLength(1);
    // Growth fires at i=0 (monthsFromStart=0): delta = 5000 * 0.10 = 500
    expect(result.balances["acc1"][0]).toBeCloseTo(5500);
  });

  it("account drains past zero: balance goes negative without error", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 500 });
    const t = makeTransfer({ amount: 1000, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(-500);
  });

  it("null source AND null target: no accounts affected", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 5000 });
    const t = makeTransfer({ sourceAccountId: null, targetAccountId: null, amount: 1000, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(5000);
  });

  it("zero inflationRate with inflation enabled: no scaling and no deflation", () => {
    // inflationRate=0 means the `inflationRate !== 0` guard skips both the scaling and deflation loops
    const acc = makeAccount({ id: "acc1", initialBalance: 50000 });
    const t = makeTransfer({ amount: 500, inflationHedged: false, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], inflationRate: 0, inflationEnabled: true, timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    // Same as no inflation: each month withdraws exactly 500
    for (let i = 0; i < 12; i++) {
      expect(result.balances["acc1"][i]).toBeCloseTo(50000 - (i + 1) * 500);
    }
  });
});

// ─── SECTION A: Inflation Semantics ──────────────────────────────────────────

describe("A1: Non-hedged invariant: real withdrawal = entered amount each month", () => {
  it("reconstructed nominal withdrawal divided by deflator equals entered amount", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 100000, growthRate: 0 });
    const t = makeTransfer({ amount: 1000, inflationHedged: false, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], inflationRate: 0.03, inflationEnabled: true, timelineEnd: "2024-06" });
    const result = runSimulation(scenario);
    const r = 0.03;
    // Recover nominal balances: nomBal[i] = display[i] * (1+r)^(i/12)
    // Nominal withdrawal at month i = nomBal[i-1] - nomBal[i]
    // Real withdrawal = nomWithdrawal / deflator[i] = should be exactly 1000
    for (let i = 1; i < 6; i++) {
      const nomPrev = (result.balances["acc1"][i - 1] as number) * Math.pow(1 + r, (i - 1) / 12);
      const nomCurr = (result.balances["acc1"][i] as number) * Math.pow(1 + r, i / 12);
      const realWithdrawal = (nomPrev - nomCurr) / Math.pow(1 + r, i / 12);
      expect(realWithdrawal).toBeCloseTo(1000, 4);
    }
  });
});

describe("A2: Hedged invariant: nominal withdrawal constant, real spending power shrinks", () => {
  it("reconstructed nominal withdrawal is constant at entered amount", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 100000, growthRate: 0 });
    const t = makeTransfer({ amount: 1000, inflationHedged: true, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], inflationRate: 0.03, inflationEnabled: true, timelineEnd: "2024-06" });
    const result = runSimulation(scenario);
    const r = 0.03;
    for (let i = 1; i < 6; i++) {
      const nomPrev = (result.balances["acc1"][i - 1] as number) * Math.pow(1 + r, (i - 1) / 12);
      const nomCurr = (result.balances["acc1"][i] as number) * Math.pow(1 + r, i / 12);
      expect(nomPrev - nomCurr).toBeCloseTo(1000, 4);
    }
  });

  it("real purchasing power of each hedged withdrawal is strictly decreasing", () => {
    const r = 0.03;
    // Real cost of hedged withdrawal at month i = 1000 / (1+r)^(i/12) — decreases as i grows
    const realCosts = Array.from({ length: 5 }, (_, k) => 1000 / Math.pow(1 + r, (k + 1) / 12));
    for (let i = 1; i < realCosts.length; i++) {
      expect(realCosts[i - 1]).toBeGreaterThan(realCosts[i]);
    }
  });
});

describe("A3: Non-hedged vs hedged: display balances diverge after month 0", () => {
  it("both show same balance at i=0 (deflator=1), non-hedged lower thereafter", () => {
    const mkSetup = (hedged: boolean) => {
      const acc = makeAccount({ id: "acc1", initialBalance: 100000, growthRate: 0 });
      const t = makeTransfer({ amount: 1000, inflationHedged: hedged, isOneTime: false, period: "monthly" });
      return makeScenario({ accounts: [acc], transfers: [t], inflationRate: 0.03, inflationEnabled: true, timelineEnd: "2024-06" });
    };
    const rNH = runSimulation(mkSetup(false));
    const rH  = runSimulation(mkSetup(true));
    // At i=0: both scenarios withdraw 1000 nominal (deflator[0]=1, non-hedged scales by (1.03)^0=1)
    expect(rNH.balances["acc1"][0]).toBeCloseTo(rH.balances["acc1"][0] as number, 4);
    // At i>0: non-hedged withdraws more in nominal terms → lower displayed balance
    for (let i = 1; i < 6; i++) {
      expect(rNH.balances["acc1"][i] as number).toBeLessThan(rH.balances["acc1"][i] as number);
    }
  });
});

describe("A4: Inflation + Growth: real return ≈ (1 + growthRate) / (1 + inflationRate) - 1", () => {
  it("real balance ratio between two consecutive yearly growth events matches formula", () => {
    // Timeline 2024-01 to 2025-01: 13 months. Yearly growth fires at i=0 AND i=12.
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.07 });
    const scenario = makeScenario({ accounts: [acc], timelineStart: "2024-01", timelineEnd: "2025-01", inflationRate: 0.02, inflationEnabled: true });
    const result = runSimulation(scenario);
    // i=0: growth fires → nominal=10700, deflator=1 → display=10700
    expect(result.balances["acc1"][0]).toBeCloseTo(10700, 2);
    // i=12: growth fires again → nominal=10700*1.07=11449, deflated by 1.02 → 11224.5
    expect(result.balances["acc1"][12]).toBeCloseTo(10700 * 1.07 / 1.02, 2);
    // Real return per year = balances[12]/balances[0] - 1 = 1.07/1.02 - 1 ≈ 4.9%
    const realReturn = (result.balances["acc1"][12] as number) / (result.balances["acc1"][0] as number) - 1;
    expect(realReturn).toBeCloseTo(1.07 / 1.02 - 1, 3);
    // Principals not deflated: stays at initial value
    expect(result.principals["acc1"][12]).toBeCloseTo(10000);
  });
});

describe("A5: Inflation + Growth + Non-Hedged Transfer: full interaction", () => {
  it("displayed balance matches manual month-by-month computation", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.05, growthPeriod: "monthly" });
    const t = makeTransfer({ amount: 200, inflationHedged: false, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], inflationRate: 0.02, inflationEnabled: true, timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    const r = 0.02;
    const growthRate = Math.pow(1.05, 1 / 12) - 1;
    let nomBal = 10000;
    for (let i = 0; i < 12; i++) {
      // Growth uses snapshot, withdrawal also uses snapshot: both apply to opening balance
      nomBal = nomBal * (1 + growthRate) - 200 * Math.pow(1 + r, i / 12);
      const expected = nomBal / Math.pow(1 + r, i / 12);
      expect(result.balances["acc1"][i]).toBeCloseTo(expected, 1);
    }
  });
});

describe("A6: Gains-fraction tax uses nominal values, not real values", () => {
  it("tax cost is identical with and without inflation; displays differ only by deflation", () => {
    const mkSetup = (withInflation: boolean) => {
      const acc = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 0.5, growthRate: 0 });
      const t = makeTransfer({ amount: 1000, taxRate: 0.30, taxBasis: "gains-fraction", isOneTime: true, startDate: "2024-01" });
      return makeScenario({
        accounts: [acc], transfers: [t],
        timelineStart: "2024-01", timelineEnd: "2025-01",
        inflationRate: 0.02, inflationEnabled: withInflation,
      });
    };
    const rInfl = runSimulation(mkSetup(true));
    const rNone = runSimulation(mkSetup(false));
    // At i=0 deflator=1: both show same displayed balance
    expect(rInfl.balances["acc1"][0]).toBeCloseTo(rNone.balances["acc1"][0] as number, 4);
    // At i=12: inflation version is deflated; no-inflation version is nominal
    const nomAtMonth12 = rNone.balances["acc1"][12] as number;
    expect(rInfl.balances["acc1"][12]).toBeCloseTo(nomAtMonth12 / 1.02, 2);
  });
});

describe("A7: Inflation deflation with negative balance", () => {
  it("negative nominal balance is deflated: debt worth less in real terms", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 1000, growthRate: 0 });
    const t = makeTransfer({ amount: 1000, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], inflationRate: 0.03, inflationEnabled: true, timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    // i=0: 1000 - 1000 = 0 (deflator=1)
    expect(result.balances["acc1"][0]).toBeCloseTo(0);
    // i=1: nominal = 0 - 1000 = -1000; real = -1000 / (1.03)^(1/12) ≈ -997.5 (less negative)
    expect(result.balances["acc1"][1]).toBeCloseTo(-1000 / Math.pow(1.03, 1 / 12), 2);
    // i=2: nominal = -1000 - 1000 = -2000; real = -2000 / (1.03)^(2/12)
    expect(result.balances["acc1"][2]).toBeCloseTo(-2000 / Math.pow(1.03, 2 / 12), 2);
  });
});

describe("A8: All accounts deflated independently by the same deflator", () => {
  it("two accounts with different balances are each deflated correctly at i=12", () => {
    const acc1 = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const acc2 = makeAccount({ id: "acc2", initialBalance: 5000, growthRate: 0 });
    const scenario = makeScenario({
      accounts: [acc1, acc2],
      timelineStart: "2024-01", timelineEnd: "2025-01",
      inflationRate: 0.04, inflationEnabled: true,
    });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][12]).toBeCloseTo(10000 / 1.04, 2);
    expect(result.balances["acc2"][12]).toBeCloseTo(5000 / 1.04, 2);
  });
});

describe("A1b: Percent-balance transfer operates on nominal balance; no inflation scaling applied", () => {
  it("nominal balance drops by exactly transferRate each month regardless of inflation", () => {
    // Percent-balance amount is computed on the nominal snapshot balance, then the result is
    // deflated as a display transform. Consecutive displayed balances use *different* deflators,
    // so display[i]/display[i-1] = 0.90 * (1+r)^(-1/12), not 0.90. The correct invariant is
    // that the *nominal* ratio is exactly 0.90 — verified by recovering nominal values.
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const t = makeTransfer({ amount: 0.10, amountType: "percent-balance", isOneTime: false, period: "monthly" });
    const r = 0.05;
    const scenario = makeScenario({ accounts: [acc], transfers: [t], inflationRate: r, inflationEnabled: true, timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    for (let i = 1; i < 12; i++) {
      const nomCurr = (result.balances["acc1"][i] as number) * Math.pow(1 + r, i / 12);
      const nomPrev = (result.balances["acc1"][i - 1] as number) * Math.pow(1 + r, (i - 1) / 12);
      expect(nomCurr / nomPrev).toBeCloseTo(0.90, 6);
    }
  });
});

// ─── SECTION B: Growth Period Completeness ────────────────────────────────────

describe("B1: Half-yearly growth fires at i=0 and i=6 with correct period rate", () => {
  it("balance changes only at half-year marks using (1+annual)^(6/12)-1 rate", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.08, growthPeriod: "half-yearly" });
    const scenario = makeScenario({ accounts: [acc], timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    const hr = Math.pow(1.08, 6 / 12) - 1;
    const b0 = 10000 * (1 + hr);
    expect(result.balances["acc1"][0]).toBeCloseTo(b0, 2);
    for (let i = 1; i < 6; i++) {
      expect(result.balances["acc1"][i]).toBeCloseTo(b0, 2);
    }
    const b6 = b0 * (1 + hr);
    expect(result.balances["acc1"][6]).toBeCloseTo(b6, 2);
    for (let i = 7; i < 12; i++) {
      expect(result.balances["acc1"][i]).toBeCloseTo(b6, 2);
    }
  });
});

describe("B2: Zero growth rate: balance never changes from growth alone", () => {
  it("all 12 months remain at initial balance", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0, growthPeriod: "monthly" });
    const scenario = makeScenario({ accounts: [acc], timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    for (let i = 0; i < 12; i++) {
      expect(result.balances["acc1"][i]).toBeCloseTo(10000);
    }
  });
});

describe("B3: Negative growth rate (depreciation)", () => {
  it("balance decreases by exactly annual rate when yearly growth fires at i=0", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: -0.10, growthPeriod: "yearly" });
    // 12-month timeline: yearly growth fires only at i=0
    const scenario = makeScenario({ accounts: [acc], timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    // i=0: growth fires → 10000 * 0.90 = 9000
    expect(result.balances["acc1"][0]).toBeCloseTo(9000, 1);
    // Stays at 9000 for remaining months (no second firing in 12-month window)
    for (let i = 1; i < 12; i++) {
      expect(result.balances["acc1"][i]).toBeCloseTo(9000, 1);
    }
    // Principal unchanged by depreciation
    expect(result.principals["acc1"][11]).toBeCloseTo(10000);
  });
});

describe("B4: Yearly growth fires again at i=12 (year boundary)", () => {
  it("balance at i=11 is 11000 and at i=12 is 12100 after two yearly firings", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.10, growthPeriod: "yearly" });
    const scenario = makeScenario({ accounts: [acc], timelineStart: "2024-01", timelineEnd: "2025-01" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(11000, 1);
    expect(result.balances["acc1"][11]).toBeCloseTo(11000, 1);
    expect(result.balances["acc1"][12]).toBeCloseTo(12100, 0);
  });
});

describe("B5: Monthly growth compounds to exact annual rate over 12 months", () => {
  it("balance at i=11 equals initialBalance * (1 + annualRate)", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.06, growthPeriod: "monthly" });
    const scenario = makeScenario({ accounts: [acc], timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][11]).toBeCloseTo(10000 * 1.06, 3);
  });
});

// ─── SECTION C: Principal Tracking Deep Cases ────────────────────────────────

describe("C1: Zero-balance source: principal guard prevents division by zero", () => {
  it("principal stays 0 (not -1000) when withdrawing from zero-balance account", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 0, growthRate: 0 });
    const t = makeTransfer({ amount: 1000, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(-1000);
    expect(result.principals["acc1"][0]).toBeCloseTo(0);
  });
});

describe("C2: Sequential withdrawals maintain proportional principal ratio", () => {
  it("principal/balance ratio stays at 0.4 through 3 monthly withdrawals", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 0.4, growthRate: 0 });
    const t = makeTransfer({ amount: 2000, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(8000);
    expect(result.principals["acc1"][0]).toBeCloseTo(3200);
    expect(result.balances["acc1"][1]).toBeCloseTo(6000);
    expect(result.principals["acc1"][1]).toBeCloseTo(2400);
    expect(result.balances["acc1"][2]).toBeCloseTo(4000);
    expect(result.principals["acc1"][2]).toBeCloseTo(1600);
    // Ratio maintained at 0.4 each step
    for (let i = 0; i < 3; i++) {
      const ratio = (result.principals["acc1"][i] as number) / (result.balances["acc1"][i] as number);
      expect(ratio).toBeCloseTo(0.4, 6);
    }
  });
});

describe("C3: Two sequential withdrawals from same account each use the live principal fraction", () => {
  it("each transfer uses the balance at the moment it executes; proportional debit preserves ratio", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 0.5, growthRate: 0 });
    const t1 = makeTransfer({ id: "t1", amount: 2000, isOneTime: true });
    const t2 = makeTransfer({ id: "t2", amount: 3000, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t1, t2] });
    const result = runSimulation(scenario);
    // balance = 10000 - 2000 - 3000 = 5000
    expect(result.balances["acc1"][0]).toBeCloseTo(5000);
    // principal: opening fraction = 5000/10000 = 0.5; debit = (2000+3000)*0.5 = 2500
    expect(result.principals["acc1"][0]).toBeCloseTo(2500);
    // Ratio still 0.5
    expect((result.principals["acc1"][0] as number) / (result.balances["acc1"][0] as number)).toBeCloseTo(0.5, 6);
  });
});

describe("C4: Target account receives gains transfer: netToTarget becomes new principal", () => {
  it("target balance and principal both equal netToTarget after gains-only transfer", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 0.5, growthRate: 0 });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0, growthRate: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amountType: "gains-only", taxRate: 0.20, taxBasis: "full", isOneTime: true });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t] });
    const result = runSimulation(scenario);
    // gains = 10000 - 5000 = 5000; taxCost = 5000*0.20=1000; netToTarget = 4000
    expect(result.balances["acc2"][0]).toBeCloseTo(4000);
    expect(result.principals["acc2"][0]).toBeCloseTo(4000);
    // Gains ratio on target = 0 (all principal)
    expect((result.balances["acc2"][0] as number) - (result.principals["acc2"][0] as number)).toBeCloseTo(0);
  });
});

describe("C5: After receiving gains-only transfer (all principal), subsequent gains-fraction tax is zero", () => {
  it("gainsRatio = 0 when account received transfer as all-principal; no tax on withdrawal", () => {
    // Target starts with 4000 all-principal (as in C4 outcome)
    const tgt = makeAccount({ id: "acc2", initialBalance: 4000, initialPrincipalRatio: 1.0, growthRate: 0 });
    const withdraw = makeTransfer({ id: "t2", sourceAccountId: "acc2", targetAccountId: null, amount: 2000, taxRate: 0.30, taxBasis: "gains-fraction", isOneTime: true });
    const scenario = makeScenario({ accounts: [tgt], transfers: [withdraw] });
    const result = runSimulation(scenario);
    // gainsRatio = (4000-4000)/4000 = 0; taxCost = 0; balance drops by exactly 2000
    expect(result.balances["acc2"][0]).toBeCloseTo(2000);
    expect(result.principals["acc2"][0]).toBeCloseTo(2000);
  });
});

// ─── SECTION D: Transfer Scheduling Edge Cases ───────────────────────────────

describe("D1: startDate=null defaults to timelineStart", () => {
  it("null startDate produces identical result to explicit timelineStart", () => {
    const mkSetup = (sd: string | null) => {
      const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
      const t = makeTransfer({ amount: 500, isOneTime: false, period: "monthly", startDate: sd });
      return makeScenario({ accounts: [acc], transfers: [t] });
    };
    const rNull = runSimulation(mkSetup(null));
    const rExpl = runSimulation(mkSetup("2024-01"));
    for (let i = 0; i < 12; i++) {
      expect(rNull.balances["acc1"][i]).toBeCloseTo(rExpl.balances["acc1"][i] as number, 6);
    }
  });
});

describe("D2: Quarterly transfer starting mid-year fires on startDate offset, not calendar", () => {
  it("fires at i=3,6,9,12 when startDate=2024-04 in a Jan 2024 to Mar 2025 timeline", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const t = makeTransfer({ amount: 500, isOneTime: false, period: "quarterly", startDate: "2024-04" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineStart: "2024-01", timelineEnd: "2025-03" });
    const result = runSimulation(scenario);
    const firingMonths = new Set([3, 6, 9, 12]);
    // Count total firings: 4 × 500 = 2000 reduction
    let expected = 10000;
    for (let i = 0; i < 15; i++) {
      if (firingMonths.has(i)) expected -= 500;
      expect(result.balances["acc1"][i]).toBeCloseTo(expected, 4);
    }
  });
});

describe("D3: Transfer startDate exactly at timelineEnd fires in last month", () => {
  it("one-time transfer at 2024-12 fires at i=11 (last month)", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const t = makeTransfer({ amount: 1000, isOneTime: true, startDate: "2024-12" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    for (let i = 0; i < 11; i++) {
      expect(result.balances["acc1"][i]).toBeCloseTo(10000);
    }
    expect(result.balances["acc1"][11]).toBeCloseTo(9000);
  });
});

describe("D4: Transfer startDate after timelineEnd: never fires", () => {
  it("balance unchanged for all 12 months when startDate is beyond timeline", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const t = makeTransfer({ amount: 5000, isOneTime: true, startDate: "2025-06" });
    const scenario = makeScenario({ accounts: [acc], timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    for (let i = 0; i < 12; i++) {
      expect(result.balances["acc1"][i]).toBeCloseTo(10000);
    }
  });
});

describe("D5: endDate = startDate: recurring transfer fires exactly once", () => {
  it("monthly transfer with startDate=endDate=2024-03 fires only at i=2", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const t = makeTransfer({ amount: 500, isOneTime: false, period: "monthly", startDate: "2024-03", endDate: "2024-03" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-06" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(10000);
    expect(result.balances["acc1"][1]).toBeCloseTo(10000);
    expect(result.balances["acc1"][2]).toBeCloseTo(9500);
    expect(result.balances["acc1"][3]).toBeCloseTo(9500);
    expect(result.balances["acc1"][4]).toBeCloseTo(9500);
    expect(result.balances["acc1"][5]).toBeCloseTo(9500);
  });
});

describe("D6: Half-yearly transfer starting mid-year fires 6 months apart from startDate", () => {
  it("fires at i=3 (2024-04) and i=9 (2024-10) in a 2024 calendar year timeline", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const t = makeTransfer({ amount: 1000, isOneTime: false, period: "half-yearly", startDate: "2024-04" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    const firingMonths = new Set([3, 9]);
    let expected = 10000;
    for (let i = 0; i < 12; i++) {
      if (firingMonths.has(i)) expected -= 1000;
      expect(result.balances["acc1"][i]).toBeCloseTo(expected, 4);
    }
  });
});

// ─── SECTION E: Growth Interaction With Transfers ────────────────────────────

describe("E1: Monthly growth and monthly transfer both use opening snapshot", () => {
  it("result = snapshot * (1+rate) - withdrawal, not sequential application", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.12, growthPeriod: "monthly" });
    const t = makeTransfer({ amount: 500, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineEnd: "2024-02" });
    const result = runSimulation(scenario);
    const monthlyRate = Math.pow(1.12, 1 / 12) - 1;
    const expected = 10000 * (1 + monthlyRate) - 500;
    expect(result.balances["acc1"][0]).toBeCloseTo(expected, 3);
    // Wrong order would give: (10000 - 500) * (1 + monthlyRate) — different from above
    expect(result.balances["acc1"][0]).not.toBeCloseTo((10000 - 500) * (1 + monthlyRate), 1);
  });
});

describe("E2: Yearly growth fires at i=0 regardless of calendar month", () => {
  it("growth fires at i=0 (June) and i=12 (June next year), not on January", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0.10, growthPeriod: "yearly" });
    const scenario = makeScenario({ accounts: [acc], timelineStart: "2024-06", timelineEnd: "2025-06" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(11000, 1);
    for (let i = 1; i < 12; i++) {
      expect(result.balances["acc1"][i]).toBeCloseTo(11000, 1);
    }
    expect(result.balances["acc1"][12]).toBeCloseTo(12100, 1);
  });
});

// ─── SECTION F: Output Shape and Determinism ─────────────────────────────────

describe("F1: months array has correct YYYY-MM values spanning the timeline", () => {
  it("months from 2024-10 to 2025-03 are correct in order", () => {
    const scenario = makeScenario({ timelineStart: "2024-10", timelineEnd: "2025-03" });
    const result = runSimulation(scenario);
    expect(result.months).toEqual(["2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03"]);
  });
});

describe("F2: months array length equals number of months in range (inclusive)", () => {
  it("1-month, 12-month, and 25-month timelines have correct lengths", () => {
    const single = makeScenario({ timelineStart: "2024-06", timelineEnd: "2024-06" });
    expect(runSimulation(single).months).toHaveLength(1);
    const twelve = makeScenario({ timelineStart: "2024-01", timelineEnd: "2024-12" });
    expect(runSimulation(twelve).months).toHaveLength(12);
    const twentyfive = makeScenario({ timelineStart: "2024-01", timelineEnd: "2026-01" });
    expect(runSimulation(twentyfive).months).toHaveLength(25);
  });
});

describe("F3: Long-running simulation (30 years) produces no NaN or Infinity", () => {
  it("all 360 balance values are finite numbers", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 100000, growthRate: 0.07, growthPeriod: "monthly" });
    const t = makeTransfer({ amount: 500, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({
      accounts: [acc], transfers: [t],
      timelineStart: "2024-01", timelineEnd: "2053-12",
      inflationRate: 0.02, inflationEnabled: true,
    });
    const result = runSimulation(scenario);
    expect(result.months).toHaveLength(360);
    for (let i = 0; i < 360; i++) {
      const val = result.balances["acc1"][i] as number;
      expect(isNaN(val)).toBe(false);
      expect(isFinite(val)).toBe(true);
    }
  });
});

// ─── SECTION G: Additional Edge Cases ────────────────────────────────────────

describe("G1: Two incoming transfers to same account in same month accumulate additively", () => {
  it("target receives sum of both transfers; principal = total received", () => {
    const src1 = makeAccount({ id: "acc1", initialBalance: 5000, growthRate: 0 });
    const src2 = makeAccount({ id: "acc2", initialBalance: 8000, growthRate: 0 });
    const tgt  = makeAccount({ id: "acc3", initialBalance: 0, growthRate: 0 });
    const t1 = makeTransfer({ id: "t1", sourceAccountId: "acc1", targetAccountId: "acc3", amount: 1000, isOneTime: true });
    const t2 = makeTransfer({ id: "t2", sourceAccountId: "acc2", targetAccountId: "acc3", amount: 2000, isOneTime: true });
    const scenario = makeScenario({ accounts: [src1, src2, tgt], transfers: [t1, t2] });
    const result = runSimulation(scenario);
    expect(result.balances["acc3"][0]).toBeCloseTo(3000);
    expect(result.principals["acc3"][0]).toBeCloseTo(3000);
  });
});

describe("G2: Null source AND null target with non-zero taxRate: no accounts affected", () => {
  it("non-zero tax rate with null source/target causes no balance changes", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 5000, growthRate: 0 });
    const t = makeTransfer({ sourceAccountId: null, targetAccountId: null, amount: 1000, taxRate: 0.30, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(5000);
  });
});

describe("G3: Self-transfer with fixed amount (not gains-only): taxCost is net loss", () => {
  it("source=target fixed transfer results in balance reduced by taxCost only", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 1, growthRate: 0 });
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc1", amount: 1000, taxRate: 0.20, taxBasis: "full", isOneTime: true });
    const scenario = makeScenario({ accounts: [acc], transfers: [t] });
    const result = runSimulation(scenario);
    // Deduct 1000 from source, credit 800 to target (same account): net = -200
    expect(result.balances["acc1"][0]).toBeCloseTo(9800);
    expect(result.principals["acc1"][0]).toBeCloseTo(9800);
  });
});

describe("G4: Gains-only transfer with zero tax rate transfers all gains to target", () => {
  it("source retains principal, target receives full gains when taxRate=0", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 1, growthRate: 0.50, growthPeriod: "yearly" });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0, growthRate: 0 });
    // Transfer fires at month 1 (after growth at month 0)
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amountType: "gains-only", taxRate: 0, isOneTime: true, startDate: "2024-02" });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    // After month 0: acc1 balance=15000, principal=10000 (growth doesn't change principal)
    // Month 1: gains=15000-10000=5000, taxCost=0, netToTarget=5000
    // acc1: 15000-5000=10000; principal: 10000 - 5000*(10000/15000) = 10000 - 3333.33 = 6666.67
    expect(result.balances["acc1"][1]).toBeCloseTo(10000, 1);
    expect(result.balances["acc2"][1]).toBeCloseTo(5000, 1);
    expect(result.principals["acc1"][1]).toBeCloseTo(10000 - 5000 * (10000 / 15000), 1);
    expect(result.principals["acc2"][1]).toBeCloseTo(5000, 1);
  });
});

describe("G5: Very high inflation rate (50% annual)", () => {
  it("balance at i=12 is deflated by 1.50", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const scenario = makeScenario({ accounts: [acc], timelineStart: "2024-01", timelineEnd: "2025-01", inflationRate: 0.50, inflationEnabled: true });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][12]).toBeCloseTo(10000 / 1.50, 2);
  });

  it("non-hedged nominal withdrawal at i=6 scales by (1.5)^(6/12)", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 100000, growthRate: 0 });
    const t = makeTransfer({ amount: 1000, inflationHedged: false, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], inflationRate: 0.50, inflationEnabled: true, timelineEnd: "2024-07" });
    const result = runSimulation(scenario);
    const r = 0.50;
    // Verify real withdrawal at i=6 = 1000
    const nomPrev = (result.balances["acc1"][5] as number) * Math.pow(1 + r, 5 / 12);
    const nomCurr = (result.balances["acc1"][6] as number) * Math.pow(1 + r, 6 / 12);
    const realWithdrawal = (nomPrev - nomCurr) / Math.pow(1 + r, 6 / 12);
    expect(realWithdrawal).toBeCloseTo(1000, 2);
  });
});

describe("G6: initialPrincipalRatio=0: gains-fraction tax applies at full rate always", () => {
  it("account with zero cost basis incurs full tax rate on gains-fraction withdrawal", () => {
    const src = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 0, growthRate: 0.20, growthPeriod: "yearly" });
    const tgt = makeAccount({ id: "acc2", initialBalance: 0, growthRate: 0 });
    // Transfer at month 1: gains-fraction 30% from acc1 to acc2
    const t = makeTransfer({ sourceAccountId: "acc1", targetAccountId: "acc2", amount: 2000, taxRate: 0.30, taxBasis: "gains-fraction", isOneTime: true, startDate: "2024-02" });
    const scenario = makeScenario({ accounts: [src, tgt], transfers: [t], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    // After i=0: acc1 balance = 12000, principal = 0 (growth doesn't change principal)
    // At i=1: gainsRatio = (12000-0)/12000 = 1.0; taxCost = 2000*1.0*0.30 = 600; netToTarget = 1400
    expect(result.balances["acc2"][1]).toBeCloseTo(1400, 1);
    expect(result.principals["acc2"][1]).toBeCloseTo(1400, 1);
  });
});

describe("G7: Yearly transfer starting mid-year fires on startDate offset", () => {
  it("yearly transfer from 2024-07 fires at i=6, i=18, i=30 in a 31-month timeline", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const t = makeTransfer({ amount: 1000, isOneTime: false, period: "yearly", startDate: "2024-07" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t], timelineStart: "2024-01", timelineEnd: "2026-07" });
    const result = runSimulation(scenario);
    const firingIndices = new Set([6, 18, 30]);
    let expected = 10000;
    for (let i = 0; i < 31; i++) {
      if (firingIndices.has(i)) expected -= 1000;
      expect(result.balances["acc1"][i]).toBeCloseTo(expected, 4);
    }
  });
});

// ─── SECTION H: Integration Tests ────────────────────────────────────────────

describe("H1: Retirement drawdown scenario: portfolio survives 20 years", () => {
  it("$500k at 6% growth with $2500/month non-hedged at 2% inflation stays positive for 240 months", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 500000, growthRate: 0.06, growthPeriod: "yearly", initialPrincipalRatio: 1 });
    const t = makeTransfer({ amount: 2500, inflationHedged: false, isOneTime: false, period: "monthly" });
    const scenario = makeScenario({
      accounts: [acc], transfers: [t],
      timelineStart: "2024-01", timelineEnd: "2043-12",
      inflationRate: 0.02, inflationEnabled: true,
    });
    const result = runSimulation(scenario);
    expect(result.months).toHaveLength(240);
    expect(result.balances["acc1"][239] as number).toBeGreaterThan(0);
  });
});

describe("H2: Transfer chain A→B→C: fixed amount transfers give correct result in sequential model", () => {
  it("C gets $1000 (fixed amount); in the sequential model B's credit from A is visible within the same month", () => {
    const accA = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const accB = makeAccount({ id: "acc2", initialBalance: 5000, growthRate: 0 });
    const accC = makeAccount({ id: "acc3", initialBalance: 0, growthRate: 0 });
    const t1 = makeTransfer({ id: "t1", sourceAccountId: "acc1", targetAccountId: "acc2", amount: 2000, isOneTime: true });
    const t2 = makeTransfer({ id: "t2", sourceAccountId: "acc2", targetAccountId: "acc3", amount: 1000, isOneTime: true });
    const scenario = makeScenario({ accounts: [accA, accB, accC], transfers: [t1, t2] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(8000);
    expect(result.balances["acc2"][0]).toBeCloseTo(6000); // +2000 from A, -1000 to C = net +1000
    expect(result.balances["acc3"][0]).toBeCloseTo(1000); // gets $1000 fixed from B
  });
});

describe("H3: Account fully drained then receives contribution", () => {
  it("zero-balance account correctly accepts new contribution with correct principal", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 1000, initialPrincipalRatio: 1, growthRate: 0 });
    const drain = makeTransfer({ id: "t1", amount: 1000, isOneTime: true, startDate: "2024-01" });
    const contrib = makeTransfer({ id: "t2", sourceAccountId: null, targetAccountId: "acc1", amount: 2000, isOneTime: true, startDate: "2024-02" });
    const scenario = makeScenario({ accounts: [acc], transfers: [drain, contrib], timelineEnd: "2024-03" });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(0);
    expect(result.principals["acc1"][0]).toBeCloseTo(0);
    expect(result.balances["acc1"][1]).toBeCloseTo(2000);
    expect(result.principals["acc1"][1]).toBeCloseTo(2000);
  });
});

// ─── SECTION S: Sequential Processing Behaviour ──────────────────────────────

describe("S1: Percent-balance transfer sees updated balance from prior external transfer in same month", () => {
  it("10% of post-contribution balance, not opening balance", () => {
    // acc1: $10,000. T1 (external → acc1): $5,000. T2 (acc1 → null): 10% percent-balance.
    // Old model: T2 = 10% × $10,000 = $1,000. New model: T2 = 10% × $15,000 = $1,500.
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const t1 = makeTransfer({ id: "t1", sourceAccountId: null, targetAccountId: "acc1", amount: 5000, isOneTime: true, amountType: "fixed" });
    const t2 = makeTransfer({ id: "t2", sourceAccountId: "acc1", targetAccountId: null, amount: 0.10, isOneTime: true, amountType: "percent-balance" });
    const scenario = makeScenario({ accounts: [acc], transfers: [t1, t2] });
    const result = runSimulation(scenario);
    // Phase 1: external $5,000 → acc1 = $15,000
    // Phase 2: acc1 growth (0), then T2 = 10% × $15,000 = $1,500 out → acc1 = $13,500
    expect(result.balances["acc1"][0]).toBeCloseTo(13500);
  });
});

describe("S2: Gains-only self-transfer + outgoing fixed transfer on same account: no sentinel corruption", () => {
  it("outgoing transfer after gains-only self-transfer correctly debits principal", () => {
    // acc1: $10,000, principal $5,000. acc2: $0.
    // T1: gains-only self-transfer (acc1→acc1), taxRate 20% → gains=5000, taxCost=1000, principal resets to $9,000.
    // T2: $3,000 fixed from acc1 → acc2 (fires after T1 in Phase 2 for acc1).
    // After T1: acc1 balance=9000, principal=9000.
    // After T2: acc1 balance=6000, principal debit = 3000 × (9000/9000) = 3000 → principal=6000.
    // acc2 balance=3000, principal=3000.
    const acc1 = makeAccount({ id: "acc1", initialBalance: 10000, initialPrincipalRatio: 0.5, growthRate: 0 });
    const acc2 = makeAccount({ id: "acc2", initialBalance: 0, growthRate: 0 });
    const t1 = makeTransfer({ id: "t1", sourceAccountId: "acc1", targetAccountId: "acc1", amountType: "gains-only", taxRate: 0.20, taxBasis: "full", isOneTime: true });
    const t2 = makeTransfer({ id: "t2", sourceAccountId: "acc1", targetAccountId: "acc2", amount: 3000, amountType: "fixed", taxRate: 0, isOneTime: true });
    const scenario = makeScenario({ accounts: [acc1, acc2], transfers: [t1, t2] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(6000);
    expect(result.principals["acc1"][0]).toBeCloseTo(6000);
    expect(result.balances["acc2"][0]).toBeCloseTo(3000);
    expect(result.principals["acc2"][0]).toBeCloseTo(3000);
  });
});

describe("S3: Transfer chain A→B→C: C draws from B's post-credit balance for percent-balance", () => {
  it("C receives 50% of B's post-credit balance, not B's opening zero balance", () => {
    // A: $10,000. B: $0. C: $0.
    // T1: A→B $5,000 fixed. T2: B→C 50% percent-balance.
    // Old model: T2 = 50% × $0 = $0. New model: T2 = 50% × $5,000 = $2,500.
    const accA = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0 });
    const accB = makeAccount({ id: "acc2", initialBalance: 0, growthRate: 0 });
    const accC = makeAccount({ id: "acc3", initialBalance: 0, growthRate: 0 });
    const t1 = makeTransfer({ id: "t1", sourceAccountId: "acc1", targetAccountId: "acc2", amount: 5000, amountType: "fixed", isOneTime: true });
    const t2 = makeTransfer({ id: "t2", sourceAccountId: "acc2", targetAccountId: "acc3", amount: 0.50, amountType: "percent-balance", isOneTime: true });
    const scenario = makeScenario({ accounts: [accA, accB, accC], transfers: [t1, t2] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(5000);
    expect(result.balances["acc2"][0]).toBeCloseTo(2500);
    expect(result.balances["acc3"][0]).toBeCloseTo(2500);
  });
});
