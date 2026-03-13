# FIRE Financial Timeline Tracker — Implementation Spec

## Overview

A web-based financial planning tool targeting the FIRE (Financial Independence, Retire Early) community. Users construct a timeline of financial **Accounts** and **Transfers** that interact over time. A monthly simulation engine computes account balances across the full timeline and renders them as an interactive stacked chart. All parameters are editable in real time, with drag-and-drop timeline manipulation.

---

## 1. Data Model

### 1.0 Shared Types

```ts
type Period = "monthly" | "quarterly" | "half-yearly" | "yearly";
```

Used by both `Account.growthPeriod` and `Transfer.period`.

---

### 1.1 Account

Represents a financial bucket (savings, pension, mortgage, brokerage, cash, etc.).

```ts
interface Account {
  id: string;                  // UUID
  name: string;                // Display name, e.g. "Pension", "Cash"
  color: string;               // Hex color for chart rendering
  startDate: string;           // ISO date (YYYY-MM): when account is created in timeline
  initialBalance: number;      // Opening principal at startDate (can be negative, e.g. mortgage)
  growthRate: number;          // Annual growth rate as decimal, e.g. 0.04 = 4%
  growthPeriod: Period;        // How frequently growth compounds (see shared Period type in 1.0)
  notes?: string;
}
```

**Notes:**
- Accounts with a negative `initialBalance` are valid (loans, mortgages). They will render below zero on the chart.
- There is no enforced floor — accounts can go negative at any time.
- Growth applies to the current balance (including negative balances, which means negative growth = accruing interest on a debt).

---

### 1.2 Transfer

Represents a movement of value between two accounts (or from/to an account and itself), with optional tax/fee applied.

```ts
interface Transfer {
  id: string;                  // UUID
  name: string;                // Display name, e.g. "Pension contribution", "Unrealized gains tax"
  sourceAccountId: string;     // Account funds come from (can equal targetAccountId)
  targetAccountId: string;     // Account funds go into
  startDate: string;           // ISO date (YYYY-MM): first occurrence
  endDate: string | null;      // ISO date (YYYY-MM): last occurrence, null = indefinite. Must be >= startDate if set.
  isOneTime: boolean;          // If true, fires exactly once at startDate; endDate and period are ignored
  amount: number;              // Base amount per occurrence (see amountType)
  amountType: AmountType;      // See below
  period: Period;              // How often this transfer fires: "monthly" | "quarterly" | "half-yearly" | "yearly"
  taxRate: number;             // Fraction of transferred amount lost to tax/fees, e.g. 0.15
  taxBasis: "full" | "gains-fraction"; // What portion of the transfer is subject to tax
  notes?: string;
}

type AmountType =
  | "fixed"            // Transfer exactly `amount` per occurrence
  | "percent-balance"  // Transfer `amount` fraction (decimal) of source account balance at period open
  | "gains-only";      // Transfer the full non-principal portion of the source account (for tax-on-gains use case)
```

**Notes on `amountType`:**
- `fixed`: `amount` is a currency value. E.g. `amount: 10000` = transfer 10,000 per period.
- `percent-balance`: `amount` is a decimal fraction, consistent with `growthRate`. E.g. `amount: 0.04` = transfer 4% of balance per period. The simulation uses `abs(snapshot[source]) * amount` — see section 2.4.
- `gains-only`: `amount` is ignored entirely. The resolved amount is always the full gains portion of the source account (`snapshot[source] - principal[source]`). When creating a transfer with this type, the `amount` field should be set to `0` and the UI should hide or disable the amount input. **Tax basis must be `"full"` when `amountType` is `"gains-only"`** — since the resolved amount is already purely gains, applying `"gains-fraction"` would incorrectly tax only a fraction of the gains. The UI should enforce this by defaulting to `"full"` and disabling the tax basis selector.

