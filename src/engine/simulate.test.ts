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
    startDate: "2024-01",
    initialBalance: 10000,
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
    targetAccountId: "acc2",
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

// Case 1: Simple growth — principal does NOT change
describe("Case 1: Simple growth", () => {
  it("account grows 10% yearly; principal stays at initialBalance", () => {
    const acc = makeAccount({ initialBalance: 10000, growthRate: 0.10, growthPeriod: "yearly" });
    const scenario = makeScenario({ accounts: [acc], timelineStart: "2024-01", timelineEnd: "2024-12" });
    const result = runSimulation(scenario);
    // After 12 months (1 year), balance should be ~11000
    const finalBalance = result.balances["acc1"][11] as number;
    expect(finalBalance).toBeCloseTo(11000, 0);
    // Principal must remain 10000
    const finalPrincipal = result.principals["acc1"][11] as number;
    expect(finalPrincipal).toBeCloseTo(10000, 0);
  });
});

// Case 2: Fixed transfer in — principal increases
describe("Case 2: Fixed transfer in", () => {
  it("receiving 5000 increases principal by 5000", () => {
    const acc1 = makeAccount({ id: "acc1", initialBalance: 0, growthRate: 0, growthPeriod: "yearly" });
    const acc2 = makeAccount({ id: "acc2", initialBalance: 10000, growthRate: 0, growthPeriod: "yearly" });
    const transfer = makeTransfer({
      sourceAccountId: "acc2",
      targetAccountId: "acc1",
      amount: 5000,
      amountType: "fixed",
      isOneTime: true,
      startDate: "2024-01",
    });
    const scenario = makeScenario({ accounts: [acc1, acc2], transfers: [transfer] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(5000, 0);
    expect(result.principals["acc1"][0]).toBeCloseTo(5000, 0);
  });
});

// Case 3: Fixed transfer out (no tax) — proportional principal reduction
describe("Case 3: Fixed transfer out (no tax)", () => {
  it("proportionally reduces principal on withdrawal", () => {
    // Account A: initial 15000, no growth. Account B receives transfer.
    // Transfer 6000 from A to B, no tax.
    // If initial principal = initial balance = 15000, then principalFraction = 15000/15000 = 1
    // So principal debit = 6000 * 1 = 6000. Principal after = 9000.
    const accA = makeAccount({ id: "acc1", initialBalance: 15000, growthRate: 0, growthPeriod: "yearly" });
    const accB = makeAccount({ id: "acc2", initialBalance: 0, growthRate: 0, growthPeriod: "yearly" });
    const transfer = makeTransfer({
      sourceAccountId: "acc1",
      targetAccountId: "acc2",
      amount: 6000,
      amountType: "fixed",
      isOneTime: true,
      startDate: "2024-01",
      taxRate: 0,
    });
    const scenario = makeScenario({ accounts: [accA, accB], transfers: [transfer] });
    const result = runSimulation(scenario);
    expect(result.balances["acc1"][0]).toBeCloseTo(9000, 0);
    expect(result.principals["acc1"][0]).toBeCloseTo(9000, 0);
    expect(result.balances["acc2"][0]).toBeCloseTo(6000, 0);
    expect(result.principals["acc2"][0]).toBeCloseTo(6000, 0);
  });
});

// Case 4: Fixed transfer out with gains-fraction tax
describe("Case 4: Gains-fraction tax", () => {
  it("taxes only gains fraction of transferred amount", () => {
    const accA = makeAccount({
      id: "acc1",
      initialBalance: 10000,
      growthRate: 0.5, // 50% yearly — fires in month 0 only (offset 0 % 12 == 0)
      growthPeriod: "yearly",
    });
    // After month 0 (2024-01), growth fires: delta = 10000 * 0.5 = 5000, balance = 15000, principal = 10000
    // In 2024-02, no growth (offset 1 % 12 != 0), only transfer fires
    const accB = makeAccount({ id: "acc2", initialBalance: 0, growthRate: 0, growthPeriod: "yearly", startDate: "2024-02" });
    const transfer = makeTransfer({
      sourceAccountId: "acc1",
      targetAccountId: "acc2",
      amount: 6000,
      amountType: "fixed",
      isOneTime: true,
      startDate: "2024-02",
      taxRate: 0.30,
      taxBasis: "gains-fraction",
    });
    const scenario = makeScenario({
      accounts: [accA, accB],
      transfers: [transfer],
      timelineStart: "2024-01",
      timelineEnd: "2024-03",
    });
    const result = runSimulation(scenario);
    // After month 0: acc1 balance should be 15000
    expect(result.balances["acc1"][0]).toBeCloseTo(15000, 0);
    expect(result.principals["acc1"][0]).toBeCloseTo(10000, 0);
    // After month 1 (2024-02): transfer fires
    // gainsRatio = 5000/15000 = 0.3333; taxCost = 6000 * 0.3333 * 0.30 ≈ 600
    const b1 = result.balances["acc1"][1] as number;
    expect(b1).toBeCloseTo(9000, 0); // 15000 - 6000
    const b2 = result.balances["acc2"][1] as number;
    expect(b2).toBeCloseTo(5400, 0); // 6000 - 600
  });
});

// Case 5: Self-transfer gains-only
describe("Case 5: Self-transfer gains-only", () => {
  it("taxes gains on self-transfer and resets principal to balance", () => {
    // Account at 15000, principal 10000. gains = 5000.
    const acc = makeAccount({
      id: "acc1",
      initialBalance: 10000,
      growthRate: 0.5, // 50% yearly — fires in month 0 only
      growthPeriod: "yearly",
    });
    // Month 0: grows to 15000, principal stays 10000
    // Month 1: no growth (offset 1 % 12 != 0), self-transfer fires
    const selfTransfer = makeTransfer({
      sourceAccountId: "acc1",
      targetAccountId: "acc1",
      amount: 0,
      amountType: "gains-only",
      isOneTime: true,
      startDate: "2024-02",
      taxRate: 0.15,
      taxBasis: "full",
    });
    const scenario = makeScenario({
      accounts: [acc],
      transfers: [selfTransfer],
      timelineStart: "2024-01",
      timelineEnd: "2024-03",
    });
    const result = runSimulation(scenario);
    // Month 0: balance = 15000, principal = 10000
    expect(result.balances["acc1"][0]).toBeCloseTo(15000, 0);
    // Month 1: resolvedAmount = 5000, taxCost = 750, balance = 14250, principal = 14250
    expect(result.balances["acc1"][1]).toBeCloseTo(14250, 0);
    expect(result.principals["acc1"][1]).toBeCloseTo(14250, 0);
  });
});

// Case 6: Gains-only with no gains
describe("Case 6: Gains-only with no gains", () => {
  it("resolves to zero when no gains exist", () => {
    const acc = makeAccount({ id: "acc1", initialBalance: 10000, growthRate: 0, growthPeriod: "yearly" });
    const selfTransfer = makeTransfer({
      sourceAccountId: "acc1",
      targetAccountId: "acc1",
      amount: 0,
      amountType: "gains-only",
      isOneTime: true,
      startDate: "2024-01",
      taxRate: 0.15,
      taxBasis: "full",
    });
    const scenario = makeScenario({ accounts: [acc], transfers: [selfTransfer] });
    const result = runSimulation(scenario);
    // No gains, so no transfer, balance stays at 10000
    expect(result.balances["acc1"][0]).toBeCloseTo(10000, 0);
    expect(result.principals["acc1"][0]).toBeCloseTo(10000, 0);
  });
});

// Case 7: Negative balance account
describe("Case 7: Negative balance account", () => {
  it("gainsRatio resolves to 0 for negative balance", () => {
    const debt = makeAccount({ id: "acc1", initialBalance: -50000, growthRate: 0.05, growthPeriod: "yearly" });
    const target = makeAccount({ id: "acc2", initialBalance: 0, growthRate: 0, growthPeriod: "yearly" });
    const transfer = makeTransfer({
      sourceAccountId: "acc1",
      targetAccountId: "acc2",
      amount: 1000,
      amountType: "fixed",
      isOneTime: true,
      startDate: "2024-01",
      taxRate: 0.20,
      taxBasis: "gains-fraction",
    });
    const scenario = makeScenario({ accounts: [debt, target], transfers: [transfer] });
    const result = runSimulation(scenario);
    // gainsRatio = 0 (negative balance), so no tax, full 1000 passes through
    expect(result.balances["acc2"][0]).toBeCloseTo(1000, 0);
  });
});
