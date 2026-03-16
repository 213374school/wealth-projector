import { useCallback } from "react";
import type { Transfer, Account } from "../types";
import { useScenarioStore } from "../store/scenario";

const PERIODS = ["monthly", "quarterly", "half-yearly", "yearly"] as const;
const AMOUNT_TYPES = ["fixed", "percent-balance", "gains-only"] as const;

interface Props {
  transfer: Transfer;
  accounts: Account[];
}

export function TransferEditor({ transfer, accounts }: Props) {
  const updateTransfer = useScenarioStore(s => s.updateTransfer);
  const deleteTransfer = useScenarioStore(s => s.deleteTransfer);
  const inflationEnabled = useScenarioStore(
    s => s.activeScenarioId ? (s.scenarios[s.activeScenarioId]?.inflationEnabled ?? false) : false
  );

  const update = useCallback(<K extends keyof Transfer>(key: K, value: Transfer[K]) => {
    updateTransfer(transfer.id, { [key]: value });
  }, [transfer.id, updateTransfer]);

  const isGainsOnly = transfer.amountType === "gains-only";
  const hasSource = transfer.sourceAccountId !== null;
  const hasTarget = transfer.targetAccountId !== null;

  const handleAmountTypeChange = (val: Transfer["amountType"]) => {
    const updates: Partial<Transfer> = { amountType: val };
    if (val === "gains-only") {
      updates.amount = 0;
      updates.taxBasis = "full";
    }
    updateTransfer(transfer.id, updates);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Transfer</h3>
        <button onClick={() => deleteTransfer(transfer.id)} className="text-red-500 hover:text-red-700 text-sm">Delete</button>
      </div>

      <Field label="Name">
        <input type="text" value={transfer.name} onChange={e => update("name", e.target.value)} className="input" />
      </Field>

      <Field label="Source Account">
        <select
          value={transfer.sourceAccountId ?? ""}
          onChange={e => update("sourceAccountId", e.target.value || null)}
          className="input"
        >
          <option value="">None (external / contribution)</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>

      <Field label="Target Account">
        <select
          value={transfer.targetAccountId ?? ""}
          onChange={e => {
            const val = e.target.value || null;
            const updates: Partial<Transfer> = { targetAccountId: val };
            if (val === null) { updates.taxRate = 0; updates.taxBasis = "full"; }
            updateTransfer(transfer.id, updates);
          }}
          className="input"
        >
          <option value="">None (external / consumption)</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>

      <Field label="Start Date">
        <input
          type="month"
          value={transfer.startDate}
          onChange={e => update("startDate", e.target.value)}
          className="input"
        />
      </Field>

      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">One-time Event</label>
        <input type="checkbox" checked={transfer.isOneTime} onChange={e => update("isOneTime", e.target.checked)} className="mr-1" />
        <span className="text-sm text-gray-700 dark:text-gray-300">Fire once at start date</span>
      </div>

      {!transfer.isOneTime && (
        <>
          <Field label="End Date">
            <input
              type="month"
              value={transfer.endDate ?? ""}
              onChange={e => update("endDate", e.target.value || null)}
              className="input"
            />
          </Field>
          <Field label="Period">
            <select value={transfer.period} onChange={e => update("period", e.target.value as Transfer["period"])} className="input">
              {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </>
      )}

      <Field label="Amount Type">
        <select value={transfer.amountType} onChange={e => handleAmountTypeChange(e.target.value as Transfer["amountType"])} className="input">
          {AMOUNT_TYPES.map(t => (
            <option key={t} value={t} disabled={!hasSource && t !== "fixed"}>{t}</option>
          ))}
        </select>
      </Field>

      {!isGainsOnly && (
        <Field label={
          transfer.amountType === "percent-balance"
            ? "Amount (% of balance)"
            : (transfer.amountType === "fixed" && (transfer.inflationHedged ?? true) === false)
              ? "Amount (today's value)"
              : "Amount"
        }>
          <input
            type="number"
            value={transfer.amountType === "percent-balance" ? (transfer.amount * 100).toFixed(2) : transfer.amount}
            step={transfer.amountType === "percent-balance" ? "0.1" : "100"}
            onChange={e => {
              const v = parseFloat(e.target.value) || 0;
              update("amount", transfer.amountType === "percent-balance" ? v / 100 : v);
            }}
            className="input"
          />
        </Field>
      )}

      {transfer.amountType === "fixed" && (
        <Field label={`Inflation hedged${!inflationEnabled ? " (applies when inflation is enabled)" : ""}`}>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={transfer.inflationHedged ?? true}
              onChange={e => update("inflationHedged", e.target.checked)}
            />
            Fixed nominal amount
          </label>
        </Field>
      )}

      {hasTarget && (
        <>
          <Field label="Tax Rate (%)">
            <input
              type="number"
              value={(transfer.taxRate * 100).toFixed(1)}
              step="0.5"
              min="0"
              max="100"
              onChange={e => update("taxRate", (parseFloat(e.target.value) || 0) / 100)}
              className="input"
            />
          </Field>

          <Field label="Tax Basis">
            <select
              value={transfer.taxBasis}
              disabled={isGainsOnly}
              onChange={e => update("taxBasis", e.target.value as Transfer["taxBasis"])}
              className="input disabled:opacity-50"
            >
              <option value="full">Full amount</option>
              <option value="gains-fraction">Gains fraction only</option>
            </select>
          </Field>
        </>
      )}

      <Field label="Notes">
        <textarea value={transfer.notes ?? ""} onChange={e => update("notes", e.target.value)} rows={2} className="input" />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