**Notes on `taxRate` and `taxBasis`:**
- Tax is always withholding-style: it reduces the net amount received by the target. The source always loses the full `resolvedAmount`.
- `taxBasis: "full"` — tax applies to the entire transferred amount:
  - `taxCost = resolvedAmount × taxRate`
  - `netToTarget = resolvedAmount × (1 - taxRate)`
  - Use for: pension drawdown tax, flat transaction fees, income tax on withdrawals.
- `taxBasis: "gains-fraction"` — tax applies only to the gains portion of the transferred amount, proportional to how much of the source account is gains vs principal at the time of transfer:
  - If `snapshot[source] <= 0`: `gainsRatio = 0` (debts have no taxable gains)
  - Otherwise: `gainsRatio = max(0, snapshot[source] - principal[source]) / snapshot[source]`
  - `taxCost = resolvedAmount × gainsRatio × taxRate`
  - `netToTarget = resolvedAmount - taxCost`
  - Use for: capital gains tax on brokerage withdrawals, where principal is returned tax-free but gains are taxed.
- A `taxRate` of 0 means the full amount passes through regardless of `taxBasis`.

---

### 1.3 Scenario (Root Object)

The top-level object that owns all accounts and transfers and global settings.

```ts
interface Scenario {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  timelineStart: string;       // ISO date (YYYY-MM): left edge of visible timeline
  timelineEnd: string;         // ISO date (YYYY-MM): right edge of visible timeline
  inflationRate: number;       // Annual rate, e.g. 0.02 = 2%. Applied post-simulation.
  inflationEnabled: boolean;
  currencyLocale: string;      // BCP 47 locale string for currency formatting, e.g. "en-US", "sv-SE"
  currencySymbol: string;      // Display symbol, e.g. "$", "£", "kr"
  accounts: Account[];
  transfers: Transfer[];
}
```

---

## 2. Simulation Engine

### 2.1 Core Loop

The simulation runs **month by month** from `timelineStart` to `timelineEnd`. Each month is a discrete tick.

```
for each month M from timelineStart to timelineEnd:
  snapshot         = copy of all account balances at start of M
  principalSnapshot = copy of all principal values at start of M
  for each transfer T active in month M:
    apply T using snapshot values and principalSnapshot values as source amounts
  for each account A:
    apply A's growth using snapshot value of A
  commit all changes to account balances and principal tracker
```

All transfers and growth in a given month see the **opening balance and principal snapshots** — not the mid-period updated values. This eliminates ordering ambiguity and handles circular transfers correctly. Notably, all reads of `principal[source]` in section 2.4 (for `gainsRatio`, `principalFraction`, and `gains-only` resolution) must use `principalSnapshot`, not the live principal tracker. Writes to `principal` accumulate during the tick and are committed at the end of the month.

### 2.2 Determining Active Transfers for Month M

A transfer is **active** in month M if:
- `M >= transfer.startDate`
- `transfer.endDate == null` OR `M <= transfer.endDate`
- `transfer.isOneTime == false` OR `M == transfer.startDate`
- The transfer's recurrence period is due in M (see 2.3)
- `M >= sourceAccount.startDate` AND `M >= targetAccount.startDate`

The last condition prevents transfers from firing against accounts that do not yet exist in the timeline. A transfer whose source or target account hasn't started yet is silently skipped for those months — it does not error.

### 2.3 Period Scheduling

Each transfer fires at intervals defined by its `period`. Relative to the transfer's `startDate`:

| Period        | Fires every N months |
|---------------|----------------------|
| monthly       | 1                    |
| quarterly     | 3                    |
| half-yearly   | 6                    |
| yearly        | 12                   |

A transfer is due in month M if `(M - startDate) mod N == 0`.

Similarly, account growth is applied every N months based on the account's `growthPeriod`. For monthly compounding, it fires every tick. For yearly compounding it fires once a year from the account's `startDate`.

**Rate conversion:** A yearly rate `r` compounded over N months uses the formula:
```
periodRate = (1 + r)^(N/12) - 1
```
This ensures consistent compounding regardless of expressed period.

### 2.4 Applying a Transfer

Given the opening snapshot balance of the source account:

1. **Resolve amount** from `amountType`:
   - `fixed`: use `transfer.amount`
   - `percent-balance`: `abs(snapshot[source]) * transfer.amount`
     - `transfer.amount` is stored as a decimal (e.g. `0.04` = 4%). See data model note in 1.2.
     - `abs()` is applied so that a percentage drawdown from a negative-balance account (e.g. a loan) produces a positive resolved amount representing the magnitude of the movement.
   - `gains-only`: `max(0, snapshot[source] - principalTracker[source])`

2. **Apply tax**:
   - If `taxBasis == "full"`:
     - `taxCost = resolvedAmount × taxRate`
   - If `taxBasis == "gains-fraction"`:
     - Guard: if `snapshot[source] <= 0`, set `gainsRatio = 0` (gains-fraction tax is only meaningful for positive-balance accounts; debts have no taxable gains)
     - Otherwise: `gainsRatio = max(0, (snapshot[source] - principal[source])) / snapshot[source]`
     - `taxCost = resolvedAmount × gainsRatio × taxRate`
   - `netToTarget = resolvedAmount - taxCost`

3. **Deduct from source**: `balance[source] -= resolvedAmount`
   - If source equals target (self-transfer), see note below.

4. **Credit to target**: `balance[target] += netToTarget`

5. **Update principal tracker** (see 2.5)

**Self-transfers** (source == target): Used for the gains-tax use case. The account pays tax on gains and the after-tax amount remains as principal. Effectively: `balance[account] -= taxCost`, `principal[account] = balance[account]` after the transfer. (`taxCost` is the variable computed in step 2 above — do not introduce a separate `taxLost` variable.)

For self-transfers with `amountType == "gains-only"`, the principal tracker update in section 2.5 **skips the proportional debit and credit rules entirely** and applies only the gains-only reset: `principal[account] = balance[account]`. Applying both rules would be wrong — the proportional debit rule is designed for outbound transfers to other accounts, not for the gains-realization pattern.

**Insufficient funds:** No floor is enforced. If `resolvedAmount > snapshot[source]`, the full amount is still moved and the source balance goes negative. The chart will reflect this.

### 2.5 Principal Tracking

Each account maintains a running **principal** value used by the `gains-only` amountType. Principal is initialized to `account.initialBalance`.

Principal is updated as follows:

- When a transfer **credits** an account:
  ```
  principal[target] += netToTarget
  ```

- When a transfer **debits** an account, principal is reduced proportionally to preserve the gains/principal ratio:
  ```
  if snapshot[source] != 0:
    principalFraction = principal[source] / snapshot[source]
  else:
    principalFraction = 1
  principal[source] -= resolvedAmount * principalFraction
  // Clamp: for positive balances, principal cannot go below 0.
  // For negative balances (debts), principal cannot go below the balance itself.
  // Combined as: principal = max(principal, min(0, balance))
  principal[source] = max(principal[source], min(0, balance[source]))
  ```
  This ensures that withdrawing from an account reduces principal and gains in proportion, rather than drawing down one before the other.

- After a **self-transfer** with `gains-only`: 
  ```
  principal[account] = balance[account]
  ```
  The gains have been realized and taxed; all remaining balance is now treated as principal.

### 2.6 Applying Growth

After all transfers are applied to the commit buffer:

```
for each account A:
  if M < A.startDate: skip   // account does not exist yet; no balance, no growth
  if A.growthPeriod is due this month:
    periodRate = (1 + A.growthRate)^(N/12) - 1
    delta = snapshot[A] * periodRate
    balance[A] += delta
    // principal is NOT updated here — growth creates gains, not principal
```

Note: Both transfer deltas and growth deltas are computed independently from the opening snapshot, then all deltas are summed and applied as a single commit at the end of the month. Neither depends on the other's results within the same tick.

**Critical:** Growth must never be added to `principal`. Growth is precisely what creates the gap between `balance` and `principal` — that gap is the taxable gains. If growth were added to principal, `balance` would always equal `principal`, `gains-only` transfers would always resolve to zero, and the entire gains-tax mechanism would silently produce no output.

Accounts that have not yet reached their `startDate` have no balance and receive no growth. Their balance is `undefined` / omitted from the simulation output for those months, and the chart renders nothing (not zero) before the account's start.

### 2.7 Implementation Note: Principal Tracker is Load-Bearing

The principal tracker underpins both the `gains-only` amount type and the `gains-fraction` tax basis. If principal is tracked incorrectly, both of these features will fail silently — producing wrong numbers with no visible error.

**The simulation engine's principal tracker must be implemented and unit tested in complete isolation before any transfer or tax logic that depends on it is written.** The following cases must be verified with concrete numbers before proceeding:

1. **Simple growth**: Account opens at 10,000 principal, grows 10%. Principal should remain 10,000; gains = 1,000.
2. **Fixed transfer in**: Account receives 5,000. Principal increases by 5,000.
3. **Fixed transfer out (no tax)**: Account at 15,000 with 10,000 principal. Transfer out 6,000. Principal reduces proportionally: `6,000 x (10,000 / 15,000) = 4,000` deducted. Principal = 6,000.
4. **Fixed transfer out (gains-fraction tax)**: Same account. Transfer out 6,000 at 30% tax on gains fraction. `gainsRatio = 5,000 / 15,000 = 0.333`. `taxCost = 6,000 x 0.333 x 0.30 = 600`. Source loses 6,000. Target receives 5,400. Principal on source reduces by the same proportional rule as case 3.
5. **Self-transfer (gains-only)**: Account at 15,000 with 10,000 principal. Gains = 5,000. Transfer gains-only back onto itself with 15% tax. `taxCost = 5,000 x 0.15 = 750`. Balance after: `15,000 - 750 = 14,250`. Principal after: `14,250` (all remaining balance is now principal — gains have been realized and taxed).
6. **Gains-only when no gains exist**: Account balance equals principal. Resolved amount = 0. No transfer occurs. No principal change.
7. **Negative balance account**: Principal tracker may go negative (e.g. a loan accruing interest). `gainsRatio` for a negative balance account should resolve to 0 — no taxable gains on a debt.

### 2.8 Inflation Adjustment (Post-Simulation)

Inflation is **not** applied during simulation. After simulation produces a full array of monthly balances, if `inflationEnabled`:

```
for each month M at index i (0-based from timelineStart):
  deflator = (1 + inflationRate)^(i/12)
  displayBalance[A][M] = simulatedBalance[A][M] / deflator
```

This converts all nominal values to real values in `timelineStart` money. Inflation adjustment is purely a display transform — it does not affect the simulation data.

### 2.9 Simulation Output

The engine produces:

```ts
interface SimulationResult {
  months: string[];                                   // Array of ISO month strings
  balances: Record<string, (number | null)[]>;        // accountId -> balance per month; null before account startDate
  principals: Record<string, (number | null)[]>;      // accountId -> principal per month; null before account startDate
}
```

`null` is used (not `0`) for months before an account's `startDate`. The chart layer must treat `null` as an absent segment — rendering nothing for that account in that month rather than a zero-height area. Using `0` would cause the stacked chart to incorrectly include the account in stacking calculations before it exists.

This is recomputed in full on any change to any account or transfer. For typical lifespans (60 years = 720 months) and a small number of accounts, this is fast enough to run synchronously on every edit.

---

## 3. Rendering

### 3.1 Chart

**Type:** Stacked area chart with bidirectional stacking.

- Accounts with **positive balances** stack upward from the zero axis.
- Accounts with **negative balances** stack downward from the zero axis.
- The total net worth line (sum of all accounts) is overlaid as a separate line.
- Each account has a distinct color (user-assignable, with defaults).
- X-axis: time (months), with year labels.
- Y-axis: currency value, with a visible zero line.

**Bidirectional stacking logic:**
- For each month, separate accounts into positive-balance and negative-balance sets.
- Stack positive accounts upward from 0 (order configurable or alphabetical by default).
- Stack negative accounts downward from 0.
- An account that crosses zero mid-timeline should switch stacking zone smoothly — handle by splitting its area at the zero crossing.

**Chart overlays and UI:**
- **Legend**: displayed adjacent to the chart, mapping each account's name to its color. Clicking a legend entry toggles that account's visibility on the chart without removing it from the simulation.
- **Tooltip**: on hover, a vertical crosshair snaps to the nearest month and displays a tooltip showing each account's balance at that month, plus the total net worth. Values should be formatted as currency.
- **Today marker**: a vertical line on both the chart and the timeline ruler indicating the current calendar month. Labeled "Today". This gives users a clear anchor between historical and projected portions of the timeline.

**Recommended library:** [Recharts](https://recharts.org) or [D3.js](https://d3js.org). Recharts is simpler for React integration; D3 gives full control over bidirectional stacking and custom behaviors. Given the complexity of bidirectional stacking and custom timeline interaction, **D3 is recommended**.

### 3.2 Timeline UI

Below the chart, a horizontal timeline ruler spanning `timelineStart` to `timelineEnd`.

Each Transfer and Account is represented as a **horizontal bar** on the timeline:
- Accounts show as thin bars (color-matched) starting at their `startDate` and extending to `timelineEnd`.
- Transfers show as bars from `startDate` to `endDate` (or to `timelineEnd` if indefinite).
- One-time transfers show as a **point/marker** rather than a bar.
- Bars are organized in lanes to avoid overlap.

**Interactions:**
- Drag the **left handle** of a bar to change `startDate`.
- Drag the **right handle** to change `endDate`.
- Drag the **body** of a bar to shift both start and end dates simultaneously.
- Clicking a bar opens the parameter editor panel for that object.
- Dragging snaps to monthly grid by default; holding Shift snaps to yearly.

### 3.3 Parameter Editor Panel

A side panel or modal that opens when an account or transfer is selected. Contains form fields for all parameters of the selected object. Changes apply immediately and trigger a simulation re-run with chart update.

Fields for **Account:**
- Name, color
- Start date
- Initial balance (can be negative)
- Growth rate (%), growth period
- Notes

Fields for **Transfer:**
- Name
- Source account (dropdown), target account (dropdown)
- Start date, end date, one-time toggle
- Amount, amount type (fixed / % of balance / gains only)
- Period (monthly / quarterly / half-yearly / yearly)
- Tax rate (%)
- Tax basis (full amount / gains fraction only)
- Notes



### 3.4 Real-Time Updates

On any parameter change or drag interaction:
1. Update the in-memory Scenario object.
2. Re-run the simulation engine (synchronous, full re-simulation).
3. Re-render the chart and timeline with new data.
4. Debounce rapid inputs (e.g. typing in a number field) by ~150ms to avoid unnecessary re-renders mid-keystroke.

---

## 4. Interaction Model

### 4.1 Adding Objects

- **Add Account** button: creates a new account with default values and its `startDate` set to the current calendar month (or `timelineStart`, whichever is later). Opens the parameter editor immediately.
- **Add Transfer** button: same, but requires user to select source and target accounts before confirming.
- One-time events can be added via the same Add Transfer flow with the one-time toggle enabled.

### 4.2 Deleting Objects

- Delete button in the parameter editor.
- Deleting an account also removes all transfers that reference it (with a confirmation prompt).

### 4.3 Timeline Navigation

- The chart and timeline ruler scroll/zoom together horizontally.
- Pinch-to-zoom or scroll-wheel zooms the time axis.
- Zoom and scroll control a **viewport window** within the fixed simulation range — they do not change `timelineStart` / `timelineEnd` and do not trigger re-simulation. The simulation always covers the full range; the viewport merely controls which portion is visible.
- The timeline range (start/end) is configurable in the scenario settings (changing these does trigger re-simulation).

### 4.4 Global Settings Panel

Accessible via a settings icon. Contains:
- Scenario name
- Timeline start and end dates
- Inflation rate and toggle
- Currency symbol/locale
- Export / Import buttons

---

## 5. Persistence

### 5.1 Local Storage

The active Scenario is serialized as JSON and stored in `localStorage` under a key such as `fire-tracker:scenario:{id}`.

On app load:
1. Read all scenario keys from localStorage.
2. If one or more exist, load the most recently updated one.
3. If none exist, initialize with a default empty scenario.

### 5.2 Multiple Scenarios

Support for saving and switching between multiple named scenarios. A scenario picker (dropdown or modal) allows:
- Creating a new blank scenario
- Duplicating the current scenario
- Deleting a scenario

### 5.3 Serialization Format

The full `Scenario` object (defined in section 1.3) is the serialization unit. It is self-contained and human-readable JSON. All dates are ISO strings (`YYYY-MM`). All rates are stored as decimals.

### 5.4 Export / Import

- **Export:** Triggers a download of the current scenario as a `.json` file.
- **Import:** Accepts a `.json` file, validates the schema, and loads it as a new scenario. Validation should check: (1) all required fields are present and correctly typed, (2) all `sourceAccountId` / `targetAccountId` values reference account IDs that exist in the file, (3) dates are valid `YYYY-MM` strings, and (4) rates are numeric. On validation failure, reject the entire file and display the first error encountered. Do not attempt partial imports.

This serves as the sharing mechanism for the prototype (users can share scenario files with each other).

---

## 6. Tech Stack (Recommended)

| Concern | Recommendation | Rationale |
|---|---|---|
| Framework | React (+ Vite) | Component model fits the panel/chart/timeline architecture well |
| Charting | D3.js | Bidirectional stacking and custom timeline dragging require low-level control |
| State management | Zustand or React Context | Scenario state needs to be shared across chart, timeline, and editor panel |
| Styling | Tailwind CSS | Utility-first, fast to iterate |
| Persistence | localStorage | No backend for prototype |
| Language | TypeScript | Data model complexity warrants type safety |

---

## 7. Key Constraints and Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Account goes negative | Balance tracked normally; renders below zero on chart |
| Transfer source has insufficient funds | Transfer fires fully; source goes negative |
| Transfer amount exceeds gains-only available | Amount resolves to 0; no transfer occurs that period |
| Circular transfers between two accounts | Both fire against opening snapshot; no infinite loop |
| Account starts after timeline start | No balance until startDate; chart renders nothing (not zero) before that |
| Transfer with no end date | Runs to timelineEnd |
| Growth rate of 0 | Valid; account balance changes only from transfers |
| Negative growth rate | Valid; models depreciating assets |
| Inflation disabled | All chart values are nominal |
| Inflation enabled | All chart values deflated to real (timelineStart) terms |
| `gains-fraction` tax with zero or negative balance | `gainsRatio` resolves to 0; no tax cost; full amount passes to target |
| `percent-balance` transfer from negative account | `abs(snapshot[source])` used; produces a positive resolved amount |
| Transfer references account that hasn't started yet | Transfer silently skipped for those months |
| Account balance before its `startDate` | Undefined / omitted; chart renders nothing, not zero |
| `gains-only` transfer with no gains | Resolved amount = 0; transfer skipped silently for that period |
| `gains-only` transfer with `taxBasis: "gains-fraction"` | Invalid combination; UI enforces `taxBasis: "full"` when `amountType` is `"gains-only"` |
